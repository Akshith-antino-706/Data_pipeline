"""
=============================================================
  MySQL (x2)  ->  PostgreSQL  |  INCREMENTAL Sync

  Pulls only NEW/UPDATED rows since last sync.
  Uses sync_metadata table to track last sync time per table.
  Safe to run repeatedly (idempotent via ON CONFLICT).

  HOW TO RUN:
      python incremental_sync.py              # sync all
      python incremental_sync.py contacts     # sync one table
      python incremental_sync.py --full       # force full re-sync
=============================================================
"""

import pymysql
import psycopg2
from datetime import datetime, timedelta
import sys
import time

# ---------------------------------------------
#  CONFIG
# ---------------------------------------------

MYSQL_DB1 = dict(
    host="95.211.169.194", port=3306,
    user="sowmya_new", password="sowmya@756",
    db="rayna_data", charset="utf8mb4",
)

MYSQL_DB2 = dict(
    host="5.79.64.193", port=3306,
    user="sowmya_new", password="sowmya@756",
    db="rayna_data", charset="utf8mb4",
)

POSTGRES = dict(
    host="localhost", port=5432,
    dbname="rayna_data_pipe",
    user="akshithkumaryv", password="7884",
)

BATCH_SIZE = 5000

# ---------------------------------------------
#  HELPERS
# ---------------------------------------------

def log(msg, level="INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    icons = {"INFO": "->", "OK": "[OK]", "WARN": "[!]", "ERR": "[X]", "PROG": ".."}
    print(f"  {ts} {icons.get(level, '*')} {msg}", flush=True)

def fmt_num(n): return f"{n:,}"
def fmt_elapsed(start):
    secs = time.time() - start
    return f"{secs:.0f}s" if secs < 60 else f"{secs/60:.1f}min"

def clean_date(val):
    if val is None: return None
    s = str(val)
    if s.startswith("0000"): return None
    return val

def mysql_conn(cfg):
    return pymysql.connect(
        host=cfg["host"], port=cfg["port"],
        user=cfg["user"], password=cfg["password"],
        database=cfg["db"], charset=cfg["charset"],
        cursorclass=pymysql.cursors.SSDictCursor,
        connect_timeout=30, read_timeout=7200,
    )

# ---------------------------------------------
#  SYNC METADATA
# ---------------------------------------------

def get_last_sync(pg_cur, table_name):
    pg_cur.execute(
        "SELECT last_synced_at FROM sync_metadata WHERE table_name = %s",
        (f"incr_{table_name}",)
    )
    row = pg_cur.fetchone()
    if row and row[0]:
        return row[0]
    return datetime.now() - timedelta(days=365)

def update_sync_meta(pg_cur, table_name, rows_synced, status, duration_ms, error=None):
    pg_cur.execute("""
        INSERT INTO sync_metadata (table_name, rows_synced, sync_status, error_message, sync_duration_ms, last_synced_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
        ON CONFLICT (table_name) DO UPDATE SET
            rows_synced = EXCLUDED.rows_synced,
            sync_status = EXCLUDED.sync_status,
            error_message = EXCLUDED.error_message,
            sync_duration_ms = EXCLUDED.sync_duration_ms,
            last_synced_at = CASE WHEN EXCLUDED.sync_status = 'success' THEN NOW() ELSE sync_metadata.last_synced_at END,
            updated_at = NOW()
    """, (f"incr_{table_name}", rows_synced, status, error, duration_ms))

# ---------------------------------------------
#  IDENTITY CACHE (loaded from PG at start)
# ---------------------------------------------

email_cache = {}
phone_cache = {}

def load_identity_cache(pg_cur):
    global email_cache, phone_cache
    log("Loading identity cache from PostgreSQL...")
    pg_cur.execute("SELECT email, user_id FROM user_emails")
    for row in pg_cur.fetchall():
        email_cache[row[0].lower().strip()] = row[1]
    pg_cur.execute("SELECT phone, user_id FROM user_phones")
    for row in pg_cur.fetchall():
        phone_cache[row[0].strip()] = row[1]
    log(f"Cache loaded: {fmt_num(len(email_cache))} emails, {fmt_num(len(phone_cache))} phones", "OK")

def get_or_create_user(pg_cur, emails=None, phones=None, name=None,
                       city=None, country=None, contact_type=None,
                       contact_status=None, source=None,
                       company_name=None, designation=None, dob=None,
                       website=None, cstate=None, pincode=None,
                       address_line1=None, address_line2=None,
                       created_at=None, updated_at=None):
    clean_emails = [str(e).strip().lower() for e in (emails or []) if e and str(e).strip()]
    clean_phones = []
    for p in (phones or []):
        if isinstance(p, (list, tuple)):
            num, ptype = p[0], p[1] if len(p) > 1 else "mobile"
        else:
            num, ptype = p, "mobile"
        if num and str(num).strip():
            clean_phones.append((str(num).strip(), ptype))

    if not clean_emails and not clean_phones:
        return None

    user_id = None
    for e in clean_emails:
        if e in email_cache:
            user_id = email_cache[e]; break
    if not user_id:
        for num, _ in clean_phones:
            if num in phone_cache:
                user_id = phone_cache[num]; break

    if not user_id:
        pg_cur.execute("""
            INSERT INTO users (name, primary_email, mobile, city, country,
                               contact_type, contact_status, source,
                               company_name, designation, dob, website,
                               cstate, pincode, address_line1, address_line2,
                               created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (
            name, clean_emails[0] if clean_emails else None,
            clean_phones[0][0] if clean_phones else None,
            city, country, contact_type, contact_status or "new", source,
            company_name, designation, dob, website,
            cstate, pincode, address_line1, address_line2,
            created_at, updated_at,
        ))
        user_id = pg_cur.fetchone()[0]

    for e in clean_emails:
        if e not in email_cache:
            pg_cur.execute("INSERT INTO user_emails (user_id, email, source) VALUES (%s, %s, %s) ON CONFLICT (email) DO NOTHING", (user_id, e, source))
            email_cache[e] = user_id
    for num, ptype in clean_phones:
        if num not in phone_cache:
            pg_cur.execute("INSERT INTO user_phones (user_id, phone, phone_type) VALUES (%s, %s, %s) ON CONFLICT (user_id, phone) DO NOTHING", (user_id, num, ptype))
            phone_cache[num] = user_id

    return user_id

# ---------------------------------------------
#  INCREMENTAL SYNC FUNCTIONS
# ---------------------------------------------

def sync_contacts(pg_cur, pg_conn, since, force_full=False):
    log(f"Syncing contacts since {since}...")
    t0 = time.time()
    conn = mysql_conn(MYSQL_DB1)
    cur = conn.cursor()
    cur.execute("SELECT * FROM contacts WHERE updated_at > %s ORDER BY updated_at", (since,))
    processed = 0
    for row in cur:
        pg_cur.execute("SAVEPOINT rsp")
        try:
            def split_field(val):
                return [v.strip() for v in str(val).split(",") if v.strip()] if val else []
            emails = [row.get("email")] + split_field(row.get("email2"))
            phones = ([(row.get("mobile"), "mobile")] + [(m, "mobile2") for m in split_field(row.get("mobile2"))] +
                      [(row.get("phone"), "phone")] + [(p, "phone2") for p in split_field(row.get("phone2"))])
            get_or_create_user(pg_cur, emails=emails, phones=phones,
                name=row.get("name"), city=row.get("city"), country=row.get("country_name"),
                contact_type=row.get("contact_type"), contact_status=row.get("contact_status"),
                source="db1_contacts", company_name=row.get("company_name"),
                designation=row.get("designation"), dob=row.get("dob"),
                created_at=row.get("created_at"), updated_at=row.get("updated_at"))
            pg_cur.execute("RELEASE SAVEPOINT rsp")
            processed += 1
        except:
            pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
        if processed % BATCH_SIZE == 0:
            pg_conn.commit()
            log(f"  contacts: {fmt_num(processed)} synced...", "PROG")
    cur.close(); conn.close(); pg_conn.commit()
    log(f"Contacts: {fmt_num(processed)} synced | {fmt_elapsed(t0)}", "OK")
    return processed

def sync_tickets(pg_cur, pg_conn, since, force_full=False):
    log(f"Syncing tickets since {since}...")
    t0 = time.time()
    conn = mysql_conn(MYSQL_DB1)
    cur = conn.cursor()
    cur.execute("SELECT * FROM tickets WHERE updated_at > %s ORDER BY updated_at", (since,))
    processed = 0
    for row in cur:
        t_from = (row.get("t_from") or "").strip().lower()
        user_id = email_cache.get(t_from)
        pg_cur.execute("SAVEPOINT rsp")
        try:
            pg_cur.execute("""
                INSERT INTO tickets (orig_id, user_id, subject, body, t_from, from_name,
                    t_to, cc, channel, priority, status, seen, due_at, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (orig_id) DO UPDATE SET
                    user_id=EXCLUDED.user_id, subject=EXCLUDED.subject, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at
            """, (row.get("id"), user_id, row.get("subject"), row.get("body"),
                  row.get("t_from"), row.get("from_name"), row.get("t_to"), row.get("cc"),
                  row.get("channel"), row.get("priority", 1), row.get("status", 0),
                  row.get("seen", 0), clean_date(row.get("due")),
                  clean_date(row.get("created_at")), clean_date(row.get("updated_at"))))
            pg_cur.execute("RELEASE SAVEPOINT rsp")
            processed += 1
        except:
            pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
        if processed % BATCH_SIZE == 0:
            pg_conn.commit()
            log(f"  tickets: {fmt_num(processed)} synced...", "PROG")
    cur.close(); conn.close(); pg_conn.commit()
    log(f"Tickets: {fmt_num(processed)} synced | {fmt_elapsed(t0)}", "OK")
    return processed

def sync_travel(pg_cur, pg_conn, since, force_full=False):
    log(f"Syncing travel bookings since {since}...")
    t0 = time.time()
    conn = mysql_conn(MYSQL_DB1)
    cur = conn.cursor()
    cur.execute("SELECT * FROM travel_data WHERE added_date > %s ORDER BY added_date", (since,))
    processed = 0
    for row in cur:
        pg_cur.execute("SAVEPOINT rsp")
        try:
            user_id = get_or_create_user(pg_cur,
                emails=[row.get("email")], phones=[(row.get("contact"), "phone")],
                name=row.get("guest_name"), source="db1_travel",
                created_at=clean_date(row.get("added_date")))
            pg_cur.execute("""
                INSERT INTO travel_bookings (orig_id, user_id, bill_serial, bill_number, bill_type,
                    service_name, guest_name, nationality, contact, start_date, end_date, bill_made_by, added_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (orig_id) DO NOTHING
            """, (row.get("id"), user_id, row.get("bill_serial"), row.get("bill_number"),
                  row.get("bill_type"), row.get("service_name"), row.get("guest_name"),
                  row.get("nationality"), row.get("contact"),
                  clean_date(row.get("start_date")), clean_date(row.get("last_date")),
                  row.get("bill_made_by"), clean_date(row.get("added_date"))))
            pg_cur.execute("RELEASE SAVEPOINT rsp")
            processed += 1
        except:
            pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
        if processed % BATCH_SIZE == 0:
            pg_conn.commit()
            log(f"  travel: {fmt_num(processed)} synced...", "PROG")
    cur.close(); conn.close(); pg_conn.commit()
    log(f"Travel: {fmt_num(processed)} synced | {fmt_elapsed(t0)}", "OK")
    return processed

def sync_chats(pg_cur, pg_conn, since, force_full=False):
    log(f"Syncing chats since {since}...")
    t0 = time.time()
    conn = mysql_conn(MYSQL_DB2)
    cur = conn.cursor()
    cur.execute("SELECT * FROM chats WHERE updated_at > %s ORDER BY updated_at", (since,))
    processed = 0
    for row in cur:
        pg_cur.execute("SAVEPOINT rsp")
        try:
            emails = [row.get("email")] if row.get("email") else []
            phones = [(row.get("wa_id"), "whatsapp")] if row.get("wa_id") else []
            if not emails and not phones:
                pg_cur.execute("RELEASE SAVEPOINT rsp"); continue
            user_id = get_or_create_user(pg_cur, emails=emails, phones=phones,
                name=row.get("wa_name"), country=row.get("country"),
                source="db2_chats", created_at=clean_date(row.get("created_at")),
                updated_at=clean_date(row.get("updated_at")))
            pg_cur.execute("""
                INSERT INTO chats (orig_id, user_id, wa_id, wa_name, country, receiver,
                    status, priority, tags, last_msg_at, last_short, seen, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (orig_id) DO UPDATE SET
                    last_msg_at=EXCLUDED.last_msg_at, last_short=EXCLUDED.last_short,
                    status=EXCLUDED.status, updated_at=EXCLUDED.updated_at
            """, (row.get("id"), user_id, row.get("wa_id"), row.get("wa_name"),
                  row.get("country"), row.get("receiver"),
                  row.get("status", 0), row.get("priority", 4), row.get("tags"),
                  clean_date(row.get("last_msg")), row.get("last_short"),
                  row.get("seen", 1), clean_date(row.get("created_at")),
                  clean_date(row.get("updated_at"))))
            pg_cur.execute("RELEASE SAVEPOINT rsp")
            processed += 1
        except:
            pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
        if processed % BATCH_SIZE == 0:
            pg_conn.commit()
            log(f"  chats: {fmt_num(processed)} synced...", "PROG")
    cur.close(); conn.close(); pg_conn.commit()
    log(f"Chats: {fmt_num(processed)} synced | {fmt_elapsed(t0)}", "OK")
    return processed

def sync_unsubscribed(pg_cur, pg_conn, since, force_full=False):
    log(f"Syncing unsubscribed...")
    t0 = time.time()
    conn = mysql_conn(MYSQL_DB1)
    cur = conn.cursor()
    cur.execute("SELECT * FROM unsubscribed")
    processed = 0
    for row in cur:
        pg_cur.execute("SAVEPOINT rsp")
        try:
            pg_cur.execute("""
                INSERT INTO unsubscribed (id, email, message_ids, delivered, clicks, opens, soft_bounces, hard_bounces, unsubscribe, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO UPDATE SET
                    delivered=EXCLUDED.delivered, clicks=EXCLUDED.clicks, opens=EXCLUDED.opens,
                    soft_bounces=EXCLUDED.soft_bounces, hard_bounces=EXCLUDED.hard_bounces, unsubscribe=EXCLUDED.unsubscribe
            """, (row["id"], row.get("email"), row.get("message_ids"),
                  row.get("delivered"), row.get("clicks"), row.get("opens"),
                  row.get("soft_bounces"), row.get("hard_bounces"),
                  row.get("unsubscribe"), row.get("created_at")))
            pg_cur.execute("RELEASE SAVEPOINT rsp")
            processed += 1
        except:
            pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
        if processed % BATCH_SIZE == 0:
            pg_conn.commit()
    cur.close(); conn.close(); pg_conn.commit()

    # Update user flags
    pg_cur.execute("""UPDATE users u SET is_unsubscribed = true
        FROM unsubscribed uns WHERE LOWER(TRIM(u.primary_email)) = LOWER(TRIM(uns.email)) AND uns.unsubscribe = 1 AND (u.is_unsubscribed IS NULL OR u.is_unsubscribed = false)""")
    pg_cur.execute("""UPDATE users u SET is_hard_bounced = true
        FROM unsubscribed uns WHERE LOWER(TRIM(u.primary_email)) = LOWER(TRIM(uns.email)) AND uns.hard_bounces::int > 0 AND (u.is_hard_bounced IS NULL OR u.is_hard_bounced = false)""")
    pg_conn.commit()
    log(f"Unsubscribed: {fmt_num(processed)} synced | {fmt_elapsed(t0)}", "OK")
    return processed

# ---------------------------------------------
#  MAIN
# ---------------------------------------------

SYNC_TABLES = {
    "contacts": sync_contacts,
    "tickets": sync_tickets,
    "travel": sync_travel,
    "chats": sync_chats,
    "unsubscribed": sync_unsubscribed,
}

def main():
    args = sys.argv[1:]
    force_full = "--full" in args
    tables = [a for a in args if a != "--full"] or list(SYNC_TABLES.keys())

    print(f"\n{'='*50}")
    print(f"  Incremental Sync {'(FULL)' if force_full else ''}")
    print(f"  Tables: {', '.join(tables)}")
    print(f"{'='*50}\n")

    t_start = time.time()
    pg_conn = psycopg2.connect(**POSTGRES)
    pg_conn.autocommit = False
    pg_cur = pg_conn.cursor()

    try:
        load_identity_cache(pg_cur)

        for table in tables:
            fn = SYNC_TABLES.get(table)
            if not fn:
                log(f"Unknown table: {table}", "ERR"); continue

            since = datetime(2000, 1, 1) if force_full else get_last_sync(pg_cur, table)
            t0 = time.time()
            update_sync_meta(pg_cur, table, 0, "running", 0)
            pg_conn.commit()

            try:
                rows = fn(pg_cur, pg_conn, since, force_full)
                update_sync_meta(pg_cur, table, rows, "success", int((time.time() - t0) * 1000))
            except Exception as e:
                pg_conn.rollback()
                log(f"{table} FAILED: {e}", "ERR")
                update_sync_meta(pg_cur, table, 0, "error", int((time.time() - t0) * 1000), str(e))
            pg_conn.commit()

        # Summary
        print(f"\n{'='*50}")
        for label, q in [
            ("Users", "SELECT COUNT(*) FROM users"),
            ("Emails", "SELECT COUNT(*) FROM user_emails"),
            ("Phones", "SELECT COUNT(*) FROM user_phones"),
            ("Tickets", "SELECT COUNT(*) FROM tickets"),
            ("Bookings", "SELECT COUNT(*) FROM travel_bookings"),
            ("Chats", "SELECT COUNT(*) FROM chats"),
            ("Unsubscribed", "SELECT COUNT(*) FROM unsubscribed"),
        ]:
            pg_cur.execute(q)
            log(f"{label:<15} {pg_cur.fetchone()[0]:>10,}", "OK")
        print(f"{'='*50}")
        log(f"Total time: {fmt_elapsed(t_start)}", "OK")

    except Exception as e:
        pg_conn.rollback()
        log(f"FATAL: {e}", "ERR")
        import traceback; traceback.print_exc()
    finally:
        pg_cur.close(); pg_conn.close()

if __name__ == "__main__":
    main()
