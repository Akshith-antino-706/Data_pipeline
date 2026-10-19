'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { getOverviewHomeSection, getOverviewStatus } from '@/lib/api';
import type { OverviewHomeSectionName, OverviewSection } from '@/lib/api';
import { Card, Skeleton, buttonClass } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import type { HomeTrendDatum } from './HomeTrendChart';
import s from './home.module.css';

const HomeTrendChart = dynamic(() => import('./HomeTrendChart'), { ssr: false, loading: () => <Skeleton height={240} /> });

const STALE_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** Narrows a section to its data, or null when the API marked it unavailable (or omitted it). */
function avail<T>(sec: OverviewSection<T> | undefined): T | null {
  return sec && sec.available === true ? sec : null;
}
const num = (n: number | null | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const fmt = (n: number | null | undefined): string => num(n).toLocaleString();

/** Shown when a card's data timed out, failed or was marked unavailable; retries only that card. */
function Unavailable({ onRetry, retrying }: { onRetry?: () => void; retrying?: boolean }) {
  return (
    <p className={s.note}>
      Not available right now
      {onRetry && (
        <>
          {' · '}
          <button type="button" className={s.retryLink} onClick={onRetry} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Try again'}
          </button>
        </>
      )}
    </p>
  );
}

const MAX_POLLS = 24;
/** The status endpoint returns at most the latest 50 failed sends, so 50 means "50 or more". */
const FAILED_LIST_CAP = 50;
const isTimeout = (sec: unknown): boolean =>
  !!sec && typeof sec === 'object' && (sec as { available?: unknown }).available === false && (sec as { reason?: unknown }).reason === 'timeout';

interface CardState<T> { data: T | null; loading: boolean; retry: () => void; retrying: boolean }
/** One Home card's query (its own request, cache entry and loading state), narrowed to { data | null, loading, retry }. */
function useHomeCard<T>(section: OverviewHomeSectionName, fetchSection: () => Promise<OverviewSection<T>>): CardState<T> {
  const q = useQuery<OverviewSection<T>>({
    queryKey: ['dashboard', 'home', section],
    queryFn: fetchSection,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    // A 'timeout' means the server is still computing this card in the background and will
    // cache it when done — poll every 5s (up to ~2 min) and keep showing the skeleton meanwhile.
    refetchInterval: query => (isTimeout(query.state.data) && query.state.dataUpdateCount <= MAX_POLLS ? 5_000 : false),
  });
  const result: OverviewSection<T> | undefined = q.data;
  const polls = useQueryClient().getQueryState(['dashboard', 'home', section])?.dataUpdateCount ?? 0;
  const stillComputing = isTimeout(result) && polls <= MAX_POLLS;
  return {
    data: avail(result),
    loading: q.isPending || stillComputing,
    retry: () => { void q.refetch(); },
    retrying: q.isFetching,
  };
}

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

interface KpiProps { label: string; value: ReactNode; help: string; loading: boolean; available: boolean; onRetry: () => void; retrying: boolean }
function Kpi({ label, value, help, loading, available, onRetry, retrying }: KpiProps) {
  return (
    <Card>
      <p className={s.kpiLabel}>{label}</p>
      {loading ? <Skeleton width={90} height={30} /> : available ? (
        <>
          <div className={s.kpiValue}>{value}</div>
          <div className={s.kpiHelp}>{help}</div>
        </>
      ) : <Unavailable onRetry={onRetry} retrying={retrying} />}
    </Card>
  );
}

export interface HomeOverviewProps {
  /** Rendered in the hero's action row (the existing refresh button). */
  extraActions?: ReactNode;
}

export default function HomeOverview({ extraActions }: HomeOverviewProps) {
  const { user } = useAuth();
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const hello = greetingFor(new Date().getHours());

  // One request per card, fired in parallel: each card renders as soon as its own data arrives.
  const sentTodayC = useHomeCard('sentToday', () => getOverviewHomeSection('sentToday'));
  const deliveryC = useHomeCard('delivery7d', () => getOverviewHomeSection('delivery7d'));
  const conversionsC = useHomeCard('conversions30d', () => getOverviewHomeSection('conversions30d'));
  const runningC = useHomeCard('runningJourneys', () => getOverviewHomeSection('runningJourneys'));
  const sendingC = useHomeCard('sendingToday', () => getOverviewHomeSection('sendingToday'));
  const seriesC = useHomeCard('series14d', () => getOverviewHomeSection('series14d'));
  const statusQ = useQuery({
    queryKey: ['dashboard', 'status'],
    queryFn: getOverviewStatus,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
  });

  const sentToday = sentTodayC.data;
  const delivery = deliveryC.data;
  const conversions = conversionsC.data;
  const running = runningC.data;
  const sending = sendingC.data;
  const series = seriesC.data;

  // Failed sends in the last 24h — derived from real status rows only; hidden otherwise.
  const failed = avail(statusQ.data?.failedSends);
  const now = Date.now();
  const failed24h = failed
    ? (failed.rows ?? []).filter(r => r.time && now - new Date(r.time).getTime() <= DAY_MS).length
    : 0;

  const chartData: HomeTrendDatum[] = (series?.days ?? []).map(d => ({
    name: shortDate(d.date), email: num(d.email), whatsapp: num(d.whatsapp), sms: num(d.sms),
  }));
  const chartTotal = chartData.reduce((t, d) => t + d.email + d.whatsapp + d.sms, 0);

  const sentHelp = sentToday
    ? `Email ${fmt(sentToday.email)} · WhatsApp ${fmt(sentToday.whatsapp)} · SMS ${fmt(sentToday.sms)}`
    : '';
  const deliveredPct = delivery ? `${num(delivery.deliveredPct).toFixed(1)}%` : '';

  return (
    <div>
      <div className={s.hero}>
        <div>
          <h1 className={s.greeting}>{firstName ? `${hello}, ${firstName}` : hello}</h1>
          <p className={s.sub}>Here is what is happening with your messages today.</p>
        </div>
        <div className={`${s.actions} page-actions`}>
          {extraActions}
          <Link href="/journeys" className={buttonClass('secondary')}><GitBranch size={16} aria-hidden="true" />Create journey</Link>
        </div>
      </div>

      <>
          {failed24h > 0 && (
            <Card className={s.attention} aria-label="Needs your attention">
              <span className={s.attentionText}>
                <span className={s.badChip}>{failed24h >= FAILED_LIST_CAP ? `${fmt(FAILED_LIST_CAP)}+` : fmt(failed24h)}</span>
                failed send{failed24h === 1 ? '' : 's'} in the last 24 hours
              </span>
              <Link href="/log?channel=all&status=failed" className={buttonClass('secondary', 'sm')}>View failed</Link>
            </Card>
          )}

          <div className={s.kpis}>
            <Kpi label="Sent today" loading={sentTodayC.loading} available={!!sentToday} onRetry={sentTodayC.retry} retrying={sentTodayC.retrying} value={fmt(sentToday?.total)} help={sentHelp} />
            <Kpi label="Delivered (7 days)" loading={deliveryC.loading} available={!!delivery} onRetry={deliveryC.retry} retrying={deliveryC.retrying} value={deliveredPct}
              help={delivery ? `${fmt(delivery.delivered)} of ${fmt(delivery.sent)} sent` : ''} />
            <Kpi label="Conversions (30 days)" loading={conversionsC.loading} available={!!conversions} onRetry={conversionsC.retry} retrying={conversionsC.retrying} value={fmt(conversions?.count)} help="Bookings attributed to messages" />
          </div>

          <div className={s.twoCol}>
            <Card title="Running journeys" actions={<Link href="/journeys" className={s.headLink}>{running && (running.total ?? 0) > running.journeys.length ? `View all ${fmt(running.total ?? 0)}` : 'All journeys'}</Link>}>
              {runningC.loading ? <Skeleton height={60} /> : !running ? <Unavailable onRetry={runningC.retry} retrying={runningC.retrying} /> : running.journeys.length === 0 ? (
                <p className={s.note}>No journeys are running.</p>
              ) : (
                <ul className={s.list}>
                  {running.journeys.slice(0, 5).map(j => (
                    <li key={j.id} className={s.listItem}>
                      <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                        <span className={s.dot} aria-hidden="true" />
                        <Link href={`/journeys?id=${j.id}`} className={s.listName}>{j.name || `Journey ${j.id}`}</Link>
                      </span>
                      <span className={s.listMeta}>{fmt(j.joined)} joined</span>
                    </li>
                  ))}
                </ul>
              )}
              {running && (running.total ?? 0) > running.journeys.length && (
                <p className={s.note}>Showing the {Math.min(5, running.journeys.length)} most recently updated of {fmt(running.total ?? 0)} running journeys.</p>
              )}
            </Card>

            <Card title="Sending today" actions={sending ? <span className={s.muted}>{fmt(sending.total)} due</span> : undefined}>
              {sendingC.loading ? <Skeleton height={60} /> : !sending ? <Unavailable onRetry={sendingC.retry} retrying={sendingC.retrying} /> : sending.journeys.length === 0 ? (
                <p className={s.note}>Nothing is scheduled to send today.</p>
              ) : (
                <ul className={s.list}>
                  {sending.journeys.slice(0, 5).map(j => (
                    <li key={j.id} className={s.listItem}>
                      <Link href={`/journeys?id=${j.id}`} className={s.listName}>{j.name || `Journey ${j.id}`}</Link>
                      <span className={s.listMeta}>{fmt(j.due)} due</span>
                    </li>
                  ))}
                </ul>
              )}
              {sending && sending.journeys.length > 0 && <p className={s.note}>Top 5 journeys by messages due today (including overdue).</p>}
            </Card>
          </div>

          <Card title="Messages sent, last 14 days" className={s.chartCard}
            actions={series ? <span className={s.muted}>{fmt(chartTotal)} total</span> : undefined}>
            {seriesC.loading ? <Skeleton height={240} /> : !series ? <Unavailable onRetry={seriesC.retry} retrying={seriesC.retrying} /> : chartData.length === 0 ? (
              <p className={s.note}>No messages sent in the last 14 days.</p>
            ) : <HomeTrendChart data={chartData} />}
          </Card>
      </>
    </div>
  );
}
