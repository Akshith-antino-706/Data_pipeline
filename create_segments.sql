-- =============================================================
-- customer_segments: 360-degree marketing segment table
-- Database: rayna_data_pipe (PostgreSQL)
-- Idempotent: safe to run repeatedly (DROP + CREATE + INSERT)
-- =============================================================

-- ---------------------------------------------------------------
-- STEP 0: Drop and recreate cleanly
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS customer_segments;

-- ---------------------------------------------------------------
-- STEP 1: CREATE TABLE
-- ---------------------------------------------------------------
CREATE TABLE customer_segments (

    -- ── Identity ──────────────────────────────────────────────
    email               TEXT        PRIMARY KEY,   -- real email OR 'wa:{wa_id}' for phone-only
    identifier_type     TEXT        NOT NULL DEFAULT 'email',  -- 'email' | 'whatsapp'
    full_name           TEXT,
    phone               TEXT,
    mobile              TEXT,
    whatsapp_id         TEXT,
    whatsapp_name       TEXT,
    country             TEXT,
    city                TEXT,
    nationality         TEXT,

    -- ── Classification ────────────────────────────────────────
    customer_type       TEXT,                   -- 'B2C' | 'B2B'
    contact_status      TEXT,
    priority            INTEGER,                -- 1=high … 4=low

    -- ── Marketing flags ───────────────────────────────────────
    can_email           BOOLEAN     DEFAULT TRUE,
    can_call            BOOLEAN     DEFAULT TRUE,
    can_sms             BOOLEAN     DEFAULT TRUE,
    soft_bounce         BOOLEAN     DEFAULT FALSE,
    hard_bounce         BOOLEAN     DEFAULT FALSE,
    email_bounced       BOOLEAN     GENERATED ALWAYS AS (soft_bounce OR hard_bounce) STORED,

    -- ── Marketing flags (channel reach) ──────────────────────
    can_whatsapp        BOOLEAN     DEFAULT FALSE,  -- TRUE whenever we have a wa_id

    -- ── Engagement: WhatsApp / Chats ──────────────────────────
    has_whatsapp        BOOLEAN     DEFAULT FALSE,
    total_chats         INTEGER     DEFAULT 0,
    last_chat_date      TIMESTAMPTZ,
    chat_tags           TEXT[],

    -- ── Engagement: Email Tickets ─────────────────────────────
    total_tickets       INTEGER     DEFAULT 0,
    open_tickets        INTEGER     DEFAULT 0,
    last_ticket_date    TIMESTAMPTZ,
    last_ticket_subject TEXT,

    -- ── Transactions: Travel / Bookings ───────────────────────
    total_bookings      INTEGER     DEFAULT 0,
    last_travel_date    DATE,
    first_travel_date   DATE,
    travel_services     TEXT[],
    travel_type         TEXT,

    -- ── RFM Signals ───────────────────────────────────────────
    recency_days        INTEGER,
    frequency           INTEGER,
    monetary            INTEGER     DEFAULT 0,

    -- ── Segment label ─────────────────────────────────────────
    segment_label       TEXT,

    -- ── Metadata ──────────────────────────────────────────────
    source_tables       TEXT[],
    first_seen_date     TIMESTAMPTZ,
    last_interaction    TIMESTAMPTZ,
    segment_updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cs_segment_label    ON customer_segments (segment_label);
CREATE INDEX idx_cs_customer_type    ON customer_segments (customer_type);
CREATE INDEX idx_cs_last_interaction ON customer_segments (last_interaction DESC);
CREATE INDEX idx_cs_total_bookings   ON customer_segments (total_bookings DESC);
CREATE INDEX idx_cs_can_email        ON customer_segments (can_email) WHERE can_email = TRUE;
CREATE INDEX idx_cs_has_whatsapp     ON customer_segments (has_whatsapp) WHERE has_whatsapp = TRUE;

-- ---------------------------------------------------------------
-- STEP 2: Populate via CTEs
-- ---------------------------------------------------------------
INSERT INTO customer_segments (
    email, identifier_type, full_name, phone, mobile, whatsapp_id, whatsapp_name,
    country, city, nationality,
    customer_type, contact_status, priority,
    can_email, can_call, can_sms, can_whatsapp, soft_bounce, hard_bounce,
    has_whatsapp, total_chats, last_chat_date, chat_tags,
    total_tickets, open_tickets, last_ticket_date, last_ticket_subject,
    total_bookings, last_travel_date, first_travel_date, travel_services, travel_type,
    recency_days, frequency, monetary,
    segment_label,
    source_tables, first_seen_date, last_interaction, segment_updated_at
)

WITH

-- ── 1. Base email universe ──────────────────────────────────────
email_universe AS (
    SELECT LOWER(TRIM(email)) AS email, 'contacts' AS src
    FROM contacts
    WHERE email IS NOT NULL
      AND email LIKE '%@%'
      AND LOWER(TRIM(email)) NOT IN ('', 'null', 'n/a', 'na', '-', '0')

    UNION

    SELECT LOWER(TRIM(t_from)) AS email, 'tickets' AS src
    FROM tickets
    WHERE t_from IS NOT NULL
      AND t_from LIKE '%@%'
      AND LOWER(TRIM(t_from)) NOT IN ('', 'null', 'n/a', 'na', '-', '0')

    UNION

    SELECT LOWER(TRIM(email)) AS email, 'travel' AS src
    FROM travel_data
    WHERE email IS NOT NULL
      AND email LIKE '%@%'
      AND LOWER(TRIM(email)) NOT IN ('', 'null', 'n/a', 'na', '-', '0')

    UNION

    SELECT LOWER(TRIM(email)) AS email, 'chats' AS src
    FROM chats
    WHERE email IS NOT NULL
      AND email LIKE '%@%'
      AND LOWER(TRIM(email)) NOT IN ('', 'null', 'n/a', 'na', '-', '0')
),

base_emails AS (
    SELECT
        email,
        ARRAY_AGG(DISTINCT src ORDER BY src) AS source_tables
    FROM email_universe
    GROUP BY email
),

-- ── 2. Contacts aggregation ──────────────────────────────────────
contacts_agg AS (
    SELECT
        LOWER(TRIM(c.email)) AS email,

        NULLIF(TRIM(c.name), '') AS c_name,

        CASE WHEN TRIM(COALESCE(c.phone,'')) IN
                  ('', '-', 'N/A', 'NA', 'na', '0', '00', '0000000000', 'NULL', 'null', 'None')
             THEN NULL ELSE TRIM(c.phone) END AS c_phone,

        CASE WHEN TRIM(COALESCE(c.mobile,'')) IN
                  ('', '-', 'N/A', 'NA', 'na', '0', '00', '0000000000', 'NULL', 'null', 'None')
             THEN NULL ELSE TRIM(c.mobile) END AS c_mobile,

        CASE WHEN TRIM(COALESCE(c.country_name,'')) IN ('', '-', 'N/A', 'NA', 'null', 'NULL')
             THEN NULL ELSE TRIM(c.country_name) END AS c_country,

        CASE WHEN TRIM(COALESCE(c.city,'')) IN ('', '-', 'N/A', 'NA', 'null', 'NULL')
             THEN NULL ELSE TRIM(c.city) END AS c_city,

        NULLIF(TRIM(COALESCE(c.contact_type,'')), '')  AS c_customer_type,
        NULLIF(TRIM(COALESCE(c.contact_status,'')), '') AS c_contact_status,
        c.priority                                     AS c_priority,

        (c.rte = 1)  AS c_can_email,
        (c.rtc = 1)  AS c_can_call,
        (c.rts = 1)  AS c_can_sms,

        (NULLIF(TRIM(COALESCE(c.s_bounce, '0')), '0') IS NOT NULL) AS c_soft_bounce,
        (NULLIF(TRIM(COALESCE(c.h_bounce, '0')), '0') IS NOT NULL) AS c_hard_bounce,

        -- contacts dates are proper TIMESTAMP columns
        c.created_at AS c_created_at,
        c.updated_at AS c_updated_at

    FROM contacts c
    WHERE c.email IS NOT NULL
      AND c.email LIKE '%@%'
      AND LOWER(TRIM(c.email)) NOT IN ('', 'null', 'n/a', 'na', '-', '0')
),

-- ── 3. Tickets aggregation ───────────────────────────────────────
-- created_at is TEXT 'DD/MM/YYYY HH:MM'
-- Closed statuses observed in data: 3, 16, 48, 70, 99
tickets_ranked AS (
    SELECT
        LOWER(TRIM(t_from)) AS email,
        subject,
        from_name,
        status,
        bill_total,
        created_at,
        TO_TIMESTAMP(
            NULLIF(TRIM(created_at), ''), 'DD/MM/YYYY HH24:MI'
        ) AS parsed_at,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(t_from))
            ORDER BY TO_TIMESTAMP(NULLIF(TRIM(created_at),''), 'DD/MM/YYYY HH24:MI') DESC NULLS LAST
        ) AS rn_latest,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(t_from))
            ORDER BY
                CASE WHEN from_name IS NOT NULL
                          AND TRIM(from_name) NOT IN ('', '-', 'N/A', 'NULL')
                     THEN 0 ELSE 1 END,
                TO_TIMESTAMP(NULLIF(TRIM(created_at),''), 'DD/MM/YYYY HH24:MI') DESC NULLS LAST
        ) AS rn_name
    FROM tickets
    WHERE t_from IS NOT NULL
      AND t_from LIKE '%@%'
      AND LOWER(TRIM(t_from)) NOT IN ('', 'null', 'n/a', 'na', '-', '0')
      AND spam = '0'
),

tickets_agg AS (
    SELECT
        tr.email,
        COUNT(*)                                               AS total_tickets,
        COUNT(*) FILTER (
            WHERE tr.status NOT IN ('3', '16', '48', '70', '99')
        )                                                      AS open_tickets,
        MAX(tr.parsed_at)                                      AS last_ticket_date,
        MIN(tr.parsed_at)                                      AS first_ticket_date,
        MAX(tr.subject) FILTER (WHERE tr.rn_latest = 1)        AS last_ticket_subject,
        MAX(tr.from_name) FILTER (WHERE tr.rn_name = 1)        AS t_name,
        COUNT(*) FILTER (
            WHERE tr.bill_total IS NOT NULL
              AND TRIM(tr.bill_total) NOT IN ('', 'NULL', '0', '00', 'null')
              AND tr.bill_total ~ '^[0-9]+(\.[0-9]+)?$'
              AND tr.bill_total::NUMERIC > 0
        )                                                      AS monetary_count
    FROM tickets_ranked tr
    GROUP BY tr.email
),

-- ── 4. Travel data aggregation ───────────────────────────────────
-- start_date / last_date are proper DATE columns
travel_ranked AS (
    SELECT
        LOWER(TRIM(email)) AS email,
        bill_type,
        type,
        nationality,
        guest_name,
        contact,
        start_date,
        added_date,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(email))
            ORDER BY
                CASE WHEN nationality IS NOT NULL
                          AND TRIM(nationality) NOT IN ('', '-', 'NULL', 'null', 'N/A')
                     THEN 0 ELSE 1 END,
                added_date DESC NULLS LAST
        ) AS rn_nat,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(email))
            ORDER BY
                CASE WHEN guest_name IS NOT NULL
                          AND TRIM(guest_name) NOT IN ('', '-', 'NULL')
                     THEN 0 ELSE 1 END,
                added_date DESC NULLS LAST
        ) AS rn_name,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(email))
            ORDER BY
                CASE WHEN contact IS NOT NULL
                          AND TRIM(contact) NOT IN ('', '-', '0', '0000000000', 'NULL', 'null')
                          AND LENGTH(REGEXP_REPLACE(contact, '[^0-9]', '', 'g')) >= 7
                     THEN 0 ELSE 1 END,
                added_date DESC NULLS LAST
        ) AS rn_phone
    FROM travel_data
    WHERE email IS NOT NULL
      AND email LIKE '%@%'
      AND LOWER(TRIM(email)) NOT IN ('', 'null', 'n/a', 'na', '-', '0')
),

travel_agg AS (
    SELECT
        tr.email,
        COUNT(*)           AS total_bookings,
        MAX(tr.start_date) AS last_travel_date,
        MIN(tr.start_date) AS first_travel_date,

        ARRAY_REMOVE(
            ARRAY_AGG(DISTINCT LOWER(TRIM(tr.bill_type))),
            NULL
        ) AS travel_services,

        CASE
            WHEN COUNT(DISTINCT UPPER(tr.type)) > 1 THEN 'Mixed'
            WHEN MAX(UPPER(tr.type)) = 'B2B'        THEN 'B2B'
            WHEN MAX(UPPER(tr.type)) = 'B2C'        THEN 'B2C'
            ELSE NULL
        END AS travel_type,

        MAX(LOWER(TRIM(tr.nationality))) FILTER (WHERE tr.rn_nat = 1)  AS nationality,
        MAX(TRIM(tr.guest_name))         FILTER (WHERE tr.rn_name = 1) AS td_name,
        MAX(TRIM(tr.contact))            FILTER (WHERE tr.rn_phone = 1) AS td_phone,

        MIN(tr.added_date) AS first_booking_added

    FROM travel_ranked tr
    GROUP BY tr.email
),

-- ── 5. Chats aggregation ─────────────────────────────────────────
-- 5a. Chats that carry their own email field
chats_with_email AS (
    SELECT
        LOWER(TRIM(ch.email)) AS email,
        ch.wa_id,
        ch.wa_name,
        ch.last_msg,
        ch.created_at         AS chat_created_at,
        ch.tags,
        ch.country            AS chat_country
    FROM chats ch
    WHERE ch.email IS NOT NULL
      AND ch.email LIKE '%@%'
      AND LOWER(TRIM(ch.email)) NOT IN ('', 'null', 'n/a', 'na', '-', '0')
      AND ch.spam = 0
),

-- 5b. Chats without email: resolve via contacts phone suffix-match
-- Only match when the contact actually has a valid phone (length >= 7 digits)
chats_phone_resolved AS (
    SELECT
        LOWER(TRIM(c.email)) AS email,
        ch.wa_id,
        ch.wa_name,
        ch.last_msg,
        ch.created_at        AS chat_created_at,
        ch.tags,
        ch.country           AS chat_country
    FROM chats ch
    INNER JOIN contacts c ON (
        -- Both sides must have at least 7 digits
        LENGTH(REGEXP_REPLACE(ch.wa_id, '[^0-9]', '', 'g')) >= 7
        AND (
            -- Match against mobile (if valid)
            (
                TRIM(COALESCE(c.mobile,'')) NOT IN
                    ('', '-', '0', '00', '0000000000', 'N/A', 'NA', 'null', 'NULL', 'None')
                AND LENGTH(REGEXP_REPLACE(c.mobile, '[^0-9]', '', 'g')) >= 7
                AND (
                    REGEXP_REPLACE(ch.wa_id, '[^0-9]', '', 'g')
                      LIKE '%' || REGEXP_REPLACE(c.mobile, '[^0-9]', '', 'g')
                    OR
                    REGEXP_REPLACE(c.mobile, '[^0-9]', '', 'g')
                      LIKE '%' || REGEXP_REPLACE(ch.wa_id, '[^0-9]', '', 'g')
                )
            )
            OR
            -- Match against phone (if valid)
            (
                TRIM(COALESCE(c.phone,'')) NOT IN
                    ('', '-', '0', '00', '0000000000', 'N/A', 'NA', 'null', 'NULL', 'None')
                AND LENGTH(REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g')) >= 7
                AND (
                    REGEXP_REPLACE(ch.wa_id, '[^0-9]', '', 'g')
                      LIKE '%' || REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g')
                    OR
                    REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g')
                      LIKE '%' || REGEXP_REPLACE(ch.wa_id, '[^0-9]', '', 'g')
                )
            )
        )
    )
    WHERE ch.email IS NULL
      AND ch.spam = 0
      AND c.email IS NOT NULL AND c.email LIKE '%@%'
),

all_chats_resolved AS (
    SELECT * FROM chats_with_email
    UNION ALL
    SELECT * FROM chats_phone_resolved
),

-- 5c. WhatsApp-only: chats that could NOT be resolved to any email
chats_wa_only AS (
    SELECT
        ch.wa_id,
        ch.wa_name,
        ch.last_msg,
        ch.created_at  AS chat_created_at,
        ch.tags,
        ch.country     AS chat_country
    FROM chats ch
    WHERE ch.spam = 0
      AND NOT EXISTS (
          SELECT 1 FROM all_chats_resolved acr
          WHERE acr.wa_id = ch.wa_id
      )
),

-- Aggregate WhatsApp-only customers by wa_id
wa_only_ranked AS (
    SELECT
        wa_id,
        wa_name,
        last_msg,
        chat_created_at,
        tags,
        chat_country,
        ROW_NUMBER() OVER (
            PARTITION BY wa_id
            ORDER BY last_msg DESC NULLS LAST
        ) AS rn
    FROM chats_wa_only
),

wa_only_tags AS (
    SELECT DISTINCT
        wa_id,
        TRIM(tag) AS tag
    FROM chats_wa_only
    CROSS JOIN LATERAL unnest(string_to_array(tags, ',')) AS tag
    WHERE tags IS NOT NULL
      AND TRIM(tags) NOT IN ('', 'NULL', 'null')
      AND TRIM(tag) != ''
),

wa_only_agg AS (
    SELECT
        wr.wa_id,
        COUNT(*)                                            AS total_chats,
        MAX(wr.last_msg)                                    AS last_chat_date,
        MAX(wr.wa_name)  FILTER (WHERE wr.rn = 1)          AS wa_name,
        MAX(wr.chat_country)                               AS chat_country,
        MIN(wr.chat_created_at)                            AS first_chat_date,
        (
            SELECT ARRAY_AGG(tag ORDER BY tag)
            FROM wa_only_tags wt
            WHERE wt.wa_id = wr.wa_id
        )                                                  AS chat_tags
    FROM wa_only_ranked wr
    GROUP BY wr.wa_id
),

chats_ranked AS (
    SELECT
        email,
        wa_id,
        wa_name,
        last_msg,
        chat_created_at,
        tags,
        chat_country,
        ROW_NUMBER() OVER (
            PARTITION BY email
            ORDER BY last_msg DESC NULLS LAST
        ) AS rn
    FROM all_chats_resolved
),

chats_tags_expanded AS (
    SELECT DISTINCT
        email,
        TRIM(tag) AS tag
    FROM all_chats_resolved
    CROSS JOIN LATERAL unnest(string_to_array(tags, ',')) AS tag
    WHERE tags IS NOT NULL
      AND TRIM(tags) NOT IN ('', 'NULL', 'null')
      AND TRIM(tag) != ''
),

chats_agg AS (
    SELECT
        cr.email,
        COUNT(*)                                            AS total_chats,
        MAX(cr.last_msg)                                    AS last_chat_date,
        TRUE                                               AS has_whatsapp,
        MAX(cr.wa_id)    FILTER (WHERE cr.rn = 1)          AS wa_id,
        MAX(cr.wa_name)  FILTER (WHERE cr.rn = 1)          AS wa_name,
        (
            SELECT ARRAY_AGG(tag ORDER BY tag)
            FROM chats_tags_expanded cte
            WHERE cte.email = cr.email
        )                                                  AS chat_tags,
        MAX(cr.chat_country)                               AS chat_country,
        MIN(cr.chat_created_at)                            AS first_chat_date
    FROM chats_ranked cr
    GROUP BY cr.email
),

-- ── 6. Last interaction across all channels ──────────────────────
last_interactions AS (
    SELECT
        be.email,
        GREATEST(
            ta.last_ticket_date,
            ca.last_chat_date,
            trav.last_travel_date::TIMESTAMPTZ,
            con.c_updated_at
        ) AS last_interaction,
        LEAST(
            ta.first_ticket_date,
            ca.first_chat_date,
            trav.first_travel_date::TIMESTAMPTZ,
            con.c_created_at
        ) AS first_seen_date
    FROM base_emails be
    LEFT JOIN tickets_agg  ta   ON ta.email   = be.email
    LEFT JOIN chats_agg    ca   ON ca.email   = be.email
    LEFT JOIN travel_agg   trav ON trav.email = be.email
    LEFT JOIN contacts_agg con  ON con.email  = be.email
),

-- ── 7. Assemble all fields ───────────────────────────────────────
assembled AS (
    SELECT
        be.email,
        'email'::TEXT AS identifier_type,

        COALESCE(con.c_name, ta.t_name, trav.td_name, ca.wa_name) AS full_name,
        COALESCE(con.c_phone, trav.td_phone)                       AS phone,
        con.c_mobile                                               AS mobile,
        ca.wa_id                                                   AS whatsapp_id,
        ca.wa_name                                                 AS whatsapp_name,
        COALESCE(con.c_country, ca.chat_country)                   AS country,
        con.c_city                                                 AS city,
        trav.nationality                                           AS nationality,

        COALESCE(UPPER(con.c_customer_type), UPPER(trav.travel_type)) AS customer_type,
        COALESCE(con.c_contact_status, 'Unknown')                 AS contact_status,
        COALESCE(con.c_priority, 4)                               AS priority,

        COALESCE(con.c_can_email, TRUE)    AS can_email,
        COALESCE(con.c_can_call,  TRUE)    AS can_call,
        COALESCE(con.c_can_sms,   TRUE)    AS can_sms,
        (ca.wa_id IS NOT NULL)             AS can_whatsapp,
        COALESCE(con.c_soft_bounce, FALSE) AS soft_bounce,
        COALESCE(con.c_hard_bounce, FALSE) AS hard_bounce,

        COALESCE(ca.has_whatsapp, FALSE) AS has_whatsapp,
        COALESCE(ca.total_chats, 0)      AS total_chats,
        ca.last_chat_date,
        ca.chat_tags,

        COALESCE(ta.total_tickets, 0) AS total_tickets,
        COALESCE(ta.open_tickets, 0)  AS open_tickets,
        ta.last_ticket_date,
        ta.last_ticket_subject,

        COALESCE(trav.total_bookings, 0) AS total_bookings,
        trav.last_travel_date,
        trav.first_travel_date,
        trav.travel_services,
        trav.travel_type,

        EXTRACT(DAY FROM (NOW() - li.last_interaction))::INTEGER AS recency_days,

        COALESCE(ca.total_chats, 0)
            + COALESCE(ta.total_tickets, 0)
            + COALESCE(trav.total_bookings, 0) AS frequency,

        COALESCE(ta.monetary_count, 0) AS monetary,

        be.source_tables,
        li.first_seen_date,
        li.last_interaction

    FROM base_emails be
    LEFT JOIN contacts_agg  con  ON con.email  = be.email
    LEFT JOIN tickets_agg   ta   ON ta.email   = be.email
    LEFT JOIN chats_agg     ca   ON ca.email   = be.email
    LEFT JOIN travel_agg    trav ON trav.email = be.email
    LEFT JOIN last_interactions li ON li.email = be.email
)

-- ── 8. Final SELECT with segment_label (email-based + wa_only UNION) ──
SELECT
    a.email,
    a.identifier_type,
    a.full_name,
    a.phone,
    a.mobile,
    a.whatsapp_id,
    a.whatsapp_name,
    a.country,
    a.city,
    a.nationality,
    a.customer_type,
    a.contact_status,
    a.priority,
    a.can_email,
    a.can_call,
    a.can_sms,
    a.can_whatsapp,
    a.soft_bounce,
    a.hard_bounce,
    a.has_whatsapp,
    a.total_chats,
    a.last_chat_date,
    a.chat_tags,
    a.total_tickets,
    a.open_tickets,
    a.last_ticket_date,
    a.last_ticket_subject,
    a.total_bookings,
    a.last_travel_date,
    a.first_travel_date,
    a.travel_services,
    a.travel_type,
    a.recency_days,
    a.frequency,
    a.monetary,

    CASE
        WHEN a.hard_bounce = TRUE
            THEN 'Invalid - Bounced'
        WHEN a.total_bookings >= 3
          OR (a.total_bookings >= 1 AND a.monetary >= 2)
            THEN 'High Value'
        WHEN a.customer_type = 'B2B'
          AND (a.total_tickets >= 2 OR a.total_bookings >= 1)
            THEN 'B2B Partner'
        WHEN a.total_bookings >= 1
            THEN 'Converted'
        WHEN a.frequency >= 5
          AND a.recency_days IS NOT NULL AND a.recency_days <= 30
            THEN 'Engaged'
        WHEN a.recency_days IS NOT NULL AND a.recency_days <= 14
          AND a.frequency <= 2
            THEN 'New Lead'
        WHEN a.recency_days IS NOT NULL
          AND a.recency_days BETWEEN 31 AND 90
          AND a.frequency >= 3
            THEN 'At Risk'
        WHEN a.recency_days IS NULL OR a.recency_days > 90
            THEN 'Dormant'
        ELSE 'Prospect'
    END AS segment_label,

    a.source_tables,
    a.first_seen_date,
    a.last_interaction,
    NOW() AS segment_updated_at

FROM assembled a

UNION ALL

-- ── WhatsApp-only customers (no email anywhere) ──────────────────
SELECT
    'wa:' || wa.wa_id                          AS email,
    'whatsapp'                                 AS identifier_type,
    wa.wa_name                                 AS full_name,
    wa.wa_id                                   AS phone,   -- the phone number
    NULL                                       AS mobile,
    wa.wa_id                                   AS whatsapp_id,
    wa.wa_name                                 AS whatsapp_name,
    wa.chat_country                            AS country,
    NULL                                       AS city,
    NULL                                       AS nationality,
    NULL                                       AS customer_type,
    'WhatsApp Only'                            AS contact_status,
    4                                          AS priority,
    FALSE                                      AS can_email,
    FALSE                                      AS can_call,
    FALSE                                      AS can_sms,
    TRUE                                       AS can_whatsapp,
    FALSE                                      AS soft_bounce,
    FALSE                                      AS hard_bounce,
    TRUE                                       AS has_whatsapp,
    wa.total_chats,
    wa.last_chat_date,
    wa.chat_tags,
    0                                          AS total_tickets,
    0                                          AS open_tickets,
    NULL                                       AS last_ticket_date,
    NULL                                       AS last_ticket_subject,
    0                                          AS total_bookings,
    NULL                                       AS last_travel_date,
    NULL                                       AS first_travel_date,
    NULL                                       AS travel_services,
    NULL                                       AS travel_type,
    EXTRACT(DAY FROM (NOW() - wa.last_chat_date))::INTEGER AS recency_days,
    wa.total_chats                             AS frequency,
    0                                          AS monetary,

    CASE
        WHEN wa.total_chats >= 5
          AND EXTRACT(DAY FROM (NOW() - wa.last_chat_date)) <= 30
            THEN 'Engaged'
        WHEN EXTRACT(DAY FROM (NOW() - wa.last_chat_date)) <= 14
          AND wa.total_chats <= 2
            THEN 'New Lead'
        WHEN EXTRACT(DAY FROM (NOW() - wa.last_chat_date)) BETWEEN 31 AND 90
          AND wa.total_chats >= 3
            THEN 'At Risk'
        WHEN EXTRACT(DAY FROM (NOW() - wa.last_chat_date)) > 90
            THEN 'Dormant'
        ELSE 'Prospect'
    END                                        AS segment_label,

    ARRAY['chats']                             AS source_tables,
    wa.first_chat_date                         AS first_seen_date,
    wa.last_chat_date                          AS last_interaction,
    NOW()                                      AS segment_updated_at

FROM wa_only_agg wa

ORDER BY total_bookings DESC, frequency DESC, email;
