'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2, XCircle, Loader2, Zap,
  Search, X, ClipboardList, Square, Cpu, Plus, Filter, CheckSquare, RefreshCw,
} from 'lucide-react';
import { authFetch } from '@/lib/api';
import { contactTypeColor } from '@/lib/contactTypes';
import {
  Button, Card, Chip, ConfirmDialog, EmptyState, Field, PageHeader, Select, StatusChip, Table,
} from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import styles from '../sends.module.css';
import type { Id, SendLogRow } from '@/types/api';
import type {
  FilterOptionObj, MailSchedule, ScheduleLogModal, ScheduleTickResult, TestSendContact,
  TestSendContactsPage, TestSendFilterOptions, TestSendFilters,
} from '@/types/f7scheduler';

interface FilterField { key: string; label: string; opts?: (string | FilterOptionObj)[]; isObj?: boolean }
interface ApiJson { error?: string; data?: unknown }

const DAY6_DESTINATIONS = ['singapore', 'bangkok', 'phuket', 'bali', 'kuala_lumpur', 'istanbul'];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function apiPost(path: string, body: unknown = {}): Promise<unknown> {
  const res = await authFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as ApiJson;
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data || data;
}

async function apiGet(path: string): Promise<unknown> {
  const res = await authFetch(`${API_BASE}${path}`);
  const data = await res.json().catch(() => ({})) as ApiJson;
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data || data;
}

const statusTone = (st: string): ChipTone =>
  st === 'sent' || st === 'opened' || st === 'clicked' ? 'ok'
  : st === 'failed' ? 'bad'
  : st === 'queued' ? 'gold'
  : 'mute';

const fmtList = (emails: string[]): string =>
  `${emails.slice(0, 5).join(', ')}${emails.length > 5 ? ` and ${emails.length - 5} more` : ''}`;

export default function SchedulerPage() {
  // ── contact list state ────────────────────────────────────────────────
  const [selected, setSelected]               = useState<TestSendContact[]>([]);
  const [contactQuery, setContactQuery]       = useState('');
  const [contacts, setContacts]               = useState<TestSendContact[]>([]);
  const [contactsTotal, setContactsTotal]     = useState(0);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsOffset, setContactsOffset]   = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── filter state ────────────────────────────────────────────────────
  const [showFilters, setShowFilters]       = useState(false);
  const [filterOptions, setFilterOptions]   = useState<TestSendFilterOptions | null>(null);
  const [filters, setFilters]               = useState<TestSendFilters>({
    booking_status: '', contact_type: '', country: '', geography: '',
    product_tier: '', is_indian: '', segment_id: '', custom_segment_id: '',
  });
  const [selectingAll, setSelectingAll]     = useState(false);

  // ── schedule state ──────────────────────────────────────────────────
  const [schedules, setSchedules]           = useState<MailSchedule[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [logModal, setLogModal]             = useState<ScheduleLogModal | null>(null);
  const [day6Dest, setDay6Dest]             = useState('singapore');
  const anyRunningRef = useRef(false);
  const pollRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── send confirmations (who / what / when) ──────────────────────────
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmTick, setConfirmTick]   = useState<MailSchedule | null>(null);
  const cancelStart = useCallback(() => setConfirmStart(false), []);
  const cancelTick  = useCallback(() => setConfirmTick(null), []);

  // ── schedule list ─────────────────────────────────────────────────────
  const loadSchedules = useCallback(async () => {
    try {
      const list = await apiGet('/api/v3/test-sends/schedule/list') as MailSchedule[] | null;
      const arr  = Array.isArray(list) ? list : [];
      setSchedules(arr);
      anyRunningRef.current = arr.some(s => s.is_running);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadSchedules();
    pollRef.current = setInterval(() => {
      if (anyRunningRef.current) loadSchedules();
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadSchedules]);

  // ── contact list (load on mount + debounced filter) ───────────────────
  const loadContacts = useCallback(async (q = '', offset = 0, activeFilters = filters) => {
    setContactsLoading(true);
    try {
      const qs = new URLSearchParams({ limit: 50, offset } as unknown as Record<string, string>);
      if (q.trim().length >= 2) qs.set('q', q.trim());
      Object.entries(activeFilters).forEach(([k, v]) => { if (v !== '') qs.set(k, v); });
      const res = await apiGet(`/api/v3/test-sends/contacts?${qs}`) as TestSendContactsPage;
      setContacts(prev => offset === 0 ? (res.contacts || []) : [...prev, ...(res.contacts || [])]);
      setContactsTotal(res.total || 0);
      setContactsOffset(offset);
    } catch { /* ignore */ }
    setContactsLoading(false);
  }, [filters]);

  useEffect(() => { loadContacts('', 0); }, [loadContacts]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadContacts(contactQuery, 0), 300);
    return () => clearTimeout(debounceRef.current!);
  }, [contactQuery, loadContacts]);

  // ── load filter options on mount ──────────────────────────────────────
  useEffect(() => {
    apiGet('/api/v3/test-sends/contacts/filter-options').then(d => setFilterOptions(d as TestSendFilterOptions)).catch(() => {});
  }, []);

  const handleFilterChange = (key: string, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    loadContacts(contactQuery, 0, next);
  };
  const clearFilters = () => {
    const blank = { booking_status: '', contact_type: '', country: '', geography: '', product_tier: '', is_indian: '', segment_id: '', custom_segment_id: '' };
    setFilters(blank);
    loadContacts(contactQuery, 0, blank);
  };
  const hasActiveFilters = Object.values(filters).some(v => v !== '');

  const handleSelectAllFiltered = async () => {
    setSelectingAll(true);
    try {
      const qs = new URLSearchParams({ limit: 50000, offset: 0 } as unknown as Record<string, string>);
      Object.entries(filters).forEach(([k, v]) => { if (v !== '') qs.set(k, v); });
      if (contactQuery.trim().length >= 2) qs.set('q', contactQuery.trim());
      const res = await apiGet(`/api/v3/test-sends/contacts?${qs}`) as TestSendContactsPage;
      const all = res.contacts || [];
      const seen = new Set<string>();
      const deduped: TestSendContact[] = [];
      for (const c of all) {
        const key = c.email.toLowerCase();
        if (!seen.has(key)) { seen.add(key); deduped.push(c); }
      }
      setSelected(deduped);
    } catch (err) { alert('Failed to select all: ' + (err as Error).message); }
    setSelectingAll(false);
  };

  const toggleContact = (contact: TestSendContact) => {
    setSelected(prev =>
      prev.some(s => s.email === contact.email)
        ? prev.filter(s => s.email !== contact.email)
        : [...prev, contact]
    );
  };

  // ── schedule handlers ─────────────────────────────────────────────────
  const handleScheduleStart = useCallback(async () => {
    if (selected.length === 0) { alert('Select at least one recipient first'); return; }
    setScheduleLoading(true);
    try {
      const newSched = await apiPost('/api/v3/test-sends/schedule/start', {
        destinationKey: day6Dest,
        loop:           false,
        emails:         selected.map(s => s.email),
      }) as MailSchedule;
      setSchedules(prev => [newSched, ...prev]);
      anyRunningRef.current = true;
    } catch (err) { alert('Start failed: ' + (err as Error).message); }
    setScheduleLoading(false);
  }, [selected, day6Dest]);

  const handleScheduleStop = useCallback(async (id: Id) => {
    try {
      const updated = await apiPost(`/api/v3/test-sends/schedule/${id}/stop`) as MailSchedule;
      setSchedules(prev => prev.map(s => s.id === id ? updated : s));
    } catch (err) { alert('Stop failed: ' + (err as Error).message); }
  }, []);

  const handleScheduleTick = useCallback(async (id: Id) => {
    try {
      const data = await apiPost(`/api/v3/test-sends/schedule/${id}/tick`) as ScheduleTickResult;
      if (data.skipped) {
        alert('Skipped: ' + (data.reason || 'unknown'));
      } else {
        alert(`Day ${data.day} (${data.label}) sent to ${data.sentTo}${data.sequenceDone ? ' — sequence complete!' : ''}`);
      }
      loadSchedules();
    } catch (err) { alert('Tick failed: ' + (err as Error).message); }
  }, [loadSchedules]);

  const handleRemoveEmailFromSchedule = useCallback(async (scheduleId: Id, email: string) => {
    try {
      const updated = await apiPost(`/api/v3/test-sends/schedule/${scheduleId}/remove-email`, { email }) as MailSchedule;
      setSchedules(prev => prev.map(s => s.id === scheduleId ? updated : s));
    } catch (err) { alert('Remove failed: ' + (err as Error).message); }
  }, []);

  const openLogModal = useCallback(async (id: Id) => {
    setLogModal({ id, rows: [], loading: true });
    try {
      const rows = await apiGet(`/api/v3/test-sends/schedule/${id}/logs`) as SendLogRow[] | null;
      setLogModal({ id, rows: Array.isArray(rows) ? rows : [], loading: false });
    } catch {
      setLogModal(prev => prev?.id === id ? { ...prev, loading: false } : prev);
    }
  }, []);

  const refreshLogModal = useCallback(async () => {
    if (!logModal?.id) return;
    setLogModal(prev => ({ ...prev!, loading: true }));
    try {
      const rows = await apiGet(`/api/v3/test-sends/schedule/${logModal.id}/logs`) as SendLogRow[] | null;
      setLogModal(prev => prev ? { ...prev, rows: Array.isArray(rows) ? rows : [], loading: false } : null);
    } catch {
      setLogModal(prev => prev ? { ...prev, loading: false } : null);
    }
  }, [logModal?.id]);

  const runningCount = schedules.filter(s => s.is_running).length;
  const filterFields: FilterField[] = filterOptions ? [
    { key: 'booking_status', label: 'Booking Status', opts: filterOptions.booking_status },
    { key: 'contact_type', label: 'Contact Type', opts: filterOptions.contact_type },
    { key: 'country', label: 'Country', opts: (filterOptions.countries || []).map(c => c.val) },
    { key: 'geography', label: 'Geography', opts: filterOptions.geography },
    { key: 'is_indian', label: 'Indian / Rest', opts: [{ val: 'true', label: 'Indian' }, { val: 'false', label: 'Rest of World' }], isObj: true },
    { key: 'product_tier', label: 'Product Tier', opts: filterOptions.product_tier },
    { key: 'segment_id', label: 'Segment', opts: (filterOptions.segments || []).map(s => ({ val: String(s.id), label: s.name })), isObj: true },
    { key: 'custom_segment_id', label: 'Custom Segment', opts: (filterOptions.custom_segments || []).map(s => ({ val: String(s.id), label: s.name })), isObj: true },
  ] : [];
  const tickEmails = Array.isArray(confirmTick?.emails) ? confirmTick.emails : [];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Mail Scheduler"
        breadcrumbs={[{ label: 'Sends' }, { label: 'Test Sends', href: '/test-sends' }, { label: 'Scheduler' }]}
        description="Select recipients, create schedules, and manage Day 1→7 auto-sends."
      />

      {/* ── Recipients ───────────────────────────────────────────────── */}
      <Card
        title={
          <span className={styles.cardTitle}>
            Recipients
            <span className={styles.muted}>&middot; {selected.length} selected of {contactsTotal} contacts</span>
          </span>
        }
        actions={selected.length > 0 ? (
          <div className={styles.cardActions}>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear all</Button>
          </div>
        ) : undefined}
      >
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

        <div className={styles.toolbar}>
          <Button
            size="sm"
            aria-expanded={showFilters}
            className={showFilters || hasActiveFilters ? styles.filterOn : undefined}
            onClick={() => setShowFilters(f => !f)}
          >
            <Filter size={14} aria-hidden="true" />Filters {hasActiveFilters && `(${Object.values(filters).filter(v => v !== '').length})`}
          </Button>
          {hasActiveFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>Clear Filters</Button>
          )}
          <div className={styles.cardActions}>
            <Button size="sm" onClick={handleSelectAllFiltered} disabled={selectingAll || contactsTotal === 0}>
              {selectingAll ? <Loader2 size={14} className="spin" /> : <CheckSquare size={14} aria-hidden="true" />}
              Select All {contactsTotal.toLocaleString()} Filtered
            </Button>
          </div>
        </div>

        {showFilters && filterOptions && (
          <div className={styles.filterGrid}>
            {filterFields.map(({ key, label, opts, isObj }) => (
              <Field key={key} label={label}>
                {ctrl => (
                  <Select {...ctrl} value={filters[key]} onChange={e => handleFilterChange(key, e.target.value)}>
                    <option value="">All</option>
                    {(opts || []).map(o => isObj
                      ? <option key={(o as FilterOptionObj).val} value={(o as FilterOptionObj).val}>{(o as FilterOptionObj).label}</option>
                      : <option key={o as string} value={o as string}>{o as string}</option>
                    )}
                  </Select>
                )}
              </Field>
            ))}
          </div>
        )}

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
                      {c.booking_status && (
                        <Chip tone={c.booking_status === 'CANCELLED' ? 'bad' : 'ok'}>{c.booking_status}</Chip>
                      )}
                      {c.country && <span className={styles.muted}>{c.country}</span>}
                    </span>
                    {c.name && <span className={styles.rowMeta}><span>{c.name}</span></span>}
                  </span>
                </button>
              );
            })
          )}
          {contacts.length < contactsTotal && (
            <button type="button" className={styles.loadMore} onClick={() => loadContacts(contactQuery, contactsOffset + 50, filters)}>
              Load more ({contactsTotal - contacts.length} remaining)
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

      {/* ── Daily Auto-Send Schedules ─────────────────────────────────── */}
      <Card
        title={
          <span className={styles.cardTitle}>
            Daily Auto-Send Schedules
            {runningCount > 0 && <StatusChip tone="ok">{runningCount} RUNNING</StatusChip>}
          </span>
        }
        actions={
          <div className={styles.cardActions}>
            <Button
              variant="primary"
              onClick={() => { if (selected.length === 0) { alert('Select at least one recipient first'); return; } setConfirmStart(true); }}
              disabled={scheduleLoading || selected.length === 0}
              title={selected.length === 0 ? 'Select recipients above first' : `Start Day 1→7 for ${selected.length} recipient(s)`}
            >
              {scheduleLoading ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
              New Schedule
            </Button>
          </div>
        }
      >
        <p className={styles.sub}>
          Each schedule sends Day 1→7 at 24 h intervals to its own recipient list. Multiple schedules can run in parallel.
        </p>

        {schedules.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={20} />}
            title="No schedules yet"
            description={<>Select recipients above and click &ldquo;New Schedule&rdquo;.</>}
          />
        ) : (
          <div className={styles.schedList}>
            {schedules.map(sched => {
              const isRunning = !!sched.is_running;
              const prewarm   = sched.prewarm || {};
              const emails    = Array.isArray(sched.emails) ? sched.emails : [];
              const pwTone: ChipTone = prewarm.status === 'prewarming' ? 'gold' : prewarm.status === 'ready' ? 'ok' : 'bad';
              return (
                <Card key={sched.id} className={isRunning ? styles.schedRunning : undefined}>
                  <div className={styles.toolbar}>
                    <span className={styles.tplName}>Schedule #{sched.id}</span>
                    {isRunning
                      ? <StatusChip tone="ok">RUNNING</StatusChip>
                      : <StatusChip tone="mute">STOPPED</StatusChip>}
                    {sched.started_at && (
                      <span className={styles.muted}>Started {new Date(sched.started_at).toLocaleString()}</span>
                    )}
                    <div className={styles.cardActions}>
                      <Button size="sm" variant="ghost" onClick={() => openLogModal(sched.id)}>
                        <ClipboardList size={14} aria-hidden="true" /> View Logs
                      </Button>
                      {isRunning && (
                        <>
                          <Button size="sm" onClick={() => setConfirmTick(sched)} title="Send today's email now without waiting">
                            <Zap size={14} aria-hidden="true" /> Send Now
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => handleScheduleStop(sched.id)}>
                            <Square size={12} fill="currentColor" aria-hidden="true" /> Stop
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={styles.days}>
                    {[1, 2, 3, 4, 5, 6, 7].map(d => {
                      const sent = (sched.last_sent_day ?? 0) >= d;
                      const next = isRunning && sched.next_day_to_send === d;
                      return (
                        <Chip key={d} tone={sent ? 'ok' : next ? 'gold' : 'mute'}>
                          {sent ? '✓' : next ? '→' : ''} Day {d}
                        </Chip>
                      );
                    })}
                    {sched.last_sent_day != null && sched.last_sent_day !== 0 && (
                      <span className={styles.muted}>
                        Last: Day {sched.last_sent_day} &middot; {sched.last_sent_at ? new Date(sched.last_sent_at).toLocaleTimeString() : ''}
                      </span>
                    )}
                  </div>

                  {prewarm.status && prewarm.status !== 'idle' && (
                    <div className={`${styles.prewarm} ${styles[`t-${pwTone}`]}`}>
                      {prewarm.status === 'prewarming'
                        ? <Loader2 size={14} className="spin" aria-hidden="true" />
                        : prewarm.status === 'ready'
                          ? <Cpu size={14} aria-hidden="true" />
                          : <XCircle size={14} aria-hidden="true" />}
                      <span>
                        {prewarm.status === 'prewarming' && 'Pre-generating AI rankings for all 7 days…'}
                        {prewarm.status === 'ready' && `AI content ready — ${prewarm.readyCount ?? 0}/7 days cached`}
                        {prewarm.status === 'failed' && `Pre-warm failed: ${prewarm.error ?? 'unknown error'}`}
                      </span>
                      {prewarm.status === 'ready' && (prewarm.summary?.length ?? 0) > 0 && (
                        <span className={styles.miniTags}>
                          {(prewarm.summary ?? []).map(s => (
                            <Chip key={s.day} tone={s.status === 'ready' ? 'ok' : 'bad'}>
                              D{s.day}{s.status === 'ready' ? '✓' : '✗'}
                            </Chip>
                          ))}
                        </span>
                      )}
                    </div>
                  )}

                  {emails.length > 0 && (
                    <div className={styles.tags}>
                      {emails.map(email => (
                        <span key={email} className={`${styles.tag} ${isRunning ? '' : styles.tagStatic}`}>
                          {email}
                          {isRunning && (
                            <button
                              type="button"
                              className={styles.tagX}
                              aria-label={`Remove ${email} from this schedule`}
                              title={`Remove ${email} from this schedule`}
                              onClick={() => handleRemoveEmailFromSchedule(sched.id, email)}
                            >
                              <X size={12} />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Log Modal ─────────────────────────────────────────────────── */}
      {logModal && (
        <div className={styles.overlay} onClick={() => setLogModal(null)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={`Schedule #${logModal.id} email send logs`}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.modalHead}>
              <ClipboardList size={16} className={styles.goldIcon} aria-hidden="true" />
              <h2>Schedule #{logModal.id} — Email Send Logs</h2>
              <span className={styles.muted}>{logModal.rows.length} entries</span>
              <div className={styles.cardActions}>
                <Button size="sm" onClick={refreshLogModal} disabled={logModal.loading}>
                  {logModal.loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} aria-hidden="true" />} Refresh
                </Button>
                <Button size="sm" variant="ghost" icon aria-label="Close" onClick={() => setLogModal(null)}>
                  <X size={16} />
                </Button>
              </div>
            </div>

            <div className={styles.modalBody}>
              {logModal.loading ? (
                <div className={styles.loadingRow}>
                  <Loader2 size={18} className="spin" /> Loading logs…
                </div>
              ) : logModal.rows.length === 0 ? (
                <EmptyState title="No send log entries found for this schedule yet." />
              ) : (
                <Table label="Schedule send logs">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Sent At</th>
                      <th>Opened</th>
                      <th className={styles.right}>ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logModal.rows.map(row => (
                      <tr key={row.id}>
                        <td className={styles.nowrap}><Chip tone="gold">Day {row.day_number}</Chip></td>
                        <td><div className={styles.ellipsis}>{row.email}</div></td>
                        <td><Chip tone={statusTone(row.status)}>{row.status}</Chip></td>
                        <td className={styles.nowrap}>{row.sent_at ? new Date(row.sent_at).toLocaleString() : '—'}</td>
                        <td className={styles.nowrap}>{row.opened_at ? new Date(row.opened_at).toLocaleTimeString() : '—'}</td>
                        <td className={`${styles.nowrap} ${styles.right}`}>{row.duration_ms ? `${row.duration_ms}ms` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmStart}
        title="Start a new Day 1→7 schedule?"
        description={
          <dl className={styles.confirmList}>
            <dt>Who</dt>
            <dd>{selected.length} recipient{selected.length === 1 ? '' : 's'}: {fmtList(selected.map(s => s.email))}</dd>
            <dt>What</dt>
            <dd>The Day 1 to Day 7 template sequence (Day 6 destination: {day6Dest.replace('_', ' ')}).</dd>
            <dt>When</dt>
            <dd>Day 1 goes out right after you confirm, then one email every 24 hours until Day 7 or until stopped.</dd>
          </dl>
        }
        confirmLabel="Start schedule"
        busy={scheduleLoading}
        onCancel={cancelStart}
        onConfirm={() => { setConfirmStart(false); handleScheduleStart(); }}
      />

      <ConfirmDialog
        open={confirmTick !== null}
        title={confirmTick ? `Send the next email for Schedule #${confirmTick.id} now?` : 'Send now?'}
        description={confirmTick ? (
          <dl className={styles.confirmList}>
            <dt>Who</dt>
            <dd>
              {tickEmails.length > 0
                ? `${tickEmails.length} recipient${tickEmails.length === 1 ? '' : 's'}: ${fmtList(tickEmails)}`
                : 'Every recipient on this schedule'}
            </dd>
            <dt>What</dt>
            <dd>{confirmTick.next_day_to_send ? `Day ${confirmTick.next_day_to_send} email` : "This schedule's next day email"}</dd>
            <dt>When</dt>
            <dd>Immediately, without waiting for the 24 hour timer.</dd>
          </dl>
        ) : undefined}
        confirmLabel="Confirm send"
        onCancel={cancelTick}
        onConfirm={() => {
          const s = confirmTick;
          setConfirmTick(null);
          if (s) handleScheduleTick(s.id);
        }}
      />
    </div>
  );
}
