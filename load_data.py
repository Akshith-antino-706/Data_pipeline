"""
Load CSV data into PostgreSQL tables for rayna_data_pipe.
Tables: chats, contacts, tickets, travel_data
"""

import os
import psycopg2
import pandas as pd
from psycopg2.extras import execute_values
import numpy as np

# ── DB config ──────────────────────────────────────────────────────────────
DB = dict(
    host="localhost",
    port=5432,
    dbname="rayna_data_pipe",
    user="akshithkumaryv",
    password="7884",
)

BASE = os.path.dirname(os.path.abspath(__file__))

# ── DDL ────────────────────────────────────────────────────────────────────
DDL = {
    "chats": """
        CREATE TABLE IF NOT EXISTS chats (
            id          INTEGER PRIMARY KEY,
            wa_id       VARCHAR(20)  NOT NULL,
            wa_name     VARCHAR(25),
            email       VARCHAR(100),
            country     VARCHAR(50),
            receiver    VARCHAR(20)  NOT NULL,
            assign_to   INTEGER      NOT NULL DEFAULT 0,
            boat        INTEGER,
            status      INTEGER      NOT NULL,
            priority    INTEGER      NOT NULL DEFAULT 4,
            tags        VARCHAR(510),
            fv          INTEGER      NOT NULL DEFAULT 0,
            last_in     TIMESTAMP,
            last_out    TIMESTAMP,
            last_msg    TIMESTAMP,
            last_short  VARCHAR(60),
            seen        INTEGER      NOT NULL DEFAULT 1,
            spam        INTEGER      NOT NULL DEFAULT 0,
            last_packed VARCHAR(15)  NOT NULL DEFAULT '0',
            created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP
        )
    """,
    "contacts": """
        CREATE TABLE IF NOT EXISTS contacts (
            id                  INTEGER PRIMARY KEY,
            foreign_id          INTEGER,
            type                VARCHAR(10),
            contact_type        VARCHAR(20)  NOT NULL,
            source_id           INTEGER,
            subsource_id        INTEGER      DEFAULT 0,
            source_type         VARCHAR(50),
            source_person       INTEGER,
            name                VARCHAR(75),
            company_name        VARCHAR(75),
            designation         VARCHAR(75),
            dob                 VARCHAR(20),
            email               VARCHAR(100),
            email2              TEXT,
            pcode               VARCHAR(6),
            mobile              VARCHAR(20),
            mobile2             TEXT,
            phone               VARCHAR(20),
            phone2              TEXT,
            website             VARCHAR(100),
            city                VARCHAR(20),
            cstate              VARCHAR(20),
            country_id          INTEGER,
            country_name        VARCHAR(20),
            pincode             VARCHAR(20),
            address_line1       TEXT,
            address_line2       TEXT,
            hotel_name          VARCHAR(75),
            hotel_category      VARCHAR(20),
            agent_code          VARCHAR(15),
            registration_date   TIMESTAMP,
            authorize_status    VARCHAR(15),
            authorize_employee  VARCHAR(15),
            added_by            INTEGER,
            status              SMALLINT     NOT NULL DEFAULT 0,
            rte                 SMALLINT     NOT NULL DEFAULT 1,
            rtc                 SMALLINT     NOT NULL DEFAULT 0,
            rts                 SMALLINT     NOT NULL DEFAULT 0,
            opn                 INTEGER      NOT NULL DEFAULT 0,
            contact_status      VARCHAR(20)  NOT NULL DEFAULT 'new',
            calls               INTEGER      NOT NULL DEFAULT 0,
            qe                  INTEGER      NOT NULL DEFAULT 0,
            n_queries           INTEGER,
            l_query             DATE,
            n_bookings          INTEGER,
            l_booking           DATE,
            registered          SMALLINT     DEFAULT 0,
            priority            SMALLINT     NOT NULL DEFAULT 0,
            assign_to           INTEGER      DEFAULT 0,
            booking_date        TIMESTAMP,
            traveld             INTEGER      DEFAULT 0,
            traveld_name        VARCHAR(50),
            traveld_exp         TIMESTAMP,
            s_bounce            VARCHAR(4)   DEFAULT '0',
            h_bounce            VARCHAR(4)   DEFAULT '0',
            created_at          TIMESTAMP,
            updated_at          TIMESTAMP
        )
    """,
    "tickets": """
        CREATE TABLE IF NOT EXISTS tickets (
            id              INTEGER PRIMARY KEY,
            dt              INTEGER      NOT NULL,
            uid             VARCHAR(10),
            sno             VARCHAR(10),
            unique_id       TEXT,
            foreign_id      INTEGER,
            t_from          VARCHAR(100) NOT NULL,
            from_name       VARCHAR(75),
            t_to            VARCHAR(150),
            cc              TEXT,
            bcc             TEXT,
            assoc           TEXT,
            subject         VARCHAR(150),
            body            TEXT,
            extra           TEXT,
            produc          VARCHAR(30),
            pex             INTEGER      DEFAULT 0,
            channel         INTEGER      DEFAULT 0,
            time            VARCHAR(40),
            status          INTEGER      NOT NULL,
            bill            VARCHAR(50),
            bill_total      VARCHAR(11),
            bill_currency   VARCHAR(5),
            contact_status  TEXT,
            assign_to       INTEGER      NOT NULL DEFAULT 0,
            assign_time     TIMESTAMP,
            aid             INTEGER,
            due             TIMESTAMP,
            travel          TIMESTAMP,
            priority        INTEGER      NOT NULL DEFAULT 1,
            attach          TEXT,
            seen            INTEGER      NOT NULL DEFAULT 0,
            th              INTEGER      NOT NULL DEFAULT 1,
            last_th         TIMESTAMP,
            last_out        TIMESTAMP,
            spam            INTEGER      NOT NULL DEFAULT 0,
            confirm_time    TIMESTAMP,
            created_at      TIMESTAMP    NOT NULL,
            updated_at      TIMESTAMP
        )
    """,
    "travel_data": """
        CREATE TABLE IF NOT EXISTS travel_data (
            id                INTEGER PRIMARY KEY,
            bill_serial       BIGINT       NOT NULL,
            bill_number       BIGINT       NOT NULL,
            bill_type         VARCHAR(50),
            service_name      TEXT,
            guest_name        VARCHAR(50),
            nationality       VARCHAR(30),
            contact           VARCHAR(70),
            email             VARCHAR(50)  NOT NULL DEFAULT '',
            age               VARCHAR(10),
            business_provider VARCHAR(70),
            start_date        DATE,
            last_date         DATE,
            bill_made_by      VARCHAR(25),
            added_date        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            type              VARCHAR(10),
            sent              INTEGER      DEFAULT 0
        )
    """,
}

# ── helpers ────────────────────────────────────────────────────────────────

def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Replace NaN / 'NULL' strings with None (Python None → SQL NULL)."""
    df = df.where(pd.notna(df), None)
    df = df.map(lambda v: None if v == "NULL" else v)
    return df


def parse_dates(df: pd.DataFrame, cols: list, fmt: str) -> pd.DataFrame:
    for col in cols:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], format=fmt, errors="coerce")
            # Convert NaT → None
            df[col] = df[col].where(df[col].notna(), None)
    return df


def upsert(cur, table: str, df: pd.DataFrame):
    cols = list(df.columns)
    col_sql = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join(["%s"] * len(cols))
    # ON CONFLICT DO NOTHING so re-runs are safe
    sql = (
        f'INSERT INTO "{table}" ({col_sql}) VALUES ({placeholders}) '
        f"ON CONFLICT DO NOTHING"
    )
    def _safe(v):
        if v is None:
            return None
        if isinstance(v, float) and np.isnan(v):
            return None
        if v is pd.NaT:
            return None
        # pandas Timestamp with NaT check
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        return v

    rows = [
        tuple(_safe(v) for v in row)
        for row in df.itertuples(index=False, name=None)
    ]
    cur.executemany(sql, rows)
    return len(rows)


# ── per-table loaders ──────────────────────────────────────────────────────

def load_chats(cur):
    df = pd.read_csv(os.path.join(BASE, "chats.csv"), dtype=str)
    df = clean(df)
    ts_cols = ["last_in", "last_out", "last_msg", "created_at", "updated_at"]
    df = parse_dates(df, ts_cols, "%Y-%m-%d %H:%M:%S")
    return upsert(cur, "chats", df)


def load_contacts(cur):
    df = pd.read_csv(os.path.join(BASE, "contacts.csv"), dtype=str)
    df = clean(df)
    # Timestamps stored as "dd/mm/yyyy hh:mm"
    ts_cols = ["registration_date", "booking_date", "traveld_exp", "created_at", "updated_at"]
    date_cols = ["l_query", "l_booking"]
    df = parse_dates(df, ts_cols, "%d/%m/%Y %H:%M")
    df = parse_dates(df, date_cols, "%d/%m/%Y %H:%M")
    return upsert(cur, "contacts", df)


def load_tickets(cur):
    df = pd.read_csv(os.path.join(BASE, "tickets.csv"), dtype=str)
    df = clean(df)
    # assign_time / last_th / last_out / confirm_time / created_at / updated_at
    # stored as "dd/mm/yyyy hh:mm"
    ts_dd_cols = [
        "assign_time", "last_th", "last_out", "confirm_time",
        "created_at", "updated_at",
    ]
    # due / travel stored as "dd/mm/yyyy hh:mm" too
    ts_dd_cols += ["due", "travel"]
    df = parse_dates(df, ts_dd_cols, "%d/%m/%Y %H:%M")
    return upsert(cur, "tickets", df)


def load_travel_data(cur):
    # No header row in travel_data.csv
    cols = [
        "id", "bill_serial", "bill_number", "bill_type", "service_name",
        "guest_name", "nationality", "contact", "email", "age",
        "business_provider", "start_date", "last_date", "bill_made_by",
        "added_date", "type", "sent",
    ]
    df = pd.read_csv(os.path.join(BASE, "travel_data.csv"), header=None, names=cols, dtype=str)
    df = clean(df)
    df = parse_dates(df, ["added_date"], "%Y-%m-%d %H:%M:%S")
    df = parse_dates(df, ["start_date", "last_date"], "%Y-%m-%d")
    return upsert(cur, "travel_data", df)


# ── main ───────────────────────────────────────────────────────────────────

def main():
    conn = psycopg2.connect(**DB)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        print("Creating tables …")
        for table in DDL:
            cur.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')
        for table, ddl in DDL.items():
            cur.execute(ddl)
        conn.commit()
        print("  Tables ready.\n")

        loaders = {
            "chats":       load_chats,
            "contacts":    load_contacts,
            "tickets":     load_tickets,
            "travel_data": load_travel_data,
        }

        for table, loader in loaders.items():
            print(f"Loading {table} …", end=" ", flush=True)
            n = loader(cur)
            conn.commit()
            print(f"{n} rows inserted.")

        print("\nDone.")

    except Exception as exc:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
