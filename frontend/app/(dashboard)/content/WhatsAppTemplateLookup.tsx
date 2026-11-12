'use client';

/**
 * WhatsApp Template Lookup — preview a ChatHead WhatsApp template and check its Meta
 * approval status. Pick channel + template, or type a template ID directly (e.g. one
 * just created with "Create WhatsApp Template"). Read-only: uses
 *   GET  /api/v3/chathead/templates/:id/preview  → rendered template HTML
 *   POST /api/v3/chathead/templates/status       → { meta_status, meta_category, quality_score }
 */
import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { FileSearch, Eye, ShieldCheck, Loader2, RefreshCw } from 'lucide-react';
import { getWhatsAppChannels, getWhatsAppTemplatesAll, previewWhatsAppTemplate, getWhatsAppTemplateStatus } from '@/lib/api';
import { sanitizePreviewHtml, hasVisibleContent } from './WhatsAppTestSend';

interface WaChannel { id: string | number; name?: string }
interface WaTemplate { id: string | number; name?: string; template_code?: string }
interface OtherTemplate { id: string; meta_status: string; meta_category: string | null; label?: string }
interface TemplateStatus {
  meta_status?: string; meta_category?: string; created?: number | string; updated?: number | string;
  quality_score?: { score?: string; date?: number | string };
  [key: string]: unknown;
}
interface ApiResult<T> { success?: boolean; data?: T; error?: string }
interface PreviewState { id: string; loading: boolean; html: string; error: string | null }
interface StatusState { id: string; loading: boolean; data: TemplateStatus | null; error: string | null; checkedAt?: Date }
interface Tone { fg: string; bg: string; label: string; hint: string }

// Meta template states → chip colours. Anything unlisted shows neutral.
const STATUS_TONE: Record<string, Tone> = {
  APPROVED: { fg: '#15803d', bg: 'rgba(22,163,74,0.12)', label: 'Approved', hint: 'Ready to send.' },
  PENDING:  { fg: '#b45309', bg: 'rgba(245,158,11,0.14)', label: 'Pending review', hint: 'Meta is still reviewing it. Sends will fail until it is approved.' },
  IN_APPEAL:{ fg: '#b45309', bg: 'rgba(245,158,11,0.14)', label: 'In appeal', hint: 'An appeal is under review. Sends will fail until it is approved.' },
  REJECTED: { fg: '#b91c1c', bg: 'rgba(239,68,68,0.12)', label: 'Rejected', hint: 'Meta rejected it. Edit the content and submit a new template.' },
  PAUSED:   { fg: '#b91c1c', bg: 'rgba(239,68,68,0.12)', label: 'Paused', hint: 'Paused by Meta after poor quality feedback. Sends will fail.' },
  DISABLED: { fg: '#b91c1c', bg: 'rgba(239,68,68,0.12)', label: 'Disabled', hint: 'Disabled by Meta. It can no longer be sent.' },
};
const QUALITY_TONE: Record<string, string> = { GREEN: '#15803d', YELLOW: '#b45309', RED: '#b91c1c' };

const ctrl: CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, width: '100%' };
const labelStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-tertiary)' };
const panel: CSSProperties = { border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-secondary)', padding: 14, minWidth: 0 };
const panelTitle: CSSProperties = { fontSize: 11.5, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 };

const fmtDate = (secs: unknown): string | null => {
  const n = Number(secs);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function WhatsAppTemplateLookup() {
  const [channels, setChannels]     = useState<WaChannel[]>([]);
  const [channelId, setChannelId]   = useState('');
  const [templates, setTemplates]   = useState<WaTemplate[]>([]);    // approved, this channel
  const [others, setOthers]         = useState<OtherTemplate[]>([]); // not approved yet, channel unknown
  const [templateId, setTemplateId] = useState('');
  const [loadingCh, setLoadingCh]   = useState(true);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [err, setErr]               = useState<string | null>(null);
  const [preview, setPreview]       = useState<PreviewState | null>(null);
  const [status, setStatus]         = useState<StatusState | null>(null);

  useEffect(() => {
    getWhatsAppChannels()
      .then(r => setChannels((r as ApiResult<WaChannel[]>).data || []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoadingCh(false));
  }, []);

  const loadTemplates = (value: string, refresh = false) => {
    if (!value) return;
    setLoadingTpl(true);
    getWhatsAppTemplatesAll(value, { refresh })
      .then(res => {
        const r = res as ApiResult<{ approved?: WaTemplate[]; other?: OtherTemplate[] }>;
        setTemplates(r.data?.approved || []); setOthers(r.data?.other || []);
      })
      .catch(() => { setTemplates([]); setOthers([]); })
      .finally(() => setLoadingTpl(false));
  };
  const pickChannel = (value: string) => {
    setChannelId(value); setTemplateId(''); setTemplates([]); setOthers([]);
    loadTemplates(value);
  };

  const id = templateId.trim();
  const validId = /^\d+$/.test(id);
  const tpl = templates.find(t => String(t.id) === id);
  const other = others.find(t => String(t.id) === id);
  const tplLabel = tpl ? `${tpl.name?.trim() || tpl.template_code} (#${tpl.id})`
    : other ? `#${other.id} · ${other.label || 'no text'}` : (validId ? `Template #${id}` : '');

  const loadPreview = async () => {
    if (!validId) return;
    setPreview({ id, loading: true, html: '', error: null });
    try {
      const r = await previewWhatsAppTemplate(id) as ApiResult<{ content?: string }>;
      const html = sanitizePreviewHtml(r?.data?.content ?? '');
      setPreview({
        id, loading: false, html,
        error: r?.success === false
          ? (r.error || 'ChatHead returned no preview for this template.')
          : (hasVisibleContent(html) ? null : 'This template has no preview content (it may be empty, or a carousel, which ChatHead does not preview).'),
      });
    } catch (e) {
      setPreview({ id, loading: false, html: '', error: (e as Error).message });
    }
  };

  const loadStatus = async () => {
    if (!validId) return;
    setStatus({ id, loading: true, data: null, error: null });
    try {
      const r = await getWhatsAppTemplateStatus(id) as ApiResult<TemplateStatus>;
      setStatus({ id, loading: false, data: r?.data || null, error: r?.success === false ? (r.error || 'Status unavailable.') : null, checkedAt: new Date() });
    } catch (e) {
      setStatus({ id, loading: false, data: null, error: (e as Error).message || 'Status unavailable. Check the template ID.', checkedAt: new Date() });
    }
  };

  const checkBoth = () => { loadPreview(); loadStatus(); };

  const st = status?.data;
  // Only rendered when `st` is set; a neutral chip covers states Meta adds later.
  const tone: Tone = STATUS_TONE[String(st?.meta_status || '').toUpperCase()] || { fg: 'var(--text-secondary)', bg: 'var(--bg-primary, transparent)', label: st?.meta_status || 'Unknown', hint: '' };
  const quality = st?.quality_score?.score ?? '';
  const busy = preview?.loading || status?.loading;
  const btn = (enabled: boolean): CSSProperties => ({ gap: 6, padding: '8px 14px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: enabled ? 'var(--text-primary)' : 'var(--text-tertiary)', cursor: enabled ? 'pointer' : 'not-allowed' });

  return (
    <div className="card" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <FileSearch size={18} color="#25D366" />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>WhatsApp Template Lookup</h3>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', margin: '0 0 14px' }}>
        Preview a WhatsApp template and check whether Meta has approved it. The list shows the channel’s approved templates, plus recently submitted ones that are pending or rejected. You can also type a template ID.
      </p>

      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>Couldn’t load WhatsApp channels: {err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <label style={labelStyle}>
          Channel
          <select id="wa-lookup-channel" value={channelId} onChange={e => pickChannel(e.target.value)} disabled={loadingCh} style={{ ...ctrl, marginTop: 4 }}>
            <option value="">{loadingCh ? 'Loading…' : 'Select channel'}</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name} (#{c.id})</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Template
            {channelId && (
              <button type="button" onClick={() => loadTemplates(channelId, true)} disabled={loadingTpl} title="Reload templates, including newly submitted ones"
                style={{ background: 'none', border: 'none', padding: 0, cursor: loadingTpl ? 'default' : 'pointer', color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <RefreshCw size={11} style={loadingTpl ? { animation: 'spin 1s linear infinite' } : undefined} /> Reload
              </button>
            )}
          </span>
          <select id="wa-lookup-template" value={tpl || other ? id : ''} onChange={e => setTemplateId(e.target.value)} disabled={!channelId || loadingTpl} style={{ ...ctrl, marginTop: 4 }}>
            <option value="">{loadingTpl ? 'Loading templates…' : (channelId ? `Select template (${templates.length + others.length})` : 'Pick a channel first')}</option>
            {templates.length > 0 && (
              <optgroup label={`Approved on this channel (${templates.length})`}>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name?.trim() || t.template_code} (#{t.id})</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={`Not approved yet, any channel (${others.length})`}>
                {others.map(t => <option key={t.id} value={t.id}>{String(t.meta_status).toUpperCase()} · #{t.id} · {t.label || 'no text'}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <label style={labelStyle}>
          …or template ID
          <input id="wa-lookup-id" value={templateId} onChange={e => setTemplateId(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter' && validId) checkBoth(); }}
            inputMode="numeric" placeholder="e.g. 1490" style={{ ...ctrl, marginTop: 4 }} />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={loadPreview} disabled={!validId || preview?.loading} className="btn btn-sm" style={btn(validId)}>
          {preview?.loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Eye size={14} />} Preview
        </button>
        <button type="button" onClick={loadStatus} disabled={!validId || status?.loading} className="btn btn-sm" style={btn(validId)}>
          {status?.loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ShieldCheck size={14} />} Check status
        </button>
        <button type="button" onClick={checkBoth} disabled={!validId || busy} className="btn btn-sm"
          style={{ gap: 6, border: 'none', padding: '8px 16px', background: validId ? '#25D366' : 'var(--bg-secondary)', color: validId ? '#fff' : 'var(--text-tertiary)', cursor: validId ? 'pointer' : 'not-allowed' }}>
          Preview + status
        </button>
        {tplLabel && <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{tplLabel}</span>}
      </div>

      {(preview || status) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 16 }}>
          {status && (
            <div style={panel}>
              <div style={panelTitle}><ShieldCheck size={13} /> Approval status · #{status.id}</div>
              {status.loading ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 13 }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Checking with Meta…
                </span>
              ) : status.error ? (
                <div style={{ fontSize: 12.5, color: '#ef4444' }}>{status.error}</div>
              ) : st ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <span style={{ display: 'inline-block', fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 999, color: tone.fg, background: tone.bg }}>{tone.label}</span>
                    {tone.hint && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>{tone.hint}</div>}
                  </div>
                  <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', margin: 0, fontSize: 12.5 }}>
                    <dt style={{ color: 'var(--text-tertiary)' }}>Meta status</dt><dd style={{ margin: 0, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{st.meta_status || '—'}</dd>
                    <dt style={{ color: 'var(--text-tertiary)' }}>Category</dt><dd style={{ margin: 0, color: 'var(--text-primary)' }}>{st.meta_category || '—'}</dd>
                    <dt style={{ color: 'var(--text-tertiary)' }}>Quality</dt>
                    <dd style={{ margin: 0, color: QUALITY_TONE[quality] || 'var(--text-primary)', fontWeight: QUALITY_TONE[quality] ? 600 : 400 }}>
                      {quality || '—'}{quality === 'UNKNOWN' && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> (not enough sends yet)</span>}
                    </dd>
                    {fmtDate(st.quality_score?.date) && <><dt style={{ color: 'var(--text-tertiary)' }}>Quality as of</dt><dd style={{ margin: 0, color: 'var(--text-primary)' }}>{fmtDate(st.quality_score?.date)}</dd></>}
                  </dl>
                  <button type="button" onClick={loadStatus} className="btn btn-sm" style={{ ...btn(true), alignSelf: 'flex-start', padding: '5px 10px' }}>
                    <RefreshCw size={13} /> Refresh{status.checkedAt && <span style={{ color: 'var(--text-tertiary)' }}> · checked {status.checkedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
                  </button>
                </div>
              ) : <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>No status returned.</div>}
            </div>
          )}
          {preview && (
            <div style={panel}>
              <div style={panelTitle}><Eye size={13} /> Preview · #{preview.id}</div>
              <div style={{ background: '#e5ddd5', borderRadius: 8, padding: 14 }}>
                {preview.loading ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#555', fontSize: 13 }}>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading preview…
                  </span>
                ) : preview.error ? (
                  <div style={{ fontSize: 12.5, color: '#b91c1c', background: '#fff', borderRadius: 8, padding: '10px 12px' }}>{preview.error}</div>
                ) : (
                  <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, color: '#111', boxShadow: '0 1px 1px rgba(0,0,0,0.15)', maxWidth: 340, wordBreak: 'break-word' }}
                    dangerouslySetInnerHTML={{ __html: preview.html }} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
