'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Users, Building2, UserCheck, Loader2 } from 'lucide-react';
import { getRegistrationLeads, getRegistrationSummary, getRegistrationPeriods } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Table } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/States';
import type {
  RegistrationSourceConfig, RegQuery, RegistrationSummary, RegistrationPeriods, RegistrationRecords,
} from '@/types/f6leads';
import {
  AnalyticsSkeleton, COMPARE_LABEL, DeltaText, Kpi, Pills, Seg, TableSkeleton, TOOLTIP_STYLE,
  comparisonRange, formatNum, pctChange, type CompareMode,
} from './leadsShared';
import styles from './leads.module.css';

export interface RegPanelQuery extends RegQuery { compare: CompareMode }

const REGISTRATION_SOURCES: Record<string, RegistrationSourceConfig> = {
  guestuser: { label: 'Guest Users', icon: Users },
  agent: { label: 'Agents', icon: Building2 },
  affiliate: { label: 'Affiliates', icon: UserCheck },
};
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PERIOD_COUNT: Record<string, number> = { day: 7, week: 7, month: 3 };
const PERIOD_COUNT_OPTIONS: Record<string, number[]> = { day: [5, 7, 14, 30], week: [4, 7, 8, 12, 16], month: [3, 6, 12] };
const UNIT_OPTIONS = [{ value: 'day', label: 'Day on Day' }, { value: 'week', label: 'Week on Week' }, { value: 'month', label: 'Month on Month' }];

// "GuestUserId" → "Guest User Id", "AgentID" → "Agent ID"
export function humanizeColumn(name: string): string {
  const spaced = name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Empty values are stored as '' or the text 'NULL'; timestamps as 'YYYY-MM-DD HH:MM:SS[.ffffff]'.
export function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === 'NULL') return '—';
  const s = String(value);
  const ts = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s);
  if (ts) return ts[2] === '00:00' && /^\d{4}-\d{2}-\d{2} 00:00(:00(\.0+)?)?$/.test(s) ? ts[1] : `${ts[1]} ${ts[2]}`;
  return s;
}

// Registrations tab. `query` comes from the page's shared period filter.
export default function RegistrationPanel({ query }: { query: RegPanelQuery }) {
  const [source, setSource] = useState('guestuser');

  const [summary, setSummary] = useState<RegistrationSummary | null>(null);
  const [prevTotal, setPrevTotal] = useState<number | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [periodUnit, setPeriodUnit] = useState('week');
  const [periodCount, setPeriodCount] = useState(DEFAULT_PERIOD_COUNT.week);
  const [periodData, setPeriodData] = useState<RegistrationPeriods | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [periodError, setPeriodError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<RegistrationRecords>({ records: [], total: 0, columns: [] });
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('leads-registration-source');
      if (saved && REGISTRATION_SOURCES[saved]) setSource(saved);
    } catch { /* storage blocked */ }
  }, []);

  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    setSummaryError(null);
    setPrevTotal(null);
    // Comparison window first, so the current-window call is the latest one made.
    const prev = comparisonRange(query.from, query.to, query.compare);
    if (prev) {
      getRegistrationSummary(source, prev.from, prev.to, query.granularity)
        .then(data => { const t = (data as RegistrationSummary | null)?.total; if (active) setPrevTotal(typeof t === 'number' ? t : null); })
        .catch(() => { /* comparison is optional */ });
    }
    getRegistrationSummary(source, query.from, query.to, query.granularity)
      .then(data => { if (active) setSummary(data as RegistrationSummary); })
      .catch((err: Error) => { if (active) setSummaryError(err.message || 'Failed to load registrations'); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [source, query]);

  useEffect(() => {
    let active = true;
    setPeriodLoading(true);
    setPeriodError(null);
    getRegistrationPeriods(source, periodUnit, periodCount)
      .then(data => {
        if (!active) return;
        const p = data as Partial<RegistrationPeriods> | null;
        setPeriodData({ dimension: p?.dimension ?? '', periods: p?.periods ?? [], rows: p?.rows ?? [], totals: p?.totals ?? [] });
      })
      .catch((err: Error) => { if (active) setPeriodError(err.message || 'Failed to load period breakdown'); })
      .finally(() => { if (active) setPeriodLoading(false); });
    return () => { active = false; };
  }, [source, periodUnit, periodCount]);

  useEffect(() => { setPage(1); }, [source, query, search, limit]);

  useEffect(() => {
    let active = true;
    setRecordsLoading(true);
    setRecordsError(null);
    getRegistrationLeads({ source, from: query.from, to: query.to, search, limit, page })
      .then(data => {
        if (!active) return;
        const r = data as Partial<RegistrationRecords> | null;
        setRecords({ records: r?.records ?? [], total: r?.total ?? 0, columns: r?.columns ?? [] });
      })
      .catch((err: Error) => { if (active) setRecordsError(err.message || 'Failed to load registrations'); })
      .finally(() => { if (active) setRecordsLoading(false); });
    return () => { active = false; };
  }, [source, query, search, limit, page]);

  const handleSource = (s: string) => {
    setSource(s);
    try { window.localStorage.setItem('leads-registration-source', s); } catch { /* storage blocked */ }
  };
  const handlePeriodUnit = (unit: string) => { setPeriodUnit(unit); setPeriodCount(DEFAULT_PERIOD_COUNT[unit]); };

  const label = REGISTRATION_SOURCES[source].label;
  const counts = summary?.counts || {};
  const chartData = (summary?.points || []).map(p => ({ period: p.period, registrations: p.registrations ?? 0 }));
  const columns = records.columns || [];
  const totalPages = Math.max(Math.ceil((records.total || 0) / limit), 1);
  const dimension = periodData?.dimension || (source === 'affiliate' ? 'Affiliate type' : 'Website');
  const peak = chartData.reduce<{ period: string; registrations: number } | null>((best, p) => (!best || p.registrations > best.registrations ? p : best), null);

  return (
    <>
      <div role="radiogroup" aria-label="Registration type" className={styles.sourceRow}>
        {Object.entries(REGISTRATION_SOURCES).map(([key, s]) => (
          <button key={key} type="button" role="radio" aria-checked={source === key} className={styles.sourceBtn} onClick={() => handleSource(key)}>
            <s.icon size={16} aria-hidden="true" />
            {s.label}
            <Chip tone={source === key ? 'gold' : 'mute'}>{summary ? formatNum(counts[key]) : '…'}</Chip>
          </button>
        ))}
      </div>

      {summaryError && <ErrorState title="Couldn't load registrations" description={summaryError} />}
      {summaryLoading && !summary && <AnalyticsSkeleton />}

      {summary && (
        <>
          <div className={styles.kpiGrid}>
            <Kpi
              label={`${label} registered`}
              value={formatNum(summary.total)}
              trend={<DeltaText pct={pctChange(summary.total, prevTotal)} suffix={COMPARE_LABEL[query.compare]} />}
              help={`${summary.from} to ${summary.to}`}
            />
            {peak && peak.registrations > 0 && (
              <Kpi label={`Busiest ${summary.granularity}`} value={peak.period} textValue
                trend={<span className={styles.kpiTrend}>{formatNum(peak.registrations)} registrations</span>} help="From the chart below" />
            )}
          </div>

          <Card className={styles.cardPad}>
            <div className={styles.cardHead}>
              <div>
                <h2 className={styles.cardTitle}>{label} registrations per {summary.granularity}</h2>
                <span className={styles.help}>By registration date</span>
              </div>
              {summaryLoading && <Loader2 size={16} className={styles.spin} aria-label="Refreshing" />}
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fill: 'var(--ink3)', fontSize: 11 }} />
                  <YAxis allowDecimals={false} width={36} tick={{ fill: 'var(--ink3)', fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--sunken)' }} />
                  <Bar dataKey="registrations" name="Registrations" fill="var(--gold)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className={styles.chartEmpty}>No registrations in the selected range.</div>
            )}
          </Card>
        </>
      )}

      <Card className={styles.cardPad}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{label} by {dimension.toLowerCase()}</h2>
          {periodLoading && periodData && <Loader2 size={16} className={styles.spin} aria-label="Refreshing" />}
        </div>
        <div className={styles.periodRow}>
          <Seg label="Breakdown period" options={UNIT_OPTIONS} value={periodUnit} onChange={handlePeriodUnit} />
          <span className={styles.label}>Last</span>
          <Pills label="Number of periods" value={periodCount} onChange={setPeriodCount}
            options={PERIOD_COUNT_OPTIONS[periodUnit].map(n => ({ value: n, label: `${n} ${periodUnit === 'day' ? 'days' : periodUnit === 'week' ? 'weeks' : 'months'}` }))} />
        </div>
        {periodError ? <ErrorState title="Couldn't load the breakdown" description={periodError} />
          : !periodData && periodLoading ? <TableSkeleton label="Loading department data" />
          : periodData && (
            <div className={styles.tableBox}>
              <Table label={`${label} by ${dimension.toLowerCase()}`}>
                <thead>
                  <tr>
                    <th className={styles.stickyCol}>{periodData.dimension || dimension}</th>
                    {periodData.periods.map((p, i) => (
                      <th key={i} className={styles.r}>{p.label}<span className={styles.th2}>{p.sublabel}{p.partial ? ' · PARTIAL' : ''}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periodData.rows.map(row => (
                    <tr key={row.name}>
                      <td className={styles.stickyCol}>{row.name}</td>
                      {row.values.map((v, j) => <td key={j} className={`${styles.r} ${styles.num}`}>{formatNum(v)}</td>)}
                    </tr>
                  ))}
                  {periodData.rows.length === 0 ? (
                    <tr><td colSpan={1 + periodData.periods.length} className={styles.emptyLine}>No registrations in these periods.</td></tr>
                  ) : (
                    <tr>
                      <td className={styles.stickyCol}><b>Total</b></td>
                      {periodData.totals.map((v, j) => <td key={j} className={`${styles.r} ${styles.num}`}><b>{formatNum(v)}</b></td>)}
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          )}
      </Card>

      <Card className={styles.cardPad}>
        <div className={styles.cardHead}>
          <div className={styles.inline}>
            <h2 className={styles.cardTitle}>{label} records</h2>
            <span className={styles.note}>{formatNum(records.total)} records · page {page} of {totalPages}</span>
          </div>
          {recordsLoading && records.records.length > 0 && <Loader2 size={16} className={styles.spin} aria-label="Refreshing" />}
        </div>
        <div className={styles.periodRow}>
          <div className={styles.searchRow}>
            <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setSearch(searchInput.trim()); }}
              aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()} — name, email, phone, ID…`} />
            <Button variant="primary" onClick={() => setSearch(searchInput.trim())}>Search</Button>
            {search && <Button variant="ghost" onClick={() => { setSearchInput(''); setSearch(''); }}>Clear</Button>}
          </div>
          <span className={styles.label}>Rows</span>
          <Pills label="Rows per page" value={limit} onChange={setLimit} options={ROWS_PER_PAGE_OPTIONS.map(n => ({ value: n, label: String(n) }))} />
        </div>
        {recordsError && <ErrorState title="Couldn't load records" description={recordsError} />}
        {recordsLoading && records.records.length === 0 ? <TableSkeleton label="Loading registration records" />
          : records.records.length === 0 ? (
            <EmptyState title={`No ${label.toLowerCase()} registered in this range${search ? ' matching the search' : ''}.`} description="Try a longer period or a different search." />
          ) : (
            <div className={`${styles.tableBox} ${recordsLoading ? styles.dim : ''}`}>
              <Table label={`${label} records`}>
                <thead>
                  <tr>{columns.map(col => <th key={col} title={col}>{humanizeColumn(col)}</th>)}</tr>
                </thead>
                <tbody>
                  {records.records.map(record => (
                    <tr key={`${record.source}-${record.recordId}`}>
                      {columns.map(col => {
                        const text = formatCell(record.data[col]);
                        return <td key={col} title={text} className={text === '—' ? styles.flat : undefined} style={{ whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        <div className={styles.pager}>
          <Button variant="ghost" size="sm" disabled={page <= 1 || recordsLoading} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className={`${styles.note} ${styles.num}`}>{page} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages || recordsLoading} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </Card>
    </>
  );
}
