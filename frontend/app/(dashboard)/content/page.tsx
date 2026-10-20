'use client';

import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import {
  getTemplates, getTemplate, previewTemplate, previewTemplateAI, renderPreviewHtml, createTemplate, updateTemplate, deleteTemplate,
  approveTemplate, rejectTemplate, sendTestDay, sendTemplate, analyzeTestEmail, checkInboxPlacement, getStoredQaReport, authFetch,
} from '@/lib/api';
import WhatsAppTestSend from './WhatsAppTestSend';
import CreateWhatsAppTemplate from './CreateWhatsAppTemplate';
import SmsTestSend from './SmsTestSend';
import RcsTestSend from './RcsTestSend';
import {
  ArrowLeft, Eye, X, Mail, MessageCircle, Smartphone, Bell, Plus, Upload, Edit2, Trash2, Sparkles, Send, Search, RefreshCw,
  Monitor, Tablet, LayoutGrid, List, Check, MoreHorizontal, ShieldCheck, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import hotToast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input, Select, Field } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { Chip, StatusChip, type ChipTone } from '@/components/ui/Chip';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { Table } from '@/components/ui/Table';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { QueryParams } from '@/types/api';
import type { ContentTemplate, TestSendRecipient, InboxPlacement, QaReportData, QaReportState, TemplatePreviewState, PreviewFit } from '@/types/f4Content';
import { cleanExcerpt, exactDateTime, readablePlaceholders, readableTitle, relativeTime, splitPlaceholders } from './templateText';
import styles from './content.module.css';

interface DynVar { key: string; value: string }
interface SendOptions { emails?: string[]; mode?: string }
interface QaSectionProps { title: string; items: string[]; okText: string; danger?: boolean }
type ChannelKey = 'all' | 'email' | 'whatsapp' | 'sms' | 'push';
type StatusKey = 'all' | 'draft' | 'pending_approval' | 'approved' | 'rejected';
type ToolKey = 'email' | 'whatsapp' | 'sms' | 'rcs';
type TabKey = 'library' | 'testing' | 'approval';
type Device = 'desktop' | 'tablet' | 'mobile';
type EditorState = 'create' | ContentTemplate | null;

// Plain status names and one colour each: Draft grey, Waiting amber, Approved green, Rejected red.
const STATUS_META: Record<string, { label: string; tone: ChipTone } | undefined> = {
  draft: { label: 'Draft', tone: 'mute' },
  pending_approval: { label: 'Waiting for approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'bad' },
};
const statusMeta = (s: string | undefined) => STATUS_META[s || ''] || { label: s ? readableTitle(s) : 'Unknown', tone: 'mute' as ChipTone };
const STATUS_OPTIONS: { key: StatusKey; label: string }[] = [
  { key: 'all', label: 'All statuses' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending_approval', label: 'Waiting for approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const CHANNELS = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'sms', label: 'SMS', icon: Smartphone },
  { key: 'push', label: 'Push', icon: Bell },
] as const;
const CHANNEL_LABEL: Record<string, string | undefined> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', push: 'Push' };
const CHANNEL_ICON: Record<string, LucideIcon | undefined> = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, push: Bell };
const channelLabel = (c: string | undefined) => CHANNEL_LABEL[c || ''] || c || 'Unknown';

const BLANK_FORM = { name: '', channel: 'email', subject: '', body: '', fileName: '' };

// Fixed QA test inbox — the "Test send" action always targets this address
// (this is the IMAP inbox the real spam-placement check reads from).
const ROCKY_EMAIL = 'rocky.86agency@gmail.com';

// ── Routes: /content (library), /content/new (create), /content/<id> (edit) ──
const CONTENT_PATH = '/content';
const TAB_KEYS: readonly TabKey[] = ['library', 'testing', 'approval'];
type ContentRoute = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: number } | { kind: 'invalid' };
function parseContentPath(pathname: string | null | undefined): ContentRoute {
  const path = (pathname || CONTENT_PATH).replace(/\/+$/, '') || CONTENT_PATH;
  if (path === CONTENT_PATH || !path.startsWith(`${CONTENT_PATH}/`)) return { kind: 'list' };
  const rest = path.slice(CONTENT_PATH.length + 1);
  if (rest === 'new') return { kind: 'new' };
  if (/^\d+$/.test(rest)) {
    const id = Number(rest);
    if (Number.isSafeInteger(id) && id > 0) return { kind: 'edit', id };
  }
  return { kind: 'invalid' };
}
const listUrl = (tab: TabKey) => (tab === 'library' ? CONTENT_PATH : `${CONTENT_PATH}?tab=${tab}`);
const tabFromSearch = (search: string): TabKey => {
  const t = new URLSearchParams(search).get('tab');
  return TAB_KEYS.find(k => k === t) ?? 'library';
};
function navigate(url: string, replace = false) {
  if (typeof window === 'undefined') return;
  if (`${window.location.pathname}${window.location.search}` === url) return;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

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

const toInt = (v: string | number | undefined): number => {
  const n = typeof v === 'number' ? v : parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};
const fmtNum = (n: number) => n.toLocaleString();

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const tsGet = (path: string) => authFetch(`${apiBase}${path}`, { credentials: 'include' })
  .then(r => r.json() as Promise<{ data?: unknown }>)
  .then(d => d.data || d); // unwrap { data: ... } envelope

const isDayTemplate = (t: ContentTemplate) => t.id >= 1 && t.id <= 7 && t.channel === 'email';
const canTestSend = (t: ContentTemplate) => isDayTemplate(t) || (t.channel === 'email' && t.status === 'approved');
const excerptOf = (t: ContentTemplate) => cleanExcerpt(t.body || t.body_plain);

/** Text with {{placeholders}} shown as small readable tags such as "[coupon code]". */
function Readable({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((p, i) => (p.kind === 'tag'
        ? <span key={i} className={styles.phTag}>{p.text}</span>
        : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

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

// ── Right-side drawer (same pattern as the journey step drawer) ──
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function Drawer({ label, onClose, head, footer, children }: { label: string; onClose: () => void; head: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => {
      // Let a dialog opened on top (e.g. Email checks) handle its own Escape first.
      if (e.key === 'Escape' && !document.querySelector(`.${styles.backdrop}`)) onCloseRef.current();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      if (prev && prev.isConnected) prev.focus();
    };
  }, []);
  const trap = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className={styles.drawerLayer}>
      <div className={styles.scrim} aria-hidden="true" onClick={onClose} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-label={label} className={styles.drawer} onKeyDown={trap}>
        <div className={styles.drawerHead}>
          <div className={styles.drawerHeadMain}>{head}</div>
          <Button ref={closeRef} size="sm" variant="ghost" icon aria-label="Close preview" onClick={onClose}><X size={16} /></Button>
        </div>
        <div className={styles.drawerBody}>{children}</div>
        {footer && <div className={styles.drawerFoot}>{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

// ── "⋯" menu ──
interface MenuAction { key: string; label: string; icon: ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean; title?: string }

function MoreMenu({ label, items }: { label: string; items: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const regular = items.filter(i => !i.danger);
  const danger = items.filter(i => i.danger);
  const item = (a: MenuAction) => (
    <button key={a.key} type="button" role="menuitem" disabled={a.disabled} title={a.title}
      className={a.danger ? `${styles.menuItem} ${styles.danger}` : styles.menuItem}
      onClick={() => { setOpen(false); a.onSelect(); }}>
      {a.icon}{a.label}
    </button>
  );
  return (
    <div className={styles.moreWrap} ref={wrapRef}>
      <Button ref={btnRef} size="sm" variant="ghost" icon aria-haspopup="menu" aria-expanded={open} aria-label={label} title="More actions"
        onClick={() => setOpen(o => !o)}>
        <MoreHorizontal size={16} />
      </Button>
      {open && (
        <div role="menu" aria-label={label} className={styles.menu}>
          {regular.map(item)}
          {regular.length > 0 && danger.length > 0 && <div role="separator" className={styles.menuSep} />}
          {danger.map(item)}
        </div>
      )}
    </div>
  );
}

// ── Card cover: a designed, channel-tinted mini mock of the message (real subject / first line) ──
const COVER_TONE: Record<string, string | undefined> = {
  email: styles.coverEmail, whatsapp: styles.coverWhatsapp, sms: styles.coverSms, push: styles.coverPush,
};
const DOT_TONE: Record<ChipTone, string> = {
  ok: styles.dotOk, warn: styles.dotWarn, bad: styles.dotBad, mute: styles.dotMute, info: styles.dotInfo, gold: styles.dotWarn,
};
const COVER_VARIANTS = [styles.coverV0, styles.coverV1, styles.coverV2];

function Cover({ t, line }: { t: ContentTemplate; line: string }) {
  const Icon = CHANNEL_ICON[t.channel] || Mail;
  const st = statusMeta(t.status);
  const variant = COVER_VARIANTS[Math.abs(t.id) % COVER_VARIANTS.length];
  const text = line || `${channelLabel(t.channel)} message`;
  return (
    <div className={[styles.cover, COVER_TONE[t.channel] || styles.coverEmail, variant].join(' ')} data-testid="card-cover">
      <span className={styles.coverBadge}><Icon size={18} aria-hidden="true" /></span>
      <span className={[styles.coverDot, DOT_TONE[st.tone]].join(' ')} title={st.label} aria-hidden="true" data-status={st.label} />
      {t.channel === 'email' ? (
        <div className={styles.coverMail}>
          <span className={styles.coverText}><Readable text={text} /></span>
          <span className={styles.coverLine} style={{ width: '88%' }} />
          <span className={styles.coverLine} style={{ width: '64%' }} />
        </div>
      ) : (
        <div className={styles.coverBubble}><span className={styles.coverText}><Readable text={text} /></span></div>
      )}
    </div>
  );
}

export default function Content() {
  const pathname = usePathname();
  const initialRoute = parseContentPath(pathname);

  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [allTotal, setAllTotal] = useState<number | null>(null);     // every template (no filter)
  const [pendingTotal, setPendingTotal] = useState<number | null>(null); // known once the approval queue loads
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

  const [tab, setTabState] = useState<TabKey>('library');
  const tabRef = useRef<TabKey>('library');
  const [channelFilter, setChannelFilter] = useState<ChannelKey>('all');
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all');
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
  const [modal, setModal] = useState<EditorState>(() => (initialRoute.kind === 'new' ? 'create' : null));
  const editorRef = useRef<EditorState>(initialRoute.kind === 'new' ? 'create' : null);
  const setEditor = (v: EditorState) => { editorRef.current = v; setModal(v); };
  const [opening, setOpening] = useState<number | null>(() => (initialRoute.kind === 'edit' ? initialRoute.id : null));
  const openingRef = useRef<number | null>(null);
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

  // ── Global recipients (shared by all Test send actions) ──
  const [recipients, setRecipients] = useState<TestSendRecipient[]>([]);
  const [recipQuery, setRecipQuery] = useState('');
  const [recipTotal, setRecipTotal] = useState(0);
  const [recipLoading, setRecipLoading] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [sendingDay, setSendingDay] = useState<number | null>(null);       // templateId currently sending
  const [sendingMode, setSendingMode] = useState<string | null>(null);     // 'rocky' | 'selected'
  const [flowStats, setFlowStats] = useState({ sent: 0, opened: 0, clicked: 0, utm: 0, failed: 0 });
  const [flowLoading, setFlowLoading] = useState(false);
  // The Testing tab's data loads the first time the tab is opened, then stays.
  const [testingOpened, setTestingOpened] = useState(false);

  // ── Post-send QA report ("Email checks") ──
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
        setQaReport({ template: tpl, report: { error: 'No checks yet — use Test send first to run them.' } });
      } else {
        setQaReport({ template: tpl, report: res.data });
        if (res.data.placement) setPlacement(res.data.placement);
      }
    } catch (e) {
      setQaReport({ template: tpl, report: { error: (e as Error).message } });
    } finally { setQaLoading(false); }
  }

  // Load contacts (debounced on query) — only once the Testing tab has been opened
  useEffect(() => {
    if (!testingOpened) return;
    const t = setTimeout(async () => {
      setRecipLoading(true);
      try {
        const qs = new URLSearchParams({ limit: '50', offset: '0' });
        if (recipQuery.trim().length >= 2) qs.set('q', recipQuery.trim());
        const res = await tsGet(`/api/v3/test-sends/contacts?${qs}`) as { contacts?: TestSendRecipient[]; total?: number };
        setRecipients(res.contacts || []);
        setRecipTotal(toInt(res.total));
      } catch { /* ignore */ }
      setRecipLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [recipQuery, testingOpened]);

  // Load tracking flow stats — once, the first time the Testing tab is opened
  useEffect(() => {
    if (!testingOpened) return;
    setFlowLoading(true);
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
      setFlowLoading(false);
    })();
  }, [testingOpened]);

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

  const testSend = (t: ContentTemplate, mode: 'rocky' | 'selected') => {
    const send = isDayTemplate(t) ? handleCardTestSend : handleGenericSend;
    void send(t, mode === 'rocky' ? { emails: [ROCKY_EMAIL], mode: 'rocky' } : { emails: selectedEmails, mode: 'selected' });
  };

  // The approval queue reuses the same list request, filtered to "waiting for approval".
  const effChannel: ChannelKey = tab === 'approval' ? 'all' : channelFilter;
  const effSearch = tab === 'approval' ? '' : searchQuery.trim();
  const effStatus: StatusKey = tab === 'approval' ? 'pending_approval' : statusFilter;

  // Server-side pagination + channel + status + search filter, debounced 300 ms.
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const params: QueryParams = { page, limit: pageSize };
      if (effChannel !== 'all') params.channel = effChannel;
      if (effSearch) params.search = effSearch;
      if (effStatus !== 'all') params.status = effStatus;
      (getTemplates(params) as Promise<{ data?: ContentTemplate[]; total?: number }>)
        .then(res => {
          const n = toInt(res?.total ?? (res?.data?.length || 0));
          setTemplates(res?.data || []);
          setTotal(n);
          if (effChannel === 'all' && !effSearch && effStatus === 'all') setAllTotal(n);
          if (effChannel === 'all' && !effSearch && effStatus === 'pending_approval') setPendingTotal(n);
          setLoadError(null);
        })
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Request failed'))
        .finally(() => { setLoading(false); setLoaded(true); });
    }, 300);
    return () => clearTimeout(t);
  }, [page, pageSize, effChannel, effSearch, effStatus, reloadKey]);

  // Reset to page 1 whenever the page-size or any filter changes.
  useEffect(() => { setPage(1); }, [pageSize, effChannel, effSearch, effStatus]);

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

  async function decideFor(tpl: ContentTemplate, kind: 'approve' | 'reject') {
    setReviewBusy(kind);
    try {
      const res = await (kind === 'approve' ? approveTemplate(tpl.id) : rejectTemplate(tpl.id)) as { data?: ContentTemplate } | null;
      const status = res?.data?.status || (kind === 'approve' ? 'approved' : 'rejected');
      setTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, ...(res?.data || {}), status } : t));
      setPreview(p => p && p.template.id === tpl.id ? { ...p, template: { ...p.template, status } } : p);
      if (tpl.status === 'pending_approval') setPendingTotal(n => (n === null ? n : Math.max(0, n - 1)));
      hotToast.success(kind === 'approve' ? 'Template approved' : 'Template rejected');
      setReview(r => (r && r.template.id === tpl.id ? null : r));
    } catch (err) {
      hotToast.error((err as Error).message || (kind === 'approve' ? 'Failed to approve' : 'Failed to reject'));
    } finally { setReviewBusy(null); }
  }

  function decide(kind: 'approve' | 'reject') {
    if (review) void decideFor(review.template, kind);
  }

  function openCreate() {
    setForm({ ...BLANK_FORM });
    setDynVars([]);
    setLiveDevice('desktop');
    setEditor('create');
  }

  // `prefetched` = the full record already loaded (deep link to /content/<id>), so it isn't fetched twice.
  async function openEdit(tpl: ContentTemplate, prefetched?: ContentTemplate) {
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
    setEditor(tpl);

    let sourceHtml = '';
    if (prefetched) {
      sourceHtml = prefetched.body || prefetched.html_body || '';
    } else {
      try {
        const res = await getTemplate(tpl.id) as ({ data?: ContentTemplate } & Partial<ContentTemplate>) | null;
        const full = res?.data || res;
        sourceHtml = full?.body || full?.html_body || '';
      } catch { /* fall through to preview-rendered HTML */ }
    }
    if (sourceHtml) {
      setForm(f => ({ ...f, body: sourceHtml, fileName: 'existing-template.html' }));
      setDynVars(extractVars(sourceHtml));
      return;
    }

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

  // /content/<id>: use the list row when it's loaded, otherwise load the template by id.
  async function openEditById(id: number) {
    if (openingRef.current === id) return;
    const known = templates.find(t => t.id === id);
    if (known) { void openEdit(known); return; }
    openingRef.current = id;
    setOpening(id);
    try {
      const res = await getTemplate(id) as ({ data?: ContentTemplate } & Partial<ContentTemplate>) | null;
      const full: Partial<ContentTemplate> | null = res?.data ?? res ?? null;
      if (!full || (full.id === undefined && !full.name)) throw new Error('Template not found');
      if (openingRef.current !== id) return; // the user moved on meanwhile
      const tpl: ContentTemplate = { ...full, id: typeof full.id === 'number' ? full.id : id, channel: full.channel || 'email', status: full.status || '' };
      void openEdit(tpl, tpl);
    } catch {
      if (openingRef.current === id) {
        hotToast.error('Template not found');
        setEditor(null);
        navigate(listUrl(tabRef.current), true);
      }
    } finally {
      if (openingRef.current === id) { openingRef.current = null; setOpening(null); }
    }
  }

  function setTab(next: TabKey) {
    tabRef.current = next;
    setTabState(next);
    if (next === 'testing') setTestingOpened(true);
    if (typeof window !== 'undefined' && parseContentPath(window.location.pathname).kind === 'list') navigate(listUrl(next), true);
  }

  // Navigation (pushState keeps the list state; back/forward still work).
  function goCreate() {
    setPreview(null);
    openCreate();
    navigate(`${CONTENT_PATH}/new`);
  }
  function goEdit(tpl: ContentTemplate) {
    setPreview(null);
    void openEdit(tpl);
    navigate(`${CONTENT_PATH}/${tpl.id}`);
  }
  function leaveEditor() {
    openingRef.current = null;
    setOpening(null);
    setEditor(null);
    navigate(listUrl(tabRef.current));
  }

  // The URL decides what is shown: /content (+ ?tab=), /content/new or /content/<id>.
  const routeActions = useRef({ openCreate, openEditById, setEditor, setTabState });
  useEffect(() => { routeActions.current = { openCreate, openEditById, setEditor, setTabState }; });
  useEffect(() => {
    const a = routeActions.current;
    const route = parseContentPath(pathname);
    if (route.kind === 'list') {
      if (editorRef.current !== null) a.setEditor(null);
      openingRef.current = null;
      setOpening(null);
      const t = tabFromSearch(window.location.search);
      tabRef.current = t;
      a.setTabState(t);
      if (t === 'testing') setTestingOpened(true);
      return;
    }
    if (route.kind === 'new') {
      if (editorRef.current !== 'create') a.openCreate();
      return;
    }
    if (route.kind === 'invalid') {
      a.setEditor(null);
      setOpening(null);
      window.history.replaceState(null, '', CONTENT_PATH);
      hotToast.error('Template not found');
      return;
    }
    const cur = editorRef.current;
    if (cur && cur !== 'create' && cur.id === route.id) return;
    void a.openEditById(route.id);
  }, [pathname]);

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
    const wasPending = confirmDelete.status === 'pending_approval';
    setDeleting(id);
    setConfirmDelete(null);
    try {
      await deleteTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      setTotal(t => Math.max(0, t - 1));
      setAllTotal(t => (t === null ? t : Math.max(0, t - 1)));
      if (wasPending) setPendingTotal(n => (n === null ? n : Math.max(0, n - 1)));
      setPreview(p => (p && p.template.id === id ? null : p));
      setReview(r => (r && r.template.id === id ? null : r));
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
        setAllTotal(t => (t === null ? t : t + 1));
        hotToast.success('Template created');
      } else {
        const id = modal.id;
        const res = await updateTemplate(id, payload) as { data: ContentTemplate };
        setTemplates(prev => prev.map(t => t.id === id ? res.data : t));
        hotToast.success('Template updated');
      }
      setEditor(null);
      navigate(listUrl(tabRef.current));
    } catch (err) {
      hotToast.error((err as Error).message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  const closeQa = useCallback(() => setQaReport(null), []);
  const closePreview = useCallback(() => setPreview(null), []);
  const cancelDelete = useCallback(() => setConfirmDelete(null), []);

  const pendingOnPage = templates.filter(t => t.status === 'pending_approval').length;
  const pendingCount = pendingTotal ?? pendingOnPage;
  const firstLoad = !loaded;
  const hasFilter = !!searchQuery.trim() || channelFilter !== 'all' || statusFilter !== 'all';
  const showingFrom = templates.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = (page - 1) * pageSize + templates.length;

  // ── ⋯ menu actions for one template (everything except Preview and Edit) ──
  const menuActions = (t: ContentTemplate): MenuAction[] => {
    const out: MenuAction[] = [];
    if (isDayTemplate(t)) {
      out.push({ key: 'ai', label: 'Preview AI version', icon: <Sparkles size={14} aria-hidden="true" />, onSelect: () => void openPreviewAI(t) });
    }
    if (t.channel === 'email') {
      out.push({ key: 'checks', label: 'Email checks', icon: <ShieldCheck size={14} aria-hidden="true" />, onSelect: () => void viewStoredReport(t) });
      const eligible = canTestSend(t);
      const busy = sendingDay === t.id;
      const n = selectedEmails.length;
      out.push({
        key: 'send', label: busy && sendingMode === 'rocky' ? 'Sending…' : 'Test send', icon: <Send size={14} aria-hidden="true" />,
        disabled: !eligible || busy,
        title: eligible ? `Send a test to the test inbox (${ROCKY_EMAIL})` : 'Only approved email templates can be test-sent',
        onSelect: () => testSend(t, 'rocky'),
      });
      out.push({
        key: 'send-selected',
        label: busy && sendingMode === 'selected' ? 'Sending…' : n === 0 ? 'Test send (select recipients)' : `Test send to ${n} selected`,
        icon: <Users size={14} aria-hidden="true" />,
        disabled: !eligible || busy || n === 0,
        title: !eligible ? 'Only approved email templates can be test-sent' : n === 0 ? 'Pick test recipients on the Testing tab first' : `Send to ${n} selected`,
        onSelect: () => testSend(t, 'selected'),
      });
    }
    if (t.status === 'pending_approval') {
      out.push({ key: 'review', label: 'Approve or reject', icon: <Check size={14} aria-hidden="true" />, onSelect: () => { setTab('approval'); void openReview(t); } });
    }
    out.push({ key: 'delete', label: 'Delete', icon: <Trash2 size={14} aria-hidden="true" />, danger: true, disabled: deleting === t.id, onSelect: () => setConfirmDelete(t) });
    return out;
  };

  // ── Shared overlays (rendered in both library and editor) ──
  const previewSendable = preview ? canTestSend(preview.template) : false;
  const previewBusy = preview ? sendingDay === preview.template.id : false;
  const modals = (
    <>
      <ConfirmDialog
        open={confirmDelete !== null}
        danger
        title="Delete template"
        description={confirmDelete ? <p>Delete <b>{readableTitle(confirmDelete.name)}</b>? This can’t be undone.</p> : undefined}
        confirmLabel="Delete"
        onConfirm={confirmAndDelete}
        onCancel={cancelDelete}
      />

      {preview && (
        <Drawer
          label={`Preview of ${preview.template.name || 'template'}`}
          onClose={closePreview}
          head={(
            <>
              <h2 className={styles.drawerTitle}>
                {readableTitle(preview.template.name)}
                {preview.ai && <Chip tone="gold"><Sparkles size={12} aria-hidden="true" /> AI</Chip>}
              </h2>
              <div className={styles.help}>
                {channelLabel(preview.template.channel)} · {preview.template.segment_label || 'Everyone'} · {statusMeta(preview.template.status).label}
              </div>
              {preview.template.subject && (
                <div className={styles.drawerSubject}><span className={styles.subLabel}>Subject</span> <Readable text={preview.template.subject} /></div>
              )}
            </>
          )}
          footer={(
            <>
              {modal === null && <Button size="sm" onClick={() => goEdit(preview.template)}><Edit2 size={14} aria-hidden="true" /> Edit</Button>}
              {previewSendable && (
                <>
                  <Button size="sm" onClick={() => testSend(preview.template, 'rocky')} disabled={previewBusy} title={`Send a test to ${ROCKY_EMAIL}`}>
                    <Send size={14} aria-hidden="true" /> {previewBusy && sendingMode === 'rocky' ? 'Sending…' : 'Test send'}
                  </Button>
                  {selectedEmails.length > 0 && (
                    <Button size="sm" onClick={() => testSend(preview.template, 'selected')} disabled={previewBusy}>
                      <Users size={14} aria-hidden="true" /> {previewBusy && sendingMode === 'selected' ? 'Sending…' : `Test send to ${selectedEmails.length} selected`}
                    </Button>
                  )}
                </>
              )}
              {preview.template.channel === 'email' && (
                <Button size="sm" variant="ghost" onClick={() => viewStoredReport(preview.template)}><ShieldCheck size={14} aria-hidden="true" /> Email checks</Button>
              )}
              {isDayTemplate(preview.template) && !preview.ai && (
                <Button size="sm" variant="ghost" onClick={() => openPreviewAI(preview.template)}><Sparkles size={14} aria-hidden="true" /> AI version</Button>
              )}
              {preview.template.status === 'pending_approval' && (
                <span className={styles.footRight}>
                  <Button size="sm" onClick={() => decideFor(preview.template, 'reject')} disabled={reviewBusy !== null}>{reviewBusy === 'reject' ? 'Rejecting…' : 'Reject'}</Button>
                  <Button size="sm" variant="primary" onClick={() => decideFor(preview.template, 'approve')} disabled={reviewBusy !== null}>{reviewBusy === 'approve' ? 'Approving…' : 'Approve'}</Button>
                </span>
              )}
            </>
          )}
        >
          <div className={styles.drawerTools}>
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
            <span className={styles.help}>Shown with sample customer details</span>
          </div>
          <div className={[styles.previewBody, previewDevice === 'desktop' ? styles.previewBodyDesktop : ''].join(' ')}>
            {preview.loading ? (
              <div className={styles.previewMsg} role="status">
                {preview.ai ? 'Creating the AI version… (about 15–25 seconds)' : 'Loading preview…'}
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
        </Drawer>
      )}

      {qaReport && (
        <Modal label="Email checks" onClose={closeQa}>
          <div className={styles.dialogHead}>
            <div>
              <h2>Email checks</h2>
              <div className={styles.help}>
                {readableTitle(qaReport.template.name)}
                {qaReport.report?.generatedAt ? ` — checked ${exactDateTime(qaReport.report.generatedAt) || 'earlier'}` : ' — just checked'}
              </div>
            </div>
            <Button variant="ghost" size="sm" icon aria-label="Close email checks" onClick={closeQa}><X size={16} /></Button>
          </div>
          <div className={styles.dialogBody}>
            {qaLoading ? (
              <div className={styles.loadingBlock} role="status">
                <Sparkles size={24} aria-hidden="true" />
                <div style={{ fontWeight: 600, marginTop: 8 }}>Running the checks…</div>
                <div className={styles.help}>Spelling · content · links · real inbox delivery (about 30–50 seconds)</div>
              </div>
            ) : qaReport.report?.error ? (
              <div className={styles.errorBox} role="alert">Checks couldn’t run: {qaReport.report.error}</div>
            ) : qaReport.report ? (() => {
              const r = qaReport.report;
              const sr: NonNullable<QaReportData['spamRisk']> = r.spamRisk || {};
              const srTone: ChipTone = sr.level === 'High' ? 'bad' : sr.level === 'Medium' ? 'warn' : 'ok';
              const known = placement?.available && placement.placement !== 'not_found';
              const isInbox = placement?.placement === 'inbox';
              const foundAt = exactDateTime(placement?.foundAt);
              return (
                <div>
                  <div className={[styles.qaBox, known ? (isInbox ? styles.qaBoxOk : styles.qaBoxBad) : ''].join(' ')}>
                    <div className={styles.eyebrow} style={{ marginBottom: 6 }}>Spam check (real test inbox)</div>
                    {placementLoading && !known ? (
                      <div className={styles.row} role="status"><RefreshCw size={14} className={styles.spin} aria-hidden="true" /> Delivering and checking the test inbox… (about 15–40 seconds)</div>
                    ) : known ? (
                      <div>
                        <div className={styles.qaVerdict} style={{ color: isInbox ? 'var(--ok)' : 'var(--bad)' }}>{isInbox ? 'Inbox — not spam' : 'Spam'}</div>
                        <div className={styles.help}>Checked in the test inbox {ROCKY_EMAIL}{foundAt ? ` · ${foundAt}` : ''}</div>
                      </div>
                    ) : (
                      <div>
                        <div className={styles.note}>{placement?.error ? `⚠ ${placement.error}` : (placement?.note || 'Not found in the test inbox yet.')}</div>
                        <Button size="sm" onClick={checkPlacement} disabled={placementLoading} style={{ marginTop: 8 }}>
                          <Search size={14} aria-hidden="true" /> {placementLoading ? 'Checking…' : 'Check again'}
                        </Button>
                      </div>
                    )}
                    {sr.level && (
                      <div className={styles.qaHint}>
                        Quick estimate: <Chip tone={srTone}>{sr.level} risk</Chip>{sr.reasons?.length ? ` — ${sr.reasons.slice(0, 2).join('; ')}` : ''}
                      </div>
                    )}
                  </div>
                  <QaSection title="Spelling and grammar" items={r.grammar || []} okText="No spelling or grammar issues found" />
                  <QaSection title="Missing content" items={r.missingContent || []} okText="Nothing missing" danger />
                  <div className={styles.qaSection}>
                    <div className={styles.eyebrow} style={{ marginBottom: 8 }}>Links ({toInt(r.urls?.total)} found, {toInt(r.urls?.broken)} broken)</div>
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
                  <QaSection title="Other problems" items={r.errors || []} okText="No other problems" danger />
                  {r.analysisSource && <div className={styles.help}>Content checked by {r.analysisSource === 'claude' ? 'Claude AI' : r.analysisSource}</div>}
                </div>
              );
            })() : null}
          </div>
        </Modal>
      )}
    </>
  );

  // ─────────────────────────── Opening /content/<id> ───────────────────────────
  if (modal === null && opening !== null) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <button type="button" className={styles.back} onClick={leaveEditor} aria-label="Back to templates" title="Back to templates">
            <ArrowLeft size={16} />
          </button>
          <h1 className={styles.title}>Opening template…</h1>
        </header>
        <div className={styles.editorGrid} role="status" aria-label="Loading template">
          {[0, 1, 2].map(i => <Card key={i} className={styles.panel}><Skeleton height={20} width="60%" /><Skeleton height={240} /></Card>)}
        </div>
        {modals}
      </div>
    );
  }

  // ─────────────────────────── Editor view ───────────────────────────
  if (modal !== null) {
    const isCreate = modal === 'create';
    const title = isCreate ? 'New template' : readableTitle(form.name || modal.name);
    const st = isCreate ? null : statusMeta(modal.status);
    const customVars = dynVars.filter(v => !SYSTEM_VARS.has(v.key));
    const subjectLen = form.subject.length;
    const updatedRel = isCreate ? '' : relativeTime(modal.updated_at);
    const leave = () => { if (!saving) leaveEditor(); };
    return (
      <div className={styles.editorPage}>
        <header className={styles.header}>
          <button type="button" className={styles.back} onClick={leave} aria-label="Back to templates" title="Back to templates">
            <ArrowLeft size={16} />
          </button>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{title}</h1>
            <Chip>{channelLabel(form.channel)}</Chip>
            {st && <StatusChip tone={st.tone}>{st.label}</StatusChip>}
            {updatedRel && <span className={styles.help} title={exactDateTime(isCreate ? undefined : modal.updated_at)}>Updated {updatedRel}</span>}
          </div>
          {!isCreate && (
            <div className={styles.actions}>
              <Button size="sm" onClick={() => openPreview(modal)}><Eye size={14} aria-hidden="true" /> Preview</Button>
              {modal.channel === 'email' && (
                <Button size="sm" onClick={() => viewStoredReport(modal)}><ShieldCheck size={14} aria-hidden="true" /> Email checks</Button>
              )}
            </div>
          )}
        </header>

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
            <details className={styles.optional}>
              <summary>Personal fields{dynVars.length > 0 ? ` · ${dynVars.length} found` : ''}</summary>
              <div className={styles.optionalBody}>
                {customVars.length > 0 ? (
                  <div className={styles.varList} aria-label="Custom variables">
                    {customVars.map(v => <span key={v.key} className={[styles.mono, styles.varChip].join(' ')}>{`{{${v.key}}}`}</span>)}
                  </div>
                ) : (
                  <span className={styles.help}>{dynVars.length > 0 ? 'Only standard contact fields are used.' : 'No {{FIELD}} placeholders found yet.'}</span>
                )}
                {dynVars.length > 0 && <span className={styles.help}>{dynVars.length} placeholder{dynVars.length === 1 ? '' : 's'} detected in the content.</span>}
              </div>
            </details>
          </Card>

          <Card aria-label="Content editor" className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.label}>{form.channel === 'email' ? 'Email content (HTML)' : 'Message content'} <span aria-hidden="true">*</span></span>
              <label className={styles.upload}>
                <Upload size={14} aria-hidden="true" /> Upload .html
                <input type="file" accept=".html,.htm,text/html" onChange={handleFileChange} aria-label="Upload HTML file" />
              </label>
            </div>
            <textarea
              className={styles.code}
              aria-label="Email content (HTML)"
              value={form.body}
              onChange={e => {
                const html = e.target.value;
                setForm(f => ({ ...f, body: html, fileName: html.trim() ? (f.fileName || 'inline-template.html') : '' }));
                setDynVars(extractVars(html));
              }}
              spellCheck={false}
              placeholder="<html>…</html> — edit directly. Use {{KEY}} placeholders (e.g. {{USER_NAME}}, {{ITEM_NAME}})."
            />
            <details className={styles.optional}>
              <summary>How personalisation works</summary>
              <div className={styles.optionalBody}>
                <span className={styles.help}>
                  {form.fileName ? `Source: ${form.fileName}. ` : ''}Write {'{{FIELD}}'} where a customer detail should go. If / case blocks are worked out by the server for the preview, exactly as they will be sent.
                </span>
              </div>
            </details>
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
              <span className={styles.help}>Sample customer details</span>
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
              {!form.body ? <Chip>Nothing to show yet</Chip>
                : livePreviewLoading ? <Chip tone="info"><RefreshCw size={12} className={styles.spin} aria-hidden="true" /> Updating…</Chip>
                  : livePreviewHtml ? <Chip tone="ok">Exactly as it will be sent</Chip>
                    : <Chip tone="warn">Quick preview</Chip>}
            </div>
          </Card>
        </div>

        <div className={styles.footer}>
          <span className={styles.help}>{isCreate ? 'New templates start as drafts.' : 'Changes are saved to this template.'}</span>
          <span className={styles.spacer} />
          <Button onClick={leave} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isCreate ? 'Save template' : 'Save changes'}
          </Button>
        </div>

        {modals}
      </div>
    );
  }

  // ─────────────────────────── Library ───────────────────────────
  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  const renderCard = (t: ContentTemplate) => {
    const st = statusMeta(t.status);
    const Icon = CHANNEL_ICON[t.channel] || Mail;
    const title = readableTitle(t.name);
    const showRaw = !!t.name && title !== t.name;
    const excerpt = excerptOf(t);
    const rel = relativeTime(t.updated_at);
    return (
      <article key={t.id} className={styles.tcard} aria-label={title} tabIndex={0}
        onClick={() => void openPreview(t)}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); void openPreview(t); } }}>
        <Cover t={t} line={t.channel === 'email' ? (t.subject || excerpt) : (excerpt || t.subject || '')} />
        <div className={styles.tbody}>
          <div>
            <h3 className={styles.tname} title={title}>{title}</h3>
            {showRaw && <div className={styles.rawName} title="Template name">{t.name}</div>}
          </div>
          <div className={styles.row}>
            <Chip><Icon size={12} aria-hidden="true" /> {channelLabel(t.channel)}</Chip>
            <StatusChip tone={st.tone}>{st.label}</StatusChip>
          </div>
          {t.subject ? (
            <div className={styles.tsubBlock}>
              <span className={styles.subLabel}>Subject</span>
              <span className={styles.tsub} title={readablePlaceholders(t.subject)}><Readable text={t.subject} /></span>
            </div>
          ) : null}
          {t.channel === 'email' && excerpt && <div className={styles.tplain}><Readable text={excerpt} /></div>}
          {t.cta_text && <div className={styles.help}>Button: {readablePlaceholders(t.cta_text)}</div>}
          <div className={styles.tfoot}>
            {rel ? <span className={styles.help} title={exactDateTime(t.updated_at)}>Updated {rel}</span> : <span />}
            <div className={styles.tactions} onClick={stop} onKeyDown={e => e.stopPropagation()}>
              <Button size="sm" variant="ghost" onClick={() => openPreview(t)}><Eye size={14} aria-hidden="true" /> Preview</Button>
              <Button size="sm" onClick={() => goEdit(t)}><Edit2 size={14} aria-hidden="true" /> Edit</Button>
              <MoreMenu label={`More actions for ${title}`} items={menuActions(t)} />
            </div>
          </div>
        </div>
      </article>
    );
  };

  const libraryBody = (() => {
    if (firstLoad) {
      return (
        <div className={styles.grid} role="status" aria-label="Loading templates">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.skelCard}>
              <Skeleton height={140} radius={0} />
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
    if (templates.length === 0 && viewMode === 'card') {
      return hasFilter ? (
        <EmptyState title="No templates found" description="Nothing matches these filters. Try a different channel, status or search." />
      ) : (
        <EmptyState title="No templates yet" description="Create a template or upload your own HTML. New templates start as drafts."
          action={<Button variant="primary" onClick={goCreate}><Plus size={16} aria-hidden="true" /> New template</Button>} />
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
            {templates.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyLine}>No templates found</td></tr>
            )}
            {templates.map(t => {
              const st = statusMeta(t.status);
              const title = readableTitle(t.name);
              return (
                <tr key={t.id}>
                  <td className={styles.cellName}>
                    <button type="button" className={styles.linkBtn} onClick={() => openPreview(t)}>{title}</button>
                    {t.name && title !== t.name && <div className={styles.rawName}>{t.name}</div>}
                  </td>
                  <td><Chip>{channelLabel(t.channel)}</Chip></td>
                  <td><StatusChip tone={st.tone}>{st.label}</StatusChip></td>
                  <td className={styles.cellSub} title={readablePlaceholders(t.subject || '')}>{t.subject ? <Readable text={t.subject} /> : '—'}</td>
                  <td>{t.segment_label ? <Chip>{t.segment_label}</Chip> : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }} title={exactDateTime(t.updated_at)}>{relativeTime(t.updated_at) || '—'}</td>
                  <td className={styles.cellActions}>
                    <div>
                      <Button size="sm" variant="ghost" onClick={() => openPreview(t)}>Preview</Button>
                      <Button size="sm" onClick={() => goEdit(t)}>Edit</Button>
                      <MoreMenu label={`More actions for ${title}`} items={menuActions(t)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      );
    }
    return <div className={styles.grid}>{templates.map(renderCard)}</div>;
  })();

  const pager = total > 0 && !loadError && !firstLoad ? (
    <nav className={styles.pager} aria-label="Pagination">
      <div className={styles.pagerLeft}>
        <label htmlFor="tpl-page-size">Per page</label>
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
  ) : null;

  const channelOptions: { key: ChannelKey; label: string }[] = [{ key: 'all', label: 'All' }, ...CHANNELS.map(c => ({ key: c.key as ChannelKey, label: c.label }))];
  const chipCount = (key: ChannelKey): number | null => {
    if (!loaded || loadError) return null;
    if (key === channelFilter && statusFilter === 'all' && !searchQuery.trim()) return total;
    if (key === 'all' && allTotal !== null) return allTotal;
    return null;
  };

  const library = (
    <>
      <div className={styles.filters}>
        <div className={styles.chanChips} role="group" aria-label="Channel">
          {channelOptions.map(c => {
            const n = chipCount(c.key);
            return (
              <button key={c.key} type="button" className={styles.chanBtn} aria-pressed={channelFilter === c.key} onClick={() => setChannelFilter(c.key)}>
                {c.label}{n !== null && <span className={styles.chipNum}>{fmtNum(n)}</span>}
              </button>
            );
          })}
        </div>
        <div className={styles.search}>
          <Search size={16} className={styles.searchIcon} aria-hidden="true" />
          <Input aria-label="Search templates" placeholder="Search name or subject…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && (
            <button type="button" className={styles.searchClear} onClick={() => setSearchQuery('')} aria-label="Clear search"><X size={14} /></button>
          )}
        </div>
        <Select aria-label="Status" className={styles.statusSelect} value={statusFilter} onChange={e => {
          const v = STATUS_OPTIONS.find(o => o.key === e.target.value)?.key ?? 'all';
          setStatusFilter(v);
        }}>
          {STATUS_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Select>
        <span className={styles.spacer} />
        <span className={[styles.help, styles.num].join(' ')}>Showing {showingFrom}–{showingTo} of {fmtNum(total)}</span>
        <div className={styles.seg} role="group" aria-label="View">
          <button type="button" className={styles.segBtn} aria-pressed={viewMode === 'card'} onClick={() => setViewMode('card')} aria-label="Card view" title="Card view">
            <LayoutGrid size={14} aria-hidden="true" />
          </button>
          <button type="button" className={styles.segBtn} aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')} aria-label="Table view" title="Table view">
            <List size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.scroll}>
        {libraryBody}
        {pager}
      </div>
    </>
  );

  // ── Waiting for approval: a queue + the review panel ──
  const queue = templates.filter(t => t.status === 'pending_approval');
  const approval = (
    <div className={styles.approvalLayout}>
      <div className={styles.scroll}>
        {firstLoad || (loading && tab === 'approval' && pendingTotal === null) ? (
          <div className={styles.queue} role="status" aria-label="Loading templates">
            {[0, 1, 2].map(i => <Skeleton key={i} height={64} radius={10} />)}
          </div>
        ) : loadError ? (
          <ErrorState
            title="Couldn't load templates"
            description="The template service didn't respond. Nothing was changed."
            details={loadError}
            action={<Button variant="primary" size="sm" onClick={() => setReloadKey(k => k + 1)}>Try again</Button>}
          />
        ) : queue.length === 0 ? (
          <EmptyState title="Nothing is waiting for approval" description="When a template is sent for approval, it shows up here." icon={<Check size={20} />} />
        ) : (
          <ul className={styles.queue} aria-label="Waiting for approval">
            {queue.map(t => {
              const title = readableTitle(t.name);
              const Icon = CHANNEL_ICON[t.channel] || Mail;
              const on = review?.template.id === t.id;
              const rel = relativeTime(t.updated_at);
              return (
                <li key={t.id} className={on ? `${styles.qItem} ${styles.qItemOn}` : styles.qItem}>
                  <span className={styles.qIcon}><Icon size={16} aria-hidden="true" /></span>
                  <div className={styles.qMain}>
                    <div className={styles.qName}>{title}</div>
                    <div className={styles.help}>
                      {channelLabel(t.channel)}
                      {t.subject ? <> · <Readable text={t.subject} /></> : null}
                      {rel ? <span title={exactDateTime(t.updated_at)}> · Updated {rel}</span> : null}
                    </div>
                  </div>
                  <div className={styles.qActions}>
                    <Button size="sm" variant="ghost" onClick={() => openPreview(t)}>Preview</Button>
                    <Button size="sm" variant={on ? 'primary' : 'secondary'} onClick={() => openReview(t)}>Review</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {tab === 'approval' && pager}
      </div>

      {review ? (
        <aside className={styles.review} aria-labelledby="tpl-review-title">
          <div className={styles.reviewHead}>
            <div>
              <span className={styles.eyebrow}>
                Approval review{queue.some(p => p.id === review.template.id)
                  ? ` · ${queue.findIndex(p => p.id === review.template.id) + 1} of ${queue.length}` : ''}
              </span>
              <h2 id="tpl-review-title">{review.template.name}</h2>
            </div>
            <Button variant="ghost" size="sm" icon aria-label="Close review" onClick={() => setReview(null)}><X size={16} /></Button>
          </div>
          <div className={styles.row}>
            <Chip>{channelLabel(review.template.channel)}</Chip>
            <StatusChip tone={statusMeta(review.template.status).tone}>{statusMeta(review.template.status).label}</StatusChip>
            {review.template.updated_at && <span className={styles.help} title={exactDateTime(review.template.updated_at)}>Updated {relativeTime(review.template.updated_at)}</span>}
          </div>
          <div className={styles.reviewFrame}>
            {review.template.subject && <div className={styles.reviewSubject}><b>Subject:</b> <Readable text={review.template.subject} /></div>}
            {review.template.channel === 'email' ? (
              review.loading ? <div className={styles.previewMsg} role="status">Loading preview…</div> : (
                <iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className={styles.reviewIframe}
                  srcDoc={withViewport(review.html || '')} title={`Review of ${review.template.name || 'template'}`} />
              )
            ) : (
              <div className={styles.reviewText}>{review.template.body_plain || stripHtml(review.template.body) || 'No message text.'}</div>
            )}
          </div>
          {review.template.channel === 'email' && (
            <Button size="sm" onClick={() => viewStoredReport(review.template)}><ShieldCheck size={14} aria-hidden="true" /> Email checks</Button>
          )}
          <div className={styles.row} style={{ marginTop: 'auto' }}>
            <Button onClick={() => decide('reject')} disabled={reviewBusy !== null}>{reviewBusy === 'reject' ? 'Rejecting…' : 'Reject'}</Button>
            <Button variant="primary" onClick={() => decide('approve')} disabled={reviewBusy !== null}>{reviewBusy === 'approve' ? 'Approving…' : 'Approve template'}</Button>
          </div>
          <span className={styles.help}>Only approved templates can be used in sends and journeys.</span>
        </aside>
      ) : queue.length > 0 ? (
        <div className={styles.reviewHint}>Pick a template and choose <b>Review</b> to see it here and approve or reject it.</div>
      ) : null}
    </div>
  );

  // ── Testing: the existing testing tools, unchanged in behaviour ──
  const testing = (
    <div className={styles.scroll}>
      <Card className={styles.tools}>
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
              {flowLoading ? (
                <div className={styles.flow} role="status" aria-label="Loading tracking flow">
                  {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={54} radius={10} />)}
                </div>
              ) : (
                <div className={styles.flow}>
                  {[
                    { label: 'Sent', value: flowStats.sent },
                    { label: 'Opened', value: flowStats.opened },
                    { label: 'Clicked', value: flowStats.clicked },
                    { label: 'Website visits tracked', value: flowStats.utm },
                    { label: 'Failed', value: flowStats.failed },
                  ].map(s => (
                    <div key={s.label} className={styles.flowStat}>
                      <div className={styles.flowVal}>{s.value.toLocaleString()}</div>
                      <div className={styles.flowLabel}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.recipPanel}>
              <div className={styles.panelHead}>
                <span className={styles.label}>Test recipients · <span className={styles.num}>{fmtNum(selectedEmails.length)} selected of {fmtNum(recipTotal)}</span></span>
                <div className={styles.row}>
                  {recipients.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setSelectedEmails(prev => [...new Set([...prev, ...recipients.map(c => c.email || c.actual_email || '').filter(Boolean)])])}>
                      Select all shown
                    </Button>
                  )}
                  {selectedEmails.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelectedEmails([])}>Clear</Button>}
                </div>
              </div>
              <div className={styles.recipSearch}>
                <Search size={16} className={styles.searchIcon} aria-hidden="true" />
                <Input aria-label="Filter test recipients" placeholder="Search by email or name (at least 2 characters)" value={recipQuery}
                  onChange={e => setRecipQuery(e.target.value)} />
              </div>
              <div className={styles.recipList} aria-busy={recipLoading}>
                {recipLoading && recipients.length === 0 && <div className={styles.emptyLine} role="status">Loading contacts…</div>}
                {!recipLoading && recipients.length === 0 && (
                  <div className={styles.emptyLine}>{recipQuery.trim().length >= 2 ? 'No contacts found' : 'Type at least 2 characters to search'}</div>
                )}
                {recipients.map(c => {
                  const email = c.email || c.actual_email || '';
                  const checked = selectedEmails.includes(email);
                  return (
                    <label key={c.id ?? email} className={[styles.recip, checked ? styles.recipOn : ''].join(' ')} data-testid="recipient-row"
                      title={[c.name, email, c.country].filter(Boolean).join(' · ')}>
                      <input type="checkbox" checked={checked} onChange={() => toggleRecipient(email)} />
                      <span className={styles.recipText}>
                        {c.name && <span className={styles.recipName}>{c.name}</span>}
                        <span className={styles.recipEmail}>{email}</span>
                        {c.country && <span className={styles.recipMeta}>{c.country}</span>}
                      </span>
                      {c.contact_type && <Chip tone="info">{c.contact_type}</Chip>}
                      {c.booking_status && <Chip tone="ok">{c.booking_status}</Chip>}
                    </label>
                  );
                })}
              </div>
              <span className={styles.help}>Pick recipients here, then choose “Test send to … selected” in a template’s ⋯ menu or preview.</span>
            </div>
          </>
        )}
        {toolTab === 'whatsapp' && (<><CreateWhatsAppTemplate /><WhatsAppTestSend /></>)}
        {toolTab === 'sms' && <SmsTestSend />}
        {toolTab === 'rcs' && <RcsTestSend />}
      </Card>
    </div>
  );

  const tabs: TabItem<TabKey>[] = [
    { key: 'library', label: 'Library' },
    { key: 'testing', label: 'Testing' },
    { key: 'approval', label: pendingCount > 0 ? <>Waiting for approval <span className={styles.tabCount}>{fmtNum(pendingCount)}</span></> : 'Waiting for approval' },
  ];
  const PANELS: Record<TabKey, { name: string; body: ReactNode }> = {
    library: { name: 'Library', body: library },
    approval: { name: 'Waiting for approval', body: approval },
    testing: { name: 'Testing', body: testing },
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Templates</h1>
          {allTotal !== null && <Chip className={styles.num}>{fmtNum(allTotal)} {allTotal === 1 ? 'template' : 'templates'}</Chip>}
          {pendingCount > 0 && <Chip tone="warn" className={styles.num}>{fmtNum(pendingCount)} waiting for approval</Chip>}
          {loading && loaded && <RefreshCw size={14} className={styles.spin} aria-label="Refreshing" />}
          <span className={styles.summary}>Messages for email, WhatsApp, SMS and push. Only approved templates can be used in journeys.</span>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" onClick={goCreate}><Plus size={16} aria-hidden="true" /> New template</Button>
        </div>
      </header>

      <Tabs label="Templates sections" items={tabs} value={tab} onChange={setTab} />

      <div role="tabpanel" aria-label={PANELS[tab].name} className={styles.tabPanel}>
        {PANELS[tab].body}
      </div>

      {modals}
    </div>
  );
}
