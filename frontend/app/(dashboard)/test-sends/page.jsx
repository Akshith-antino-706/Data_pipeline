'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, CheckCircle2, XCircle, Loader2, Mail, Users, Globe,
  Square, Calendar, Zap, Search, X, ClipboardList, ChevronLeft, ChevronRight,
  MousePointer, Eye, ArrowRight, Link2,
} from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

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

async function apiPost(path, body = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data || data;
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data || data;
}

export default function TestSends() {
  // ── selected recipients ────────────────────────────────────────────────
  const [selected, setSelected] = useState([]);       // [{ id, email, first_name, last_name }]
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // ── template send state ────────────────────────────────────────────────
  const [running, setRunning] = useState({});
  const [results, setResults] = useState({});
  const [day6Dest, setDay6Dest] = useState('singapore');

  // ── schedule state ─────────────────────────────────────────────────────
  const [schedule, setSchedule] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleLoop, setScheduleLoop] = useState(false);

  // ── flow tracker stats ────────────────────────────────────────────────
  const [flowStats, setFlowStats] = useState({ sent: 0, opened: 0, clicked: 0, failed: 0, utmCaptures: 0 });

  useEffect(() => {
    async function loadFlowStats() {
      try {
        const [summary, utmLog] = await Promise.all([
          apiGet('/api/v3/test-sends/send-log/summary'),
          apiGet('/api/v3/test-sends/utm-log?limit=1'),
        ]);
        const byStatus = summary?.byStatus || [];
        const get = (s) => parseInt(byStatus.find(r => r.status === s)?.count || 0);
        setFlowStats({
          sent:        get('sent') + get('opened') + get('clicked'),
          opened:      get('opened') + get('clicked'),
          clicked:     get('clicked'),
          failed:      get('failed'),
          utmCaptures: utmLog?.total || 0,
        });
      } catch {}
    }
    loadFlowStats();
  }, []);

  // ── send log modal state ───────────────────────────────────────────────
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState('');
  const logDebounceRef = useRef(null);

  // Load schedule on mount
  useEffect(() => {
    apiGet('/api/v3/test-sends/schedule').then(d => {
      setSchedule(d);
      if (d?.destination_key) setDay6Dest(d.destination_key);
      if (d?.loop != null) setScheduleLoop(!!d.loop);
    }).catch(() => {});
  }, []);

  // ── contact search (debounced) ─────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await apiGet(`/api/v3/test-sends/search-contacts?q=${encodeURIComponent(searchQuery.trim())}`);
        setSearchResults(Array.isArray(data) ? data : []);
        setShowDropdown(true);
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addRecipient = (contact) => {
    if (selected.some(s => s.email === contact.email)) return;
    setSelected(prev => [...prev, contact]);
    setSearchQuery('');
    setShowDropdown(false);
  };

  const removeRecipient = (email) => {
    setSelected(prev => prev.filter(s => s.email !== email));
  };

  const selectedEmails = selected.map(s => s.email);

  // ── schedule handlers ──────────────────────────────────────────────────
  const refreshSchedule = useCallback(async () => {
    try { setSchedule(await apiGet('/api/v3/test-sends/schedule')); } catch {}
  }, []);

  const handleScheduleStart = useCallback(async () => {
    setScheduleLoading(true);
    try {
      setSchedule(await apiPost('/api/v3/test-sends/schedule/start', { destinationKey: day6Dest, loop: scheduleLoop }));
    } catch (err) { alert('Start failed: ' + err.message); }
    setScheduleLoading(false);
  }, [day6Dest, scheduleLoop]);

  const handleScheduleStop = useCallback(async () => {
    setScheduleLoading(true);
    try {
      setSchedule(await apiPost('/api/v3/test-sends/schedule/stop'));
    } catch (err) { alert('Stop failed: ' + err.message); }
    setScheduleLoading(false);
  }, []);

  const handleScheduleTick = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const data = await apiPost('/api/v3/test-sends/schedule/tick');
      if (data.skipped) {
        alert('Tick skipped: ' + (data.reason || 'unknown'));
      } else {
        alert(`Day ${data.day} (${data.label}) sent to ${data.sentTo}/${data.sentTo + data.failed}${data.sequenceDone ? ' — sequence complete' : ''}`);
      }
      await refreshSchedule();
    } catch (err) { alert('Tick failed: ' + err.message); }
    setScheduleLoading(false);
  }, [refreshSchedule]);

  // ── send log loader + debounce ────────────────────────────────────────
  const loadLogs = useCallback(async (page = 1, search = '', status = '') => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (search.trim()) params.set('email', search.trim());
      if (status) params.set('status', status);
      const data = await apiGet(`/api/v3/test-sends/send-log?${params}`);
      setLogs(data.rows || []);
      setLogTotal(data.total || 0);
      setLogPage(data.page || 1);
    } catch { setLogs([]); }
    setLogsLoading(false);
  }, []);

  useEffect(() => {
    if (!showLogs) return;
    if (logDebounceRef.current) clearTimeout(logDebounceRef.current);
    logDebounceRef.current = setTimeout(() => {
      loadLogs(1, logSearch, logStatusFilter);
    }, 300);
    return () => clearTimeout(logDebounceRef.current);
  }, [showLogs, logSearch, logStatusFilter, loadLogs]);

  // ── send handler ───────────────────────────────────────────────────────
  const handleSend = useCallback(async (tpl) => {
    const key = tpl.key;
    setRunning(r => ({ ...r, [key]: true }));
    setResults(r => ({ ...r, [key]: null }));
    try {
      const body = { emails: selectedEmails };
      if (tpl.needsDestination) body.destinationKey = day6Dest;
      const data = await apiPost(`/api/v3/test-sends/${key}`, body);
      setResults(r => ({ ...r, [key]: { ok: true, ...data } }));
    } catch (err) {
      setResults(r => ({ ...r, [key]: { ok: false, error: err.message } }));
    } finally {
      setRunning(r => ({ ...r, [key]: false }));
    }
  }, [selectedEmails, day6Dest]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Mail size={26} /> Test Sends
          </h1>
          <p style={{ color: 'var(--muted-foreground)', margin: 0, fontSize: 14 }}>
            Search contacts, select recipients, and send any of the 7 day templates. Internal QA only.
          </p>
        </div>
        <button
          onClick={() => setShowLogs(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
            background: 'var(--card)', color: 'var(--foreground)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <ClipboardList size={15} style={{ color: '#e2b340' }} />
          View Email Logs
        </button>
      </div>

      {/* ── Recipient search + selection ──────────────────────────────── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
        padding: '16px 18px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Users size={16} style={{ color: '#e2b340' }} />
          <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted-foreground)' }}>
            Recipients
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>&middot; {selected.length} selected</span>
        </div>

        {/* Search input */}
        <div ref={searchRef} style={{ position: 'relative', marginBottom: 12 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            padding: '8px 12px',
          }}>
            {searching ? <Loader2 size={15} className="spin" style={{ color: 'var(--muted-foreground)' }} /> : <Search size={15} style={{ color: 'var(--muted-foreground)' }} />}
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
              placeholder="Search by email or name..."
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 13, color: 'var(--foreground)',
              }}
            />
          </div>

          {/* Search dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              marginTop: 4, maxHeight: 240, overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            }}>
              {searchResults.map(c => {
                const alreadySelected = selected.some(s => s.email === c.email);
                return (
                  <div
                    key={c.id}
                    onClick={() => !alreadySelected && addRecipient(c)}
                    style={{
                      padding: '10px 14px', cursor: alreadySelected ? 'default' : 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      borderBottom: '1px solid var(--border)',
                      opacity: alreadySelected ? 0.4 : 1,
                      background: alreadySelected ? 'rgba(226,179,64,0.05)' : 'transparent',
                    }}
                    onMouseEnter={e => { if (!alreadySelected) e.currentTarget.style.background = 'rgba(226,179,64,0.08)'; }}
                    onMouseLeave={e => { if (!alreadySelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{c.email}</span>
                        {c.contact_type && (
                          <span style={{
                            fontSize: 9, padding: '1px 6px', borderRadius: 'var(--radius-sm)', fontWeight: 700,
                            letterSpacing: 0.5, textTransform: 'uppercase', flexShrink: 0,
                            background: c.contact_type === 'B2B' ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
                            color:      c.contact_type === 'B2B' ? '#3b82f6'               : '#a855f7',
                          }}>
                            {c.contact_type}
                          </span>
                        )}
                      </div>
                      {c.name && (
                        <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 1 }}>
                          {c.name}
                        </div>
                      )}
                    </div>
                    {alreadySelected && (
                      <CheckCircle2 size={14} style={{ color: '#22c55e', flexShrink: 0 }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected recipients pills */}
        {selected.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
            No recipients selected. Search and add emails above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {selected.map(s => (
              <span key={s.email} style={{
                fontSize: 12, padding: '4px 8px 4px 10px', borderRadius: 'var(--radius-sm)',
                background: 'rgba(226,179,64,0.10)', color: '#e2b340', fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {s.email}
                {s.contact_type && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 'var(--radius-sm)',
                    fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                    background: s.contact_type === 'B2B' ? 'rgba(59,130,246,0.2)' : 'rgba(168,85,247,0.2)',
                    color:      s.contact_type === 'B2B' ? '#3b82f6'              : '#a855f7',
                  }}>
                    {s.contact_type}
                  </span>
                )}
                <X
                  size={12}
                  style={{ cursor: 'pointer', opacity: 0.7 }}
                  onClick={() => removeRecipient(s.email)}
                />
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Daily auto-send schedule ──────────────────────────────────── */}
      <div style={{
        background: 'var(--card)',
        border: `1px solid ${schedule?.is_running ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-xl)', padding: '16px 20px', marginBottom: 24,
        boxShadow: schedule?.is_running ? '0 0 0 1px rgba(34,197,94,0.25)' : 'none',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Calendar size={16} style={{ color: schedule?.is_running ? '#22c55e' : 'var(--muted-foreground)' }} />
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted-foreground)' }}>
                Daily Auto-Send
              </span>
              {schedule?.is_running ? (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 700, letterSpacing: 0.5 }}>RUNNING</span>
              ) : (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(148,163,184,0.15)', color: 'var(--muted-foreground)', fontWeight: 700, letterSpacing: 0.5 }}>STOPPED</span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
              When started, the cron at <strong>9:00 AM Dubai daily</strong> sends the next template (Day-1 → Day-7). No further intervention needed.
            </div>
            {schedule?.is_running && (
              <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
                <div><span style={{ color: 'var(--muted-foreground)' }}>Next:</span> <strong>Day {schedule.next_day_to_send}</strong></div>
                {schedule.last_sent_day && (
                  <div><span style={{ color: 'var(--muted-foreground)' }}>Last sent:</span> Day {schedule.last_sent_day} &middot; {new Date(schedule.last_sent_at).toLocaleString()}</div>
                )}
                <div><span style={{ color: 'var(--muted-foreground)' }}>Mode:</span> {schedule.loop ? 'Loop forever' : 'One-shot (1→7)'}</div>
                {schedule.destination_key && (
                  <div><span style={{ color: 'var(--muted-foreground)' }}>Day-6 dest:</span> {schedule.destination_key}</div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {!schedule?.is_running && (
              <label style={{ fontSize: 11, color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={scheduleLoop} onChange={e => setScheduleLoop(e.target.checked)} />
                Loop after Day-7
              </label>
            )}
            {schedule?.is_running ? (
              <>
                <button onClick={handleScheduleTick} disabled={scheduleLoading}
                  title="Send today's email now without waiting for cron"
                  style={{
                    background: 'transparent', color: '#e2b340', border: '1px solid #e2b340',
                    borderRadius: 'var(--radius)', padding: '8px 14px', fontSize: 12, fontWeight: 600,
                    cursor: scheduleLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  {scheduleLoading ? <Loader2 size={13} className="spin" /> : <Zap size={13} />} Send Now
                </button>
                <button onClick={handleScheduleStop} disabled={scheduleLoading}
                  style={{
                    background: '#ef4444', color: '#ffffff', border: 'none',
                    borderRadius: 'var(--radius)', padding: '8px 16px', fontSize: 12, fontWeight: 700,
                    cursor: scheduleLoading ? 'wait' : 'pointer', letterSpacing: 0.5, textTransform: 'uppercase',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  {scheduleLoading ? <Loader2 size={13} className="spin" /> : <Square size={13} fill="currentColor" />} Stop
                </button>
              </>
            ) : (
              <button onClick={handleScheduleStart} disabled={scheduleLoading}
                style={{
                  background: '#22c55e', color: '#0a0a0a', border: 'none',
                  borderRadius: 'var(--radius)', padding: '8px 18px', fontSize: 12, fontWeight: 700,
                  cursor: scheduleLoading ? 'not-allowed' : 'pointer',
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                {scheduleLoading ? <Loader2 size={13} className="spin" /> : <Play size={13} />} Start Daily Send
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Email Flow Tracker ───────────────────────────────────────── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)', padding: '16px 20px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Mail size={15} style={{ color: '#e2b340' }} />
          <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted-foreground)' }}>
            Email Tracking Flow
          </span>
          <button onClick={() => setShowLogs(true)} style={{
            marginLeft: 'auto', fontSize: 11, color: '#e2b340', background: 'transparent',
            border: '1px solid rgba(226,179,64,0.3)', borderRadius: 'var(--radius-sm)',
            padding: '3px 10px', cursor: 'pointer', fontWeight: 600,
          }}>View Logs</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0, alignItems: 'center' }}>
          {[
            { label: 'Sent',         value: flowStats.sent,        color: '#3b82f6', icon: Mail },
            { label: 'Opened',       value: flowStats.opened,      color: '#22c55e', icon: Eye },
            { label: 'Clicked',      value: flowStats.clicked,     color: '#a855f7', icon: MousePointer },
            { label: 'UTM Captured', value: flowStats.utmCaptures, color: '#e2b340', icon: Link2 },
            { label: 'Failed',       value: flowStats.failed,      color: '#ef4444', icon: XCircle },
          ].map(({ label, value, color, icon: Icon }, i, arr) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                flex: 1, textAlign: 'center', padding: '10px 8px',
                background: `color-mix(in srgb, ${color} 6%, transparent)`,
                borderRadius: 10, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `color-mix(in srgb, ${color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={15} color={color} />
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 3 }}>{label}</div>
                {i > 0 && i < 4 && flowStats.sent > 0 && (
                  <div style={{ fontSize: 10, color, fontWeight: 600, marginTop: 2 }}>
                    {Math.round((value / flowStats.sent) * 100)}%
                  </div>
                )}
              </div>
              {i < arr.length - 1 && (
                <ArrowRight size={14} style={{ color: 'var(--muted-foreground)', flexShrink: 0, margin: '0 4px' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Template cards ────────────────────────────────────────────── */}
      <motion.div variants={staggerContainer} initial="hidden" animate="visible"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {TEMPLATES.map(tpl => {
          const isRunning = !!running[tpl.key];
          const result = results[tpl.key];
          const disabled = isRunning || selected.length === 0;
          return (
            <motion.div key={tpl.key} variants={fadeInUp} style={{
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-xl)', padding: '18px 20px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                      background: 'rgba(226,179,64,0.15)', color: '#e2b340', fontWeight: 700,
                      letterSpacing: 1, textTransform: 'uppercase',
                    }}>
                      Day {tpl.day}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{tpl.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.45, marginBottom: 8 }}>
                    {tpl.desc}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Globe size={11} /> {tpl.ranking}
                  </div>
                </div>
              </div>

              {tpl.needsDestination && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted-foreground)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Destination
                  </label>
                  <select value={day6Dest} onChange={e => setDay6Dest(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', fontSize: 13,
                      background: 'var(--background)', color: 'var(--foreground)',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    }}>
                    {DAY6_DESTINATIONS.map(d => <option key={d} value={d}>{d.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                  </select>
                </div>
              )}

              <button
                onClick={() => handleSend(tpl)}
                disabled={disabled}
                style={{
                  width: '100%',
                  background: isRunning ? 'rgba(226,179,64,0.15)' : '#e2b340',
                  color: isRunning ? '#e2b340' : '#1a1a1a',
                  border: 'none', borderRadius: 'var(--radius)', padding: '10px 14px',
                  fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled && !isRunning ? 0.5 : 1, letterSpacing: 0.5, textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                {isRunning
                  ? <><Loader2 size={14} className="spin" /> Sending...</>
                  : <><Play size={14} /> Send ({selected.length})</>
                }
              </button>

              {result && (
                <div style={{
                  marginTop: 12, padding: '10px 12px', borderRadius: 'var(--radius)',
                  background: result.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${result.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  fontSize: 11.5,
                }}>
                  {result.ok ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#22c55e', fontWeight: 600, marginBottom: 6 }}>
                        <CheckCircle2 size={13} />
                        Sent to {result.results?.length || 0} recipients
                        {result.ranking?.source && <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}>&middot; {result.ranking.source}</span>}
                      </div>
                      {result.ranking?.themes && result.ranking.themes.length > 0 && (
                        <div style={{ color: 'var(--muted-foreground)', fontSize: 11, marginBottom: 6 }}>
                          <strong>Trending:</strong> {result.ranking.themes.slice(0, 3).join(' · ')}
                        </div>
                      )}
                      <div style={{ display: 'grid', gap: 3, fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5 }}>
                        {(result.results || []).map((r, i) => (
                          <div key={i} style={{ color: r.success ? 'var(--foreground)' : '#ef4444', display: 'flex', justifyContent: 'space-between' }}>
                            <span>{r.success ? '\u2713' : '\u2717'} {r.email}</span>
                            <span style={{ color: 'var(--muted-foreground)' }}>{r.success ? `${r.ms}ms` : (r.error || '').slice(0, 30)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444' }}>
                      <XCircle size={13} /> {result.error || 'Failed'}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {/* ── Email Send Logs Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {showLogs && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowLogs(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xl)', padding: '24px 28px',
                width: '90vw', maxWidth: 920, maxHeight: '85vh',
                display: 'flex', flexDirection: 'column', gap: 0,
                boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
              }}
            >
              {/* Modal header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ClipboardList size={18} style={{ color: '#e2b340' }} />
                  <span style={{ fontSize: 17, fontWeight: 700 }}>Email Send Logs</span>
                  {logTotal > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--muted-foreground)', fontWeight: 400 }}>
                      {logTotal} record{logTotal !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <button onClick={() => setShowLogs(false)} style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--muted-foreground)', padding: 4, display: 'flex',
                }}>
                  <X size={18} />
                </button>
              </div>

              {/* Filters row */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{
                  flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--background)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '7px 12px',
                }}>
                  <Search size={13} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={e => setLogSearch(e.target.value)}
                    placeholder="Search by email..."
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      fontSize: 13, color: 'var(--foreground)',
                    }}
                  />
                  {logSearch && (
                    <X size={12} style={{ cursor: 'pointer', color: 'var(--muted-foreground)' }}
                      onClick={() => setLogSearch('')} />
                  )}
                </div>
                <select
                  value={logStatusFilter}
                  onChange={e => setLogStatusFilter(e.target.value)}
                  style={{
                    padding: '7px 12px', fontSize: 13, minWidth: 130,
                    background: 'var(--background)', color: 'var(--foreground)',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  }}
                >
                  <option value="">All Statuses</option>
                  <option value="queued">Queued</option>
                  <option value="sent">Sent</option>
                  <option value="opened">Opened</option>
                  <option value="clicked">Clicked</option>
                  <option value="failed">Failed</option>
                </select>
                <button
                  onClick={() => loadLogs(logPage, logSearch, logStatusFilter)}
                  style={{
                    background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '7px 14px',
                    fontSize: 13, color: 'var(--muted-foreground)', cursor: 'pointer',
                  }}
                >
                  Refresh
                </button>
              </div>

              {/* Table */}
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {logsLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 48 }}>
                    <Loader2 size={22} className="spin" style={{ color: 'var(--muted-foreground)' }} />
                  </div>
                ) : logs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted-foreground)', fontSize: 14 }}>
                    No send logs found.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Status', 'Email', 'Template', 'Sent At', 'Opened', 'Clicked', 'Duration'].map(h => (
                          <th key={h} style={{
                            padding: '8px 10px', textAlign: 'left', fontSize: 11,
                            fontWeight: 600, color: 'var(--muted-foreground)',
                            textTransform: 'uppercase', letterSpacing: 0.5,
                            whiteSpace: 'nowrap',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((row, i) => {
                        const statusCfg = {
                          queued:  { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' },
                          sent:    { bg: 'rgba(59,130,246,0.15)',  color: '#3b82f6' },
                          failed:  { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444' },
                          opened:  { bg: 'rgba(34,197,94,0.15)',   color: '#22c55e' },
                          clicked: { bg: 'rgba(168,85,247,0.15)',  color: '#a855f7' },
                        }[row.status] || { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' };
                        return (
                          <tr key={row.id} style={{
                            borderBottom: '1px solid var(--border)',
                            background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                          }}>
                            <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                              <span style={{
                                fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                                background: statusCfg.bg, color: statusCfg.color,
                                fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                              }}>
                                {row.status}
                              </span>
                            </td>
                            <td style={{ padding: '9px 10px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <div style={{ fontWeight: 500 }}>{row.email}</div>
                              {row.contact_name && (
                                <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{row.contact_name}</div>
                              )}
                            </td>
                            <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', color: 'var(--muted-foreground)' }}>
                              {row.template_label || '—'}
                            </td>
                            <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', color: 'var(--muted-foreground)', fontSize: 12 }}>
                              {row.sent_at ? new Date(row.sent_at).toLocaleString() : '—'}
                            </td>
                            <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', fontSize: 12 }}>
                              {row.opened_at ? (
                                <span style={{ color: '#22c55e', fontWeight: 600 }}>
                                  ✓ {new Date(row.opened_at).toLocaleString()}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--muted-foreground)' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', fontSize: 12 }}>
                              {row.clicked_at ? (
                                <span style={{ color: '#a855f7', fontWeight: 600 }}>
                                  ✓ {new Date(row.clicked_at).toLocaleString()}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--muted-foreground)' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', color: 'var(--muted-foreground)', fontSize: 12 }}>
                              {row.duration_ms != null ? `${row.duration_ms}ms` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {logTotal > 20 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  paddingTop: 14, marginTop: 4, borderTop: '1px solid var(--border)',
                  fontSize: 13, color: 'var(--muted-foreground)',
                }}>
                  <span>Page {logPage} of {Math.ceil(logTotal / 20)}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => loadLogs(logPage - 1, logSearch, logStatusFilter)}
                      disabled={logPage <= 1}
                      style={{
                        background: 'transparent', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', padding: '5px 10px',
                        cursor: logPage <= 1 ? 'not-allowed' : 'pointer',
                        opacity: logPage <= 1 ? 0.4 : 1, color: 'var(--foreground)',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <ChevronLeft size={14} /> Prev
                    </button>
                    <button
                      onClick={() => loadLogs(logPage + 1, logSearch, logStatusFilter)}
                      disabled={logPage >= Math.ceil(logTotal / 20)}
                      style={{
                        background: 'transparent', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', padding: '5px 10px',
                        cursor: logPage >= Math.ceil(logTotal / 20) ? 'not-allowed' : 'pointer',
                        opacity: logPage >= Math.ceil(logTotal / 20) ? 0.4 : 1, color: 'var(--foreground)',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
