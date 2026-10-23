'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getMappingStats } from '@/lib/api';
import type { MappingStats, PipelineJob, PipelineSource } from '@/lib/api';
import { Button, Card, ErrorState, PageHeader, Skeleton, StatusChip, Table } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { friendlyError } from '@/lib/friendlyError';
import StatusCenter from './StatusCenter';
import styles from './pipeline.module.css';

const SOURCES: { key: PipelineSource; label: string }[] = [
  { key: 'tours', label: 'Tours' }, { key: 'hotels', label: 'Hotels' }, { key: 'visas', label: 'Visas' },
  { key: 'flights', label: 'Flights' }, { key: 'packages', label: 'Packages' }, { key: 'others', label: 'Others' },
];
const GROUPS: { key: NonNullable<PipelineJob['category']>; label: string; hint: string }[] = [
  { key: 'ingest', label: 'Bringing data in', hint: 'Pulls from the booking system, phpAdmin and the billing API.' },
  { key: 'compute', label: 'Nightly calculations', hint: 'Snapshots and precomputed figures for the dashboards.' },
  { key: 'engine', label: 'Always running', hint: 'Loops that move journeys forward.' },
];

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Dubai' }) + ', ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
}
function fmtNum(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '0';
}
function isNum(n: unknown): n is number { return typeof n === 'number' && Number.isFinite(n); }

function jobResult(job: PipelineJob): { tone: ChipTone; label: string } {
  const status = job.meta?.sync_status ?? (job.meta ? 'success' : null);
  switch ((status ?? '').toLowerCase()) {
    case 'success': return { tone: 'ok', label: 'Synced' };
    case 'error': return { tone: 'bad', label: 'Failed' };
    case 'running': return { tone: 'info', label: 'Running' };
    case '': return { tone: 'mute', label: 'Scheduled' };
    default: return { tone: 'warn', label: status ?? 'Scheduled' };
  }
}
function lastRunText(job: PipelineJob): string | null {
  const m = job.meta;
  if (!m) return null;
  const rows = isNum(m.rows_synced) ? `${fmtNum(m.rows_synced)} rows` : null;
  const dur = isNum(m.sync_duration_ms) && m.sync_duration_ms > 0 ? `${(m.sync_duration_ms / 1000).toFixed(1)}s` : null;
  return [rows, dur].filter(Boolean).join(' · ') || null;
}

type Load = { state: 'loading' } | { state: 'ok'; data: MappingStats } | { state: 'error'; message: string };

export default function DataPipeline() {
  const { businessType } = useBusinessType();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [statusKey, setStatusKey] = useState(0);

  const fetchStats = useCallback(async (fresh: boolean) => {
    const params = businessType === 'All' ? {} : { businessType };
    try {
      const data = await getMappingStats(params, fresh ? { fresh: true } : {});
      setLoad({ state: 'ok', data: data ?? {} });
    } catch (err) {
      console.error('Failed to load pipeline data:', err);
      setLoad({ state: 'error', message: friendlyError(err instanceof Error ? err.message : String(err))?.reason ?? 'Could not load the pipeline figures.' });
    }
  }, [businessType]);

  useEffect(() => {
    setLoad({ state: 'loading' });
    void fetchStats(false);
  }, [fetchStats]);

  const refresh = async () => {
    setRefreshing(true);
    setStatusKey(k => k + 1);
    await fetchStats(true);
    setRefreshing(false);
  };

  const data = load.state === 'ok' ? load.data : null;
  const ov = data?.dataOverview ?? {};
  const overall = data?.overall ?? {};
  const coverage = data?.coverage ?? {};
  const jobs = data?.cronJobs ?? [];
  const scopeLabel = businessType === 'All' ? 'All contacts' : `${businessType} contacts`;

  const tiles = [
    { key: 'contacts', label: scopeLabel, value: ov.unifiedContacts, sub: businessType !== 'All' && isNum(ov.totalUsers) ? `of ${fmtNum(ov.totalUsers)} in total` : undefined },
    { key: 'email', label: 'With an email', value: ov.uniqueEmails },
    { key: 'mobile', label: 'With a mobile', value: ov.phones },
    { key: 'bookings', label: 'Bookings', value: ov.travelBookings, sub: isNum(overall.customersWithBookings) ? `${fmtNum(overall.customersWithBookings)} contacts have booked` : undefined },
    { key: 'chats', label: 'WhatsApp chats', value: ov.chats },
  ].filter(t => isNum(t.value));

  const sourceRows = SOURCES
    .map(s => ({ ...s, cov: coverage[s.key] }))
    .filter((s): s is typeof s & { cov: NonNullable<typeof s.cov> } => !!s.cov && isNum(s.cov.total) && s.cov.total > 0);

  const groups = GROUPS
    .map(g => ({ ...g, jobs: jobs.filter(j => (j.category ?? 'ingest') === g.key) }))
    .filter(g => g.jobs.length > 0);

  const matchRate = Number(overall.matchRate);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Data pipeline"
        meta={
          <span className={styles.headerMeta}>
            {data?.computedAt && <span>Figures as of {fmtDate(data.computedAt)}</span>}
            {data?.stale && <StatusChip tone="warn">Refreshing in the background</StatusChip>}
          </span>
        }
        actions={
          <Button size="sm" onClick={refresh} disabled={refreshing || load.state === 'loading'}>
            <RefreshCw size={14} className={refreshing ? styles.spin : undefined} /> Refresh
          </Button>
        }
      />

      <StatusCenter refreshKey={statusKey} />

      {load.state === 'loading' && (
        <div className={styles.skeletons} aria-hidden="true" data-testid="pipeline-skeleton">
          <Skeleton height={88} />
          <Skeleton height={220} />
          <Skeleton height={320} />
        </div>
      )}

      {load.state === 'error' && (
        <ErrorState
          title="Pipeline figures unavailable"
          description={load.message}
          action={<Button size="sm" onClick={() => { setLoad({ state: 'loading' }); void fetchStats(true); }}>Try again</Button>}
        />
      )}

      {data && tiles.length > 0 && (
        <Card title="What we hold">
          <div className={styles.tiles}>
            {tiles.map(t => (
              <div key={t.key} className={styles.tile}>
                <span className={styles.tileValue}>{fmtNum(t.value)}</span>
                <span className={styles.tileLabel}>{t.label}</span>
                {t.sub && <span className={styles.tileSub}>{t.sub}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {data && sourceRows.length > 0 && (
        <Card title="Bookings by product">
          {isNum(overall.customersWithBookings) && isNum(overall.totalCustomers) && overall.totalCustomers > 0 && (
            <p className={styles.cardSub}>
              {fmtNum(overall.customersWithBookings)} of {fmtNum(overall.totalCustomers)} contacts have at least one booking
              {Number.isFinite(matchRate) ? ` (${matchRate.toFixed(1)}%)` : ''}.
            </p>
          )}
          <Table label="Bookings by product">
            <thead>
              <tr><th>Product</th><th className={styles.num}>Bookings</th><th>Linked to a contact</th><th>Last data received</th></tr>
            </thead>
            <tbody>
              {sourceRows.map(s => {
                const pct = s.cov.total > 0 ? Math.min(100, (s.cov.mapped / s.cov.total) * 100) : 0;
                return (
                  <tr key={s.key}>
                    <td className={styles.strong}>{s.label}</td>
                    <td className={styles.num}>{fmtNum(s.cov.total)}</td>
                    <td>
                      <div className={styles.bar} title={`${fmtNum(s.cov.mapped)} of ${fmtNum(s.cov.total)}`}>
                        <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${pct}%` }} /></div>
                        <span className={styles.barPct}>{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className={styles.muted}>{fmtDate(s.cov.lastDataAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {data && groups.length > 0 && (
        <Card title="Scheduled jobs" actions={<span className={styles.muted}>{jobs.length} jobs · times in Dubai</span>}>
          <Table label="Scheduled jobs">
            <thead>
              <tr><th>Job</th><th>Runs</th><th>Next run</th><th>Last run</th><th>Result</th><th>Last run details</th></tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <GroupRows key={g.key} label={g.label} hint={g.hint} jobs={g.jobs} />
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function GroupRows({ label, hint, jobs }: { label: string; hint: string; jobs: PipelineJob[] }) {
  return (
    <>
      <tr className={styles.groupRow}><td colSpan={6}>{label}<span className={styles.groupHint}>{hint}</span></td></tr>
      {jobs.map(job => {
        const r = jobResult(job);
        const err = job.meta?.sync_status === 'error' ? job.meta?.error_message : null;
        const details = lastRunText(job);
        return (
          <tr key={job.name}>
            <td>
              <div className={styles.strong}>{job.label}</div>
              {job.description && <div className={styles.desc}>{job.description}</div>}
              {err && <div className={styles.err}>{err}</div>}
            </td>
            <td className={styles.muted}>{job.humanSchedule}</td>
            <td className={styles.muted}>{fmtDate(job.nextRun)}</td>
            <td className={styles.muted}>
              {job.meta ? fmtDate(job.meta.last_synced_at) : '—'}
              {job.sourceLatestAt && <div>source: {fmtDate(job.sourceLatestAt)}</div>}
            </td>
            <td><StatusChip tone={r.tone}>{r.label}</StatusChip></td>
            <td className={styles.muted}>{details ?? '—'}</td>
          </tr>
        );
      })}
    </>
  );
}
