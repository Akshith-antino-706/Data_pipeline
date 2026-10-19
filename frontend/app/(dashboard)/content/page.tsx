'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  getTemplates, getTemplate, previewTemplate, previewTemplateAI, renderPreviewHtml, createTemplate, updateTemplate, deleteTemplate,
  approveTemplate, rejectTemplate, sendTestDay, sendTemplate, analyzeTestEmail, checkInboxPlacement, getStoredQaReport, authFetch,
} from '@/lib/api';
import WhatsAppTestSend from './WhatsAppTestSend';
import CreateWhatsAppTemplate from './CreateWhatsAppTemplate';
import SmsTestSend from './SmsTestSend';
import RcsTestSend from './RcsTestSend';
import { Eye, X, Mail, MessageCircle, Smartphone, Bell, Plus, Upload, Edit2, Trash2, Sparkles, Send, Search, Info, RefreshCw, Monitor, Tablet, LayoutGrid, List, Check } from 'lucide-react';
import hotToast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input, Select, Field } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { Chip, StatusChip, type ChipTone } from '@/components/ui/Chip';
import { Tabs } from '@/components/ui/Tabs';
import { Table } from '@/components/ui/Table';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import type { QueryParams } from '@/types/api';
import type { ContentTemplate, TestSendRecipient, InboxPlacement, QaReportData, QaReportState, TemplatePreviewState, PreviewFit } from '@/types/f4Content';
import styles from './content.module.css';

interface DynVar { key: string; value: string }
interface SendOptions { emails?: string[]; mode?: string }
interface QaSectionProps { title: string; items: string[]; okText: string; danger?: boolean }
type ChannelKey = 'all' | 'email' | 'whatsapp' | 'sms' | 'push';
type ToolKey = 'email' | 'whatsapp' | 'sms' | 'rcs';
type Device = 'desktop' | 'tablet' | 'mobile';

const STATUS_META: Record<string, { label: string; tone: ChipTone } | undefined> = {
  draft: { label: 'Draft', tone: 'mute' },
  pending_approval: { label: 'Waiting for approval', tone: 'gold' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'bad' },
};
const statusMeta = (s: string | undefined) => STATUS_META[s || ''] || { label: s || 'Unknown', tone: 'mute' as ChipTone };

const CHANNELS = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'sms', label: 'SMS', icon: Smartphone },
  { key: 'push', label: 'Push', icon: Bell },
] as const;
const CHANNEL_LABEL: Record<string, string | undefined> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', push: 'Push' };
const CHANNEL_ICON: Record<string, typeof Mail | undefined> = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, push: Bell };
const channelLabel = (c: string | undefined) => CHANNEL_LABEL[c || ''] || c || 'Unknown';

const BLANK_FORM = { name: '', channel: 'email', subject: '', body: '', fileName: '' };

// Fixed QA test inbox — the "Test Send" button always targets this address
// (this is the IMAP inbox the real spam-placement check reads from).
const ROCKY_EMAIL = 'rocky.86agency@gmail.com';

const SYSTEM_VARS = new Set(['first_name', 'full_name', 'email', 'phone', 'country', 'city', 'company', 'segment', 'unsubscribe_link', 'utm_link',
  'product_affinity_1', 'product_affinity_2', 'product_affinity_3', 'service_affinity_1', 'service_affinity_2', 'service_affinity_3']);

const PREVIEW_SAMPLE: Record<string, string> = {
  USER_NAME: 'Avinash Kumar', USER_FIRST_NAME: 'Avinash', USER_EMAIL: 'avinash@example.com',
  USER_PHONE: '+971 50 123 4567', USER_CITY: 'Dubai', USER_COUNTRY: 'United Arab Emirates',
  IS_INDIAN_USER: 'No', IS_LOCAL_USER: 'Yes', BOOKING_STATUS: 'PROSPECT', PRODUCT_TIER: 'LUXURY',
  CUSTOMER_SEGMENT: 'High Intent', RID: '641500',
  PAGE_URL: 'https://www.raynatours.com/singapore/night-safari-singapore-e-4683',
  ITEM_URL: 'https://www.raynatours.com/singapore/night-safari-singapore-e-4683',
  PAGE_TITLE: 'Night Safari Singapore', EVENT_TIMESTAMP: '6/14/2026, 3:49 PM',
  EVENT_NAME: 'view_item', EVENT_ID: '151774', JOURNEY_ID: '184', NODE_ID: 'node_1',
  ITEM_NAME: 'Night Safari Singapore', ITEM_ID: '4683',
  ITEM_IMAGE_URL: 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/4683.jpg',
  ITEM_CATEGORY: 'tours', ITEM_REFERRER: 'https://www.raynatours.com/singapore',
  CURRENCY: 'INR', DESTINATION_CITY: 'Singapore', COUPON_CODE: 'RAYNA10',
  PAYMENT_METHOD: 'Card', ORDER_ID: 'TXN-90817', TAX_AMOUNT: '120', CONTENT_TYPE: 'product',
  CLICK_LOCATION: 'header', SHARE_METHOD: 'whatsapp', EMAIL_CLICKED: 'avinash@example.com',
  PHONE_CLICKED: '+971501234567', WHATSAPP_NUMBER_CLICKED: '+971501234567', FORM_NAME: 'Enquiry',
  LEAD_SOURCE: 'website', LEAD_TYPE: 'visa', LEAD_VALUE: '5000', PRODUCT_CONTEXT: 'Singapore Tours',
  PRODUCT_INTEREST: 'Wildlife', ERROR_CODE: 'E102', ERROR_MESSAGE: 'Payment declined',
  UTM_CAMPAIGN: 'summer_sale', UTM_SOURCE: 'google',
  ADULT_COUNT: '2', CHILD_COUNT: '1', BOOKING_DATE: '20 Jun 2026', SELECTED_DATE: '25 Jun 2026',
  ITEM_PRICE: '1,299', CART_VALUE: '1,299', ORDER_TOTAL: '1,419', ORDER_VALUE: '1,299',
  ATTEMPTED_AMOUNT: '1,419',
  CART_URL: 'https://www.raynatours.com/cart', WISHLIST_URL: 'https://www.raynatours.com/wishlist',
  RESUME_CHECKOUT_URL: 'https://www.raynatours.com/checkout',
  RESUME_PAYMENT_URL: 'https://www.raynatours.com/checkout',
  RETRY_PAYMENT_URL: 'https://www.raynatours.com/payment/retry?order=TXN-90817',
  VIEW_BOOKING_URL: 'https://www.raynatours.com/booking/TXN-90817',
  RAW_PAYLOAD: '{ "itemName": "Night Safari Singapore", "itemId": 4683 }',
  // Booking affinity — the contact's top booked products / business lines
  PRODUCT_AFFINITY_1: 'Desert Safari', PRODUCT_AFFINITY_2: 'Burj Khalifa', PRODUCT_AFFINITY_3: 'Dhow Cruise',
  SERVICE_AFFINITY_1: 'Tours', SERVICE_AFFINITY_2: 'Visas', SERVICE_AFFINITY_3: 'Packages',
};
// Legacy lowercase keys → canonical (matches backend placeholderResolver aliases)
const PREVIEW_ALIASES: Record<string, string | undefined> = {
  customer_name: 'USER_FIRST_NAME', user_name: 'USER_NAME', item_name: 'ITEM_NAME',
  item_image: 'ITEM_IMAGE_URL', cta_url: 'ITEM_URL', event_name: 'EVENT_NAME',
  event_id: 'EVENT_ID', event_time: 'EVENT_TIMESTAMP', page_url: 'PAGE_URL', raw_payload: 'RAW_PAYLOAD',
};
// Fill {{KEY}} with sample values for the live preview (unknown keys → highlighted chip).
const fillPreviewHtml = (html: string) => String(html || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m: string, raw: string) => {
  const key = PREVIEW_ALIASES[raw] || PREVIEW_ALIASES[raw.toLowerCase()] || raw.toUpperCase();
  if (key in PREVIEW_SAMPLE) return PREVIEW_SAMPLE[key];
  return `<span style="background:#fde68a;color:#92400e;padding:0 3px;border-radius:3px;font-size:11px">{{${raw}}}</span>`;
});

const stripHtml = (html: string | null | undefined) => {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

function extractVars(html: string): DynVar[] {
  const matches = [...html.matchAll(/\{\{(\w+)\}\}/g)];
  const unique = [...new Set(matches.map(m => m[1]))];
  return unique.map(key => ({ key, value: '' }));
}

// Inject a viewport meta so responsive emails reflow at the iframe width.
function withViewport(raw: string): string {
  const VP = '<meta name="viewport" content="width=device-width, initial-scale=1">';
  if (/name=["']viewport["']/i.test(raw)) return raw;
  return /<head[^>]*>/i.test(raw) ? raw.replace(/<head[^>]*>/i, m => `${m}${VP}`) : `${VP}${raw}`;
}

const formatDate = (iso: string | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const toInt = (v: string | number | undefined): number => {
  const n = typeof v === 'number' ? v : parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const tsGet = (path: string) => authFetch(`${apiBase}${path}`, { credentials: 'include' })
  .then(r => r.json() as Promise<{ data?: unknown }>)
  .then(d => d.data || d); // unwrap { data: ... } envelope

function QaSection({ title, items, okText, danger }: QaSectionProps) {
  return (
    <div className={styles.qaSection}>
      <div className={styles.eyebrow} style={{ marginBottom: 8 }}>{title}</div>
      {items.length === 0 ? (
        <div className={styles.qaOk}>✓ {okText}</div>
      ) : (
        <ul>{items.map((it, i) => <li key={i} className={danger ? styles.qaBad : undefined}>{it}</li>)}</ul>
      )}
    </div>
  );
}

function Modal({ label, onClose, className, children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={[styles.dialog, className ?? ''].join(' ')} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export default function Content() {
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [preview, setPreview] = useState<TemplatePreviewState | null>(null);
  const [previewDevice, setPreviewDevice] = useState<Device>('desktop');
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const [previewFit, setPreviewFit] = useState<PreviewFit>({ scale: 1, height: null });

  // Measure the email's rendered width and scale the iframe to fit the device frame
  // (Gmail-style "fit to width") so fixed-width emails don't horizontal-scroll on mobile.
  const fitPreview = useCallback(() => {
    const ifr = previewIframeRef.current;
    if (!ifr) return;
    if (previewDevice === 'desktop') { setPreviewFit({ scale: 1, height: null, contentW: null }); return; }
    const frameW = previewDevice === 'mobile' ? 390 : 768;
    try {
      const doc = ifr.contentWindow?.document;
      if (!doc) return;
      const contentW = Math.max(doc.body?.scrollWidth || 0, doc.documentElement?.scrollWidth || 0, frameW);
      const contentH = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0);
      const scale = contentW > frameW ? frameW / contentW : 1;
      setPreviewFit(prev => {
        // Avoid an infinite re-measure loop once it has converged
        if (prev.contentW === contentW && Math.abs((prev.contentH || 0) - contentH) < 4) return prev;
        return { scale, contentW, contentH, height: contentH ? contentH * scale : null };
      });
    } catch { setPreviewFit({ scale: 1, height: null, contentW: null }); }
  }, [previewDevice]);

  // Re-measure when the device toggle changes (iframe already loaded)
  useEffect(() => { fitPreview(); }, [fitPreview]);

  const [channelFilter, setChannelFilter] = useState<ChannelKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'card';
    return window.localStorage.getItem('content.viewMode') === 'table' ? 'table' : 'card';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('content.viewMode', viewMode);
  }, [viewMode]);
  const [toolTab, setToolTab] = useState<ToolKey>('email');

  // editor state: null = library, 'create' = new, object = editing existing
  const [modal, setModal] = useState<'create' | ContentTemplate | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [dynVars, setDynVars] = useState<DynVar[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ContentTemplate | null>(null);
  const [liveDevice, setLiveDevice] = useState<'desktop' | 'mobile'>('desktop');

  // Approval review side panel
  const [review, setReview] = useState<{ template: ContentTemplate; html: string | null; loading: boolean } | null>(null);
  const [reviewBusy, setReviewBusy] = useState<'approve' | 'reject' | null>(null);

  // Editor live preview — debounced server render so what you see in the
  // preview pane matches what EmailRenderer will actually send. Falls back to
  // the raw HTML (with client-side fill) while the server is still rendering
  // or if the request fails.
  const [livePreviewHtml, setLivePreviewHtml] = useState('');
  const [livePreviewLoading, setLivePreviewLoading] = useState(false);
  useEffect(() => {
    if (!form.body) { setLivePreviewHtml(''); return; }
    const t = setTimeout(async () => {
      setLivePreviewLoading(true);
      try {
        const res = await renderPreviewHtml(form.body, { engine: 'liquid' }) as { data?: { html?: string } } | null;
        setLivePreviewHtml(res?.data?.html || '');
      } catch {
        setLivePreviewHtml(''); // fall back to client-side fillPreviewHtml below
      } finally {
        setLivePreviewLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [form.body]);

  // ── Global recipients (shared by all card Test Send buttons) ──
  const [recipients, setRecipients] = useState<TestSendRecipient[]>([]);
  const [recipQuery, setRecipQuery] = useState('');
  const [recipTotal, setRecipTotal] = useState(0);
  const [recipLoading, setRecipLoading] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [sendingDay, setSendingDay] = useState<number | null>(null);       // templateId currently sending
  const [sendingMode, setSendingMode] = useState<string | null>(null);     // 'rocky' | 'selected'
  const [flowStats, setFlowStats] = useState({ sent: 0, opened: 0, clicked: 0, utm: 0, failed: 0 });

  // ── Post-send QA report ──
  const [qaReport, setQaReport] = useState<QaReportState | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [placement, setPlacement] = useState<InboxPlacement | null>(null);
  const [placementLoading, setPlacementLoading] = useState(false);

  async function checkPlacement() {
    const subject = qaReport?.report?.subject || '';
    const tid = qaReport?.template.id;
    if (tid === undefined) return;
    setPlacementLoading(true); setPlacement(null);
    try {
      const res = await checkInboxPlacement(subject, tid) as { data?: InboxPlacement } | null;
      setPlacement(res?.data || { available: false, error: 'No response' });
    } catch (e) {
      setPlacement({ available: false, error: (e as Error).message });
    } finally { setPlacementLoading(false); }
  }

  // View the STORED report for a template (no re-send)
  async function viewStoredReport(tpl: ContentTemplate) {
    setQaReport({ template: tpl, report: null });
    setPlacement(null);
    setQaLoading(true);
    try {
      const res = await getStoredQaReport(tpl.id) as { data?: QaReportData } | null;
      if (!res?.data) {
        setQaReport({ template: tpl, report: { error: 'No report yet — run a Test Send first to generate one.' } });
      } else {
        setQaReport({ template: tpl, report: res.data });
        if (res.data.placement) setPlacement(res.data.placement);
      }
    } catch (e) {
      setQaReport({ template: tpl, report: { error: (e as Error).message } });
    } finally { setQaLoading(false); }
  }

  // Load contacts (debounced on query)
  useEffect(() => {
    const t = setTimeout(async () => {
      setRecipLoading(true);
      try {
        const qs = new URLSearchParams({ limit: '50', offset: '0' });
        if (recipQuery.trim().length >= 2) qs.set('q', recipQuery.trim());
        const res = await tsGet(`/api/v3/test-sends/contacts?${qs}`) as { contacts?: TestSendRecipient[]; total?: number };
        setRecipients(res.contacts || []);
        setRecipTotal(res.total || 0);
      } catch { /* ignore */ }
      setRecipLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [recipQuery]);

  // Load tracking flow stats
  useEffect(() => {
    (async () => {
      try {
        const [summary, utmLog] = await Promise.all([
          tsGet('/api/v3/test-sends/send-log/summary'),
          tsGet('/api/v3/test-sends/utm-log?limit=1'),
        ]) as [{ byStatus?: { status: string; count?: string }[] } | null, { total?: number } | null];
        const byStatus = summary?.byStatus || [];
        const g = (s: string) => toInt(byStatus.find(r => r.status === s)?.count);
        setFlowStats({
          sent: g('sent') + g('opened') + g('clicked'),
          opened: g('opened') + g('clicked'),
          clicked: g('clicked'),
          failed: g('failed'),
          utm: toInt(utmLog?.total),
        });
      } catch { /* ignore */ }
    })();
  }, []);

  const toggleRecipient = (email: string) => {
    setSelectedEmails(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]);
  };

  // Shared QA flow after a send: content report, then real IMAP inbox placement.
  async function runQaAfterSend(tpl: ContentTemplate) {
    setQaReport({ template: tpl, report: null });
    setPlacement(null);
    setQaLoading(true);
    // 1. Content report (grammar / missing / urls / heuristic)
    let report: QaReportData | null = null;
    try {
      const res = await analyzeTestEmail(tpl.id) as { data?: QaReportData } | null;
      report = res?.data || null;
    } catch (e) {
      report = { error: (e as Error).message };
    }
    const subject = report?.subject || '';
    // 2. Real spam placement via IMAP — retry while Gmail delivers (~15-40s)
    let placementResult: InboxPlacement | null = null;
    for (let attempt = 1; attempt <= 4 && !report?.error; attempt++) {
      await new Promise(r => setTimeout(r, attempt === 1 ? 15000 : 12000));
      try {
        const res = await checkInboxPlacement(subject, tpl.id) as { data?: InboxPlacement } | null;
        const p = res?.data;
        if (p?.available && p.placement !== 'not_found') { placementResult = p; break; }
        placementResult = p || { available: false, error: 'Not found after retries' };
      } catch (e) {
        placementResult = { available: false, error: (e as Error).message };
      }
    }
    // 3. Reveal the complete report at once
    setPlacement(placementResult);
    setQaReport({ template: tpl, report });
    setQaLoading(false);
  }

  // Day 1-7 email templates (id == day number) → AI test-day send.
  async function handleCardTestSend(tpl: ContentTemplate, { emails, mode }: SendOptions = {}) {
    const to = emails && emails.length ? emails : selectedEmails;
    if (to.length === 0) return;
    setSendingDay(tpl.id);
    setSendingMode(mode || 'selected');
    try {
      const data = await sendTestDay(tpl.id, to) as { sent?: number } | null;
      hotToast.success(`Sent ${tpl.name} to ${data?.sent ?? to.length} recipient(s)`);
      await runQaAfterSend(tpl);
    } catch (err) {
      hotToast.error((err as Error).message || 'Send failed');
    } finally { setSendingDay(null); setSendingMode(null); }
  }

  // Non-Day approved email templates (e.g. weekly broadcasts) → generic send-template.
  async function handleGenericSend(tpl: ContentTemplate, { emails, mode }: SendOptions = {}) {
    const to = emails && emails.length ? emails : selectedEmails;
    if (to.length === 0) return;
    setSendingDay(tpl.id);
    setSendingMode(mode || 'selected');
    try {
      const res = await sendTemplate(tpl.id, to) as { data?: { sent?: number } } | null;
      hotToast.success(`Sent "${tpl.name}" to ${res?.data?.sent ?? to.length} recipient(s)`);
      await runQaAfterSend(tpl);
    } catch (err) {
      hotToast.error((err as Error).message || 'Send failed');
      setQaLoading(false);
    } finally { setSendingDay(null); setSendingMode(null); }
  }

  // Server-side pagination + channel + search filter, debounced 300 ms.
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const params: QueryParams = { page, limit: pageSize };
      if (channelFilter !== 'all') params.channel = channelFilter;
      const q = searchQuery.trim();
      if (q) params.search = q;
      (getTemplates(params) as Promise<{ data?: ContentTemplate[]; total?: number }>)
        .then(res => {
          setTemplates(res?.data || []);
          setTotal(toInt(res?.total ?? (res?.data?.length || 0)));
          setLoadError(null);
        })
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Request failed'))
        .finally(() => { setLoading(false); setLoaded(true); });
    }, 300);
    return () => clearTimeout(t);
  }, [page, pageSize, channelFilter, searchQuery, reloadKey]);

  // Reset to page 1 whenever the page-size, channel filter, or search changes.
  useEffect(() => { setPage(1); }, [pageSize, channelFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function openPreview(tpl: ContentTemplate) {
    setPreviewDevice('desktop');
    setPreview({ template: tpl, html: null, loading: true });
    try {
      const res = await previewTemplate(tpl.id) as { data?: { html?: string } } | null;
      setPreview({ template: tpl, html: res?.data?.html || '', loading: false });
    } catch (err) {
      setPreview({ template: tpl, html: `<pre style="padding:20px;color:#b42318">${(err as Error).message || 'Preview failed'}</pre>`, loading: false });
    }
  }

  // AI preview — renders the real Claude-ranked version (slow, ~15-25s first call)
  async function openPreviewAI(tpl: ContentTemplate) {
    setPreviewDevice('desktop');
    setPreview({ template: tpl, html: null, loading: true, ai: true });
    try {
      const res = await previewTemplateAI(tpl.id) as { data?: { html?: string } } | null;
      setPreview({ template: tpl, html: res?.data?.html || '', loading: false, ai: true });
    } catch (err) {
      setPreview({ template: tpl, html: `<pre style="padding:20px;color:#b42318">${(err as Error).message || 'AI preview failed'}</pre>`, loading: false, ai: true });
    }
  }

  async function openReview(tpl: ContentTemplate) {
    setReview({ template: tpl, html: null, loading: tpl.channel === 'email' });
    if (tpl.channel !== 'email') return;
    try {
      const res = await previewTemplate(tpl.id) as { data?: { html?: string } } | null;
      setReview(r => r && r.template.id === tpl.id ? { ...r, html: res?.data?.html || '', loading: false } : r);
    } catch {
      setReview(r => r && r.template.id === tpl.id ? { ...r, html: '', loading: false } : r);
    }
  }

  async function decide(kind: 'approve' | 'reject') {
    if (!review) return;
    const tpl = review.template;
    setReviewBusy(kind);
    try {
      const res = await (kind === 'approve' ? approveTemplate(tpl.id) : rejectTemplate(tpl.id)) as { data?: ContentTemplate } | null;
      const status = kind === 'approve' ? 'approved' : 'rejected';
      setTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, ...(res?.data || {}), status: res?.data?.status || status } : t));
      hotToast.success(kind === 'approve' ? 'Template approved' : 'Template rejected');
      setReview(null);
    } catch (err) {
      hotToast.error((err as Error).message || (kind === 'approve' ? 'Failed to approve' : 'Failed to reject'));
    } finally { setReviewBusy(null); }
  }

  function openCreate() {
    setForm({ ...BLANK_FORM });
    setDynVars([]);
    setLiveDevice('desktop');
    setModal('create');
  }

  async function openEdit(tpl: ContentTemplate) {
    // Open immediately with whatever the list row has, then fetch the full record
    // (source html_body with Liquid tags intact). Falls back to the server-rendered preview.
    setForm({
      name: tpl.name || '',
      channel: tpl.channel || 'email',
      subject: tpl.subject || '',
      body: tpl.body || '',
      fileName: tpl.body ? 'existing-template.html' : '',
    });
    setDynVars(extractVars(tpl.body || ''));
    setLiveDevice('desktop');
    setModal(tpl);

    try {
      const res = await getTemplate(tpl.id) as ({ data?: ContentTemplate } & Partial<ContentTemplate>) | null;
      const full = res?.data || res;
      const sourceHtml = full?.body || full?.html_body || '';
      if (sourceHtml) {
        setForm(f => ({ ...f, body: sourceHtml, fileName: 'existing-template.html' }));
        setDynVars(extractVars(sourceHtml));
        return;
      }
    } catch { /* fall through to preview-rendered HTML */ }

    if (!tpl.body) {
      try {
        const res = await previewTemplate(tpl.id) as { data?: { html?: string } } | null;
        const html = res?.data?.html || '';
        if (html) {
          setForm(f => ({ ...f, body: html, fileName: 'existing-template.html' }));
          setDynVars(extractVars(html));
        }
      } catch { /* leave editor empty if render fails */ }
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const html = String(ev.target?.result ?? '');
      setForm(f => ({ ...f, body: html, fileName: file.name }));
      setDynVars(extractVars(html));
    };
    reader.readAsText(file);
  }

  async function confirmAndDelete() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setDeleting(id);
    setConfirmDelete(null);
    try {
      await deleteTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      setTotal(t => Math.max(0, t - 1));
      hotToast.success('Template deleted');
    } catch (err) {
      hotToast.error((err as Error).message || 'Failed to delete template');
    } finally {
      setDeleting(null);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) { hotToast.error('Template name is required'); return; }
    if (!form.body.trim()) { hotToast.error('Please upload an HTML file'); return; }
    if (modal === null) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        channel: form.channel,
        subject: form.subject.trim() || null,
        body: form.body,
        bodyPlain: stripHtml(form.body),
        variables: dynVars.map(v => v.key),
      };

      if (modal === 'create') {
        const res = await createTemplate(payload) as { data: ContentTemplate };
        setTemplates(prev => [res.data, ...prev]);
        setTotal(t => t + 1);
        hotToast.success('Template created');
      } else {
        const id = modal.id;
        const res = await updateTemplate(id, payload) as { data: ContentTemplate };
        setTemplates(prev => prev.map(t => t.id === id ? res.data : t));
        hotToast.success('Template updated');
      }
      setModal(null);
    } catch (err) {
      hotToast.error((err as Error).message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  const closeQa = useCallback(() => setQaReport(null), []);
  const closePreview = useCallback(() => setPreview(null), []);
  const cancelDelete = useCallback(() => setConfirmDelete(null), []);

  const filtered = templates;
  const pending = templates.filter(t => t.status === 'pending_approval');
  const firstLoad = !loaded;
  const hasFilter = !!searchQuery.trim() || channelFilter !== 'all';
  const showingFrom = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = (page - 1) * pageSize + filtered.length;

  // ── Shared modals (rendered in both library and editor) ──
  const modals = (
    <>
      <ConfirmDialog
        open={confirmDelete !== null}
        danger
        title="Delete template"
        description={confirmDelete ? <p>Delete <b>{confirmDelete.name}</b>? This can’t be undone.</p> : undefined}
        confirmLabel="Delete"
        onConfirm={confirmAndDelete}
        onCancel={cancelDelete}
      />

      {qaReport && (
        <Modal label="Email QA report" onClose={closeQa}>
          <div className={styles.dialogHead}>
            <div>
              <h2>Email QA report</h2>
              <div className={styles.help}>
                {qaReport.template.name}
                {qaReport.report?.generatedAt ? ` — stored ${new Date(qaReport.report.generatedAt).toLocaleString()}` : ' — analyzed'}
              </div>
            </div>
            <Button variant="ghost" size="sm" icon aria-label="Close QA report" onClick={closeQa}><X size={16} /></Button>
          </div>
          <div className={styles.dialogBody}>
            {qaLoading ? (
              <div className={styles.loadingBlock} role="status">
                <Sparkles size={24} aria-hidden="true" />
                <div style={{ fontWeight: 600, marginTop: 8 }}>Generating report…</div>
                <div className={styles.help}>Grammar · content · URLs · delivering & checking real inbox placement (~30-50s)</div>
              </div>
            ) : qaReport.report?.error ? (
              <div className={styles.errorBox} role="alert">Analysis failed: {qaReport.report.error}</div>
            ) : qaReport.report ? (() => {
              const r = qaReport.report;
              const sr: NonNullable<QaReportData['spamRisk']> = r.spamRisk || {};
              const srTone: ChipTone = sr.level === 'High' ? 'bad' : sr.level === 'Medium' ? 'warn' : 'ok';
              const known = placement?.available && placement.placement !== 'not_found';
              const isInbox = placement?.placement === 'inbox';
              return (
                <div>
                  <div className={[styles.qaBox, known ? (isInbox ? styles.qaBoxOk : styles.qaBoxBad) : ''].join(' ')}>
                    <div className={styles.eyebrow} style={{ marginBottom: 6 }}>Spam check (real — QA inbox)</div>
                    {placementLoading && !known ? (
                      <div className={styles.row} role="status"><RefreshCw size={14} className={styles.spin} aria-hidden="true" /> Delivering & checking the QA Gmail… (~15-40s)</div>
                    ) : known ? (
                      <div>
                        <div className={styles.qaVerdict} style={{ color: isInbox ? 'var(--ok)' : 'var(--bad)' }}>{isInbox ? 'Inbox — not spam' : 'Spam'}</div>
                        <div className={styles.help}>Verified in {ROCKY_EMAIL} via IMAP{placement?.foundAt ? ` · ${new Date(placement.foundAt).toLocaleString()}` : ''}</div>
                      </div>
                    ) : (
                      <div>
                        <div className={styles.note}>{placement?.error ? `⚠ ${placement.error}` : (placement?.note || 'Not found yet in the inbox.')}</div>
                        <Button size="sm" onClick={checkPlacement} disabled={placementLoading} style={{ marginTop: 8 }}>
                          <Search size={14} aria-hidden="true" /> {placementLoading ? 'Checking…' : 'Re-check now'}
                        </Button>
                      </div>
                    )}
                    {sr.level && (
                      <div className={styles.qaHint}>
                        Quick heuristic: <Chip tone={srTone}>{sr.level} risk</Chip>{sr.reasons?.length ? ` — ${sr.reasons.slice(0, 2).join('; ')}` : ''}
                      </div>
                    )}
                  </div>
                  <QaSection title="Grammar" items={r.grammar || []} okText="No grammar issues found" />
                  <QaSection title="Missing content" items={r.missingContent || []} okText="No missing content" danger />
                  <div className={styles.qaSection}>
                    <div className={styles.eyebrow} style={{ marginBottom: 8 }}>URLs ({toInt(r.urls?.total)} found, {toInt(r.urls?.broken)} broken)</div>
                    {(r.urls?.results || []).length === 0 ? (
                      <div className={styles.note}>No links</div>
                    ) : (
                      <div className={styles.urlList}>
                        {(r.urls?.results || []).map((u, i) => (
                          <div key={i} className={styles.urlRow}>
                            <Chip tone={u.ok ? 'ok' : 'bad'}>{u.ok ? '✓' : '✗'} {u.status ?? u.error ?? ''}</Chip>
                            <span>{u.url}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <QaSection title="Other errors" items={r.errors || []} okText="No other issues" danger />
                  {r.analysisSource && <div className={styles.help}>Content analysis: {r.analysisSource === 'claude' ? 'Claude AI' : r.analysisSource}</div>}
                </div>
              );
            })() : null}
          </div>
        </Modal>
      )}

      {preview && (
        <Modal label={`Preview of ${preview.template.name || 'template'}`} onClose={closePreview}
          className={previewDevice === 'tablet' ? styles.dialogTablet : styles.dialogWide}>
          <div className={styles.dialogHead}>
            <div>
              <h2>{preview.template.name}{preview.ai && <Chip tone="gold"><Sparkles size={12} aria-hidden="true" /> AI</Chip>}</h2>
              <div className={styles.help}>
                {channelLabel(preview.template.channel)} · {preview.template.segment_label || 'ALL'} · {statusMeta(preview.template.status).label}
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.seg} role="group" aria-label="Device">
                {([
                  { key: 'desktop', icon: Monitor, label: 'Desktop' },
                  { key: 'tablet', icon: Tablet, label: 'Tablet' },
                  { key: 'mobile', icon: Smartphone, label: 'Mobile' },
                ] as const).map(d => {
                  const DIcon = d.icon;
                  return (
                    <button key={d.key} type="button" className={styles.segBtn} aria-pressed={previewDevice === d.key}
                      onClick={() => setPreviewDevice(d.key)} title={d.label} aria-label={d.label}>
                      <DIcon size={15} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <Button variant="ghost" size="sm" icon aria-label="Close preview" onClick={closePreview}><X size={16} /></Button>
            </div>
          </div>
          <div className={[styles.previewBody, previewDevice === 'desktop' ? styles.previewBodyDesktop : ''].join(' ')}>
            {preview.loading ? (
              <div className={styles.previewMsg} role="status">
                {preview.ai ? 'Generating AI preview with Claude… (~15-25s)' : 'Rendering preview…'}
              </div>
            ) : (() => {
              const frameW = previewDevice === 'mobile' ? 390 : 768;
              const html = withViewport(preview.html || '');
              if (previewDevice === 'desktop') {
                return (
                  <iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" ref={previewIframeRef} srcDoc={html} onLoad={fitPreview}
                    style={{ width: '100%', height: '70vh', border: 0, background: '#fff' }}
                    title={preview.template.name} />
                );
              }
              // Render the iframe at the email's NATURAL content width, then scale it
              // down to fit the device frame — Gmail-style "fit to width".
              const contentW = previewFit.contentW || frameW;
              const scale = contentW > frameW ? frameW / contentW : 1;
              const innerH = previewFit.contentH || Math.round((window.innerHeight * 0.7) / scale);
              return (
                <div className={styles.deviceFrame} style={{ width: frameW, height: previewFit.height || '70vh' }}>
                  <iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" ref={previewIframeRef} srcDoc={html} onLoad={fitPreview}
                    style={{ width: contentW, height: innerH, border: 0, background: '#fff', transform: `scale(${scale})`, transformOrigin: 'top left' }}
                    title={preview.template.name} />
                </div>
              );
            })()}
          </div>
        </Modal>
      )}
    </>
  );

  // ─────────────────────────── Editor view ───────────────────────────
  if (modal !== null) {
    const isCreate = modal === 'create';
    const title = isCreate ? 'New template' : (form.name || modal.name || 'Template');
    const st = isCreate ? null : statusMeta(modal.status);
    const customVars = dynVars.filter(v => !SYSTEM_VARS.has(v.key));
    const subjectLen = form.subject.length;
    const leave = () => { if (!saving) setModal(null); };
    return (
      <div className={styles.page}>
        <PageHeader
          title={title}
          breadcrumbs={[{ label: 'Messaging' }, { label: 'Templates', href: '/content' }, { label: isCreate ? 'Create' : 'Edit' }]}
          meta={(
            <div className={styles.row}>
              <Chip>{channelLabel(form.channel)}</Chip>
              {st && <StatusChip tone={st.tone}>{st.label}</StatusChip>}
              <Chip>Liquid personalisation</Chip>
              {!isCreate && modal.updated_at && <span className={styles.help}>Updated {formatDate(modal.updated_at)}</span>}
            </div>
          )}
          actions={(
            <>
              <Button onClick={leave} disabled={saving}>Back to templates</Button>
              {!isCreate && <Button onClick={() => openPreview(modal)}><Eye size={16} aria-hidden="true" /> Preview</Button>}
              {!isCreate && modal.channel === 'email' && (
                <Button onClick={() => viewStoredReport(modal)} title="View email QA report"><Info size={16} aria-hidden="true" /> QA report</Button>
              )}
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : isCreate ? 'Create Template' : 'Save Changes'}
              </Button>
            </>
          )}
        />
        <div className={styles.editorGrid}>
          <Card aria-label="Message settings" className={styles.panel}>
            <Field label="Template name" required>
              {p => <Input {...p} placeholder="e.g. Summer Sale Announcement" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />}
            </Field>
            <div className="ui-field">
              <span className="ui-label" id="tpl-channel-label">Channel</span>
              <div className={styles.chanPick} role="group" aria-labelledby="tpl-channel-label">
                {CHANNELS.map(ch => {
                  const Icon = ch.icon;
                  return (
                    <button key={ch.key} type="button" className={styles.chanBtn} aria-pressed={form.channel === ch.key}
                      onClick={() => setForm(f => ({ ...f, channel: ch.key }))}>
                      <Icon size={13} aria-hidden="true" /> {ch.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {form.channel === 'email' && (
              <Field label="Subject line" help={`${subjectLen} / 60 characters`}>
                {p => <Input {...p} placeholder="e.g. Your Exclusive Offer Awaits" value={form.subject}
                  onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />}
              </Field>
            )}
            <div className="ui-field">
              <span className="ui-label">Personal fields</span>
              {customVars.length > 0 ? (
                <div className={styles.varList} aria-label="Custom variables">
                  {customVars.map(v => <span key={v.key} className={[styles.mono, styles.varChip].join(' ')}>{`{{${v.key}}}`}</span>)}
                </div>
              ) : (
                <span className={styles.help}>{dynVars.length > 0 ? 'Only standard contact fields are used.' : 'No {{FIELD}} placeholders detected yet.'}</span>
              )}
              {dynVars.length > 0 && <span className={styles.help}>{dynVars.length} placeholder{dynVars.length === 1 ? '' : 's'} detected in the HTML.</span>}
            </div>
          </Card>

          <Card aria-label="Content editor" className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.label}>HTML template <span aria-hidden="true">*</span></span>
              <label className={styles.upload}>
                <Upload size={14} aria-hidden="true" /> Upload .html
                <input type="file" accept=".html,.htm,text/html" onChange={handleFileChange} aria-label="Upload HTML file" />
              </label>
            </div>
            <textarea
              className={styles.code}
              aria-label="HTML source"
              value={form.body}
              onChange={e => {
                const html = e.target.value;
                setForm(f => ({ ...f, body: html, fileName: html.trim() ? (f.fileName || 'inline-template.html') : '' }));
                setDynVars(extractVars(html));
              }}
              spellCheck={false}
              placeholder="<html>…</html> — edit directly. Use {{KEY}} placeholders (e.g. {{USER_NAME}}, {{ITEM_NAME}})."
            />
            <span className={styles.help}>
              {form.fileName ? `Source: ${form.fileName}. ` : ''}Liquid tags like if / case are rendered by the server for the preview, exactly as they will be sent.
            </span>
          </Card>

          <Card aria-label="Preview" className={styles.panel}>
            <div className={styles.panelHead}>
              <div className={styles.seg} role="group" aria-label="Preview device">
                <button type="button" className={styles.segBtn} aria-pressed={liveDevice === 'desktop'} onClick={() => setLiveDevice('desktop')}>
                  <Monitor size={14} aria-hidden="true" /> Desktop
                </button>
                <button type="button" className={styles.segBtn} aria-pressed={liveDevice === 'mobile'} onClick={() => setLiveDevice('mobile')}>
                  <Smartphone size={14} aria-hidden="true" /> Mobile
                </button>
              </div>
              <span className={styles.help}>Sample data</span>
            </div>
            <div className={styles.liveWrap}>
              <iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                title="template-preview"
                className={[styles.liveIframe, liveDevice === 'mobile' ? styles.liveMobile : ''].join(' ')}
                srcDoc={
                  form.body
                    ? (livePreviewHtml || fillPreviewHtml(form.body))
                    : '<div style="font-family:sans-serif;color:#9ca3af;padding:16px;font-size:13px">Preview appears here as you type…</div>'
                }
              />
            </div>
            <div className={styles.row}>
              {!form.body ? <Chip>Nothing to render yet</Chip>
                : livePreviewLoading ? <Chip tone="info"><RefreshCw size={12} className={styles.spin} aria-hidden="true" /> Rendering…</Chip>
                  : livePreviewHtml ? <Chip tone="ok">Rendered by the server</Chip>
                    : <Chip tone="warn">Local sample fill</Chip>}
            </div>
          </Card>
        </div>

        {modals}
      </div>
    );
  }

  // ─────────────────────────── Library view ───────────────────────────
  const renderSendButtons = (t: ContentTemplate) => {
    const isDay = t.id >= 1 && t.id <= 7 && t.channel === 'email';
    const isGeneric = !isDay && t.channel === 'email' && t.status === 'approved';
    if (!isDay && !isGeneric) return null;
    const send = isDay ? handleCardTestSend : handleGenericSend;
    const noRecipients = selectedEmails.length === 0;
    const isSending = sendingDay === t.id;
    const rockySending = isSending && sendingMode === 'rocky';
    const selSending = isSending && sendingMode === 'selected';
    return (
      <div>
        <Button size="sm" onClick={() => send(t, { emails: [ROCKY_EMAIL], mode: 'rocky' })} disabled={isSending}
          title={`Send a QA test to ${ROCKY_EMAIL}`}>
          <Send size={14} aria-hidden="true" /> {rockySending ? 'Sending…' : 'Test Send'}
        </Button>
        <Button size="sm" onClick={() => send(t, { emails: selectedEmails, mode: 'selected' })} disabled={noRecipients || isSending}
          title={noRecipients ? 'Select recipients in Testing tools first' : `Send to ${selectedEmails.length} selected`}>
          <Send size={14} aria-hidden="true" /> {selSending ? 'Sending…' : noRecipients ? 'Test Send (select recipients)' : `Test Send to ${selectedEmails.length} selected`}
        </Button>
      </div>
    );
  };

  const channelTabs = [{ key: 'all' as ChannelKey, label: 'All' }, ...CHANNELS.map(c => ({ key: c.key as ChannelKey, label: c.label }))]
    .map(c => ({ key: c.key, label: c.key === channelFilter && loaded && !loadError ? <>{c.label} <Chip className={styles.num}>{total}</Chip></> : c.label }));

  const library = (() => {
    if (firstLoad) {
      return (
        <div className={styles.grid} role="status" aria-label="Loading templates">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.skelCard}>
              <Skeleton height={120} radius={0} />
              <div className={styles.skelBody}><Skeleton width="80%" /><Skeleton width="50%" height={10} /></div>
            </div>
          ))}
        </div>
      );
    }
    if (loadError) {
      return (
        <ErrorState
          title="Couldn't load templates"
          description="The template service didn't respond. Nothing was changed."
          details={loadError}
          action={<Button variant="primary" size="sm" onClick={() => setReloadKey(k => k + 1)}>Try again</Button>}
        />
      );
    }
    if (filtered.length === 0 && viewMode === 'card') {
      return hasFilter ? (
        <EmptyState title="No templates found" description="Nothing matches this channel or search. Try a different filter." />
      ) : (
        <EmptyState title="No templates yet" description="Create a template or upload your own HTML. New templates start as drafts."
          action={<Button variant="primary" onClick={openCreate}><Plus size={16} aria-hidden="true" /> Create template</Button>} />
      );
    }
    if (viewMode === 'table') {
      return (
        <Table label="Templates">
          <thead>
            <tr>
              <th>Name</th><th>Channel</th><th>Status</th><th>Subject</th><th>Segment</th><th>Updated</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyLine}>No templates found</td></tr>
            )}
            {filtered.map(t => {
              const hasAI = t.id >= 1 && t.id <= 7 && t.channel === 'email';
              const st = statusMeta(t.status);
              return (
                <tr key={t.id}>
                  <td className={styles.cellName}>{t.name}</td>
                  <td><Chip>{channelLabel(t.channel)}</Chip></td>
                  <td><StatusChip tone={st.tone}>{st.label}</StatusChip></td>
                  <td className={styles.cellSub} title={t.subject || ''}>{t.subject || '—'}</td>
                  <td>{t.segment_label ? <Chip>{t.segment_label}</Chip> : '—'}</td>
                  <td className={styles.num} style={{ whiteSpace: 'nowrap' }}>{formatDate(t.updated_at)}</td>
                  <td className={styles.cellActions}>
                    <div>
                      <Button size="sm" icon onClick={() => openPreview(t)} title="Preview" aria-label="Preview"><Eye size={14} /></Button>
                      {hasAI && <Button size="sm" icon onClick={() => openPreviewAI(t)} title="Preview AI" aria-label="Preview AI"><Sparkles size={14} /></Button>}
                      <Button size="sm" icon onClick={() => openEdit(t)} title="Edit" aria-label="Edit"><Edit2 size={14} /></Button>
                      {t.channel === 'email' && <Button size="sm" icon onClick={() => viewStoredReport(t)} title="View email QA report" aria-label="View email QA report"><Info size={14} /></Button>}
                      {t.status === 'pending_approval' && <Button size="sm" icon onClick={() => openReview(t)} title="Review for approval" aria-label="Review for approval"><Check size={14} /></Button>}
                      <Button size="sm" icon onClick={() => setConfirmDelete(t)} disabled={deleting === t.id} title="Delete template" aria-label="Delete">
                        <Trash2 size={14} className={styles.danger} />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      );
    }
    return (
      <div className={styles.grid}>
        {filtered.map(t => {
          const st = statusMeta(t.status);
          const Icon = CHANNEL_ICON[t.channel] || Mail;
          const hasAI = t.id >= 1 && t.id <= 7 && t.channel === 'email';
          const plain = t.body_plain || stripHtml(t.body);
          return (
            <article key={t.id} className={styles.tcard} aria-label={t.name}>
              <div className={styles.thumb} aria-hidden="true">
                {t.channel === 'email' ? (
                  <div className={styles.thumbEmail}>
                    <div className={styles.thumbBar} />
                    <div className={styles.thumbHero} />
                    <div className={styles.thumbLine} style={{ width: '90%' }} />
                    <div className={styles.thumbLine} style={{ width: '70%' }} />
                  </div>
                ) : plain ? <div className={styles.bubble}>{plain}</div> : null}
              </div>
              <div className={styles.tbody}>
                <h3 className={styles.tname}>{t.name}</h3>
                <div className={styles.row}>
                  <Chip><Icon size={12} aria-hidden="true" /> {channelLabel(t.channel)}</Chip>
                  <StatusChip tone={st.tone}>{st.label}</StatusChip>
                  {t.segment_label && <Chip tone="info">{t.segment_label}</Chip>}
                </div>
                {t.subject && <div className={styles.tsub}>Subject: {t.subject}</div>}
                {t.channel === 'email' && plain && <div className={styles.tplain}>{plain}</div>}
                {t.cta_text && <div className={styles.help}>CTA: {t.cta_text}</div>}
                {t.updated_at && <span className={styles.help}>Updated {formatDate(t.updated_at)}</span>}
                <div className={styles.tactions}>
                  <div>
                    <Button size="sm" onClick={() => openEdit(t)}><Edit2 size={14} aria-hidden="true" /> Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => openPreview(t)}><Eye size={14} aria-hidden="true" /> Preview</Button>
                    {t.channel === 'email' && (
                      <Button size="sm" variant="ghost" icon onClick={() => viewStoredReport(t)} title="View email QA report" aria-label="View email QA report"><Info size={14} /></Button>
                    )}
                    <Button size="sm" variant="ghost" icon onClick={() => setConfirmDelete(t)} disabled={deleting === t.id} title="Delete template" aria-label="Delete">
                      {deleting === t.id ? <RefreshCw size={14} className={styles.spin} /> : <Trash2 size={14} className={styles.danger} />}
                    </Button>
                  </div>
                  {hasAI && (
                    <div><Button size="sm" onClick={() => openPreviewAI(t)}><Sparkles size={14} aria-hidden="true" /> Preview AI Template</Button></div>
                  )}
                  {t.status === 'pending_approval' && (
                    <div><Button size="sm" variant="primary" onClick={() => openReview(t)}><Check size={14} aria-hidden="true" /> Review</Button></div>
                  )}
                  {renderSendButtons(t)}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    );
  })();

  return (
    <div className={styles.page}>
      <PageHeader
        title="Templates"
        breadcrumbs={[{ label: 'Messaging' }, { label: 'Templates' }]}
        description="Every message you can send, for every channel. Only approved templates can be used in sends and journeys."
        meta={loading && loaded ? <RefreshCw size={14} className={styles.spin} aria-label="Refreshing" /> : undefined}
        actions={<Button variant="primary" onClick={openCreate}><Plus size={16} aria-hidden="true" /> Create template</Button>}
      />

      <div className={styles.layout}>
        <div className={styles.main}>
          {pending.length > 0 && (
            <div className={styles.banner} role="status">
              <span className={styles.bannerDot} aria-hidden="true" />
              <div className={styles.bannerText}>
                <b>{pending.length === 1 ? '1 template is' : `${pending.length} templates are`} waiting for approval on this page</b>
                <div className={styles.note}>{pending.slice(0, 3).map(t => `“${t.name}” (${channelLabel(t.channel)})`).join(', ')}{pending.length > 3 ? ` and ${pending.length - 3} more` : ''}.</div>
              </div>
              <Button size="sm" variant="primary" onClick={() => openReview(pending[0])}>Review now</Button>
            </div>
          )}

          <Tabs label="Channel" items={channelTabs} value={channelFilter} onChange={setChannelFilter} />

          <div className={styles.toolbar}>
            <div className={styles.search}>
              <Search size={16} className={styles.searchIcon} aria-hidden="true" />
              <Input aria-label="Search templates" placeholder="Search name or subject…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <button type="button" className={styles.searchClear} onClick={() => setSearchQuery('')} aria-label="Clear search"><X size={14} /></button>
              )}
            </div>
            <span className={[styles.note, styles.num].join(' ')}>Showing {showingFrom}–{showingTo} of {total} templates</span>
            <span className={styles.spacer} />
            <div className={styles.seg} role="group" aria-label="View">
              <button type="button" className={styles.segBtn} aria-pressed={viewMode === 'card'} onClick={() => setViewMode('card')} aria-label="Card view" title="Card view">
                <LayoutGrid size={14} aria-hidden="true" /> Grid
              </button>
              <button type="button" className={styles.segBtn} aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')} aria-label="Table view" title="Table view">
                <List size={14} aria-hidden="true" /> List
              </button>
            </div>
          </div>

          {library}

          {total > 0 && !loadError && (
            <nav className={styles.pager} aria-label="Pagination">
              <div className={styles.pagerLeft}>
                <label htmlFor="tpl-page-size">Rows per page:</label>
                <Select id="tpl-page-size" value={pageSize} onChange={e => setPageSize(parseInt(e.target.value, 10))}>
                  {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </Select>
                <span className={styles.num}>Page <b>{page}</b> of <b>{totalPages}</b></span>
              </div>
              <div className={styles.pagerBtns}>
                <Button size="sm" onClick={() => setPage(1)} disabled={page === 1} title="First page" aria-label="First page">«</Button>
                <Button size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
                {(() => {
                  const visible = [...new Set([1, totalPages, page, page - 1, page + 1])]
                    .filter(p => p >= 1 && p <= totalPages)
                    .sort((a, b) => a - b);
                  const out: ReactNode[] = [];
                  visible.forEach((p, i) => {
                    if (i > 0 && p - visible[i - 1] > 1) out.push(<span key={`gap-${p}`} className={styles.gap}>…</span>);
                    out.push(
                      <Button key={p} size="sm" variant={p === page ? 'primary' : 'secondary'} onClick={() => setPage(p)}
                        aria-current={p === page ? 'page' : undefined} style={{ minWidth: 32 }}>{p}</Button>,
                    );
                  });
                  return out;
                })()}
                <Button size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
                <Button size="sm" onClick={() => setPage(totalPages)} disabled={page >= totalPages} title="Last page" aria-label="Last page">»</Button>
              </div>
            </nav>
          )}

          <Card title="Testing tools" className={styles.tools}>
            <Tabs label="Testing tools" value={toolTab} onChange={setToolTab} items={[
              { key: 'email', label: 'Email' },
              { key: 'whatsapp', label: 'WhatsApp' },
              { key: 'sms', label: 'SMS' },
              { key: 'rcs', label: 'RCS' },
            ]} />
            {toolTab === 'email' && (
              <>
                <div>
                  <div className={styles.eyebrow} style={{ marginBottom: 8 }}>Email tracking flow</div>
                  <div className={styles.flow}>
                    {[
                      { label: 'Sent', value: flowStats.sent },
                      { label: 'Opened', value: flowStats.opened },
                      { label: 'Clicked', value: flowStats.clicked },
                      { label: 'UTM Captured', value: flowStats.utm },
                      { label: 'Failed', value: flowStats.failed },
                    ].map(s => (
                      <div key={s.label} className={styles.flowStat}>
                        <div className={styles.flowVal}>{s.value.toLocaleString()}</div>
                        <div className={styles.flowLabel}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={styles.panel}>
                  <div className={styles.panelHead}>
                    <span className={styles.label}>Test recipients · <span className={styles.num}>{selectedEmails.length} selected of {recipTotal.toLocaleString()}</span></span>
                    {selectedEmails.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelectedEmails([])}>Clear selection</Button>}
                  </div>
                  <div className={styles.search} style={{ maxWidth: 'none' }}>
                    <Search size={16} className={styles.searchIcon} aria-hidden="true" />
                    <Input aria-label="Filter test recipients" placeholder="Filter by email or name… (min 2 chars)" value={recipQuery}
                      onChange={e => setRecipQuery(e.target.value)} />
                  </div>
                  <div className={styles.recipList}>
                    {recipLoading && recipients.length === 0 && <div className={styles.emptyLine}>Loading…</div>}
                    {!recipLoading && recipients.length === 0 && <div className={styles.emptyLine}>No contacts</div>}
                    {recipients.map(c => {
                      const email = c.email || c.actual_email || '';
                      const checked = selectedEmails.includes(email);
                      return (
                        <label key={c.id ?? email} className={[styles.recip, checked ? styles.recipOn : ''].join(' ')}>
                          <input type="checkbox" checked={checked} onChange={() => toggleRecipient(email)} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className={styles.row} style={{ gap: 6 }}>
                              <span className={styles.recipEmail}>{email}</span>
                              {c.contact_type && <Chip tone="info">{c.contact_type}</Chip>}
                              {c.booking_status && <Chip tone="ok">{c.booking_status}</Chip>}
                            </div>
                            {(c.name || c.country) && (
                              <div className={styles.recipMeta}>{c.name}{c.country && ` • ${c.country}`}</div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <span className={styles.help}>Pick recipients here, then use “Test Send to … selected” on an email template.</span>
                </div>
              </>
            )}
            {toolTab === 'whatsapp' && (<><CreateWhatsAppTemplate /><WhatsAppTestSend /></>)}
            {toolTab === 'sms' && <SmsTestSend />}
            {toolTab === 'rcs' && <RcsTestSend />}
          </Card>
        </div>

        {review && (
          <aside className={styles.review} aria-labelledby="tpl-review-title">
            <div className={styles.reviewHead}>
              <div>
                <span className={styles.eyebrow}>
                  Approval review{pending.length > 0 && pending.some(p => p.id === review.template.id)
                    ? ` · ${pending.findIndex(p => p.id === review.template.id) + 1} of ${pending.length}` : ''}
                </span>
                <h2 id="tpl-review-title">{review.template.name}</h2>
              </div>
              <Button variant="ghost" size="sm" icon aria-label="Close review" onClick={() => setReview(null)}><X size={16} /></Button>
            </div>
            <div className={styles.row}>
              <Chip>{channelLabel(review.template.channel)}</Chip>
              <StatusChip tone={statusMeta(review.template.status).tone}>{statusMeta(review.template.status).label}</StatusChip>
              {review.template.updated_at && <span className={styles.help}>Updated {formatDate(review.template.updated_at)}</span>}
            </div>
            <div className={styles.reviewFrame}>
              {review.template.subject && <div className={styles.reviewSubject}><b>Subject:</b> {review.template.subject}</div>}
              {review.template.channel === 'email' ? (
                review.loading ? <div className={styles.previewMsg} role="status">Rendering preview…</div> : (
                  <iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className={styles.reviewIframe}
                    srcDoc={withViewport(review.html || '')} title={`Review of ${review.template.name || 'template'}`} />
                )
              ) : (
                <div className={styles.reviewText}>{review.template.body_plain || stripHtml(review.template.body) || 'No message text.'}</div>
              )}
            </div>
            {review.template.channel === 'email' && (
              <Button size="sm" onClick={() => viewStoredReport(review.template)} title="View email QA report"><Info size={14} aria-hidden="true" /> Automatic checks (QA report)</Button>
            )}
            <div className={styles.row} style={{ marginTop: 'auto' }}>
              <Button onClick={() => decide('reject')} disabled={reviewBusy !== null}>{reviewBusy === 'reject' ? 'Rejecting…' : 'Reject'}</Button>
              <Button variant="primary" onClick={() => decide('approve')} disabled={reviewBusy !== null}>{reviewBusy === 'approve' ? 'Approving…' : 'Approve template'}</Button>
            </div>
            <span className={styles.help}>Only approved templates can be used in sends and journeys.</span>
          </aside>
        )}
      </div>

      {modals}
    </div>
  );
}
