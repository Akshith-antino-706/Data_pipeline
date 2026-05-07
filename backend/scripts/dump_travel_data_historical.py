"""
One-time bulk dump of MySQL `travel_data` (pre-2026-02-01) into Postgres.
Uses psycopg2 COPY FROM (via pipe) for speed — ~2M rows lands in minutes.
Rayna API already covers 2026-02-01 onwards; this fills the historical gap.

Run: .venv/bin/python3 backend/scripts/dump_travel_data_historical.py
"""
import pymysql
import psycopg2
import time
import sys
import io
from datetime import datetime

MYSQL_DB1 = dict(
    host="95.211.169.194", port=3306,
    user="sowmya_new", password="sowmya@756",
    db="rayna_data", charset="utf8mb4",
    cursorclass=pymysql.cursors.SSDictCursor,
)
POSTGRES = dict(host="localhost", port=5432, user="akshithkumaryv", dbname="rayna_data_pipe")
CUTOFF = "2026-02-01"
BATCH = 50_000

TABLE_DDL = """
CREATE TABLE IF NOT EXISTS travel_data (
    id                 INTEGER     PRIMARY KEY,
    bill_serial        BIGINT,
    bill_number        BIGINT,
    bill_type          TEXT,
    service_name       TEXT,
    guest_name         TEXT,
    nationality        TEXT,
    contact            TEXT,
    email              TEXT,
    age                TEXT,
    business_provider  TEXT,
    start_date         DATE,
    last_date          DATE,
    bill_made_by       TEXT,
    added_date         TIMESTAMP,
    type               TEXT,
    sent               SMALLINT,
    unified_id         INTEGER,
    imported_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_travel_data_added_date ON travel_data(added_date);
CREATE INDEX IF NOT EXISTS idx_travel_data_email ON travel_data(LOWER(TRIM(email))) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_travel_data_contact ON travel_data(RIGHT(REGEXP_REPLACE(contact,'[^0-9]','','g'),10)) WHERE contact IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_travel_data_unified_id ON travel_data(unified_id) WHERE unified_id IS NOT NULL;
"""

COLS = ['id','bill_serial','bill_number','bill_type','service_name','guest_name',
        'nationality','contact','email','age','business_provider','start_date',
        'last_date','bill_made_by','added_date','type','sent']

def log(msg, lvl="OK"):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"  {ts} [{lvl}] {msg}", flush=True)

def copy_escape(v):
    """Escape a value for Postgres COPY text format."""
    if v is None or v == '':
        return '\\N'
    s = str(v)
    # Strip NUL bytes (illegal in UTF-8 text) + escape tab/newline/backslash/CR
    s = s.replace('\x00', '')
    s = s.replace('\\', '\\\\').replace('\t', '\\t').replace('\n', '\\n').replace('\r', '\\r')
    return s

def main():
    t_start = time.time()

    log("Connecting to Postgres...")
    pg = psycopg2.connect(**POSTGRES)
    pg.autocommit = False
    pg_cur = pg.cursor()

    log("Ensuring travel_data table + indexes exist")
    pg_cur.execute(TABLE_DDL)
    pg.commit()

    log(f"Counting existing rows (resume from last id if present)")
    pg_cur.execute("SELECT COUNT(*), COALESCE(MAX(id), 0) FROM travel_data")
    existing, max_existing_id = pg_cur.fetchone()
    log(f"  Existing: {existing:,} | resume after id > {max_existing_id}")

    log("Connecting to MySQL upstream...")
    mc = pymysql.connect(**MYSQL_DB1)
    m_cur = mc.cursor()
    log(f"Streaming travel_data where added_date < {CUTOFF} AND id > {max_existing_id}...")
    m_cur.execute(
        "SELECT " + ",".join(COLS) + " FROM travel_data WHERE added_date < %s AND id > %s ORDER BY id",
        (CUTOFF, max_existing_id)
    )

    total = 0
    batch_rows = []
    while True:
        row = m_cur.fetchone()
        if row is None:
            break
        # Build tab-separated line for COPY
        line = '\t'.join(copy_escape(row[c]) for c in COLS)
        batch_rows.append(line)
        if len(batch_rows) >= BATCH:
            buf = io.StringIO('\n'.join(batch_rows) + '\n')
            try:
                pg_cur.copy_expert(
                    f"COPY travel_data ({','.join(COLS)}) FROM STDIN WITH (FORMAT text, NULL '\\N')",
                    buf
                )
                pg.commit()
                total += len(batch_rows)
                log(f"  {total:,} rows committed | {(time.time()-t_start):.1f}s elapsed", "PROG")
            except psycopg2.errors.UniqueViolation:
                # Fallback: row-by-row with ON CONFLICT DO NOTHING
                pg.rollback()
                for r in batch_rows:
                    vals = r.split('\t')
                    try:
                        placeholders = ','.join(['%s']*len(vals))
                        # Reinterpret \N → None
                        parsed = [None if v == '\\N' else v for v in vals]
                        pg_cur.execute(
                            f"INSERT INTO travel_data ({','.join(COLS)}) VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING",
                            parsed
                        )
                    except Exception as e:
                        pg.rollback()
                        log(f"  skipped bad row: {e}", "WARN")
                        continue
                pg.commit()
                total += len(batch_rows)
            batch_rows = []

    # Final partial batch
    if batch_rows:
        buf = io.StringIO('\n'.join(batch_rows) + '\n')
        try:
            pg_cur.copy_expert(
                f"COPY travel_data ({','.join(COLS)}) FROM STDIN WITH (FORMAT text, NULL '\\N')",
                buf
            )
            pg.commit()
            total += len(batch_rows)
        except Exception as e:
            pg.rollback()
            log(f"final batch error: {e}", "ERR")

    m_cur.close(); mc.close()

    # Link to unified_contacts via email / phone
    log("Linking to unified_contacts by email + phone...")
    pg_cur.execute("""
        UPDATE travel_data td SET unified_id = uc.unified_id
        FROM unified_contacts uc
        WHERE td.unified_id IS NULL
          AND uc.email_key = LOWER(TRIM(td.email))
          AND td.email IS NOT NULL AND TRIM(td.email) != ''
    """)
    linked_by_email = pg_cur.rowcount
    pg_cur.execute("""
        UPDATE travel_data td SET unified_id = uc.unified_id
        FROM unified_contacts uc
        WHERE td.unified_id IS NULL
          AND uc.phone_key = RIGHT(REGEXP_REPLACE(td.contact,'[^0-9]','','g'), 10)
          AND td.contact IS NOT NULL
          AND LENGTH(REGEXP_REPLACE(td.contact,'[^0-9]','','g')) >= 7
    """)
    linked_by_phone = pg_cur.rowcount
    pg.commit()

    pg_cur.execute("SELECT COUNT(*) FROM travel_data WHERE unified_id IS NOT NULL")
    total_linked = pg_cur.fetchone()[0]
    pg_cur.execute("SELECT COUNT(*) FROM travel_data WHERE unified_id IS NULL")
    unlinked = pg_cur.fetchone()[0]

    log("")
    log("=" * 50)
    log(f"Total imported:       {total:,}")
    log(f"Linked by email:      {linked_by_email:,}")
    log(f"Linked by phone:      {linked_by_phone:,}")
    log(f"Total linked:         {total_linked:,}")
    log(f"Unlinked (no match):  {unlinked:,}")
    log(f"Total duration:       {(time.time()-t_start):.1f}s")
    log("=" * 50)

    pg_cur.close(); pg.close()

if __name__ == "__main__":
    main()
