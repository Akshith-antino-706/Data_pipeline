'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, CheckCircle2, XCircle, Loader2, Mail, Globe,
  Calendar, Search, X, ClipboardList,
  MousePointer, Eye, Link2, Filter,
} from 'lucide-react';
import Link from 'next/link';
import { authFetch } from '@/lib/api';
import { contactTypeColor } from '@/lib/contactTypes';
import { Button, Card, Chip, ConfirmDialog, EmptyState, PageHeader, Select, Field } from '@/components/ui';
import styles from './sends.module.css';

const TEMPLATES = [
  { day: 1, key: 'day1', label: 'Welcome',               desc: '4 service categories — Holidays / Cruises / Visas / Activities',                            ranking: 'Anthropic web-search' },
  { day: 2, key: 'day2', label: 'Cruise Spotlight',       desc: 'Cities + saver / regional / cruise-line packages',                                          ranking: 'Anthropic web-search' },
  { day: 3, key: 'day3', label: 'Visa Hub',               desc: 'International + e-visa cards + popular destinations (Tourist/Transit only)',                ranking: 'Anthropic web-search' },
  { day: 4, key: 'day4', label: 'Holidays',               desc: '4 themes × 4 cards — Summer / Eid / Romantic / Adventure',                                  ranking: 'Anthropic web-search' },
  { day: 5, key: 'day5', label: 'Activities',             desc: 'Top Cities + 5 themes × 4 cards (Thrill / Family / Icons / Water / Wildlife)',               ranking: 'Anthropic web-search' },
  { day: 6, key: 'day6', label: 'Destination Spotlight',  desc: 'Single destination — holidays + things-to-do + cruises + visa',                             ranking: 'Anthropic web-search', needsDestination: true },
  { day: 7, key: 'day7', label: 'Abandoned Cart',         desc: "User's GA4 browse history → backfill with trending picks",                                  ranking: 'Anthropic web-search' },
];

const DAY6_DESTINATIONS = ['singapore', 'bangkok', 'phuket', 'bali', 'kuala_lumpur', 'istanbul'];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiEnvelope { error?: string; data?: unknown }
interface TsContact { id?: string | number; email: string; name?: string; country?: string; contact_type?: string; booking_status?: string }
interface TsContactsResponse { contacts?: TsContact[]; total?: number }
interface TsFilterOptions {
  booking_status?: string[]; contact_type?: string[]; countries?: { val: string; cnt: number }[];
  geography?: string[]; product_tier?: string[];
  segments?: { id: string | number; name: string }[]; custom_segments?: { id: string | number; name: string }[];
}
interface TsSchedule { is_running?: boolean }
interface TsRecipientResult { success?: boolean; email?: string; ms?: number; error?: string }
interface TsSendResult { ok: boolean; error?: string; results?: TsRecipientResult[]; ranking?: { source?: string; themes?: string[] } }
type TsTemplate = typeof TEMPLATES[number];

async function apiPost(path: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const res = await authFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as ApiEnvelope;
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data || data;
}

async function apiGet(path: string): Promise<unknown> {
  const res = await authFetch(`${API_BASE}${path}`);
  const data = await res.json().catch(() => ({})) as ApiEnvelope;
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data || data;
}

export default function TestSends() {
  // ── contact list state ────────────────────────────────────────────────
  const [selected, setSelected]               = useState<TsContact[]>([]);
  const [contactQuery, setContactQuery]       = useState('');
  const [contacts, setContacts]               = useState<TsContact[]>([]);
  const [contactsTotal, setContactsTotal]     = useState(0);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsOffset, setContactsOffset]   = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── filter state ───────────────────────────────────────────────────
  const [showFilters, setShowFilters]         = useState(false);
  const [filterOptions, setFilterOptions]     = useState<TsFilterOptions | null>(null);
  const [filters, setFilters]                 = useState({
    booking_status: '', contact_type: '', country: '', geography: '',
    product_tier: '', is_indian: '', segment_id: '', custom_segment_id: '',
  });
  const [selectingAll, setSelectingAll]       = useState(false);

  // ── template send state ───────────────────────────────────────────────
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, TsSendResult | null>>({});
  const [day6Dest, setDay6Dest] = useState('singapore');

  // ── schedule count (for badge) ────────────────────────────────────────
  const [schedules, setSchedules]           = useState<TsSchedule[]>([]);
  const anyRunningRef = useRef(false);
  const pollRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── flow tracker stats ────────────────────────────────────────────────
  const [flowStats, setFlowStats] = useState({ sent: 0, opened: 0, clicked: 0, failed: 0, utmCaptures: 0 });

  useEffect(() => {
    async function loadFlowStats() {
      try {
        const [summary, utmLog] = await Promise.all([
          apiGet('/api/v3/test-sends/send-log/summary'),
          apiGet('/api/v3/test-sends/utm-log?limit=1'),
        ]);
        const byStatus = (summary as { byStatus?: { status: string; count?: string }[] } | null)?.byStatus || [];
        const get = (s: string) => parseInt(byStatus.find(r => r.status === s)?.count || 0 as unknown as string);
        setFlowStats({
          sent:        get('sent') + get('opened') + get('clicked'),
          opened:      get('opened') + get('clicked'),
          clicked:     get('clicked'),
          failed:      get('failed'),
          utmCaptures: (utmLog as { total?: number } | null)?.total || 0,
        });
      } catch { /* ignore */ }
    }
    loadFlowStats();
  }, []);

  // ── schedule list ─────────────────────────────────────────────────────
  const loadSchedules = useCallback(async () => {
    try {
      const list = await apiGet('/api/v3/test-sends/schedule/list');
      const arr: TsSchedule[]  = Array.isArray(list) ? list as TsSchedule[] : [];
      setSchedules(arr);
      anyRunningRef.current = arr.some(s => s.is_running);
    } catch { /* ignore */ }
  }, []);

  // On mount: load schedules + start polling interval
  useEffect(() => {
    loadSchedules();
    pollRef.current = setInterval(() => {
      if (anyRunningRef.current) loadSchedules();
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadSchedules]);

  // ── load filter options on mount ──────────────────────────────────────
  useEffect(() => {
    apiGet('/api/v3/test-sends/contacts/filter-options')
      .then(d => setFilterOptions(d as TsFilterOptions))
      .catch(() => {});
  }, []);

  // ── contact list (load on mount + debounced filter) ───────────────────
  const loadContacts = useCallback(async (q = '', offset = 0, activeFilters: Record<string, string> = {}) => {
    setContactsLoading(true);
    try {
      const qs = new URLSearchParams({ limit: 50, offset } as unknown as Record<string, string>);
      if (q.trim().length >= 2) qs.set('q', q.trim());
      // Apply active filters
      Object.entries(activeFilters).forEach(([k, v]) => {
        if (v !== '' && v !== undefined && v !== null) qs.set(k, v);
      });
      const res = await apiGet(`/api/v3/test-sends/contacts?${qs}`) as TsContactsResponse;
      setContacts(prev => offset === 0 ? (res.contacts || []) : [...prev, ...(res.contacts || [])]);
      setContactsTotal(res.total || 0);
      setContactsOffset(offset);
    } catch { /* ignore */ }
    setContactsLoading(false);
  }, []);

  useEffect(() => { loadContacts('', 0, filters); }, [loadContacts]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadContacts(contactQuery, 0, filters), 300);
    return () => clearTimeout(debounceRef.current!);
  }, [contactQuery, filters, loadContacts]);

  const updateFilter = (key: string, val: string) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  // Select all filtered contacts (bulk — fetches all emails matching current filters)
  const handleSelectAllFiltered = async () => {
    if (contactsTotal === 0) return;
    setSelectingAll(true);
    try {
      const qs = new URLSearchParams({ limit: contactsTotal, offset: 0 } as unknown as Record<string, string>);
      if (contactQuery.trim().length >= 2) qs.set('q', contactQuery.trim());
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== '' && v !== undefined && v !== null) qs.set(k, v);
      });
      const res = await apiGet(`/api/v3/test-sends/contacts?${qs}`) as TsContactsResponse;
      const raw = res.contacts || [];
      // Deduplicate by email within fetched results + existing selection
      setSelected(prev => {
        const seen = new Set(prev.map(s => s.email));
        const newOnes: TsContact[] = [];
        for (const c of raw) {
          if (!seen.has(c.email)) { seen.add(c.email); newOnes.push(c); }
        }
        return [...prev, ...newOnes];
      });
    } catch { /* ignore */ }
    setSelectingAll(false);
  };

  const toggleContact = (contact: TsContact) => {
    setSelected(prev =>
      prev.some(s => s.email === contact.email)
        ? prev.filter(s => s.email !== contact.email)
        : [...prev, contact]
    );
  };

  const selectedEmails = selected.map(s => s.email);
  const activeFilterCount = Object.values(filters).filter(v => v).length;
  const runningSchedules = schedules.filter(s => s.is_running).length;

  // ── send confirmation (who / what / when) ─────────────────────────────
  const [confirmTpl, setConfirmTpl] = useState<TsTemplate | null>(null);
  const cancelConfirm = useCallback(() => setConfirmTpl(null), []);

  // ── send handler ──────────────────────────────────────────────────────
  const handleSend = useCallback(async (tpl: TsTemplate) => {
    const key = tpl.key;
    setRunning(r => ({ ...r, [key]: true }));
    setResults(r => ({ ...r, [key]: null }));
    try {
      const body: { emails: string[]; destinationKey?: string } = { emails: selectedEmails };
      if (tpl.needsDestination) body.destinationKey = day6Dest;
      const data = await apiPost(`/api/v3/test-sends/${key}`, body);
      setResults(r => ({ ...r, [key]: { ok: true, ...data as Omit<TsSendResult, 'ok'> } }));
    } catch (err) {
      setResults(r => ({ ...r, [key]: { ok: false, error: (err as Error).message } }));
    } finally {
      setRunning(r => ({ ...r, [key]: false }));
    }
  }, [selectedEmails, day6Dest]);

  const FILTER_SELECTS: { key: keyof typeof filters; label: string; options: { val: string; label: string }[]; onPick?: (v: string) => void }[] = filterOptions ? [
    { key: 'booking_status', label: 'Booking Status', options: (filterOptions.booking_status || []).map(v => ({ val: v, label: v })) },
    { key: 'contact_type', label: 'Contact Type', options: (filterOptions.contact_type || []).map(v => ({ val: v, label: v })) },
    { key: 'country', label: 'Country', options: (filterOptions.countries || []).map(c => ({ val: c.val, label: `${c.val} (${c.cnt.toLocaleString()})` })) },
    { key: 'geography', label: 'Geography', options: (filterOptions.geography || []).map(v => ({ val: v, label: v })) },
    { key: 'is_indian', label: 'Indian / Rest', options: [{ val: 'true', label: 'Indian' }, { val: 'false', label: 'Rest of World' }] },
    { key: 'product_tier', label: 'Product Tier', options: (filterOptions.product_tier || []).map(v => ({ val: v, label: v })) },
    { key: 'segment_id', label: 'Segment', options: (filterOptions.segments || []).map(s => ({ val: String(s.id), label: s.name })),
      onPick: v => { updateFilter('segment_id', v); updateFilter('custom_segment_id', ''); } },
    { key: 'custom_segment_id', label: 'Custom Segment', options: (filterOptions.custom_segments || []).map(s => ({ val: String(s.id), label: s.name })),
      onPick: v => { updateFilter('custom_segment_id', v); updateFilter('segment_id', ''); } },
  ] : [];

  const FLOW: { label: string; value: number; tone: 'info' | 'ok' | 'gold' | 'bad' | 'mute'; icon: typeof Mail; pct: boolean }[] = [
    { label: 'Sent',         value: flowStats.sent,        tone: 'info', icon: Mail,         pct: false },
    { label: 'Opened',       value: flowStats.opened,      tone: 'ok',   icon: Eye,          pct: true },
    { label: 'Clicked',      value: flowStats.clicked,     tone: 'mute', icon: MousePointer, pct: true },
    { label: 'UTM Captured', value: flowStats.utmCaptures, tone: 'gold', icon: Link2,        pct: true },
    { label: 'Failed',       value: flowStats.failed,      tone: 'bad',  icon: XCircle,      pct: false },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Test Sends"
        breadcrumbs={[{ label: 'Sends' }]}
        description="Select recipients, start schedules, and send any of the 7 day templates. Internal QA only."
        actions={
          <div className={styles.headLinks}>
            <Link href="/test-sends/scheduler" className={styles.linkBtn}>
              <Calendar size={16} className={styles.goldIcon} aria-hidden="true" />
              <span>Scheduler Mail</span>
              {runningSchedules > 0 && (
                <Chip tone="ok" aria-label={`${runningSchedules} running`}>{runningSchedules}</Chip>
              )}
            </Link>
            <Link href="/test-sends/emaillog" className={styles.linkBtn}>
              <ClipboardList size={16} className={styles.goldIcon} aria-hidden="true" />
              View Email Logs
            </Link>
          </div>
        }
      />

      {/* ── Recipients ───────────────────────────────────────────────── */}
      <Card
        title={
          <span className={styles.cardTitle}>
            Recipients
            <span className={styles.muted}>&middot; {selected.length} selected of {contactsTotal.toLocaleString()} contacts</span>
          </span>
        }
        actions={
          <div className={styles.cardActions}>
            {selected.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear all</Button>
            )}
            <Button
              size="sm"
              aria-expanded={showFilters}
              className={showFilters || activeFilterCount > 0 ? styles.filterOn : undefined}
              onClick={() => setShowFilters(f => !f)}
            >
              <Filter size={14} aria-hidden="true" /> Filters
              {activeFilterCount > 0 && <span className={styles.countBadge}>{activeFilterCount}</span>}
            </Button>
          </div>
        }
      >
        {showFilters && filterOptions && (
          <div className={styles.filterGrid}>
            {FILTER_SELECTS.map(f => (
              <Field key={f.key} label={f.label}>
                {ctrl => (
                  <Select {...ctrl} value={filters[f.key]} onChange={e => (f.onPick ? f.onPick(e.target.value) : updateFilter(f.key, e.target.value))}>
                    <option value="">All</option>
                    {f.options.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                  </Select>
                )}
              </Field>
            ))}
            <div className={styles.filterFooter}>
              <Button size="sm" variant="ghost" onClick={() => setFilters({ booking_status: '', contact_type: '', country: '', geography: '', product_tier: '', is_indian: '', segment_id: '', custom_segment_id: '' })}>
                Clear Filters
              </Button>
              <Button size="sm" variant="primary" onClick={handleSelectAllFiltered} disabled={selectingAll || contactsTotal === 0}>
                {selectingAll ? <><Loader2 size={14} className="spin" /> Selecting...</> : <>Select All {contactsTotal.toLocaleString()} Filtered</>}
              </Button>
              {activeFilterCount > 0 && (
                <span className={styles.matchText}>{contactsTotal.toLocaleString()} contacts match</span>
              )}
            </div>
          </div>
        )}

        <div className={styles.search}>
          {contactsLoading
            ? <Loader2 size={16} className={`spin ${styles.goldIcon}`} aria-label="Loading contacts" />
            : <Search size={16} className={styles.muted} aria-hidden="true" />}
          <input
            type="text"
            className={styles.searchInput}
            value={contactQuery}
            onChange={e => setContactQuery(e.target.value)}
            placeholder="Filter by email or name..."
            aria-label="Filter contacts by email or name"
          />
          {contactQuery && (
            <button type="button" className={styles.iconBtn} aria-label="Clear search" onClick={() => setContactQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className={styles.list}>
          {contacts.length === 0 && !contactsLoading ? (
            <EmptyState title="No contacts found" description="Try a different search or clear the filters." />
          ) : (
            contacts.map(c => {
              const isSel = selected.some(s => s.email === c.email);
              const tc = c.contact_type ? contactTypeColor(c.contact_type) : null;
              return (
                <button
                  type="button"
                  key={c.id ?? c.email}
                  aria-pressed={isSel}
                  onClick={() => toggleContact(c)}
                  className={`${styles.row} ${isSel ? styles.rowOn : ''}`}
                >
                  <span className={`${styles.box} ${isSel ? styles.boxOn : ''}`} aria-hidden="true">
                    {isSel && <CheckCircle2 size={10} />}
                  </span>
                  <span className={styles.rowBody}>
                    <span className={styles.rowLine}>
                      <span className={`${styles.email} ${isSel ? styles.emailOn : ''}`}>{c.email}</span>
                      {c.contact_type && tc && (
                        <span className={styles.typeTag} style={{ background: tc.bg, color: tc.fg }}>{c.contact_type}</span>
                      )}
                      {c.booking_status && <Chip tone="ok">{c.booking_status}</Chip>}
                    </span>
                    {(c.name || c.country) && (
                      <span className={styles.rowMeta}>
                        {c.name && <span>{c.name}</span>}
                        {c.country && <span>{c.country}</span>}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
          {contacts.length < contactsTotal && (
            <button type="button" className={styles.loadMore} onClick={() => loadContacts(contactQuery, contactsOffset + 50, filters)}>
              {contactsLoading
                ? <Loader2 size={14} className="spin" aria-label="Loading" />
                : `Load more (${(contactsTotal - contacts.length).toLocaleString()} remaining)`}
            </button>
          )}
        </div>

        {selected.length > 0 && (
          <div className={styles.tags}>
            {selected.map((s, i) => (
              <span key={`${s.email}_${i}`} className={styles.tag}>
                {s.email}
                <button type="button" className={styles.tagX} aria-label={`Remove ${s.email}`} onClick={() => toggleContact(s)}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* ── Email Flow Tracker ───────────────────────────────────────── */}
      <Card
        title="Email Tracking Flow"
        actions={<Link href="/test-sends/emaillog" className={`${styles.linkBtn} ${styles.linkSm}`}>View Logs</Link>}
      >
        <div className={styles.flow}>
          {FLOW.map(({ label, value, tone, icon: Icon, pct }) => (
            <div key={label} className={styles.stat}>
              <div className={`${styles.statIcon} ${styles[`t-${tone}`]}`}><Icon size={16} aria-hidden="true" /></div>
              <div className={styles.statValue}>{value}</div>
              <div className={styles.statLabel}>{label}</div>
              {pct && flowStats.sent > 0 && (
                <div className={`${styles.statPct} ${styles[`c-${tone}`]}`}>{Math.round((value / flowStats.sent) * 100)}%</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Template cards ────────────────────────────────────────────── */}
      <div className={styles.templates}>
        {TEMPLATES.map(tpl => {
          const isRunning = !!running[tpl.key];
          const result    = results[tpl.key];
          const disabled  = isRunning || selected.length === 0;
          return (
            <Card key={tpl.key} className={styles.tplCard}>
              <div className={styles.tplHead}>
                <Chip tone="gold">Day {tpl.day}</Chip>
                <span className={styles.tplName}>{tpl.label}</span>
              </div>
              <p className={styles.tplDesc}>{tpl.desc}</p>
              <span className={styles.tplRank}><Globe size={12} aria-hidden="true" /> {tpl.ranking}</span>

              {tpl.needsDestination && (
                <Field label="Destination">
                  {ctrl => (
                    <Select {...ctrl} value={day6Dest} onChange={e => setDay6Dest(e.target.value)}>
                      {DAY6_DESTINATIONS.map(d => <option key={d} value={d}>{destLabel(d)}</option>)}
                    </Select>
                  )}
                </Field>
              )}

              <Button variant="primary" className={styles.full} onClick={() => setConfirmTpl(tpl)} disabled={disabled}>
                {isRunning
                  ? <><Loader2 size={14} className="spin" /> Sending...</>
                  : <><Play size={14} /> Send ({selected.length})</>}
              </Button>

              {result && (
                result.ok ? (
                  <div className={`${styles.result} ${styles.resultOk}`} role="status">
                    <div className={styles.resultHead}>
                      <CheckCircle2 size={14} aria-hidden="true" />
                      Sent to {result.results?.length || 0} recipients
                      {result.ranking?.source && <span className={styles.muted}>&middot; {result.ranking.source}</span>}
                    </div>
                    {result.ranking?.themes && result.ranking.themes.length > 0 && (
                      <div className={styles.muted}>
                        <strong>Trending:</strong> {result.ranking.themes.slice(0, 3).join(' · ')}
                      </div>
                    )}
                    <div className={`${styles.resultRows} ${styles.mono}`}>
                      {(result.results || []).map((r, i) => (
                        <div key={i} className={`${styles.resultRow} ${r.success ? '' : styles.resultRowBad}`}>
                          <span>{r.success ? '✓' : '✗'} {r.email}</span>
                          <span className={styles.muted}>{r.success ? `${r.ms ?? 0}ms` : (r.error || '').slice(0, 30)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={`${styles.result} ${styles.resultBad}`} role="alert">
                    <XCircle size={14} aria-hidden="true" /> <span>{result.error || 'Failed'}</span>
                  </div>
                )
              )}
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmTpl !== null}
        title={confirmTpl ? `Send Day ${confirmTpl.day} · ${confirmTpl.label}?` : 'Send email?'}
        description={confirmTpl ? (
          <dl className={styles.confirmList}>
            <dt>Who</dt>
            <dd>
              {selectedEmails.length} recipient{selectedEmails.length === 1 ? '' : 's'}: {selectedEmails.slice(0, 5).join(', ')}
              {selectedEmails.length > 5 ? ` and ${selectedEmails.length - 5} more` : ''}
            </dd>
            <dt>What</dt>
            <dd>Day {confirmTpl.day} {confirmTpl.label} template{confirmTpl.needsDestination ? ` for ${destLabel(day6Dest)}` : ''}</dd>
            <dt>When</dt>
            <dd>Immediately, as soon as you confirm. This sends real email.</dd>
          </dl>
        ) : undefined}
        confirmLabel="Confirm send"
        onCancel={cancelConfirm}
        onConfirm={() => {
          const tpl = confirmTpl;
          setConfirmTpl(null);
          if (tpl) handleSend(tpl);
        }}
      />
    </div>
  );
}

function destLabel(d: string): string {
  return d.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}
