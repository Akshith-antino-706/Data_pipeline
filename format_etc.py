"""
=============================================================
  MySQL (x2)  ->  PostgreSQL  |  FULL Data Migration
 
  Account 1: contacts, tickets, travel_data, departments, department_emails
  Account 2: chats, departments
 
  Identity matching: by email + phone number
  ALL data migrated (no date filter)
  Streaming + in-memory caching for 4M+ rows
=============================================================
 
INSTALL REQUIREMENTS:
    pip install pymysql psycopg2-binary
 
HOW TO RUN:
    python migrate_to_postgres.py
=============================================================
"""
 
import pymysql
import psycopg2
from contextlib import contextmanager
from datetime import datetime
import sys
import time
 
# ---------------------------------------------
#  CONFIG
# ---------------------------------------------
 
MYSQL_DB1 = dict(
    host     = "95.211.169.194",
    port     = 3306,
    user     = "sowmya_new",
    password = "sowmya@756",
    db       = "rayna_data",
    charset  = "utf8mb4",
)
 
MYSQL_DB2 = dict(
    host     = "5.79.64.193",
    port     = 3306,
    user     = "sowmya_new",
    password = "sowmya@756",
    db       = "rayna_data",
    charset  = "utf8mb4",
)
 
POSTGRES = dict(
    host     = "localhost",
    port     = 5432,
    dbname   = "rayna_data_pipe",
    user     = "akshithkumaryv",
    password = "7884",
)
 
BATCH_SIZE = 5000   # commit + log progress every N rows

# Pull ALL data (no date filter)
ONE_YEAR_AGO = "2000-01-01 00:00:00"
 
# ---------------------------------------------
#  HELPERS
# ---------------------------------------------
 
def mysql_conn(cfg):
    return pymysql.connect(
        host=cfg["host"], port=cfg["port"],
        user=cfg["user"], password=cfg["password"],
        database=cfg["db"], charset=cfg["charset"],
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )
 
@contextmanager
def mysql_stream(cfg, query, params=None):
    """Stream rows from MySQL using server-side cursor (constant memory)."""
    conn = pymysql.connect(
        host=cfg["host"], port=cfg["port"],
        user=cfg["user"], password=cfg["password"],
        database=cfg["db"], charset=cfg["charset"],
        cursorclass=pymysql.cursors.SSDictCursor,
        connect_timeout=30,
        read_timeout=7200,
    )
    cur = conn.cursor()
    try:
        cur.execute(query, params or [])
        yield cur
    finally:
        cur.close()
        conn.close()
 
def mysql_count(cfg, table):
    conn = mysql_conn(cfg)
    cur = conn.cursor()
    cur.execute(f"SELECT COUNT(*) as c FROM `{table}`")
    count = cur.fetchone()["c"]
    cur.close()
    conn.close()
    return count
 
def log(msg, level="INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    icons = {"INFO": "->", "OK": "[OK]", "WARN": "[!]", "ERR": "[X]", "PROG": ".."}
    print(f"  {ts} {icons.get(level, '*')} {msg}")
 
def section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")
 
def fmt_elapsed(start):
    secs = time.time() - start
    if secs < 60:
        return f"{secs:.0f}s"
    return f"{secs/60:.1f}min"
 
def fmt_num(n):
    return f"{n:,}"
 
def clean_date(val):
    """Convert MySQL '0000-00-00' invalid dates to None for PostgreSQL."""
    if val is None:
        return None
    s = str(val)
    if s.startswith("0000-00-00") or s.startswith("0000"):
        return None
    return val
 
# ---------------------------------------------
#  IN-MEMORY IDENTITY CACHE
# ---------------------------------------------
 
email_cache = {}   # normalized_email -> pg_user_id
phone_cache = {}   # normalized_phone -> pg_user_id
 
def get_or_create_user(pg_cur, emails=None, phones=None, name=None,
                        city=None, country=None, contact_type=None,
                        contact_status=None, created_at=None,
                        updated_at=None, source=None,
                        company_name=None, designation=None, dob=None,
                        website=None, cstate=None, pincode=None,
                        address_line1=None, address_line2=None):
    """
    Fast identity resolution with in-memory cache.
    Priority: email match > phone match > create new user.
    All emails and phones get registered for the matched/created user.
    """
    clean_emails = []
    for e in (emails or []):
        if e and str(e).strip():
            clean_emails.append(str(e).strip().lower())
 
    clean_phones = []
    for p in (phones or []):
        if isinstance(p, (list, tuple)):
            num = p[0]
            ptype = p[1] if len(p) > 1 else "mobile"
        else:
            num, ptype = p, "mobile"
        if num and str(num).strip():
            clean_phones.append((str(num).strip(), ptype))
 
    if not clean_emails and not clean_phones:
        return None
 
    user_id = None
 
    # 1. Email cache lookup (strongest match)
    for e in clean_emails:
        if e in email_cache:
            user_id = email_cache[e]
            break
 
    # 2. Phone cache lookup
    if not user_id:
        for num, _ in clean_phones:
            if num in phone_cache:
                user_id = phone_cache[num]
                break
 
    # 3. No match -> create new user
    if not user_id:
        primary_email = clean_emails[0] if clean_emails else None
        primary_mobile = clean_phones[0][0] if clean_phones else None
        pg_cur.execute("""
            INSERT INTO users (name, primary_email, mobile, city, country,
                               contact_type, contact_status, source,
                               company_name, designation, dob, website,
                               cstate, pincode, address_line1, address_line2,
                               created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (
            name, primary_email, primary_mobile, city, country,
            contact_type, contact_status or "new", source,
            company_name, designation, dob, website,
            cstate, pincode, address_line1, address_line2,
            created_at, updated_at,
        ))
        user_id = pg_cur.fetchone()[0]
 
    # 4. Register new emails
    for e in clean_emails:
        if e not in email_cache:
            pg_cur.execute("""
                INSERT INTO user_emails (user_id, email, source)
                VALUES (%s, %s, %s) ON CONFLICT (email) DO NOTHING
            """, (user_id, e, source))
            email_cache[e] = user_id
 
    # 5. Register new phones
    for num, ptype in clean_phones:
        if num not in phone_cache:
            pg_cur.execute("""
                INSERT INTO user_phones (user_id, phone, phone_type)
                VALUES (%s, %s, %s) ON CONFLICT (user_id, phone) DO NOTHING
            """, (user_id, num, ptype))
            phone_cache[num] = user_id
 
    return user_id
 
# ---------------------------------------------
#  SCHEMA
# ---------------------------------------------
 
CREATE_SCHEMA = """
DROP TABLE IF EXISTS chats CASCADE;
DROP TABLE IF EXISTS travel_bookings CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS user_phones CASCADE;
DROP TABLE IF EXISTS user_emails CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS dept_emails CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP VIEW IF EXISTS user_360_last_month CASCADE;
 
CREATE TABLE departments (
    id          SERIAL PRIMARY KEY,
    orig_id     INT,
    source      VARCHAR(10),
    name        VARCHAR(95)  NOT NULL,
    description TEXT,
    connection  VARCHAR(250),
    status      INT          DEFAULT 1,
    created_at  TIMESTAMP    DEFAULT NOW(),
    UNIQUE(orig_id, source)
);
 
CREATE TABLE dept_emails (
    id      SERIAL PRIMARY KEY,
    dept_id INT REFERENCES departments(id) ON DELETE CASCADE,
    email   VARCHAR(100) NOT NULL,
    status  INT DEFAULT 1,
    UNIQUE(dept_id, email)
);
 
CREATE TABLE employees (
    id         SERIAL PRIMARY KEY,
    dept_id    INT REFERENCES departments(id),
    name       VARCHAR(75),
    email      VARCHAR(100),
    status     INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);
 
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(100),
    primary_email  VARCHAR(120),
    mobile         VARCHAR(50),
    city           VARCHAR(50),
    country        VARCHAR(50),
    contact_type   VARCHAR(20),
    contact_status VARCHAR(20) DEFAULT 'new',
    assign_to      INT REFERENCES employees(id),
    source         VARCHAR(20),
    company_name   VARCHAR(100),
    designation    VARCHAR(100),
    dob            VARCHAR(25),
    website        VARCHAR(150),
    cstate         VARCHAR(30),
    pincode        VARCHAR(20),
    address_line1  TEXT,
    address_line2  TEXT,
    created_at     TIMESTAMP,
    updated_at     TIMESTAMP
);
 
CREATE TABLE user_emails (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email      VARCHAR(120) NOT NULL,
    source     VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(email)
);
 
CREATE TABLE user_phones (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone      VARCHAR(120) NOT NULL,
    phone_type VARCHAR(10) DEFAULT 'mobile',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, phone)
);
 
CREATE INDEX idx_phones_phone ON user_phones(phone);
 
CREATE TABLE tickets (
    id           SERIAL PRIMARY KEY,
    orig_id      INT UNIQUE,
    user_id      INT REFERENCES users(id),
    dept_id      INT REFERENCES departments(id),
    assigned_emp INT REFERENCES employees(id),
    subject      VARCHAR(150),
    body         TEXT,
    t_from       VARCHAR(100),
    from_name    VARCHAR(75),
    t_to         VARCHAR(150),
    cc           TEXT,
    channel      INT,
    priority     INT     DEFAULT 1,
    status       INT     DEFAULT 0,
    seen         INT     DEFAULT 0,
    due_at       TIMESTAMP,
    created_at   TIMESTAMP,
    updated_at   TIMESTAMP
);
 
CREATE TABLE travel_bookings (
    id              SERIAL PRIMARY KEY,
    orig_id         INT UNIQUE,
    user_id         INT REFERENCES users(id),
    bill_serial     BIGINT,
    bill_number     BIGINT,
    bill_type       VARCHAR(50),
    service_name    TEXT,
    guest_name      VARCHAR(50),
    nationality     VARCHAR(30),
    contact         VARCHAR(70),
    start_date      DATE,
    end_date        DATE,
    bill_made_by    VARCHAR(25),
    added_at        TIMESTAMP
);
 
CREATE TABLE chats (
    id           SERIAL PRIMARY KEY,
    orig_id      INT UNIQUE,
    user_id      INT REFERENCES users(id),
    assigned_emp INT REFERENCES employees(id),
    wa_id        VARCHAR(25),
    wa_name      VARCHAR(30),
    country      VARCHAR(50),
    receiver     VARCHAR(25),
    status       INT DEFAULT 0,
    priority     INT DEFAULT 4,
    tags         VARCHAR(510),
    last_msg_at  TIMESTAMP,
    last_short   VARCHAR(65),
    seen         INT DEFAULT 1,
    created_at   TIMESTAMP,
    updated_at   TIMESTAMP
);
 
CREATE INDEX idx_tickets_user ON tickets(user_id);
CREATE INDEX idx_travel_user ON travel_bookings(user_id);
CREATE INDEX idx_chats_user ON chats(user_id);
 
-- 360 view: last 1 year activity summary
CREATE OR REPLACE VIEW user_360_last_month AS
SELECT
    u.id, u.name, u.primary_email, u.mobile,
    u.city, u.country, u.contact_status, u.source,
    (SELECT STRING_AGG(ue.email, ', ')
     FROM user_emails ue WHERE ue.user_id = u.id)  AS all_emails,
    (SELECT STRING_AGG(up.phone, ', ')
     FROM user_phones up WHERE up.user_id = u.id)  AS all_phones,
    COUNT(DISTINCT t.id)                            AS total_tickets,
    COUNT(DISTINCT t.id)
        FILTER (WHERE t.status = 0)                AS open_tickets,
    COUNT(DISTINCT c.id)                            AS total_chats,
    MAX(c.last_msg_at)                              AS last_chat_at,
    COUNT(DISTINCT tb.id)                           AS total_bookings,
    MAX(tb.start_date)                              AS last_travel_date
FROM users u
LEFT JOIN tickets         t  ON t.user_id = u.id
                             AND t.created_at >= NOW() - INTERVAL '1 month'
LEFT JOIN chats           c  ON c.user_id = u.id
                             AND c.created_at >= NOW() - INTERVAL '1 month'
LEFT JOIN travel_bookings tb ON tb.user_id = u.id
                             AND tb.added_at >= NOW() - INTERVAL '1 month'
WHERE
    u.created_at >= NOW() - INTERVAL '1 month'
    OR t.id IS NOT NULL OR c.id IS NOT NULL OR tb.id IS NOT NULL
GROUP BY u.id, u.name, u.primary_email, u.mobile,
         u.city, u.country, u.contact_status, u.source;
"""
 
# ---------------------------------------------
#  SETUP
# ---------------------------------------------
 
def setup_postgres():
    section("STEP 1 -- Setting up PostgreSQL")
 
    cfg = {**POSTGRES, "dbname": "postgres"}
    try:
        conn = psycopg2.connect(**cfg)
        conn.autocommit = True
        cur = conn.cursor()
        db_name = POSTGRES["dbname"]
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
        if not cur.fetchone():
            cur.execute(f'CREATE DATABASE "{db_name}"')
            log(f"Created database '{db_name}'", "OK")
        else:
            log(f"Database '{db_name}' exists", "INFO")
        cur.close()
        conn.close()
    except Exception as e:
        log(f"Cannot connect to PostgreSQL: {e}", "ERR")
        sys.exit(1)
 
    conn = psycopg2.connect(**POSTGRES)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(CREATE_SCHEMA)
    log("Tables + indexes + views created (clean slate)", "OK")
    cur.close()
    conn.close()
 
# ---------------------------------------------
#  LOAD DEPARTMENTS (small tables, fetchall)
# ---------------------------------------------
 
def load_departments(pg_cur, pg_conn):
    section("STEP 2 -- Loading departments")
    inserted = 0
 
    # DB1
    try:
        conn = mysql_conn(MYSQL_DB1)
        cur = conn.cursor()
        cur.execute("SELECT * FROM departments")
        for row in cur.fetchall():
            pg_cur.execute("SAVEPOINT rsp")
            try:
                pg_cur.execute("""
                    INSERT INTO departments (orig_id, source, name, status)
                    VALUES (%s, 'db1', %s, %s)
                    ON CONFLICT (orig_id, source) DO NOTHING
                """, (row["id"], row["name"], row.get("status", 1)))
                did_insert = pg_cur.rowcount > 0
                pg_cur.execute("RELEASE SAVEPOINT rsp")
                if did_insert:
                    inserted += 1
            except Exception as e:
                pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
                log(f"dept db1 skip: {e}", "WARN")
        cur.close()
        conn.close()
    except Exception as e:
        log(f"DB1 departments error: {e}", "WARN")
 
    # DB2
    try:
        conn = mysql_conn(MYSQL_DB2)
        cur = conn.cursor()
        cur.execute("SELECT * FROM departments")
        for row in cur.fetchall():
            pg_cur.execute("SAVEPOINT rsp")
            try:
                pg_cur.execute("""
                    INSERT INTO departments (orig_id, source, name, description, connection, status, created_at)
                    VALUES (%s, 'db2', %s, %s, %s, %s, %s)
                    ON CONFLICT (orig_id, source) DO NOTHING
                """, (row["id"], row["name"], row.get("description"),
                      row.get("connection"), row.get("status", 1), row.get("created_at")))
                did_insert = pg_cur.rowcount > 0
                pg_cur.execute("RELEASE SAVEPOINT rsp")
                if did_insert:
                    inserted += 1
            except Exception as e:
                pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
                log(f"dept db2 skip: {e}", "WARN")
        cur.close()
        conn.close()
    except Exception as e:
        log(f"DB2 departments error: {e}", "WARN")
 
    pg_conn.commit()
    log(f"Departments: {inserted} inserted", "OK")
 
def load_dept_emails(pg_cur, pg_conn):
    inserted = 0
    try:
        conn = mysql_conn(MYSQL_DB1)
        cur = conn.cursor()
        cur.execute("SELECT * FROM department_emails")
        for row in cur.fetchall():
            pg_cur.execute("SELECT id FROM departments WHERE orig_id=%s AND source='db1'", (row["did"],))
            dept = pg_cur.fetchone()
            if not dept:
                continue
            pg_cur.execute("SAVEPOINT rsp")
            try:
                pg_cur.execute("""
                    INSERT INTO dept_emails (dept_id, email, status)
                    VALUES (%s, %s, %s) ON CONFLICT (dept_id, email) DO NOTHING
                """, (dept[0], row["email"], row.get("status", 1)))
                did_insert = pg_cur.rowcount > 0
                pg_cur.execute("RELEASE SAVEPOINT rsp")
                if did_insert:
                    inserted += 1
            except Exception as e:
                pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
        cur.close()
        conn.close()
    except Exception as e:
        log(f"Dept emails error: {e}", "WARN")
 
    pg_conn.commit()
    log(f"Dept emails: {inserted} inserted", "OK")
 
# ---------------------------------------------
#  LOAD CONTACTS (1.1M rows, streaming)
# ---------------------------------------------
 
def load_contacts(pg_cur, pg_conn):
    section("STEP 3 -- Loading contacts -> users (last 1 year)")

    conn_tmp = mysql_conn(MYSQL_DB1)
    cur_tmp = conn_tmp.cursor()
    cur_tmp.execute("SELECT COUNT(*) as c FROM contacts WHERE created_at >= %s", (ONE_YEAR_AGO,))
    total = cur_tmp.fetchone()["c"]
    cur_tmp.close()
    conn_tmp.close()
    log(f"Total contacts to process (last 1 year): {fmt_num(total)}")

    t0 = time.time()
    processed = 0
    skipped = 0

    with mysql_stream(MYSQL_DB1, "SELECT * FROM contacts WHERE created_at >= %s", (ONE_YEAR_AGO,)) as cur:
        for row in cur:
            pg_cur.execute("SAVEPOINT rsp")
            try:
                # email2/mobile2/phone2 can be comma-separated lists
                def split_field(val):
                    if not val:
                        return []
                    return [v.strip() for v in str(val).split(",") if v.strip()]
 
                emails = [row.get("email")] + split_field(row.get("email2"))
                phones = (
                    [(row.get("mobile"), "mobile")] +
                    [(m, "mobile2") for m in split_field(row.get("mobile2"))] +
                    [(row.get("phone"), "phone")] +
                    [(p, "phone2") for p in split_field(row.get("phone2"))]
                )
 
                has_id = (any(e and str(e).strip() for e in emails) or
                          any(p[0] and str(p[0]).strip() for p in phones))
                if not has_id:
                    pg_cur.execute("RELEASE SAVEPOINT rsp")
                    skipped += 1
                    continue
 
                get_or_create_user(
                    pg_cur,
                    emails=emails, phones=phones,
                    name=row.get("name"),
                    city=row.get("city"),
                    country=row.get("country_name"),
                    contact_type=row.get("contact_type"),
                    contact_status=row.get("contact_status"),
                    source="db1_contacts",
                    company_name=row.get("company_name"),
                    designation=row.get("designation"),
                    dob=row.get("dob"),
                    website=row.get("website"),
                    cstate=row.get("cstate"),
                    pincode=row.get("pincode"),
                    address_line1=row.get("address_line1"),
                    address_line2=row.get("address_line2"),
                    created_at=row.get("created_at"),
                    updated_at=row.get("updated_at"),
                )
                pg_cur.execute("RELEASE SAVEPOINT rsp")
                processed += 1
 
            except Exception as e:
                pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
                skipped += 1
                if skipped <= 5:
                    log(f"contact skip id={row.get('id')}: {e}", "WARN")
 
            n = processed + skipped
            if n % BATCH_SIZE == 0:
                pg_conn.commit()
                rate = n / (time.time() - t0)
                eta = (total - n) / rate if rate > 0 else 0
                log(f"Contacts: {fmt_num(n)}/{fmt_num(total)} "
                    f"({n*100//total}%) | {rate:.0f} rows/s | ETA {eta/60:.1f}min", "PROG")
 
    pg_conn.commit()
    log(f"Contacts done: {fmt_num(processed)} loaded, {fmt_num(skipped)} skipped "
        f"| {fmt_elapsed(t0)} | cache: {fmt_num(len(email_cache))} emails, "
        f"{fmt_num(len(phone_cache))} phones", "OK")
 
# ---------------------------------------------
#  LOAD TICKETS (267K rows, streaming)
# ---------------------------------------------
 
def load_tickets(pg_cur, pg_conn):
    section("STEP 4 -- Loading tickets (last 1 year)")

    conn_tmp = mysql_conn(MYSQL_DB1)
    cur_tmp = conn_tmp.cursor()
    cur_tmp.execute("SELECT COUNT(*) as c FROM tickets WHERE created_at >= %s", (ONE_YEAR_AGO,))
    total = cur_tmp.fetchone()["c"]
    cur_tmp.close()
    conn_tmp.close()
    log(f"Total tickets to process (last 1 year): {fmt_num(total)}")

    t0 = time.time()
    processed = 0
    skipped = 0

    row_count = 0
    with mysql_stream(MYSQL_DB1, "SELECT * FROM tickets WHERE created_at >= %s", (ONE_YEAR_AGO,)) as cur:
        for row in cur:
            row_count += 1
 
            # Fast cache lookup for user (no PG query needed)
            t_from = (row.get("t_from") or "").strip().lower()
            user_id = email_cache.get(t_from)
 
            pg_cur.execute("SAVEPOINT rsp")
            try:
                pg_cur.execute("""
                    INSERT INTO tickets
                        (orig_id, user_id, subject, body, t_from, from_name,
                         t_to, cc, channel, priority, status, seen,
                         due_at, created_at, updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (orig_id) DO NOTHING
                """, (
                    row.get("id"), user_id,
                    row.get("subject"), row.get("body"),
                    row.get("t_from"), row.get("from_name"),
                    row.get("t_to"), row.get("cc"),
                    row.get("channel"), row.get("priority", 1),
                    row.get("status", 0), row.get("seen", 0),
                    clean_date(row.get("due")),
                    clean_date(row.get("created_at")),
                    clean_date(row.get("updated_at")),
                ))
                did_insert = pg_cur.rowcount > 0
                pg_cur.execute("RELEASE SAVEPOINT rsp")
                if did_insert:
                    processed += 1
            except Exception as e:
                pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
                skipped += 1
                if skipped <= 5:
                    log(f"ticket skip id={row.get('id')}: {e}", "WARN")
 
            if row_count % BATCH_SIZE == 0:
                pg_conn.commit()
                rate = row_count / (time.time() - t0)
                eta = (total - row_count) / rate if rate > 0 else 0
                log(f"Tickets: {fmt_num(row_count)}/{fmt_num(total)} "
                    f"({row_count*100//total}%) | {rate:.0f} rows/s | ETA {eta/60:.1f}min", "PROG")
 
    pg_conn.commit()
    log(f"Tickets done: {fmt_num(processed)} loaded, {fmt_num(skipped)} skipped | {fmt_elapsed(t0)}", "OK")
 
# ---------------------------------------------
#  LOAD TRAVEL (2.1M rows, streaming)
# ---------------------------------------------
 
def load_travel(pg_cur, pg_conn):
    section("STEP 5 -- Loading travel bookings (last 1 year)")

    conn_tmp = mysql_conn(MYSQL_DB1)
    cur_tmp = conn_tmp.cursor()
    cur_tmp.execute("SELECT COUNT(*) as c FROM travel_data WHERE added_date >= %s", (ONE_YEAR_AGO,))
    total = cur_tmp.fetchone()["c"]
    cur_tmp.close()
    conn_tmp.close()
    log(f"Total travel rows to process (last 1 year): {fmt_num(total)}")

    t0 = time.time()
    processed = 0
    skipped = 0

    row_count = 0
    with mysql_stream(MYSQL_DB1, "SELECT * FROM travel_data WHERE added_date >= %s", (ONE_YEAR_AGO,)) as cur:
        for row in cur:
            row_count += 1
 
            pg_cur.execute("SAVEPOINT rsp")
            try:
                # Resolve user by email or contact phone
                user_id = get_or_create_user(
                    pg_cur,
                    emails=[row.get("email")],
                    phones=[(row.get("contact"), "phone")],
                    name=row.get("guest_name"),
                    source="db1_travel",
                    created_at=clean_date(row.get("added_date")),
                )
 
                pg_cur.execute("""
                    INSERT INTO travel_bookings
                        (orig_id, user_id, bill_serial, bill_number, bill_type,
                         service_name, guest_name, nationality, contact,
                         start_date, end_date, bill_made_by, added_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (orig_id) DO NOTHING
                """, (
                    row.get("id"), user_id,
                    row.get("bill_serial"), row.get("bill_number"),
                    row.get("bill_type"), row.get("service_name"),
                    row.get("guest_name"), row.get("nationality"),
                    row.get("contact"),
                    clean_date(row.get("start_date")),
                    clean_date(row.get("last_date")),
                    row.get("bill_made_by"),
                    clean_date(row.get("added_date")),
                ))
                did_insert = pg_cur.rowcount > 0
                pg_cur.execute("RELEASE SAVEPOINT rsp")
                if did_insert:
                    processed += 1
 
            except Exception as e:
                pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
                skipped += 1
                if skipped <= 5:
                    log(f"travel skip id={row.get('id')}: {e}", "WARN")
 
            if row_count % BATCH_SIZE == 0:
                pg_conn.commit()
                rate = row_count / (time.time() - t0)
                eta = (total - row_count) / rate if rate > 0 else 0
                log(f"Travel: {fmt_num(row_count)}/{fmt_num(total)} "
                    f"({row_count*100//total}%) | {rate:.0f} rows/s | ETA {eta/60:.1f}min", "PROG")
 
    pg_conn.commit()
    log(f"Travel done: {fmt_num(processed)} loaded, {fmt_num(skipped)} skipped | {fmt_elapsed(t0)}", "OK")
 
# ---------------------------------------------
#  LOAD CHATS (445K rows, streaming)
# ---------------------------------------------
 
def load_chats(pg_cur, pg_conn):
    section("STEP 6 -- Loading chats (last 1 year)")

    conn_tmp = mysql_conn(MYSQL_DB2)
    cur_tmp = conn_tmp.cursor()
    cur_tmp.execute("SELECT COUNT(*) as c FROM chats WHERE created_at >= %s", (ONE_YEAR_AGO,))
    total = cur_tmp.fetchone()["c"]
    cur_tmp.close()
    conn_tmp.close()
    log(f"Total chats to process (last 1 year): {fmt_num(total)}")

    t0 = time.time()
    processed = 0
    skipped = 0

    row_count = 0
    with mysql_stream(MYSQL_DB2, "SELECT * FROM chats WHERE created_at >= %s", (ONE_YEAR_AGO,)) as cur:
        for row in cur:
            row_count += 1
 
            pg_cur.execute("SAVEPOINT rsp")
            try:
                email = row.get("email")
                wa_id = row.get("wa_id")
 
                emails = [email] if email else []
                phones = [(wa_id, "whatsapp")] if wa_id else []
 
                if not emails and not phones:
                    pg_cur.execute("RELEASE SAVEPOINT rsp")
                    skipped += 1
                    continue
 
                user_id = get_or_create_user(
                    pg_cur,
                    emails=emails, phones=phones,
                    name=row.get("wa_name"),
                    country=row.get("country"),
                    source="db2_chats",
                    created_at=clean_date(row.get("created_at")),
                    updated_at=clean_date(row.get("updated_at")),
                )
 
                pg_cur.execute("""
                    INSERT INTO chats
                        (orig_id, user_id, wa_id, wa_name, country, receiver,
                         status, priority, tags, last_msg_at,
                         last_short, seen, created_at, updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (orig_id) DO NOTHING
                """, (
                    row.get("id"), user_id,
                    row.get("wa_id"), row.get("wa_name"),
                    row.get("country"), row.get("receiver"),
                    row.get("status", 0), row.get("priority", 4),
                    row.get("tags"),
                    clean_date(row.get("last_msg")),
                    row.get("last_short"), row.get("seen", 1),
                    clean_date(row.get("created_at")),
                    clean_date(row.get("updated_at")),
                ))
                did_insert = pg_cur.rowcount > 0
                pg_cur.execute("RELEASE SAVEPOINT rsp")
                if did_insert:
                    processed += 1
 
            except Exception as e:
                pg_cur.execute("ROLLBACK TO SAVEPOINT rsp")
                skipped += 1
                if skipped <= 5:
                    log(f"chat skip id={row.get('id')}: {e}", "WARN")
 
            if row_count % BATCH_SIZE == 0:
                pg_conn.commit()
                rate = row_count / (time.time() - t0)
                eta = (total - row_count) / rate if rate > 0 else 0
                log(f"Chats: {fmt_num(row_count)}/{fmt_num(total)} "
                    f"({row_count*100//total}%) | {rate:.0f} rows/s | ETA {eta/60:.1f}min", "PROG")
 
    pg_conn.commit()
    log(f"Chats done: {fmt_num(processed)} loaded, {fmt_num(skipped)} skipped | {fmt_elapsed(t0)}", "OK")
 
# ---------------------------------------------
#  SUMMARY
# ---------------------------------------------
 
def print_summary(pg_cur):
    section("MIGRATION COMPLETE -- Summary")
 
    tables = {
        "Total users":          "SELECT COUNT(*) FROM users",
        "Total unique emails":  "SELECT COUNT(*) FROM user_emails",
        "Total phones":         "SELECT COUNT(*) FROM user_phones",
        "Total departments":    "SELECT COUNT(*) FROM departments",
        "Total dept emails":    "SELECT COUNT(*) FROM dept_emails",
        "Total tickets":        "SELECT COUNT(*) FROM tickets",
        "Total travel bookings":"SELECT COUNT(*) FROM travel_bookings",
        "Total chats":          "SELECT COUNT(*) FROM chats",
    }
 
    for label, q in tables.items():
        pg_cur.execute(q)
        count = pg_cur.fetchone()[0]
        log(f"{label:<25} {count:>10,}", "OK")
 
    log(f"Identity cache: {len(email_cache):,} emails, {len(phone_cache):,} phones", "INFO")
 
    print(f"""
  -------------------------------------------------
  All data loaded. Query examples in psql:
 
      \\c {POSTGRES['dbname']}
      SELECT * FROM users LIMIT 20;
      SELECT * FROM user_360_last_month LIMIT 20;
 
  -------------------------------------------------
""")
 
# ---------------------------------------------
#  MAIN
# ---------------------------------------------
 
def main():
    global email_cache, phone_cache
    email_cache = {}
    phone_cache = {}
 
    print("""
+===================================================+
|  MySQL -> PostgreSQL  |  FULL Data Migration       |
+===================================================+
""")
 
    t_start = time.time()
 
    # 1. Setup postgres
    setup_postgres()
 
    # 2. Connect for loading
    pg_conn = psycopg2.connect(**POSTGRES)
    pg_conn.autocommit = False
    pg_cur = pg_conn.cursor()
 
    try:
        # 3. Small tables first
        load_departments(pg_cur, pg_conn)
        load_dept_emails(pg_cur, pg_conn)
 
        # 4. Contacts (creates users) -> must be before tickets/travel/chats
        load_contacts(pg_cur, pg_conn)
 
        # 5. Tickets (links to users by email cache)
        load_tickets(pg_cur, pg_conn)
 
        # 6. Travel (links/creates users by email+phone)
        load_travel(pg_cur, pg_conn)
 
        # 7. Chats (links/creates users by email+wa_id)
        load_chats(pg_cur, pg_conn)
 
        pg_conn.commit()
 
        # 8. Summary
        print_summary(pg_cur)
 
        log(f"Total migration time: {fmt_elapsed(t_start)}", "OK")
 
    except Exception as e:
        pg_conn.rollback()
        log(f"FATAL ERROR -- rolled back: {e}", "ERR")
        import traceback
        traceback.print_exc()
    finally:
        pg_cur.close()
        pg_conn.close()
 
if __name__ == "__main__":
    main()