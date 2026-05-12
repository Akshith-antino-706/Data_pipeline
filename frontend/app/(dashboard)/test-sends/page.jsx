'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Play, CheckCircle2, XCircle, Loader2, Mail, Users, Globe,
  Calendar, Search, X, ClipboardList,
  MousePointer, Eye, ArrowRight, Link2,
} from 'lucide-react';
import Link from 'next/link';

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
  // ── contact list state ────────────────────────────────────────────────
  const [selected, setSelected]               = useState([]);
  const [contactQuery, setContactQuery]       = useState('');
  const [contacts, setContacts]               = useState([]);
  const [contactsTotal, setContactsTotal]     = useState(0);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsOffset, setContactsOffset]   = useState(0);
  const debounceRef = useRef(null);

  // ── template send state ───────────────────────────────────────────────
  const [running, setRunning] = useState({});
  const [results, setResults] = useState({});
  const [day6Dest, setDay6Dest] = useState('singapore');

  // ── schedule count (for badge) ────────────────────────────────────────
  const [schedules, setSchedules]           = useState([]);
  const anyRunningRef = useRef(false);
  const pollRef       = useRef(null);

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
      } catch { /* ignore */ }
    }
    loadFlowStats();
  }, []);

  // ── schedule list ─────────────────────────────────────────────────────
  const loadSchedules = useCallback(async () => {
    try {
      const list = await apiGet('/api/v3/test-sends/schedule/list');
      const arr  = Array.isArray(list) ? list : [];
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

  // ── contact list (load on mount + debounced filter) ───────────────────
  const loadContacts = useCallback(async (q = '', offset = 0) => {
    setContactsLoading(true);
    try {
      const qs = new URLSearchParams({ limit: 50, offset });
      if (q.trim().length >= 2) qs.set('q', q.trim());
      const res = await apiGet(`/api/v3/test-sends/contacts?${qs}`);
      setContacts(prev => offset === 0 ? (res.contacts || []) : [...prev, ...(res.contacts || [])]);
      setContactsTotal(res.total || 0);
      setContactsOffset(offset);
    } catch { /* ignore */ }
    setContactsLoading(false);
  }, []);

  useEffect(() => { loadContacts('', 0); }, [loadContacts]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadContacts(contactQuery, 0), 300);
    return () => clearTimeout(debounceRef.current);
  }, [contactQuery, loadContacts]);

  const toggleContact = (contact) => {
    setSelected(prev =>
      prev.some(s => s.email === contact.email)
        ? prev.filter(s => s.email !== contact.email)
        : [...prev, contact]
    );
  };

  const selectedEmails = selected.map(s => s.email);

  // ── send handler ──────────────────────────────────────────────────────
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

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Mail size={26} /> Test Sends
          </h1>
          <p style={{ color: 'var(--muted-foreground)', margin: 0, fontSize: 14 }}>
            Select recipients, start schedules, and send any of the 7 day templates. Internal QA only.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Link
            href="/test-sends/scheduler"
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: 'var(--card)', color: 'var(--foreground)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              textDecoration: 'none',
            }}
          >
            <Calendar size={15} style={{ color: '#e2b340' }} />
            Scheduler Mail
            {schedules.filter(s => s.is_running).length > 0 && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 700 }}>
                {schedules.filter(s => s.is_running).length}
              </span>
            )}
          </Link>
          <Link
            href="/test-sends/emaillog"
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: 'var(--card)', color: 'var(--foreground)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              textDecoration: 'none',
            }}
          >
            <ClipboardList size={15} style={{ color: '#e2b340' }} />
            View Email Logs
          </Link>
        </div>
      </div>

      {/* ── Recipients panel ─────────────────────────────────────────── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
        padding: '16px 18px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Users size={16} style={{ color: '#e2b340' }} />
          <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted-foreground)' }}>
            Recipients
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            &middot; {selected.length} selected of {contactsTotal} contacts
          </span>
          {selected.length > 0 && (
            <button
              onClick={() => setSelected([])}
              style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted-foreground)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              Clear all
            </button>
          )}
        </div>

        {/* Filter input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          padding: '8px 12px',
        }}>
          {contactsLoading
            ? <Loader2 size={15} className="spin" style={{ color: 'var(--muted-foreground)' }} />
            : <Search size={15} style={{ color: 'var(--muted-foreground)' }} />}
          <input
            type="text"
            value={contactQuery}
            onChange={e => setContactQuery(e.target.value)}
            placeholder="Filter by email or name..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'var(--foreground)' }}
          />
          {contactQuery && (
            <X size={13} style={{ cursor: 'pointer', color: 'var(--muted-foreground)' }} onClick={() => setContactQuery('')} />
          )}
        </div>

        {/* Contact list */}
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          {contacts.length === 0 && !contactsLoading ? (
            <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--muted-foreground)' }}>
              No contacts found
            </div>
          ) : (
            contacts.map(c => {
              const isSel = selected.some(s => s.email === c.email);
              return (
                <div
                  key={c.id}
                  onClick={() => toggleContact(c)}
                  style={{
                    padding: '9px 14px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                    borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
                    background: isSel ? 'rgba(226,179,64,0.08)' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'rgba(226,179,64,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isSel ? 'rgba(226,179,64,0.08)' : 'transparent'; }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${isSel ? '#e2b340' : 'var(--border)'}`,
                    background: isSel ? '#e2b340' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSel && <CheckCircle2 size={10} style={{ color: '#1a1a1a' }} />}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: isSel ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.email}
                      </span>
                      {c.contact_type && (
                        <span style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 'var(--radius-sm)', fontWeight: 700,
                          letterSpacing: 0.5, textTransform: 'uppercase', flexShrink: 0,
                          background: c.contact_type === 'B2B' ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
                          color:      c.contact_type === 'B2B' ? '#3b82f6'               : '#a855f7',
                        }}>
                          {c.contact_type}
                        </span>
                      )}
                    </div>
                    {c.name && (
                      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {contacts.length < contactsTotal && (
            <div
              onClick={() => loadContacts(contactQuery, contactsOffset + 50)}
              style={{ padding: '10px 14px', textAlign: 'center', fontSize: 12, color: '#e2b340', cursor: 'pointer', borderTop: '1px solid var(--border)' }}
            >
              {/* {contactsLoading
                ? <Loader2 size={13} className="spin" style={{ display: 'inline' }} />
                : `Load more (${contactsTotal - contacts.length} remaining)`} */}
            </div>
          )}
        </div>

        {/* Selected tags */}
        {selected.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {selected.map(s => (
              <span key={s.email} style={{
                fontSize: 11, padding: '3px 8px 3px 10px', borderRadius: 'var(--radius-sm)',
                background: 'rgba(226,179,64,0.12)', color: '#e2b340', fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {s.email}
                <X size={11} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => toggleContact(s)} />
              </span>
            ))}
          </div>
        )}
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
          <Link href="/test-sends/emaillog" style={{
            marginLeft: 'auto', fontSize: 11, color: '#e2b340', background: 'transparent',
            border: '1px solid rgba(226,179,64,0.3)', borderRadius: 'var(--radius-sm)',
            padding: '3px 10px', cursor: 'pointer', fontWeight: 600, textDecoration: 'none',
          }}>View Logs</Link>
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
          const result    = results[tpl.key];
          const disabled  = isRunning || selected.length === 0;
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
                            <span>{r.success ? '✓' : '✗'} {r.email}</span>
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

    </motion.div>
  );
}
