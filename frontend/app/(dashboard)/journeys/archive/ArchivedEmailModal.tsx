'use client';

/**
 * ArchivedEmailModal — the email one archived journey step sent, read from the archive in S3
 * (GET /journey-archive/:id/nodes/:nodeId/email): the template subject/HTML as archived, the
 * subjects actually sent with dates, and a warning when the template was edited after the step's
 * last send. The HTML renders in a sandboxed iframe (no scripts, no same-origin access).
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { X, Loader2, Info, Eye, AlertTriangle } from 'lucide-react';
import { getArchivedNodeEmail } from '@/lib/api';
import type { ApiEnvelope } from '@/types/api';

interface ArchivedTemplate {
  id: number | string;
  name?: string;
  subject?: string | null;
  html_subject_line?: string | null;
  body?: string | null;
  html_body?: string | null;
  updated_at: string;
  html_updated_at?: string | null;
}

interface SentSubject {
  subject?: string | null;
  emails?: number | null;
  first_sent_at?: string | null;
}

/** GET /api/v3/journey-archive/:id/nodes/:nodeId/email → data */
interface ArchivedNodeEmail {
  node_id: string;
  template_id?: number | string | null;
  send_hour?: string | null;
  emails?: number | null;
  first_sent_at?: string | null;
  last_sent_at?: string | null;
  subjects?: SentSubject[];
  stored_email?: { subject?: string | null; html?: string | null } | null;
  template: ArchivedTemplate | null;
  archived_at?: string | null;
}

interface Loadable<T> { loading: boolean; data?: T; error?: string }

const fmt = (n: unknown) => (n == null ? '—' : (Number(n) || 0).toLocaleString('en-US'));
const fmtDate = (ts: string | null | undefined) => (ts ? new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

interface ArchivedEmailModalProps {
  journeyId: number | string;
  nodeId: string;
  label?: string;
  onClose: () => void;
}

export default function ArchivedEmailModal({ journeyId, nodeId, label: stepLabel, onClose }: ArchivedEmailModalProps) {
  const [state, setState] = useState<Loadable<ArchivedNodeEmail>>({ loading: true });
  const [view, setView] = useState<'html' | 'source'>('html');

  useEffect(() => {
    (getArchivedNodeEmail(journeyId, nodeId) as Promise<ApiEnvelope<ArchivedNodeEmail>>)
      .then(res => setState({ loading: false, data: res.data }))
      .catch((e: Error) => setState({ loading: false, error: e.message }));
  }, [journeyId, nodeId]);

  const d = state.data;
  const t = d?.template;
  const html = d?.stored_email?.html || t?.html_body || t?.body || '';
  const subject = d?.stored_email?.subject || d?.subjects?.[0]?.subject || t?.html_subject_line || t?.subject || '—';
  const editedAfter = t && d?.last_sent_at && new Date(t.html_updated_at || t.updated_at) > new Date(d.last_sent_at);
  const label: CSSProperties = { fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 700 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} className="card" role="dialog" aria-label={`Email for ${stepLabel || nodeId}`}
        style={{ width: 'min(980px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', background: 'var(--card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <Eye size={16} color="#8b5cf6" />
          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {stepLabel || nodeId} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>· {nodeId}{d?.send_hour ? ` · @ ${d.send_hour}` : ''}</span>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>

        {state.loading && <div style={{ padding: 24, color: 'var(--text-tertiary)' }}><Loader2 size={14} className="spin" style={{ verticalAlign: -2, marginRight: 6 }} /> Loading email from archive…</div>}
        {state.error && <div style={{ padding: 24, color: '#ef4444' }}>{state.error}</div>}

        {d && (
          <div style={{ overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div><div style={label}>Template</div><div style={{ color: 'var(--text-primary)' }}>{t ? `${t.name} #${t.id}` : (d.template_id ? `#${d.template_id} (not found)` : '—')}</div></div>
              <div><div style={label}>Emails sent</div><div style={{ color: 'var(--text-primary)' }}>{fmt(d.emails)}</div></div>
              <div><div style={label}>Sent on</div><div style={{ color: 'var(--text-primary)' }}>{d.first_sent_at ? `${fmtDate(d.first_sent_at)}${fmtDate(d.last_sent_at) !== fmtDate(d.first_sent_at) ? ` → ${fmtDate(d.last_sent_at)}` : ''}` : '—'}</div></div>
              <div><div style={label}>Template last edited</div><div style={{ color: 'var(--text-primary)' }}>{t ? fmtDate(t.html_updated_at || t.updated_at) : '—'}</div></div>
            </div>

            {d.stored_email ? (
              <div style={{ fontSize: 12, color: '#22c55e' }}><Info size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Exact email as sent (frozen at send time).</div>
            ) : editedAfter ? (
              <div style={{ fontSize: 12, padding: '8px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
                This template was edited after this step&apos;s last send — the preview shows the newer version, not exactly what was sent. The subjects below are what was actually sent.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}><Info size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Template as sent; personal fields ({'{{ … }}'}) were filled per contact at send time.</div>
            )}

            <div>
              <div style={label}>Subject{(d.subjects?.length ?? 0) > 1 ? 's sent' : ''}</div>
              {d.subjects?.length ? d.subjects.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, color: 'var(--text-primary)' }}>{s.subject || '—'}</span>
                  <span style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{fmt(s.emails)} · {fmtDate(s.first_sent_at)}</span>
                </div>
              )) : <div style={{ color: 'var(--text-primary)' }}>{subject}</div>}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {(['html', 'source'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: view === v ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', fontWeight: view === v ? 700 : 400 }}>
                  {v === 'html' ? 'Preview' : 'HTML source'}
                </button>
              ))}
            </div>
            {!html ? (
              <div style={{ color: 'var(--text-tertiary)' }}>No HTML stored for this template.</div>
            ) : view === 'html' ? (
              <iframe title="Email preview" sandbox="" srcDoc={html}
                style={{ width: '100%', height: '60vh', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
            ) : (
              <pre style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 11.5, padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{html}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
