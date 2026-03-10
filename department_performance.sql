-- =============================================================
-- Department Performance Analysis
-- Covers: WhatsApp channels (chats) + Email channels (tickets)
-- =============================================================

-- ── 1. Department performance via WhatsApp (chats) ────────────
DROP VIEW IF EXISTS department_scorecard;
DROP TABLE IF EXISTS dept_whatsapp_performance;
CREATE TABLE dept_whatsapp_performance AS
SELECT
    receiver                                        AS department_phone,
    COUNT(*)                                        AS total_chats,
    COUNT(*) FILTER (WHERE status = 1)              AS open_chats,
    COUNT(*) FILTER (WHERE status = 2)              AS closed_chats,
    ROUND(
        COUNT(*) FILTER (WHERE status = 2) * 100.0
        / NULLIF(COUNT(*), 0), 1
    )                                               AS close_rate_pct,
    COUNT(DISTINCT assign_to)
        FILTER (WHERE assign_to > 0)               AS active_agents,
    COUNT(*) FILTER (WHERE spam = 1)                AS spam_count,
    COUNT(*) FILTER (WHERE priority <= 2)           AS high_priority,
    MAX(last_msg)                                   AS last_activity,
    MIN(created_at)                                 AS first_seen,
    -- Top tags for this department (comma-separated)
    STRING_AGG(DISTINCT tags, ', ')
        FILTER (WHERE tags IS NOT NULL AND tags != '') AS common_tags
FROM chats
GROUP BY receiver
ORDER BY total_chats DESC;

-- ── 2. Department performance via Email (tickets) ─────────────
DROP TABLE IF EXISTS dept_ticket_performance CASCADE;
CREATE TABLE dept_ticket_performance AS
SELECT
    -- Use first email in t_to as the department identifier
    LOWER(TRIM(SPLIT_PART(t_to, ',', 1)))           AS department_email,
    -- Friendly name: everything before the @
    SPLIT_PART(SPLIT_PART(t_to, ',', 1), '@', 1)   AS department_name,
    -- Domain (company)
    SPLIT_PART(SPLIT_PART(t_to, ',', 1), '@', 2)   AS department_domain,
    COUNT(*)                                        AS total_tickets,
    COUNT(*) FILTER (
        WHERE status NOT IN ('3','16','48','70','99')
    )                                               AS open_tickets,
    COUNT(*) FILTER (
        WHERE status IN ('3','16','48','70','99')
    )                                               AS closed_tickets,
    ROUND(
        COUNT(*) FILTER (WHERE status IN ('3','16','48','70','99')) * 100.0
        / NULLIF(COUNT(*), 0), 1
    )                                               AS close_rate_pct,
    COUNT(DISTINCT assign_to)
        FILTER (WHERE assign_to ~ '^[0-9]+$' AND assign_to != '0') AS active_agents,
    COUNT(*) FILTER (WHERE spam = '1')              AS spam_count,
    COUNT(*) FILTER (WHERE priority ~ '^[0-9]+$'
        AND priority::int <= 2)                     AS high_priority,
    COUNT(*) FILTER (WHERE attach IS NOT NULL
        AND attach NOT IN ('[]',''))                AS tickets_with_attachments,
    MODE() WITHIN GROUP (ORDER BY produc)           AS top_product,
    MAX(TO_TIMESTAMP(created_at, 'DD/MM/YYYY HH24:MI'))
        FILTER (WHERE created_at LIKE '__/__/_____%')   AS last_activity,
    MIN(TO_TIMESTAMP(created_at, 'DD/MM/YYYY HH24:MI'))
        FILTER (WHERE created_at LIKE '__/__/_____%')   AS first_seen
FROM tickets
WHERE t_to IS NOT NULL AND TRIM(t_to) != ''
GROUP BY LOWER(TRIM(SPLIT_PART(t_to, ',', 1))),
         SPLIT_PART(SPLIT_PART(t_to, ',', 1), '@', 1),
         SPLIT_PART(SPLIT_PART(t_to, ',', 1), '@', 2)
ORDER BY total_tickets DESC;

-- ── 3. Worker / Agent performance (chats) ────────────────────
DROP TABLE IF EXISTS agent_whatsapp_performance;
CREATE TABLE agent_whatsapp_performance AS
SELECT
    assign_to                                       AS agent_id,
    receiver                                        AS department_phone,
    COUNT(*)                                        AS total_chats,
    COUNT(*) FILTER (WHERE status = 1)              AS open_chats,
    COUNT(*) FILTER (WHERE status = 2)              AS closed_chats,
    ROUND(
        COUNT(*) FILTER (WHERE status = 2) * 100.0
        / NULLIF(COUNT(*), 0), 1
    )                                               AS close_rate_pct,
    COUNT(*) FILTER (WHERE fv = 1)                  AS first_visit_chats,
    COUNT(*) FILTER (WHERE spam = 1)                AS spam_flagged,
    MAX(last_msg)                                   AS last_active,
    MIN(created_at)                                 AS first_chat,
    -- Response quality: avg time between last_in and last_out (minutes)
    ROUND(AVG(
        EXTRACT(EPOCH FROM (last_out - last_in)) / 60.0
    )::NUMERIC, 1)                                  AS avg_response_min
FROM chats
WHERE assign_to > 0
GROUP BY assign_to, receiver
ORDER BY total_chats DESC;

-- ── 4. Worker / Agent performance (tickets) ──────────────────
DROP TABLE IF EXISTS agent_ticket_performance;
CREATE TABLE agent_ticket_performance AS
SELECT
    assign_to                                                       AS agent_id,
    LOWER(TRIM(SPLIT_PART(t_to, ',', 1)))                          AS department_email,
    SPLIT_PART(SPLIT_PART(t_to, ',', 1), '@', 1)                  AS department_name,
    COUNT(*)                                        AS total_tickets,
    COUNT(*) FILTER (
        WHERE status NOT IN ('3','16','48','70','99')
    )                                               AS open_tickets,
    COUNT(*) FILTER (
        WHERE status IN ('3','16','48','70','99')
    )                                               AS closed_tickets,
    ROUND(
        COUNT(*) FILTER (WHERE status IN ('3','16','48','70','99')) * 100.0
        / NULLIF(COUNT(*), 0), 1
    )                                               AS close_rate_pct,
    COUNT(*) FILTER (WHERE spam = '1')              AS spam_flagged,
    COUNT(*) FILTER (WHERE priority ~ '^[0-9]+$'
        AND priority::int <= 2)                     AS high_priority_handled,
    -- Avg thread count per ticket (proxy for resolution effort)
    ROUND(AVG(
        CASE WHEN th ~ '^[0-9]+$' THEN th::numeric ELSE NULL END
    ), 1)                                           AS avg_thread_depth,
    MAX(TO_TIMESTAMP(created_at, 'DD/MM/YYYY HH24:MI'))
        FILTER (WHERE created_at LIKE '__/__/_____%')   AS last_active,
    MIN(TO_TIMESTAMP(created_at, 'DD/MM/YYYY HH24:MI'))
        FILTER (WHERE created_at LIKE '__/__/_____%')   AS first_ticket
FROM tickets
WHERE assign_to ~ '^[0-9]+$' AND assign_to != '0'
  AND t_to IS NOT NULL AND TRIM(t_to) != ''
GROUP BY assign_to,
         LOWER(TRIM(SPLIT_PART(t_to, ',', 1))),
         SPLIT_PART(SPLIT_PART(t_to, ',', 1), '@', 1)
ORDER BY total_tickets DESC;

-- ── 5. Summary view: combined department scorecard ────────────
DROP VIEW IF EXISTS department_scorecard;
CREATE VIEW department_scorecard AS

-- WhatsApp channels
SELECT
    'WhatsApp'                                      AS channel,
    dw.department_phone                             AS department_ref,
    NULL::TEXT                                      AS department_id,
    dw.total_chats                                  AS total_volume,
    dw.open_chats                                   AS open_count,
    dw.closed_chats                                 AS closed_count,
    dw.close_rate_pct,
    dw.active_agents,
    dw.spam_count,
    dw.high_priority,
    dw.last_activity,
    -- Performance grade
    CASE
        WHEN dw.close_rate_pct >= 80 THEN 'A - Excellent'
        WHEN dw.close_rate_pct >= 60 THEN 'B - Good'
        WHEN dw.close_rate_pct >= 40 THEN 'C - Average'
        WHEN dw.close_rate_pct >= 20 THEN 'D - Below Average'
        ELSE                               'F - Poor'
    END                                             AS performance_grade
FROM dept_whatsapp_performance dw

UNION ALL

-- Email/ticket channels
SELECT
    'Email'                                         AS channel,
    dt.department_email                             AS department_ref,
    dt.department_name                              AS department_id,
    dt.total_tickets                                AS total_volume,
    dt.open_tickets                                 AS open_count,
    dt.closed_tickets                               AS closed_count,
    dt.close_rate_pct,
    dt.active_agents,
    dt.spam_count,
    dt.high_priority,
    dt.last_activity,
    CASE
        WHEN dt.close_rate_pct >= 80 THEN 'A - Excellent'
        WHEN dt.close_rate_pct >= 60 THEN 'B - Good'
        WHEN dt.close_rate_pct >= 40 THEN 'C - Average'
        WHEN dt.close_rate_pct >= 20 THEN 'D - Below Average'
        ELSE                               'F - Poor'
    END                                             AS performance_grade
FROM dept_ticket_performance dt

ORDER BY total_volume DESC;
