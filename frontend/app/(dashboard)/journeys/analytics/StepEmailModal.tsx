'use client';

/**
 * StepEmailModal — shows the actual message a journey step sends. Opened by the eye button
 * in the Performance step table.
 *
 * Email step:
 *   1. The step's stored email (GET /journeys/:id/nodes/:nodeId/preview-dynamic) — byte-identical
 *      to what was sent, but only exists for the dynamic Day 1-7 templates.
 *   2. Otherwise the template's own server render (POST /content/templates/:id/preview) — real
 *      products and prices for daily offer emails, the filled-in template for everything else.
 *   The automatic email check (spam risk, broken links) stays one click away in the header.
 *
 * WhatsApp step: the ChatHead template content (GET /chathead/templates/:id/preview), shown as
 * a chat bubble like the Templates page lookup. ChatHead does not preview carousel cards.
 */
import { useEffect, useState } from 'react';
import { X, Loader2, ShieldCheck } from 'lucide-react';
import { previewJourneyNodeEmail, previewTemplate, previewWhatsAppTemplate } from '@/lib/api';
import { Button } from '@/components/ui';
import { sanitizePreviewHtml, hasVisibleContent } from '../../content/WhatsAppTestSend';

interface PreviewData { html?: string; subject?: string }
interface WaPreviewResult { success?: boolean; error?: string; data?: { content?: string } }
interface PreviewState { loading: boolean; html: string | null; subject: string | null; error: string | null }
export type StepPreview =
  | { kind: 'email'; journeyId: string | number; nodeId: string; templateId: string | number; label?: string }
  | { kind: 'whatsapp'; waTemplateId: string | number; label?: string };
/** readOnly: access-token view — only the public template render (the stored-email route needs a login). */
interface StepEmailModalProps { step: StepPreview; readOnly?: boolean; onShowCheck?: () => void; onClose: () => void }

async function loadEmail(step: Extract<StepPreview, { kind: 'email' }>, readOnly: boolean): Promise<PreviewState> {
  let data: PreviewData | undefined;
  if (!readOnly) {
    try {
      data = ((await previewJourneyNodeEmail(step.journeyId, step.nodeId)) as { data?: PreviewData } | null)?.data;
    } catch { /* not a stored Day email — use the template's own render */ }
  }
  if (!data?.html) {
    try {
      data = ((await previewTemplate(step.templateId)) as { data?: PreviewData } | null)?.data;
    } catch (e) {
      return { loading: false, html: null, subject: null, error: `Couldn't load this email. ${(e as Error).message}` };
    }
  }
  return data?.html
    ? { loading: false, html: data.html, subject: data.subject || null, error: null }
    : { loading: false, html: null, subject: null, error: 'This email has no content to show.' };
}

async function loadWhatsApp(step: Extract<StepPreview, { kind: 'whatsapp' }>): Promise<PreviewState> {
  try {
    const r = await previewWhatsAppTemplate(step.waTemplateId) as WaPreviewResult | null;
    const html = sanitizePreviewHtml(r?.data?.content ?? '');
    if (r?.success === false) return { loading: false, html: null, subject: null, error: r.error || 'ChatHead returned no preview for this template.' };
    if (!hasVisibleContent(html)) {
      return { loading: false, html: null, subject: null, error: 'This template has no preview content (it may be empty, or a carousel, which ChatHead does not preview).' };
    }
    return { loading: false, html, subject: null, error: null };
  } catch (e) {
    return { loading: false, html: null, subject: null, error: `Couldn't load this WhatsApp template. ${(e as Error).message}` };
  }
}

export default function StepEmailModal({ step, readOnly = false, onShowCheck, onClose }: StepEmailModalProps) {
  const [state, setState] = useState<PreviewState>({ loading: true, html: null, subject: null, error: null });
  const isWa = step.kind === 'whatsapp';

  // The modal mounts fresh for each step it opens with, so it starts in the loading state.
  useEffect(() => {
    let cancelled = false;
    (step.kind === 'whatsapp' ? loadWhatsApp(step) : loadEmail(step, readOnly)).then(s => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
  }, [step, readOnly]);

  const { loading, html, subject, error } = state;
  const what = isWa ? 'WhatsApp message' : 'Email';
  const title = `${what} for ${step.label || 'this step'}`;
  const sub = isWa ? `WhatsApp template #${step.waTemplateId}` : subject ? `Subject: ${subject}` : `Template #${step.templateId}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        style={{ background: 'var(--card)', borderRadius: 14, maxWidth: isWa ? 460 : 760, width: '100%', height: isWa ? 'auto' : '88vh', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {step.label || `Template #${isWa ? step.waTemplateId : step.templateId}`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {!isWa && !readOnly && onShowCheck && (
              <Button size="sm" onClick={onShowCheck} title="Spam risk, grammar and broken links for this email">
                <ShieldCheck size={14} /> Email check
              </Button>
            )}
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close"><X size={18} /></button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: isWa ? 'auto' : 'hidden', borderRadius: '0 0 14px 14px', background: isWa ? '#e5ddd5' : 'var(--surface-2, #f8fafc)' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: isWa ? '#555' : 'var(--text-secondary)' }}>
              <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', marginBottom: 10 }} />
              <div style={{ fontWeight: 600 }}>Loading {what.toLowerCase()}…</div>
            </div>
          ) : error ? (
            <div role="alert" style={{ margin: 20, padding: 16, borderRadius: 8, background: isWa ? '#fff' : 'rgba(148,163,184,0.12)', color: isWa ? '#b91c1c' : 'var(--text-secondary)', fontSize: 13 }}>{error}</div>
          ) : isWa ? (
            <div style={{ padding: 16 }}>
              <div data-testid="wa-preview" title={title}
                style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, color: '#111', boxShadow: '0 1px 1px rgba(0,0,0,0.15)', maxWidth: 340, wordBreak: 'break-word' }}
                dangerouslySetInnerHTML={{ __html: html || '' }} />
            </div>
          ) : (
            <iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={html || ''}
              title={title} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} />
          )}
        </div>
      </div>
      <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
