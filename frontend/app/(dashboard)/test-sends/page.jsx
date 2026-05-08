'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Send, Play, CheckCircle2, XCircle, Loader2, Mail, Users, Globe,
  Square, Calendar, Zap,
} from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

const TEMPLATES = [
  { day: 1, key: 'day1', label: 'Welcome',                  desc: '4 service categories — Holidays / Cruises / Visas / Activities',                                  ranking: 'Anthropic web-search' },
  { day: 2, key: 'day2', label: 'Cruise Spotlight',         desc: 'Cities + saver / regional / cruise-line packages',                                                  ranking: 'Hardcoded picks' },
  { day: 3, key: 'day3', label: 'Visa Hub',                 desc: 'International + e-visa cards + popular destinations (Tourist/Transit only)',                        ranking: 'Anthropic web-search' },
  { day: 4, key: 'day4', label: 'Holidays',                 desc: '4 themes × 4 cards — Summer / Eid / Romantic / Adventure',                                          ranking: 'Anthropic web-search' },
  { day: 5, key: 'day5', label: 'Activities',               desc: 'Top Cities + 5 themes × 4 cards (Thrill / Family / Icons / Water / Wildlife)',                       ranking: 'Anthropic web-search' },
  { day: 6, key: 'day6', label: 'Destination Spotlight',    desc: 'Single destination — holidays + things-to-do + cruises + visa',                                     ranking: 'Anthropic web-search', needsDestination: true },
  { day: 7, key: 'day7', label: 'Abandoned Cart',           desc: "User's GA4 browse history → backfill with trending picks",                                          ranking: 'Anthropic web-search' },
];

const DAY6_DESTINATIONS = ['singapore', 'bangkok', 'phuket', 'bali', 'kuala_lumpur', 'istanbul'];

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';

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
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState({});  // { day1: true, ... }
  const [results, setResults] = useState({});  // { day1: { ok, results, ranking, error }, ... }
  const [day6Dest, setDay6Dest] = useState('singapore');

  const [schedule, setSchedule] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleLoop, setScheduleLoop] = useState(false);

  const loadRecipients = useCallback(async () => {
    setLoading(true);
    try {
      const [recData, schedData] = await Promise.all([
        apiGet('/api/v3/test-sends/recipients').catch(() => []),
        apiGet('/api/v3/test-sends/schedule').catch(() => null),
      ]);
      setRecipients(Array.isArray(recData) ? recData : []);
      setSchedule(schedData);
      if (schedData?.destination_key) setDay6Dest(schedData.destination_key);
      if (schedData?.loop != null) setScheduleLoop(!!schedData.loop);
    } catch (err) {
      console.error('Failed to load:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadRecipients(); }, [loadRecipients]);

  const refreshSchedule = useCallback(async () => {
    try {
      const data = await apiGet('/api/v3/test-sends/schedule');
      setSchedule(data);
    } catch (err) { console.error(err); }
  }, []);

  const handleScheduleStart = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const data = await apiPost('/api/v3/test-sends/schedule/start', { destinationKey: day6Dest, loop: scheduleLoop });
      setSchedule(data);
    } catch (err) { alert('Start failed: ' + err.message); }
    setScheduleLoading(false);
  }, [day6Dest, scheduleLoop]);

  const handleScheduleStop = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const data = await apiPost('/api/v3/test-sends/schedule/stop');
      setSchedule(data);
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

  const handleSend = useCallback(async (tpl) => {
    const key = tpl.key;
    setRunning((r) => ({ ...r, [key]: true }));
    setResults((r) => ({ ...r, [key]: null }));
    try {
      const body = tpl.needsDestination ? { destinationKey: day6Dest } : {};
      const data = await apiPost(`/api/v3/test-sends/${key}`, body);
      setResults((r) => ({ ...r, [key]: { ok: true, ...data } }));
    } catch (err) {
      setResults((r) => ({ ...r, [key]: { ok: false, error: err.message } }));
    } finally {
      setRunning((r) => ({ ...r, [key]: false }));
    }
  }, [day6Dest]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mail size={26} /> Test Sends
        </h1>
        <p style={{ color: 'var(--muted-foreground)', margin: 0, fontSize: 14 }}>
          Send any of the 7 day templates to the <strong>TEST_USERS</strong> segment only. Internal QA — never reaches real customers.
        </p>
      </div>

      {/* Recipients pill bar */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
        padding: '14px 18px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Users size={16} style={{ color: '#e2b340' }} />
          <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted-foreground)' }}>
            Recipients (TEST_USERS segment)
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>&middot; {recipients.length} active</span>
        </div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}><Loader2 size={14} className="spin" /> Loading...</div>
        ) : recipients.length === 0 ? (
          <div style={{ fontSize: 13, color: '#ef4444' }}>No recipients in TEST_USERS segment. Check segment_definitions.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {recipients.map((r) => (
              <span key={r.email} style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                background: 'rgba(226,179,64,0.10)', color: '#e2b340', fontWeight: 500,
              }}>
                {r.email}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Daily auto-send schedule */}
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
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 700, letterSpacing: 0.5 }}>● RUNNING</span>
              ) : (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(148,163,184,0.15)', color: 'var(--muted-foreground)', fontWeight: 700, letterSpacing: 0.5 }}>○ STOPPED</span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
              When started, the cron at <strong>9:00 AM Dubai daily</strong> sends the next template (Day-1 → Day-7) to TEST_USERS. No further intervention needed.
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
                <input type="checkbox" checked={scheduleLoop} onChange={(e) => setScheduleLoop(e.target.checked)} />
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
              <button onClick={handleScheduleStart} disabled={scheduleLoading || recipients.length === 0}
                style={{
                  background: '#22c55e', color: '#0a0a0a', border: 'none',
                  borderRadius: 'var(--radius)', padding: '8px 18px', fontSize: 12, fontWeight: 700,
                  cursor: scheduleLoading || recipients.length === 0 ? 'not-allowed' : 'pointer',
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', gap: 6,
                  opacity: recipients.length === 0 ? 0.5 : 1,
                }}>
                {scheduleLoading ? <Loader2 size={13} className="spin" /> : <Play size={13} />} Start Daily Send
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Template cards */}
      <motion.div variants={staggerContainer} initial="hidden" animate="visible"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {TEMPLATES.map((tpl) => {
          const isRunning = !!running[tpl.key];
          const result = results[tpl.key];
          const disabled = isRunning || recipients.length === 0;
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
                  <select value={day6Dest} onChange={(e) => setDay6Dest(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', fontSize: 13,
                      background: 'var(--background)', color: 'var(--foreground)',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    }}>
                    {DAY6_DESTINATIONS.map((d) => <option key={d} value={d}>{d.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
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
                {isRunning ? (<><Loader2 size={14} className="spin" /> Sending...</>) : (<><Play size={14} /> Send to Test Users</>)}
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
