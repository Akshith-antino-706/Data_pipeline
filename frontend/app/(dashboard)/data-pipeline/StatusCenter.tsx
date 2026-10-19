'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { getOverviewStatus } from '@/lib/api';
import type { OverviewStatus, OverviewQueue, OverviewQueueChannel } from '@/lib/api';
import { Card, StatusChip, Table } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import styles from './StatusCenter.module.css';

export const STATUS_POLL_MS = 30_000;

type Sources = Extract<OverviewStatus['dataSources'], { available: true }>['sources'];
type FailedRows = Extract<OverviewStatus['failedSends'], { available: true }>['rows'];
type AvailableQueue = Extract<OverviewQueue, { available: true }>;

const CHANNEL_LABELS: Record<OverviewQueueChannel, string> = {
  email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', rcs: 'RCS', welcome: 'Welcome', gtmJourney: 'GTM journey',
};

const NOT_AVAILABLE = 'Not available right now';

function fmtDate(d: string | null | undefined): string {
  if (!d) return '--';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '--';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Dubai' }) + ' ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
}

function fmtNum(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '0';
}

/** A missing or malformed section counts as unavailable: we never invent values. */
function sourcesOf(s: OverviewStatus | null): Sources | null {
  const sec = s?.dataSources;
  return sec && sec.available === true && Array.isArray(sec.sources) ? sec.sources : null;
}
function queuesOf(s: OverviewStatus | null): OverviewQueue[] | null {
  const sec = s?.queues;
  return sec && sec.available === true && Array.isArray(sec.queues) ? sec.queues : null;
}
function failedOf(s: OverviewStatus | null): FailedRows | null {
  const sec = s?.failedSends;
  return sec && sec.available === true && Array.isArray(sec.rows) ? sec.rows : null;
}

function sourceTone(status: string | null): { tone: ChipTone; label: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'success': return { tone: 'ok', label: 'Healthy' };
    case 'error': return { tone: 'bad', label: 'Error' };
    case 'running': return { tone: 'info', label: 'Running' };
    case '': return { tone: 'mute', label: 'Unknown' };
    default: return { tone: 'warn', label: status ?? 'Unknown' };
  }
}

function queueTone(q: AvailableQueue): { tone: ChipTone; label: string } {
  if (q.paused > 0) return { tone: 'warn', label: 'Paused' };
  if (q.failed > 0) return { tone: 'bad', label: `${fmtNum(q.failed)} failed` };
  if (q.active > 0 || q.waiting > 0) return { tone: 'info', label: 'Processing' };
  return { tone: 'ok', label: 'Idle' };
}

interface Health { tone: ChipTone; label: string; issues: number }

/** Overall health is derived only from sections that actually reported. */
export function deriveHealth(s: OverviewStatus | null): Health {
  const sources = sourcesOf(s);
  const queues = queuesOf(s);
  const failed = failedOf(s);
  if (!sources && !queues && !failed) return { tone: 'mute', label: 'Status unknown', issues: 0 };
  let issues = 0;
  for (const src of sources ?? []) if ((src.status ?? '').toLowerCase() === 'error') issues++;
  for (const q of queues ?? []) if (q.available && (q.failed > 0 || q.paused > 0)) issues++;
  if (failed && failed.length > 0) issues++;
  if (issues > 0) return { tone: 'bad', label: issues === 1 ? '1 issue needs attention' : `${issues} issues need attention`, issues };
  const partial = !sources || !queues || !failed || (queues ?? []).some(q => !q.available);
  return partial ? { tone: 'warn', label: 'Partially reporting', issues: 0 } : { tone: 'ok', label: 'All systems healthy', issues: 0 };
}

function Unavailable() {
  return <div className={styles.unavailable}>{NOT_AVAILABLE}</div>;
}

export default function StatusCenter() {
  const [status, setStatus] = useState<OverviewStatus | null>(null);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getOverviewStatus();
      setStatus(res ?? null);
      setError(false);
      setCheckedAt(new Date());
    } catch (err) {
      console.error('Failed to load status center:', err);
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const sources = sourcesOf(status);
  const queues = queuesOf(status);
  const failed = failedOf(status);
  const health = deriveHealth(status);

  return (
    <section className={styles.wrap} aria-label="Status center">
      {error && (
        <div className={styles.banner} role="alert">
          <WifiOff size={16} aria-hidden="true" />
          <span>Can&apos;t reach the server. <span className={styles.bannerNote}>Showing the last known status; retrying every 30s.</span></span>
        </div>
      )}

      <div className={styles.summary}>
        <div className={styles.summaryLeft}>
          <span className={styles.eyebrow}>Overall health</span>
          <div>
            {loaded ? <StatusChip tone={health.tone} data-testid="overall-health">{health.label}</StatusChip>
              : <StatusChip tone="mute" data-testid="overall-health">Checking…</StatusChip>}
          </div>
        </div>
        <div className={styles.summaryCounts}>
          <span>Sources <span className={styles.num}>{sources ? fmtNum(sources.length) : '--'}</span></span>
          <span>Queues <span className={styles.num}>{queues ? fmtNum(queues.length) : '--'}</span></span>
          <span>Failed sends (24h) <span className={styles.num}>{failed ? fmtNum(failed.length) : '--'}</span></span>
        </div>
        <span className={styles.updated}>{checkedAt ? `Checked ${fmtDate(checkedAt.toISOString())}` : 'Not checked yet'}</span>
      </div>

      <Card title="Data sources">
        {!loaded ? null : !sources ? <Unavailable /> : sources.length === 0 ? (
          <div className={styles.unavailable}>No sources tracked in sync_metadata yet</div>
        ) : (
          <Table label="Data sources">
            <thead>
              <tr><th>Source</th><th>Status</th><th>Last success</th><th className={styles.right}>Rows</th><th className={styles.right}>Duration</th></tr>
            </thead>
            <tbody>
              {sources.map(src => {
                const t = sourceTone(src.status);
                return (
                  <tr key={src.name}>
                    <td>
                      <div className={styles.mono}>{src.name}</div>
                      {src.error && <div className={styles.errText}>{src.error}</div>}
                    </td>
                    <td><StatusChip tone={t.tone}>{t.label}</StatusChip></td>
                    <td className={styles.muted}>{fmtDate(src.lastSyncedAt)}</td>
                    <td className={styles.right}>{fmtNum(src.rows)}</td>
                    <td className={styles.right}>{typeof src.durationMs === 'number' && src.durationMs > 0 ? `${(src.durationMs / 1000).toFixed(1)}s` : '--'}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Queue health">
        {!loaded ? null : !queues ? <Unavailable /> : queues.length === 0 ? (
          <div className={styles.unavailable}>No queues reported</div>
        ) : (
          <div className={styles.queues}>
            {queues.map(q => {
              const name = CHANNEL_LABELS[q.channel] ?? q.channel;
              if (!q.available) {
                return (
                  <div key={q.channel} className={styles.queue} data-testid={`queue-${q.channel}`}>
                    <div className={styles.queueHead}><span className={styles.queueName}>{name}</span><StatusChip tone="mute">Unavailable</StatusChip></div>
                    <div className={styles.muted}>{NOT_AVAILABLE}</div>
                  </div>
                );
              }
              const t = queueTone(q);
              return (
                <div key={q.channel} className={styles.queue} data-testid={`queue-${q.channel}`}>
                  <div className={styles.queueHead}><span className={styles.queueName}>{name}</span><StatusChip tone={t.tone}>{t.label}</StatusChip></div>
                  <div className={styles.queueStats}>
                    <span><b>{fmtNum(q.waiting)}</b>waiting</span>
                    <span><b>{fmtNum(q.active)}</b>active</span>
                    <span><b>{fmtNum(q.delayed)}</b>delayed</span>
                    <span><b>{fmtNum(q.completed)}</b>done</span>
                    <span><b>{fmtNum(q.failed)}</b>failed</span>
                    <span><b>{fmtNum(q.paused)}</b>paused</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Failed sends (last 24h)" actions={<Link href="/log" className={styles.cardHeadLink}>Open message log</Link>}>
        {!loaded ? null : !failed ? <Unavailable /> : failed.length === 0 ? (
          <div className={styles.unavailable}>No failed sends in the last 24 hours</div>
        ) : (
          <Table label="Failed sends">
            <thead>
              <tr><th>Time</th><th>Channel</th><th>Recipient</th><th>Reason</th><th>Journey</th></tr>
            </thead>
            <tbody>
              {failed.map(r => (
                <tr key={`${r.channel}-${r.id}`}>
                  <td className={styles.muted}>{fmtDate(r.time)}</td>
                  <td>{CHANNEL_LABELS[r.channel as OverviewQueueChannel] ?? r.channel}</td>
                  <td className={styles.mono}>{r.recipient ?? '--'}</td>
                  <td className={styles.errText}>{r.reason ?? '--'}</td>
                  <td>{r.journeyId != null ? <Link href="/log">#{r.journeyId}</Link> : '--'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </section>
  );
}
