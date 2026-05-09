import json
import psycopg2
import time

JSON_PATH = r"C:\Users\Antino\Downloads\7data.txt"

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "rayna_data_pipe",
    "user": "postgres",
    "password": "Avinash1234",
}

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
}

INSERT_SQL = """
INSERT INTO {table} (bill_serial, bill_no, bill_type, is_b2b, service_id,
  travel_date, service_name, selling_price, is_cancel, guest_name,
  nationality, guest_contact, guest_email, guest_age, booking_date)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
"""

def get_table(bill_type):
    return TABLE_MAP.get((bill_type or '').strip().lower(), "rayna_others")

def main():
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"Loaded {len(data)} records from {JSON_PATH}")

    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    counts = {}
    dupes = 0
    start = time.time()

    for row in data:
        bt = row.get("BillType", "")
        table = get_table(bt)
        travel_date = (row.get("TravelDate") or "")[:10]

        params = (
            str(row.get("BillSerial", "")),
            str(row.get("BillNo", "")),
            bt,
            str(row.get("IsB2B", "")),
            str(row.get("ServiceId", "")),
            travel_date,
            row.get("ServiceName", ""),
            row.get("SellingPrice"),
            str(row.get("IsCancel", "")),
            row.get("Guest_Name", ""),
            row.get("Nationality", ""),
            row.get("Guest_Contact", ""),
            row.get("Guest_Email", ""),
            str(row.get("Guest_Age", "")),
            row.get("BookingDate", ""),
        )

        # Check for duplicate
        cur.execute(f"""
            SELECT 1 FROM {table}
            WHERE bill_serial = %s AND bill_no = %s AND service_id = %s
              AND guest_name = %s AND selling_price = %s
            LIMIT 1
        """, (params[0], params[1], params[4], params[9], params[7]))

        if cur.fetchone():
            dupes += 1
            continue

        cur.execute(INSERT_SQL.format(table=table), params)
        counts[table] = counts.get(table, 0) + 1

    conn.commit()
    elapsed = time.time() - start

    total = sum(counts.values())
    print(f"\nDone in {elapsed:.1f}s")
    print(f"Inserted: {total}")
    print(f"Duplicates skipped: {dupes}")
    for tbl, c in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {tbl}: {c}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
