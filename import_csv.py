import csv
import psycopg2
import sys
import time

CSV_PATH = r"C:\Users\Antino\Downloads\AllBillData_01012027_05052026\AllBillData_01012027_05052026.csv"

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "rayna_data_pipe",
    "user": "postgres",
    "password": "Avinash1234",
}

# BillType -> table mapping (case-insensitive)
TABLE_MAP = {
    "tours":           "rayna_tours",
    "onlinetour":      "rayna_tours",
    "package":         "rayna_packages",
    "hotel":           "rayna_hotels",
    "hotelamendment":  "rayna_hotels",
    "hoteloth":        "rayna_hotels",
    "visa":            "rayna_visas",
    "intlvisa":        "rayna_visas",
    "ticket":          "rayna_others",
    "insurance":       "rayna_others",
    "otb":             "rayna_others",
    "null":            "rayna_others",
    "":                "rayna_others",
}

INSERT_SQL = """
INSERT INTO {table} (bill_serial, bill_no, bill_type, is_b2b, service_id,
  travel_date, service_name, selling_price, is_cancel, guest_name,
  nationality, guest_contact, guest_email, guest_age, booking_date)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
"""

BATCH_SIZE = 5000

def get_table(bill_type):
    return TABLE_MAP.get(bill_type.strip().lower(), "rayna_others")

def parse_price(val):
    try:
        return float(val) if val else None
    except ValueError:
        return None

def main():
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    cur = conn.cursor()

    # Buffers per table
    buffers = {
        "rayna_tours": [],
        "rayna_packages": [],
        "rayna_hotels": [],
        "rayna_visas": [],
        "rayna_others": [],
    }
    counts = {k: 0 for k in buffers}
    total = 0
    skipped = 0
    start = time.time()

    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 15:
                skipped += 1
                continue

            bill_serial  = row[0]
            bill_no      = row[1]
            bill_type    = row[2]
            is_b2b       = row[3]
            service_id   = row[4]
            travel_date  = row[5]
            service_name = row[6]
            selling_price = parse_price(row[7])
            is_cancel    = row[8]
            guest_name   = row[9]
            nationality  = row[10]
            guest_contact = row[11]
            guest_email  = row[12]
            guest_age    = row[13]
            booking_date = row[14]

            table = get_table(bill_type)
            buffers[table].append((
                bill_serial, bill_no, bill_type, is_b2b, service_id,
                travel_date, service_name, selling_price, is_cancel, guest_name,
                nationality, guest_contact, guest_email, guest_age, booking_date
            ))
            counts[table] += 1
            total += 1

            # Flush each buffer when it hits BATCH_SIZE
            for tbl in buffers:
                if len(buffers[tbl]) >= BATCH_SIZE:
                    cur.executemany(INSERT_SQL.format(table=tbl), buffers[tbl])
                    conn.commit()
                    buffers[tbl] = []

            if total % 100000 == 0:
                elapsed = time.time() - start
                rate = total / elapsed if elapsed > 0 else 0
                print(f"  {total:,} rows processed ({rate:,.0f} rows/sec) ...", flush=True)

    # Flush remaining
    for tbl in buffers:
        if buffers[tbl]:
            cur.executemany(INSERT_SQL.format(table=tbl), buffers[tbl])
            conn.commit()
            buffers[tbl] = []

    elapsed = time.time() - start
    print(f"\n=== IMPORT COMPLETE ({elapsed:.1f}s) ===")
    print(f"Total rows imported: {total:,}")
    print(f"Skipped (bad rows):  {skipped:,}")
    for tbl, c in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {tbl:20s} → {c:>12,}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
