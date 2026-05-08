"""
Peek at upstream travel_data on MySQL — count, newest row, sample columns.
No writes to Postgres. Confirms the dump is worth running before we recreate
travel_bookings locally.
"""
import pymysql

MYSQL_DB1 = dict(
    host="95.211.169.194", port=3306,
    user="sowmya_new", password="sowmya@756",
    db="rayna_data", charset="utf8mb4",
    cursorclass=pymysql.cursors.SSDictCursor,
)

conn = pymysql.connect(**MYSQL_DB1)
cur = conn.cursor()

cur.execute("SELECT COUNT(*) AS n, MIN(added_date) AS oldest, MAX(added_date) AS newest FROM travel_data")
stats = cur.fetchone()
print(f"travel_data: {stats['n']:,} rows | oldest {stats['oldest']} | newest {stats['newest']}")

cur.execute("SELECT * FROM travel_data ORDER BY added_date DESC LIMIT 1")
sample = cur.fetchone()
if sample:
    print("\nLatest row columns:")
    for k, v in sample.items():
        vs = str(v)[:60]
        print(f"  {k:20s} = {vs}")

cur.execute("SELECT bill_type, COUNT(*) AS n FROM travel_data GROUP BY bill_type ORDER BY n DESC LIMIT 10")
print("\nBill types:")
for row in cur:
    print(f"  {row['bill_type']:30s} {row['n']:,}")

cur.close(); conn.close()
