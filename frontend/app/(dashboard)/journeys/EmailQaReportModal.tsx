'use client';

/**
 * EmailQaReportModal — read-only viewer for a template's stored Email QA report
 * (grammar, missing content, URL health, spam-risk heuristic, other errors).
 * The report is generated/refreshed daily by the TemplateQA cron and stored in
 * email_qa_reports (one row per template_id). Used by the eye button on the
 * journey analytics screen.
 */
import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { getStoredQaReport } from '@/lib/api';

interface SectionProps { icon: React.ReactNode; title: string; items?: React.ReactNode[] | null; okText: string; danger?: boolean }

interface QaUrlResult { ok?: boolean; status?: number | string; error?: string; url?: string }
interface QaReport {
  spamRisk?: { level?: string; reasons?: string[] };
  placement?: { placement?: string } | null;
  generatedAt?: string;
  grammar?: string[];
  missingContent?: string[];
  errors?: string[];
  urls?: { total?: number; broken?: number; results?: QaUrlResult[] };
  analysisSource?: string;
}
interface QaState { loading: boolean; report: QaReport | null; error: string | null }
interface EmailQaReportModalProps { templateId?: string | number | null; templateName?: string | null; onClose: () => void }

function Section({ icon, title, items, okText, danger }: SectionProps) {
  const list = items || [];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>{icon} {title}</div>
      {list.length === 0 ? (
        <div style={{ fontSize: 13, color: '#16a34a' }}>✓ {okText}</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {list.map((it, i) => <li key={i} style={{ fontSize: 13, color: danger ? '#ef4444' : 'var(--text-primary)' }}>{it}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function EmailQaReportModal({ templateId, templateName, onClose }: EmailQaReportModalProps) {
  const [state, setState] = useState<QaState>({ loading: true, report: null, error: null });

  useEffect(() => {
    let cancelled = false;
    if (!templateId) { setState({ loading: false, report: null, error: 'This step has no email attached.' }); return; }
    setState({ loading: true, report: null, error: null });
    getStoredQaReport(templateId)
      .then((res: unknown) => {
        if (cancelled) return;
        if (!(res as { data?: QaReport } | null)?.data) setState({ loading: false, report: null, error: 'No email check yet — it runs automatically each morning, or send a test email to run one now.' });
        else setState({ loading: false, report: (res as { data: QaReport }).data, error: null });
      })
      .catch((e: Error) => { if (!cancelled) setState({ loading: false, report: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [templateId]);

  const { loading, report, error } = state;
  const sr: NonNullable<QaReport['spamRisk']> = report?.spamRisk || {};
  const srColor = sr.level === 'High' ? '#ef4444' : sr.level === 'Medium' ? '#f59e0b' : '#16a34a';
  const placement = report?.placement;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 14, maxWidth: 640, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>📋 Email check</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {templateName || `Template #${templateId}`}
              {report?.generatedAt ? ` — updated ${new Date(report.generatedAt).toLocaleString()}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm"><X size={18} /></button>
        </div>

        <div style={{ padding: '18px 22px', overflow: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-secondary)' }}>
              <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', marginBottom: 10 }} />
              <div style={{ fontWeight: 600 }}>Loading report…</div>
            </div>
          ) : error ? (
            <div style={{ padding: 16, borderRadius: 8, background: 'rgba(148,163,184,0.12)', color: 'var(--text-secondary)', fontSize: 13 }}>{error}</div>
          ) : report ? (
            <div>
              {/* Spam-risk heuristic (+ real placement if it was ever checked) */}
              <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: srColor + '14', border: `1px solid ${srColor}40` }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 6 }}>📬 Spam Risk</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: srColor }}>{sr.level || 'Unknown'} risk</div>
                {sr.reasons?.length ? (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{sr.reasons.join('; ')}</div>
                ) : null}
                {placement?.placement && placement.placement !== 'not_found' ? (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                    Last real placement: <b style={{ color: placement.placement === 'inbox' ? '#16a34a' : '#ef4444' }}>{placement.placement === 'inbox' ? 'INBOX' : 'SPAM'}</b>
                  </div>
                ) : null}
              </div>

              <Section icon="✍️" title="Grammar" items={report.grammar} okText="No grammar issues found" />
              <Section icon="📦" title="Missing Content" items={report.missingContent} okText="No missing content" danger />

              {/* URLs */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>🔗 URLs ({report.urls?.total || 0} found, {report.urls?.broken || 0} broken)</div>
                {(report.urls?.results || []).length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No links</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflow: 'auto' }}>
                    {report.urls!.results!.map((u, i) => (
                      <div key={i} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: u.ok ? '#16a34a' : '#ef4444', fontWeight: 700, flexShrink: 0 }}>{u.ok ? '✓' : '✗'} {u.status || u.error}</span>
                        <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.url}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Section icon="⚠️" title="Other Errors" items={report.errors} okText="No other issues" danger />
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>Content analysis: {report.analysisSource === 'claude' ? 'Claude AI' : (report.analysisSource || 'n/a')}</div>
            </div>
          ) : null}
        </div>
      </div>
      <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
