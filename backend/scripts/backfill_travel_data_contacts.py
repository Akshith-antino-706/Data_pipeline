"""
Create unified_contacts for the 252K travel_data rows that couldn't be linked,
then re-link them back. Mirrors the same two-stage pattern as syncNewRaynaContacts
(phone first, then email-only fallback).
"""
import psycopg2
import time
from datetime import datetime

PG = dict(host="localhost", port=5432, user="akshithkumaryv", dbname="rayna_data_pipe")

def log(msg, lvl="OK"):
    print(f"  {datetime.now().strftime('%H:%M:%S')} [{lvl}] {msg}", flush=True)

def main():
    t0 = time.time()
    conn = psycopg2.connect(**PG); conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM travel_data WHERE unified_id IS NULL")
    before = cur.fetchone()[0]
    log(f"Unlinked travel_data rows before: {before:,}")

    log("Stage 1: insert contacts by phone")
    cur.execute("""
        WITH cleaned AS (
          SELECT
            RIGHT(REGEXP_REPLACE(contact,'[^0-9]','','g'), 10) AS phone_key,
            MIN(contact) AS phone,
            MIN(NULLIF(TRIM(COALESCE(email,'')), '')) AS email_raw,
            MIN(NULLIF(TRIM(COALESCE(guest_name,'')), '')) AS name,
            MIN(NULLIF(TRIM(COALESCE(nationality,'')), '')) AS country,
            MIN(added_date) AS first_seen
          FROM travel_data
          WHERE unified_id IS NULL
            AND contact IS NOT NULL
            AND LENGTH(REGEXP_REPLACE(contact,'[^0-9]','','g')) >= 7
            AND RIGHT(REGEXP_REPLACE(contact,'[^0-9]','','g'), 10) !~ '^0+$'
          GROUP BY RIGHT(REGEXP_REPLACE(contact,'[^0-9]','','g'), 10)
        )
        INSERT INTO unified_contacts (phone_key, phone, email, email_key, name, country, sources, first_seen_at)
        SELECT c.phone_key, c.phone, c.email_raw,
               CASE WHEN c.email_raw IS NOT NULL THEN LOWER(c.email_raw) END,
               c.name, c.country, 'travel_data', c.first_seen
        FROM cleaned c
        WHERE NOT EXISTS (SELECT 1 FROM unified_contacts uc WHERE uc.phone_key = c.phone_key)
        ON CONFLICT (phone_key) WHERE phone_key IS NOT NULL DO NOTHING
    """)
    by_phone = cur.rowcount
    conn.commit()
    log(f"  {by_phone:,} contacts created by phone")

    log("Stage 2: insert contacts by email (no valid phone)")
    cur.execute("""
        WITH cleaned AS (
          SELECT
            LOWER(TRIM(email)) AS email_key,
            MIN(email) AS email,
            MIN(contact) AS phone_raw,
            MIN(NULLIF(TRIM(COALESCE(guest_name,'')), '')) AS name,
            MIN(NULLIF(TRIM(COALESCE(nationality,'')), '')) AS country,
            MIN(added_date) AS first_seen
          FROM travel_data
          WHERE unified_id IS NULL
            AND email IS NOT NULL
            AND TRIM(email) != ''
            AND TRIM(email) ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'
          GROUP BY LOWER(TRIM(email))
        )
        INSERT INTO unified_contacts (email_key, email, phone, phone_key, name, country, sources, first_seen_at)
        SELECT c.email_key, c.email, c.phone_raw, NULL, c.name, c.country, 'travel_data', c.first_seen
        FROM cleaned c
        WHERE NOT EXISTS (SELECT 1 FROM unified_contacts uc WHERE uc.email_key = c.email_key)
    """)
    by_email = cur.rowcount
    conn.commit()
    log(f"  {by_email:,} contacts created by email")

    log("Stage 3: re-link travel_data rows")
    cur.execute("""
        UPDATE travel_data td SET unified_id = uc.unified_id
        FROM unified_contacts uc
        WHERE td.unified_id IS NULL
          AND uc.email_key = LOWER(TRIM(td.email))
          AND td.email IS NOT NULL AND TRIM(td.email) != ''
    """)
    linked_email = cur.rowcount
    cur.execute("""
        UPDATE travel_data td SET unified_id = uc.unified_id
        FROM unified_contacts uc
        WHERE td.unified_id IS NULL
          AND uc.phone_key = RIGHT(REGEXP_REPLACE(td.contact,'[^0-9]','','g'), 10)
          AND td.contact IS NOT NULL
          AND LENGTH(REGEXP_REPLACE(td.contact,'[^0-9]','','g')) >= 7
    """)
    linked_phone = cur.rowcount
    conn.commit()
    log(f"  Linked: {linked_email:,} by email, {linked_phone:,} by phone")

    cur.execute("SELECT COUNT(*) FROM travel_data WHERE unified_id IS NULL")
    after = cur.fetchone()[0]
    log(f"\nUnlinked before: {before:,} → after: {after:,}  (resolved {before-after:,})")
    log(f"Total time: {(time.time()-t0):.1f}s")

    cur.close(); conn.close()

if __name__ == "__main__":
    main()
