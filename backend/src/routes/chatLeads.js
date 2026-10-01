import { Router } from 'express';
import { mysqlQuery } from '../config/mysql.js';
import db from '../config/database.js';

const router = Router();

// mysql2 returns DATE columns as JS Date objects constructed in the connection's
// local timezone; reading back the LOCAL components (not toISOString, which
// converts to UTC) avoids an off-by-one-day shift when that timezone isn't UTC.
function formatLocalDate(value) {
  if (!(value instanceof Date)) return value;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Full local timestamp (YYYY-MM-DD HH:MM:SS) — same local-components approach as
// formatLocalDate to avoid the UTC off-by-one/hour shift on the Asia/Dubai DB session.
function formatLocalDateTime(value) {
  if (!(value instanceof Date)) return value;
  const p = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())} `
       + `${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}`;
}

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_TITLE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sqlDateTime(d) {
  const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0'), mi = String(d.getMinutes()).padStart(2, '0'), s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}

// Standard ISO-8601 week number (Monday-start weeks, week 1 = week containing the year's first Thursday).
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
}

function mondayOf(date) {
  const d = new Date(date);
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatRangeLabel(start, end) {
  const sMonth = MONTHS_SHORT[start.getMonth()];
  const eMonth = MONTHS_SHORT[end.getMonth()];
  return sMonth === eMonth
    ? `${start.getDate()}-${end.getDate()} ${sMonth}`
    : `${start.getDate()} ${sMonth}-${end.getDate()} ${eMonth}`;
}

// Builds `count` Monday-start ISO weeks ending at the current (possibly partial) week.
function buildWeekPeriods(count) {
  const now = new Date();
  const currentMonday = mondayOf(now);
  const periods = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(currentMonday);
    start.setDate(start.getDate() - i * 7);
    const calendarEnd = new Date(start);
    calendarEnd.setDate(calendarEnd.getDate() + 6);
    calendarEnd.setHours(23, 59, 59, 999);
    const partial = i === 0;
    const effectiveEnd = partial ? now : calendarEnd;
    periods.push({
      start: sqlDateTime(start),
      end: sqlDateTime(effectiveEnd),
      label: `W${isoWeekNumber(start)}`,
      sublabel: formatRangeLabel(start, calendarEnd),
      partial,
    });
  }
  return periods;
}

// Builds `count` calendar months ending at the current (possibly partial) month.
function buildMonthPeriods(count) {
  const now = new Date();
  const periods = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const calendarEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    const partial = i === 0;
    const effectiveEnd = partial ? now : calendarEnd;
    periods.push({
      start: sqlDateTime(start),
      end: sqlDateTime(effectiveEnd),
      label: `${MONTHS_TITLE[start.getMonth()]} ${start.getFullYear()}`,
      sublabel: null,
      partial,
    });
  }
  return periods;
}

// Builds `count` calendar days ending at today (possibly partial).
function buildDayPeriods(count) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const periods = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const calendarEnd = new Date(day);
    calendarEnd.setHours(23, 59, 59, 999);
    const partial = i === 0;
    periods.push({
      start: sqlDateTime(day),
      end: sqlDateTime(partial ? now : calendarEnd),
      label: `${day.getDate()} ${MONTHS_SHORT[day.getMonth()]}`,
      sublabel: null,
      partial,
    });
  }
  return periods;
}

// Parses an <input type="week"> value ("2026-W37") into that week's Monday.
function parseISOWeekStart(str) {
  const m = /^(\d{4})-W(\d{2})$/.exec(str || '');
  if (!m) return null;
  const jan4Monday = mondayOf(new Date(Number(m[1]), 0, 4));
  const d = new Date(jan4Monday);
  d.setDate(d.getDate() + (Number(m[2]) - 1) * 7);
  return d;
}

function buildDayRangePeriods(fromStr, toStr) {
  const now = new Date();
  const start = new Date(fromStr);
  const end = new Date(toStr);
  if (isNaN(start) || isNaN(end) || start > end) return [];
  start.setHours(0, 0, 0, 0);
  const periods = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = new Date(d);
    const calendarEnd = new Date(day);
    calendarEnd.setHours(23, 59, 59, 999);
    const partial = day.toDateString() === now.toDateString();
    periods.push({
      start: sqlDateTime(day),
      end: sqlDateTime(partial ? now : calendarEnd),
      label: `${day.getDate()} ${MONTHS_SHORT[day.getMonth()]}`,
      sublabel: null,
      partial,
    });
  }
  return periods;
}

function buildWeekRangePeriods(fromStr, toStr) {
  const now = new Date();
  const start = parseISOWeekStart(fromStr);
  const end = parseISOWeekStart(toStr);
  if (!start || !end || start > end) return [];
  const currentMonday = mondayOf(now);
  const periods = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
    const weekStart = new Date(d);
    const calendarEnd = new Date(weekStart);
    calendarEnd.setDate(calendarEnd.getDate() + 6);
    calendarEnd.setHours(23, 59, 59, 999);
    const partial = weekStart.getTime() === currentMonday.getTime();
    periods.push({
      start: sqlDateTime(weekStart),
      end: sqlDateTime(partial ? now : calendarEnd),
      label: `W${isoWeekNumber(weekStart)}`,
      sublabel: formatRangeLabel(weekStart, calendarEnd),
      partial,
    });
  }
  return periods;
}

function buildMonthRangePeriods(fromStr, toStr) {
  const now = new Date();
  const fm = /^(\d{4})-(\d{2})$/.exec(fromStr || '');
  const tm = /^(\d{4})-(\d{2})$/.exec(toStr || '');
  if (!fm || !tm) return [];
  let y = Number(fm[1]), m = Number(fm[2]);
  const ty = Number(tm[1]), tmo = Number(tm[2]);
  if (y > ty || (y === ty && m > tmo)) return [];
  const periods = [];
  while (y < ty || (y === ty && m <= tmo)) {
    const start = new Date(y, m - 1, 1);
    const calendarEnd = new Date(y, m, 0, 23, 59, 59, 999);
    const partial = y === now.getFullYear() && m === now.getMonth() + 1;
    periods.push({
      start: sqlDateTime(start),
      end: sqlDateTime(partial ? now : calendarEnd),
      label: `${MONTHS_TITLE[m - 1]} ${y}`,
      sublabel: null,
      partial,
    });
    m++; if (m > 12) { m = 1; y++; }
  }
  return periods;
}

function buildPeriods(unit, count, from, to) {
  if (from && to) {
    if (unit === 'day') return buildDayRangePeriods(from, to);
    if (unit === 'month') return buildMonthRangePeriods(from, to);
    return buildWeekRangePeriods(from, to);
  }
  if (unit === 'day') return buildDayPeriods(count);
  if (unit === 'month') return buildMonthPeriods(count);
  return buildWeekPeriods(count);
}

// Generic per-receiver/department pivot: one SUM(chats)+COUNT(DISTINCT lead) pair per period,
// in a single query (avoids relying on MySQL's own week-numbering modes).
async function queryDepartmentPeriods({ table, dateCol, leadCol, departmentJoin, receiverCol, poolName, periods }) {
  // Per period: chats (records), leads (distinct users), and a NEW vs RETURNING split.
  // A user is NEW in a period if their FIRST-EVER contact (MIN(dateCol) over all history,
  // per leadCol — the `f` subquery) falls inside that period; RETURNING if it was earlier.
  // Same "first message" definition as the KPI cards. new + old = leads.
  const caseClauses = periods.map((_, i) => `
    SUM(CASE WHEN x.${dateCol} BETWEEN ? AND ? THEN 1 ELSE 0 END) AS p${i}_chats,
    COUNT(DISTINCT CASE WHEN x.${dateCol} BETWEEN ? AND ? THEN x.${leadCol} END) AS p${i}_leads,
    COUNT(DISTINCT CASE WHEN x.${dateCol} BETWEEN ? AND ? AND f.first_at BETWEEN ? AND ? THEN x.${leadCol} END) AS p${i}_new,
    COUNT(DISTINCT CASE WHEN x.${dateCol} BETWEEN ? AND ? AND f.first_at <  ? THEN x.${leadCol} END) AS p${i}_old`).join(',\n');
  const params = [];
  periods.forEach((p) => {
    params.push(
      p.start, p.end,                 // p_chats
      p.start, p.end,                 // p_leads
      p.start, p.end, p.start, p.end, // p_new  (in period AND first_at in period)
      p.start, p.end, p.start,        // p_old  (in period AND first_at before period)
    );
  });
  params.push(periods[0].start, periods[periods.length - 1].end);

  const rows = await mysqlQuery(`
    SELECT x.${receiverCol} AS receiver, d.name AS department,
      ${caseClauses}
    FROM ${table} x
    ${departmentJoin}
    JOIN (
      SELECT ${leadCol} AS _lc, MIN(${dateCol}) AS first_at
      FROM ${table} WHERE ${leadCol} IS NOT NULL AND ${leadCol} <> ''
      GROUP BY ${leadCol}
    ) f ON f._lc = x.${leadCol}
    WHERE x.${dateCol} BETWEEN ? AND ?
    GROUP BY x.${receiverCol}, d.name
    ORDER BY p${periods.length - 1}_chats DESC
  `, params, poolName);

  return rows.map((row) => ({
    receiver: row.receiver,
    department: row.department || null,
    // one {chats, leads, newUsers, oldUsers} per period, in the same order as `periods`
    values: periods.map((_, i) => ({
      chats:    Number(row[`p${i}_chats`]) || 0,
      leads:    Number(row[`p${i}_leads`]) || 0,
      newUsers: Number(row[`p${i}_new`])   || 0,
      oldUsers: Number(row[`p${i}_old`])   || 0,
    })),
  }));
}

function parsePeriodParams(req) {
  const unit = ['month', 'day'].includes(req.query.unit) ? req.query.unit : 'week';
  const maxCount = { day: 31, week: 26, month: 24 }[unit];
  let count = parseInt(req.query.count, 10);
  if (!Number.isFinite(count) || count < 1) count = { day: 7, week: 7, month: 3 }[unit];
  count = Math.min(count, maxCount);
  const from = req.query.from || null;
  const to = req.query.to || null;
  return { unit, count, from, to };
}

function validateDateRange(req, res) {
  const { from, to } = req.query;
  if (!from || !to) {
    res.status(400).json({ error: 'Both "from" and "to" date query params are required (YYYY-MM-DD)' });
    return null;
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    return null;
  }
  if (fromDate > toDate) {
    res.status(400).json({ error: '"from" date must be before or equal to "to" date.' });
    return null;
  }
  return { from, to };
}

// ── GET /summary — leads by department for a date range ─────
router.get('/summary', async (req, res) => {
  try {
    const dates = validateDateRange(req, res);
    if (!dates) return;
    const { from, to } = dates;

    const rows = await mysqlQuery(`
      SELECT c.receiver,
             d.name AS department,
             COUNT(*) AS chats,
             COUNT(DISTINCT c.wa_id) AS leads
      FROM chats c
      LEFT JOIN departments d ON d.connection = c.receiver
      WHERE c.created_at >= ? AND c.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY c.receiver, d.name
      ORDER BY chats DESC
    `, [from, to], 'chats');

    const totalsRow = await mysqlQuery(`
      SELECT COUNT(*) AS chats, COUNT(DISTINCT wa_id) AS leads
      FROM chats
      WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
    `, [from, to], 'chats');

    // New vs old users: for each user active in the range, take their FIRST-EVER message
    // time (MIN(created_at) over all history). first message on/after `from` → NEW (this is
    // their first contact ever); earlier → OLD (returning). new + old = unique users in range.
    const userStatsRow = await mysqlQuery(`
      SELECT
        SUM(CASE WHEN f.first_at >= ? THEN 1 ELSE 0 END) AS new_users,
        SUM(CASE WHEN f.first_at <  ? THEN 1 ELSE 0 END) AS old_users
      FROM (
        SELECT wa_id, MIN(created_at) AS first_at
        FROM chats
        WHERE wa_id IN (
          SELECT DISTINCT wa_id FROM chats
          WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
            AND wa_id IS NOT NULL AND wa_id <> ''
        )
        GROUP BY wa_id
      ) f
    `, [from, from, from, to], 'chats');

    res.json({
      success: true,
      from,
      to,
      totalChats: totalsRow[0]?.chats || 0,
      totalLeads: totalsRow[0]?.leads || 0,
      uniqueUsers: totalsRow[0]?.leads || 0,
      newUsers: Number(userStatsRow[0]?.new_users || 0),
      oldUsers: Number(userStatsRow[0]?.old_users || 0),
      byDepartment: rows.map(r => ({
        receiver: r.receiver,
        department: r.department || null,
        chats: r.chats,
        leads: r.leads,
      })),
    });
  } catch (err) {
    console.error('Chat leads summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /trend — chats/leads over time, grouped by day/week/month ─
router.get('/trend', async (req, res) => {
  try {
    const dates = validateDateRange(req, res);
    if (!dates) return;
    const { from, to } = dates;
    const granularity = ['day', 'week', 'month'].includes(req.query.granularity)
      ? req.query.granularity
      : 'day';

    // period bucket for any datetime column, at the chosen granularity.
    const pe = (col) => ({
      day: `DATE(${col})`,
      week: `DATE(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY))`,
      month: `DATE_FORMAT(${col}, '%Y-%m-01')`,
    }[granularity]);

    // new vs returning per period: a user is NEW in a period if their FIRST-EVER message
    // (f.first_at) falls in the SAME period bucket as their activity; RETURNING if earlier.
    const rows = await mysqlQuery(`
      SELECT ${pe('c.created_at')} AS period,
             COUNT(*) AS chats,
             COUNT(DISTINCT c.wa_id) AS leads,
             COUNT(DISTINCT CASE WHEN ${pe('f.first_at')} = ${pe('c.created_at')} THEN c.wa_id END) AS new_users,
             COUNT(DISTINCT CASE WHEN ${pe('f.first_at')} < ${pe('c.created_at')} THEN c.wa_id END) AS old_users
      FROM chats c
      JOIN (
        SELECT wa_id, MIN(created_at) AS first_at
        FROM chats WHERE wa_id IS NOT NULL AND wa_id <> '' GROUP BY wa_id
      ) f ON f.wa_id = c.wa_id
      WHERE c.created_at >= ? AND c.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY period
      ORDER BY period ASC
    `, [from, to], 'chats');

    res.json({
      success: true,
      from,
      to,
      granularity,
      points: rows.map(r => ({
        period: formatLocalDate(r.period),
        chats: r.chats,
        leads: r.leads,
        newUsers: Number(r.new_users || 0),
        oldUsers: Number(r.old_users || 0),
      })),
    });
  } catch (err) {
    console.error('Chat leads trend error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /mail-summary — email leads by department for a date range ─
router.get('/mail-summary', async (req, res) => {
  try {
    const dates = validateDateRange(req, res);
    if (!dates) return;
    const { from, to } = dates;

    const rows = await mysqlQuery(`
      SELECT t.t_to AS receiver,
             d.name AS department,
             COUNT(*) AS emails,
             COUNT(DISTINCT t.t_from) AS leads
      FROM tickets t
      LEFT JOIN department_emails de ON de.email = t.t_to
      LEFT JOIN departments d ON d.id = de.did
      WHERE t.created_at >= ? AND t.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY t.t_to, d.name
      ORDER BY emails DESC
    `, [from, to], 'primary');

    const totalsRow = await mysqlQuery(`
      SELECT COUNT(*) AS emails, COUNT(DISTINCT t_from) AS leads
      FROM tickets
      WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
    `, [from, to], 'primary');

    res.json({
      success: true,
      from,
      to,
      totalEmails: totalsRow[0]?.emails || 0,
      totalLeads: totalsRow[0]?.leads || 0,
      byDepartment: rows.map(r => ({
        receiver: r.receiver,
        department: r.department || null,
        emails: r.emails,
        leads: r.leads,
      })),
    });
  } catch (err) {
    console.error('Mail leads summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /mail-trend — emails/leads over time, grouped by day/week/month ─
router.get('/mail-trend', async (req, res) => {
  try {
    const dates = validateDateRange(req, res);
    if (!dates) return;
    const { from, to } = dates;
    const granularity = ['day', 'week', 'month'].includes(req.query.granularity)
      ? req.query.granularity
      : 'day';

    const periodExpr = {
      day: 'DATE(t.created_at)',
      week: 'DATE(DATE_SUB(t.created_at, INTERVAL WEEKDAY(t.created_at) DAY))',
      month: "DATE_FORMAT(t.created_at, '%Y-%m-01')",
    }[granularity];

    const rows = await mysqlQuery(`
      SELECT ${periodExpr} AS period,
             COUNT(*) AS emails,
             COUNT(DISTINCT t.t_from) AS leads
      FROM tickets t
      WHERE t.created_at >= ? AND t.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY period
      ORDER BY period ASC
    `, [from, to], 'primary');

    res.json({
      success: true,
      from,
      to,
      granularity,
      points: rows.map(r => ({
        period: formatLocalDate(r.period),
        emails: r.emails,
        leads: r.leads,
      })),
    });
  } catch (err) {
    console.error('Mail leads trend error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /department-periods — chats/leads by department, one column per week/month ─
router.get('/department-periods', async (req, res) => {
  try {
    const { unit, count, from, to } = parsePeriodParams(req);
    const periods = buildPeriods(unit, count, from, to);

    const rows = await queryDepartmentPeriods({
      table: 'chats',
      dateCol: 'created_at',
      leadCol: 'wa_id',
      receiverCol: 'receiver',
      departmentJoin: 'LEFT JOIN departments d ON d.connection = x.receiver',
      poolName: 'chats',
      periods,
    });

    res.json({ success: true, unit, periods: periods.map(({ label, sublabel, partial }) => ({ label, sublabel, partial })), rows });
  } catch (err) {
    console.error('Chat leads department-periods error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /mail-department-periods — email leads by department, one column per week/month ─
router.get('/mail-department-periods', async (req, res) => {
  try {
    const { unit, count, from, to } = parsePeriodParams(req);
    const periods = buildPeriods(unit, count, from, to);

    const rows = await queryDepartmentPeriods({
      table: 'tickets',
      dateCol: 'created_at',
      leadCol: 't_from',
      receiverCol: 't_to',
      departmentJoin: 'LEFT JOIN department_emails de ON de.email = x.t_to LEFT JOIN departments d ON d.id = de.did',
      poolName: 'primary',
      periods,
    });

    res.json({ success: true, unit, periods: periods.map(({ label, sublabel, partial }) => ({ label, sublabel, partial })), rows });
  } catch (err) {
    console.error('Mail leads department-periods error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /first-msg — first message TEXT (ChatHead API) + TIMESTAMP (our chats) ─
//   from = customer WhatsApp number (chats.wa_id), to = Rayna receiver (chats.receiver)
//   ChatHead's /apis/wa/first_msg returns only the text; we add the first-message
//   time from the chats table (MIN(created_at) for that conversation).
// GET /registrations - all fields from the three registration feeds.
const REGISTRATION_TABLES = {
  guestuser: 'guestuser_data',
  agent: 'agent_data',
  affiliate: 'affiliate_data',
};

router.get('/registrations', async (req, res) => {
  try {
    const source = String(req.query.source || 'all').toLowerCase();
    if (source !== 'all' && !REGISTRATION_TABLES[source]) {
      return res.status(400).json({ error: 'Invalid registration source' });
    }
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const search = String(req.query.search || '').trim().slice(0, 200);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : '';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : '';
    const field = String(req.query.field || '').trim();
    const value = String(req.query.value || '').trim().slice(0, 200);
    const selected = source === 'all' ? Object.entries(REGISTRATION_TABLES) : [[source, REGISTRATION_TABLES[source]]];
    const unionSql = selected.map(([type, table]) => `
      SELECT '${type}'::text AS source, id::text AS record_id,
             NULLIF("registrationDate", 'NULL') AS registration_date,
             CASE WHEN "registrationDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                  THEN LEFT("registrationDate", 10) END AS registration_sort_date,
             created_at AS ingested_at, to_jsonb(t) AS data
      FROM ${table} t
    `).join(' UNION ALL ');
    const cte = `WITH registrations AS (${unionSql})`;

    const { rows: fieldRows } = await db.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position
    `, [Object.values(REGISTRATION_TABLES)]);
    const fieldsBySource = {};
    for (const row of fieldRows) {
      const type = Object.entries(REGISTRATION_TABLES).find(([, table]) => table === row.table_name)?.[0];
      if (!type) continue;
      if (!fieldsBySource[type]) fieldsBySource[type] = [];
      fieldsBySource[type].push(row.column_name);
    }
    const allFields = [...new Set(Object.values(fieldsBySource).flat())];
    if (field && !allFields.includes(field)) return res.status(400).json({ error: 'Invalid filter field' });

    const params = [];
    const conditions = [];
    const bind = input => { params.push(input); return `$${params.length}`; };
    if (search) conditions.push(`data::text ILIKE ${bind(`%${search}%`)}`);
    if (from) conditions.push(`registration_sort_date >= ${bind(from)}`);
    if (to) conditions.push(`registration_sort_date <= ${bind(to)}`);
    if (field && value) conditions.push(`COALESCE(data ->> ${bind(field)}, '') ILIKE ${bind(`%${value}%`)}`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countParams = [...params];
    const limitBind = bind(limit);
    const offsetBind = bind((page - 1) * limit);
    const [{ rows }, countResult] = await Promise.all([
      db.query(`${cte} SELECT source, record_id, registration_date, data FROM registrations ${where}
                ORDER BY registration_sort_date DESC NULLS LAST, ingested_at DESC NULLS LAST, record_id DESC
                LIMIT ${limitBind} OFFSET ${offsetBind}`, params),
      db.query(`${cte} SELECT COUNT(*)::int AS total FROM registrations ${where}`, countParams),
    ]);
    res.json({
      success: true, page, limit, total: countResult.rows[0]?.total || 0, fieldsBySource,
      records: rows.map(r => ({ source: r.source, recordId: r.record_id, registrationDate: r.registration_date, data: r.data })),
    });
  } catch (err) {
    console.error('Registration leads list error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/first-msg', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'Both "from" (customer number) and "to" (Rayna receiver number) are required' });
    }

    // 1. first message TEXT — ChatHead API (always HTTP 200; check body.status).
    let firstMsg = null;
    let chatheadStatus = 'error';
    try {
      const url = `https://chathead.io/apis/wa/first_msg/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const chResp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const body = await chResp.json();
      chatheadStatus = body?.status || 'error';
      if (chatheadStatus === 'success') firstMsg = body.msg ?? null;
    } catch (e) {
      console.warn('[first-msg] ChatHead fetch failed:', e.message);
    }

    // 2. first message TIMESTAMP — from our synced chats (MIN created_at for this pair).
    let firstMsgAt = null;
    let lastMsgAt = null;
    let totalMsgs = 0;
    try {
      const rows = await mysqlQuery(
        `SELECT MIN(created_at) AS first_msg_at, MAX(created_at) AS last_msg_at, COUNT(*) AS msgs
         FROM chats WHERE wa_id = ? AND receiver = ?`,
        [from, to], 'chats'
      );
      firstMsgAt = rows[0]?.first_msg_at ? formatLocalDateTime(rows[0].first_msg_at) : null;
      lastMsgAt  = rows[0]?.last_msg_at  ? formatLocalDateTime(rows[0].last_msg_at)  : null;
      totalMsgs  = Number(rows[0]?.msgs || 0);
    } catch (e) {
      console.warn('[first-msg] chats timestamp lookup failed:', e.message);
    }

    res.json({
      success: true,
      from,
      to,
      first_msg: firstMsg,          // text from ChatHead ("Conversation not found" → null)
      first_msg_at: firstMsgAt,     // when the conversation started (our chats data)
      last_msg_at: lastMsgAt,
      total_msgs: totalMsgs,
      found: chatheadStatus === 'success',
      chathead_status: chatheadStatus,
    });
  } catch (err) {
    console.error('first-msg error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /department-users — users of one department (receiver) in a range, with each
//    user's first message (ChatHead API) + first-message timestamp (our chats). Powers the
//    expandable row in the Leads-by-Department table. Capped + throttled (per-user API call).
router.get('/department-users', async (req, res) => {
  try {
    const { receiver, from, to } = req.query;
    if (!receiver || !from || !to) {
      return res.status(400).json({ error: '"receiver", "from" and "to" are required' });
    }
    const onlyNew = String(req.query.only_new || '') === '1';
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    // Users active with this receiver in the range, with their FIRST-EVER message time.
    // is_new = that first message falls inside the range.
    const rows = await mysqlQuery(`
      SELECT c.wa_id,
             MAX(c.wa_name) AS wa_name,
             f.first_at,
             (f.first_at >= ? AND f.first_at < DATE_ADD(?, INTERVAL 1 DAY)) AS is_new
      FROM chats c
      JOIN (
        SELECT wa_id, MIN(created_at) AS first_at
        FROM chats WHERE wa_id IS NOT NULL AND wa_id <> '' GROUP BY wa_id
      ) f ON f.wa_id = c.wa_id
      WHERE c.receiver = ? AND c.created_at >= ? AND c.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      ${onlyNew ? 'AND f.first_at >= ? AND f.first_at < DATE_ADD(?, INTERVAL 1 DAY)' : ''}
      GROUP BY c.wa_id, f.first_at
      ORDER BY f.first_at DESC
      LIMIT ?
    `, onlyNew ? [from, to, receiver, from, to, from, to, limit] : [from, to, receiver, from, to, limit], 'chats');

    // Fetch each user's first message text from ChatHead (throttled, small concurrency).
    async function firstMsgText(from_) {
      try {
        const r = await fetch(`https://chathead.io/apis/wa/first_msg/?from=${encodeURIComponent(from_)}&to=${encodeURIComponent(receiver)}`, { signal: AbortSignal.timeout(12000) });
        const b = await r.json();
        return b?.status === 'success' ? (b.msg ?? null) : null;
      } catch { return null; }
    }
    const users = [];
    const CONC = 5;
    for (let i = 0; i < rows.length; i += CONC) {
      const batch = rows.slice(i, i + CONC);
      const msgs = await Promise.all(batch.map(r => firstMsgText(r.wa_id)));
      batch.forEach((r, j) => users.push({
        wa_id: r.wa_id,
        wa_name: r.wa_name || null,
        first_msg: msgs[j],
        first_msg_at: formatLocalDateTime(r.first_at),
        is_new: !!Number(r.is_new),
      }));
    }

    res.json({ success: true, receiver, from, to, count: users.length, limit, users });
  } catch (err) {
    console.error('department-users error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Department Groups — a group has a NAME + MANY departments; each department is
// in AT MOST ONE group (UNIQUE(receiver)). Groups live in Postgres; the department
// catalog (receiver + name) comes from MySQL.
// ═══════════════════════════════════════════════════════════════════════════

// GET /departments — all departments (receiver + name) with their group assignment.
// Powers the multiselect: an already-grouped department is marked so the UI disables it.
router.get('/departments', async (_req, res) => {
  try {
    const depts = await mysqlQuery(
      `SELECT connection AS receiver, name FROM departments WHERE connection IS NOT NULL AND connection <> '' ORDER BY name`,
      [], 'chats'
    );
    const { rows: members } = await db.query(
      `SELECT m.receiver, m.group_id, g.name AS group_name
       FROM department_group_members m JOIN department_groups g ON g.id = m.group_id`
    );
    const byReceiver = new Map(members.map(m => [String(m.receiver), m]));
    res.json({
      success: true,
      departments: depts.map(d => {
        const g = byReceiver.get(String(d.receiver));
        return {
          receiver: d.receiver,
          name: d.name || null,
          group_id: g?.group_id || null,
          group_name: g?.group_name || null,
          assigned: !!g,
        };
      }),
    });
  } catch (err) {
    console.error('departments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /groups — all groups with their departments.
router.get('/groups', async (_req, res) => {
  try {
    const { rows: groups } = await db.query('SELECT id, name, created_at, updated_at FROM department_groups ORDER BY name');
    const { rows: members } = await db.query('SELECT group_id, receiver, department_name FROM department_group_members ORDER BY department_name');
    const byGroup = new Map();
    for (const m of members) {
      if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, []);
      byGroup.get(m.group_id).push({ receiver: m.receiver, name: m.department_name || null });
    }
    res.json({
      success: true,
      groups: groups.map(g => ({ id: g.id, name: g.name, departments: byGroup.get(g.id) || [], created_at: g.created_at })),
    });
  } catch (err) {
    console.error('groups list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /groups — create { name, departments: [{receiver, name}] }. Rejects if any
// department already belongs to another group (one dept → one group).
router.post('/groups', async (req, res) => {
  const client = await db.connect();
  try {
    const name = String(req.body?.name || '').trim();
    const departments = Array.isArray(req.body?.departments) ? req.body.departments : [];
    if (!name) return res.status(400).json({ error: 'Group name is required' });
    if (!departments.length) return res.status(400).json({ error: 'Select at least one department' });

    const receivers = departments.map(d => String(d.receiver));
    // Guard: any of these already in a group?
    const { rows: taken } = await client.query(
      `SELECT m.receiver, g.name AS group_name FROM department_group_members m
       JOIN department_groups g ON g.id = m.group_id WHERE m.receiver = ANY($1)`, [receivers]
    );
    if (taken.length) {
      return res.status(409).json({ error: `Already in another group: ${taken.map(t => `${t.receiver} (${t.group_name})`).join(', ')}` });
    }

    await client.query('BEGIN');
    const { rows: [grp] } = await client.query('INSERT INTO department_groups (name) VALUES ($1) RETURNING id, name', [name]);
    for (const d of departments) {
      await client.query(
        'INSERT INTO department_group_members (group_id, receiver, department_name) VALUES ($1,$2,$3)',
        [grp.id, String(d.receiver), d.name || null]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, group: { id: grp.id, name: grp.name, departments } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'A group with that name (or a department) already exists' });
    console.error('group create error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /groups/:id — rename and/or replace the department set (same one-group guard).
router.put('/groups/:id', async (req, res) => {
  const client = await db.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const name = String(req.body?.name || '').trim();
    const departments = Array.isArray(req.body?.departments) ? req.body.departments : [];
    if (!id) return res.status(400).json({ error: 'Invalid group id' });
    if (!name) return res.status(400).json({ error: 'Group name is required' });

    const receivers = departments.map(d => String(d.receiver));
    // Any receiver already in a DIFFERENT group?
    const { rows: taken } = await client.query(
      `SELECT m.receiver, g.name AS group_name FROM department_group_members m
       JOIN department_groups g ON g.id = m.group_id WHERE m.receiver = ANY($1) AND m.group_id <> $2`,
      [receivers, id]
    );
    if (taken.length) {
      return res.status(409).json({ error: `Already in another group: ${taken.map(t => `${t.receiver} (${t.group_name})`).join(', ')}` });
    }

    await client.query('BEGIN');
    await client.query('UPDATE department_groups SET name=$2, updated_at=now() WHERE id=$1', [id, name]);
    await client.query('DELETE FROM department_group_members WHERE group_id=$1', [id]);
    for (const d of departments) {
      await client.query('INSERT INTO department_group_members (group_id, receiver, department_name) VALUES ($1,$2,$3)', [id, String(d.receiver), d.name || null]);
    }
    await client.query('COMMIT');
    res.json({ success: true, group: { id, name, departments } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'A group with that name already exists' });
    console.error('group update error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /groups/:id
router.delete('/groups/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid group id' });
    await db.query('DELETE FROM department_groups WHERE id=$1', [id]);  // members cascade
    res.json({ success: true });
  } catch (err) {
    console.error('group delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
