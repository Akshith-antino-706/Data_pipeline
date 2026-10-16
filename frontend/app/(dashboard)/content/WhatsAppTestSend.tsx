'use client';

/**
 * WhatsApp Test Send — the WhatsApp analogue of the email "Test Send" on the content
 * screen. Pick a ChatHead WhatsApp channel + template, enter a test number, and fire a
 * single-recipient broadcast via POST /api/v3/chathead/test-send. Each send is fully
 * independent and logged to whatsapp_send_log.
 */
import { useState, useEffect } from 'react';
import type React from 'react';
import { MessageCircle, Send, Loader2, CheckCircle2, XCircle, Eye } from 'lucide-react';
import { getWhatsAppChannels, getWhatsAppTemplates, whatsAppTestSend, previewWhatsAppTemplate } from '@/lib/api';

/**
 * The ChatHead preview endpoint returns the fully-rendered template as HTML
 * (header image + body + footer, with <b>/<br/> and {{n}} params). We render it
 * as-is, after stripping anything executable — the content is first-party
 * (our own ChatHead account) but we still don't trust it enough to run scripts.
 */
function sanitizePreviewHtml(raw: unknown): string {
  if (!raw) return '';
  return String(raw)
    .replace(/<\/?(script|style|iframe|object|embed|link|meta|form)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    // highlight {{1}} style params so they're obvious in the preview
    .replace(/\{\{(\d+)\}\}/g, '<span style="background:#fff3cd;border-radius:3px;padding:0 3px;color:#8a6d00">{{$1}}</span>');
}

/** True if the HTML has any visible text or an image (vs. an empty shell). */
function hasVisibleContent(html: string): boolean {
  if (!html) return false;
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;
}

interface WaChannel { id: string | number; name?: string; type?: string }
interface WaTemplate { id: string | number; name?: string }
interface WaListResponse<T> { data?: T[] }
interface WaSendResult { ok: boolean; msg: string }
interface WaPreviewState { open: boolean; loading: boolean; name: string; html: string; error: string | null }
interface WaPreviewResponse { success?: boolean; error?: string; data?: { content?: string } }

export default function WhatsAppTestSend() {
  const [channels, setChannels]     = useState<WaChannel[]>([]);
  const [channelId, setChannelId]   = useState('');
  const [templates, setTemplates]   = useState<WaTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [phone, setPhone]           = useState('');
  const [name, setName]             = useState('');
  const [loadingCh, setLoadingCh]   = useState(true);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [sending, setSending]       = useState(false);
  const [result, setResult]         = useState<WaSendResult | null>(null);
  const [err, setErr]               = useState<string | null>(null);
  const [preview, setPreview]       = useState<WaPreviewState | null>(null); // { open, loading, name, html, error }

  useEffect(() => {
    (getWhatsAppChannels() as Promise<WaListResponse<WaChannel>>)
      .then(r => setChannels(r.data || []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoadingCh(false));
  }, []);

  useEffect(() => {
    if (!channelId) { setTemplates([]); setTemplateId(''); return; }
    setLoadingTpl(true); setTemplateId('');
    (getWhatsAppTemplates(channelId) as Promise<WaListResponse<WaTemplate>>)
      .then(r => setTemplates(r.data || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTpl(false));
  }, [channelId]);

  const digits = phone.replace(/[^\d]/g, '');
  const canSend = digits.length >= 10 && digits.length <= 15 && channelId && templateId && !sending;

  const send = async () => {
    setSending(true); setResult(null);
    try {
      const ch  = channels.find(c => String(c.id) === String(channelId));
      const tpl = templates.find(t => String(t.id) === String(templateId));
      const r = await whatsAppTestSend({
        phone: digits, name,
        channelId, channelName: ch?.name,
        templateId, templateName: tpl?.name,
      }) as { success?: boolean };
      setResult({ ok: !!r.success, msg: r.success ? 'Sent — scheduled ~1 min out' : 'Send failed (check number/template)' });
    } catch (e) {
      setResult({ ok: false, msg: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const openPreview = async (id: string) => {
    if (!id) return;
    const tpl = templates.find(t => String(t.id) === String(id));
    setPreview({ open: true, loading: true, name: tpl?.name?.trim() || 'Template', html: '', error: null });
    try {
      const r = await previewWhatsAppTemplate(id) as WaPreviewResponse;
      const content = r?.data?.content ?? '';
      const html = sanitizePreviewHtml(content);
      setPreview(p => p && {
        ...p, loading: false, html,
        error: r?.success === false
          ? (r.error || 'Preview unavailable from ChatHead.')
          : (hasVisibleContent(html) ? null : 'This template has no preview content yet (empty template, or not approved on WhatsApp).'),
      });
    } catch (e) {
      setPreview(p => p && { ...p, loading: false, error: (e as Error).message });
    }
  };

  const ctrl: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, width: '100%',
  };

  return (
    <div className="card" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <MessageCircle size={18} color="#25D366" />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>WhatsApp Test Send</h3>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', margin: '0 0 14px' }}>
        Send a WhatsApp template to one test number (ChatHead). Templates come from ChatHead, not email templates.
      </p>

      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>Couldn’t load WhatsApp channels: {err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Channel
          <select value={channelId} onChange={e => setChannelId(e.target.value)} disabled={loadingCh} style={{ ...ctrl, marginTop: 4 }}>
            <option value="">{loadingCh ? 'Loading…' : 'Select channel'}</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
        </label>

        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Template
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <select value={templateId} onChange={e => setTemplateId(e.target.value)} disabled={!channelId || loadingTpl} style={{ ...ctrl }}>
              <option value="">{loadingTpl ? 'Loading…' : (channelId ? 'Select template' : 'Pick a channel first')}</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => openPreview(templateId)}
              disabled={!templateId || preview?.loading}
              title={templateId ? 'Preview template' : 'Select a template to preview'}
              style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 38, height: 36, borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-secondary)', color: templateId ? 'var(--text-primary)' : 'var(--text-tertiary)',
                cursor: templateId ? 'pointer' : 'not-allowed',
              }}>
              {preview?.loading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Eye size={15} />}
            </button>
          </div>
        </label>

        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Test number (digits, no +)
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="9190XXXXXXXX" style={{ ...ctrl, marginTop: 4 }} />
        </label>

        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Name (optional)
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Rocky" style={{ ...ctrl, marginTop: 4 }} />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={send} disabled={!canSend} className="btn btn-sm"
          style={{ gap: 6, background: canSend ? '#25D366' : 'var(--bg-secondary)', color: canSend ? '#fff' : 'var(--text-tertiary)', border: 'none', padding: '8px 16px', cursor: canSend ? 'pointer' : 'not-allowed' }}>
          {sending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
          {sending ? 'Sending…' : 'Test Send (WhatsApp)'}
        </button>
        {result && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: result.ok ? '#16a34a' : '#ef4444' }}>
            {result.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {result.msg}
          </span>
        )}
      </div>

      {preview?.open && (
        <div
          onClick={() => setPreview(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 'min(420px, 94vw)', maxHeight: '82vh', overflow: 'auto', background: 'var(--bg-primary, #fff)', borderRadius: 12, border: '1px solid var(--border)', boxShadow: '0 12px 48px rgba(0,0,0,0.35)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <MessageCircle size={16} color="#25D366" />
                <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{preview.name}</strong>
              </span>
              <button type="button" onClick={() => setPreview(null)} title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'inline-flex' }}>
                <XCircle size={18} />
              </button>
            </div>
            <div style={{ padding: 16, background: '#e5ddd5' }}>
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
        </div>
      )}
    </div>
  );
}
