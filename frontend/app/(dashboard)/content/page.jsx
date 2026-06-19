'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getTemplates, getTemplate, previewTemplate, previewTemplateAI, renderPreviewHtml, createTemplate, updateTemplate, deleteTemplate, sendTestDay, analyzeTestEmail, checkInboxPlacement, getStoredQaReport } from '@/lib/api';
import { Eye, X, Mail, MessageCircle, Smartphone, Bell, Plus, Upload, Edit2, FileText, Braces, Trash2, Sparkles, Send, Search, Info, RefreshCw, Monitor, Tablet } from 'lucide-react';
import hotToast from 'react-hot-toast';

const STATUS_BADGE = { draft: 'badge-gray', pending_approval: 'badge-orange', approved: 'badge-green', rejected: 'badge-red' };
const CHANNEL_ICON = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, push: Bell };
const CHANNELS = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'sms', label: 'SMS', icon: Smartphone },
  { key: 'push', label: 'Push', icon: Bell },
];

const BLANK_FORM = { name: '', channel: 'email', subject: '', body: '', fileName: '' };

// Fixed QA test inbox — the "Test Send to Rocky" button always targets this address
// (this is the IMAP inbox the real spam-placement check reads from).
const ROCKY_EMAIL = 'rocky.86agency@gmail.com';

const SYSTEM_VARS = new Set(['first_name', 'full_name', 'email', 'phone', 'country', 'city', 'company', 'segment', 'unsubscribe_link', 'utm_link']);

// Sample values for the live preview — mirrors the 60 master placeholder keys
// (placeholder_keys_final.pdf) so the editor preview shows realistic filled content.
const PREVIEW_SAMPLE = {
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
};
// Legacy lowercase keys → canonical (matches backend placeholderResolver aliases)
const PREVIEW_ALIASES = {
  customer_name: 'USER_FIRST_NAME', user_name: 'USER_NAME', item_name: 'ITEM_NAME',
  item_image: 'ITEM_IMAGE_URL', cta_url: 'ITEM_URL', event_name: 'EVENT_NAME',
  event_id: 'EVENT_ID', event_time: 'EVENT_TIMESTAMP', page_url: 'PAGE_URL', raw_payload: 'RAW_PAYLOAD',
};
// Fill {{KEY}} with sample values for the live preview (unknown keys → highlighted chip).
const fillPreviewHtml = (html) => String(html || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, raw) => {
  const key = PREVIEW_ALIASES[raw] || PREVIEW_ALIASES[raw.toLowerCase()] || raw.toUpperCase();
  if (key in PREVIEW_SAMPLE) return PREVIEW_SAMPLE[key];
  return `<span style="background:#fde68a;color:#92400e;padding:0 3px;border-radius:3px;font-size:11px">{{${raw}}}</span>`;
});

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const stripHtml = (html) => {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

export default function Content() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [preview, setPreview] = useState(null);
  const [previewDevice, setPreviewDevice] = useState('desktop'); // desktop | tablet | mobile
  const previewIframeRef = useRef(null);
  const [previewFit, setPreviewFit] = useState({ scale: 1, height: null });

  // Re-measure when the device toggle changes (iframe already loaded)
  useEffect(() => { fitPreview(); }, [previewDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Measure the email's rendered width and scale the iframe to fit the device frame
  // (Gmail-style "fit to width") so fixed-width emails don't horizontal-scroll on mobile.
  function fitPreview() {
    const ifr = previewIframeRef.current;
    if (!ifr) return;
    if (previewDevice === 'desktop') { setPreviewFit({ scale: 1, height: null, contentW: null }); return; }
    const frameW = previewDevice === 'mobile' ? 390 : 768;
    try {
      const doc = ifr.contentWindow.document;
      const contentW = Math.max(doc.body?.scrollWidth || 0, doc.documentElement?.scrollWidth || 0, frameW);
      const contentH = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0);
      const scale = contentW > frameW ? frameW / contentW : 1;
      setPreviewFit(prev => {
        // Avoid an infinite re-measure loop once it has converged
        if (prev.contentW === contentW && Math.abs((prev.contentH || 0) - contentH) < 4) return prev;
        return { scale, contentW, contentH, height: contentH ? contentH * scale : null };
      });
    } catch { setPreviewFit({ scale: 1, height: null, contentW: null }); }
  }
  const [channelFilter, setChannelFilter] = useState('all');

  // modal state: null = closed, 'create' = new, object = editing existing
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [dynVars, setDynVars] = useState([]); // [{ key: 'first_name', value: '' }, ...]
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // template object to confirm

  // Edit-modal live preview — debounced server render so what you see in the
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
        const res = await renderPreviewHtml(form.body, { engine: 'liquid' });
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
  const [recipients, setRecipients] = useState([]);        // searched/listed contacts
  const [recipQuery, setRecipQuery] = useState('');
  const [recipTotal, setRecipTotal] = useState(0);
  const [recipLoading, setRecipLoading] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState([]); // globally selected
  const [sendingDay, setSendingDay] = useState(null);       // templateId currently sending
  const [sendingMode, setSendingMode] = useState(null);     // 'rocky' | 'selected' — which button is sending
  const [flowStats, setFlowStats] = useState({ sent: 0, opened: 0, clicked: 0, utm: 0, failed: 0 });

  // ── Post-send QA report ──
  const [qaReport, setQaReport] = useState(null);   // { template } open + report
  const [qaLoading, setQaLoading] = useState(false);
  const [placement, setPlacement] = useState(null); // real inbox placement result
  const [placementLoading, setPlacementLoading] = useState(false);

  async function checkPlacement() {
    const subject = qaReport?.report?.subject || '';
    const tid = qaReport?.template?.id;
    setPlacementLoading(true); setPlacement(null);
    try {
      const res = await checkInboxPlacement(subject, tid);
      setPlacement(res?.data || { available: false, error: 'No response' });
    } catch (e) {
      setPlacement({ available: false, error: e.message });
    } finally { setPlacementLoading(false); }
  }

  // View the STORED report for a template (the (i) button — no re-send)
  async function viewStoredReport(tpl) {
    setQaReport({ template: tpl, report: null });
    setPlacement(null);
    setQaLoading(true);
    try {
      const res = await getStoredQaReport(tpl.id);
      if (!res?.data) {
        setQaReport({ template: tpl, report: { error: 'No report yet — run a Test Send first to generate one.' } });
      } else {
        setQaReport({ template: tpl, report: res.data });
        if (res.data.placement) setPlacement(res.data.placement);
      }
    } catch (e) {
      setQaReport({ template: tpl, report: { error: e.message } });
    } finally { setQaLoading(false); }
  }

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const tsGet = (path) => fetch(`${apiBase}${path}`, { credentials: 'include' })
    .then(r => r.json())
    .then(d => d.data || d); // unwrap { data: ... } envelope

  // Load contacts (debounced on query)
  useEffect(() => {
    const t = setTimeout(async () => {
      setRecipLoading(true);
      try {
        const qs = new URLSearchParams({ limit: 50, offset: 0 });
        if (recipQuery.trim().length >= 2) qs.set('q', recipQuery.trim());
        const res = await tsGet(`/api/v3/test-sends/contacts?${qs}`);
        setRecipients(res.contacts || []);
        setRecipTotal(res.total || 0);
      } catch { /* ignore */ }
      setRecipLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [recipQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load tracking flow stats
  useEffect(() => {
    (async () => {
      try {
        const [summary, utmLog] = await Promise.all([
          tsGet('/api/v3/test-sends/send-log/summary'),
          tsGet('/api/v3/test-sends/utm-log?limit=1'),
        ]);
        const byStatus = summary?.byStatus || [];
        const g = (s) => parseInt(byStatus.find(r => r.status === s)?.count || 0);
        setFlowStats({
          sent: g('sent') + g('opened') + g('clicked'),
          opened: g('opened') + g('clicked'),
          clicked: g('clicked'),
          failed: g('failed'),
          utm: utmLog?.total || 0,
        });
      } catch { /* ignore */ }
    })();
  }, []);

  const toggleRecipient = (email) => {
    setSelectedEmails(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]);
  };

  async function handleCardTestSend(tpl, { emails, mode } = {}) {
    const recipients = emails && emails.length ? emails : selectedEmails;
    if (recipients.length === 0) return;
    const day = tpl.id; // template id 1-7 == day number
    setSendingDay(tpl.id);
    setSendingMode(mode || 'selected');
    try {
      const data = await sendTestDay(day, recipients);
      hotToast.success(`Sent ${tpl.name} to ${data?.sent ?? recipients.length} recipient(s)`);

      // Open modal in a single loading state — show the FULL report (content + real
      // spam placement) all at once when everything is ready.
      setQaReport({ template: tpl, report: null });
      setPlacement(null);
      setQaLoading(true);

      // 1. Content report (grammar / missing / urls / heuristic) — fast
      let report = null;
      try {
        const res = await analyzeTestEmail(tpl.id);
        report = res?.data || null;
      } catch (e) {
        report = { error: e.message };
      }
      const subject = report?.subject || '';

      // 2. Real spam placement via IMAP — retry while Gmail delivers (~15-40s)
      let placementResult = null;
      for (let attempt = 1; attempt <= 4 && !report?.error; attempt++) {
        await new Promise(r => setTimeout(r, attempt === 1 ? 15000 : 12000));
        try {
          const res = await checkInboxPlacement(subject, tpl.id);
          const p = res?.data;
          if (p?.available && p.placement !== 'not_found') { placementResult = p; break; }
          placementResult = p || { available: false, error: 'Not found after retries' };
        } catch (e) {
          placementResult = { available: false, error: e.message };
        }
      }

      // 3. Reveal the complete report at once
      setPlacement(placementResult);
      setQaReport({ template: tpl, report });
      setQaLoading(false);
    } catch (err) {
      hotToast.error(err.message || 'Send failed');
    } finally { setSendingDay(null); setSendingMode(null); }
  }

  function extractVars(html) {
    const matches = [...html.matchAll(/\{\{(\w+)\}\}/g)];
    const unique = [...new Set(matches.map(m => m[1]))];
    return unique.map(key => ({ key, value: '' }));
  }

  // Server-side pagination + channel filter. Backend supports page/limit/channel
  // params and returns { data, total, page, limit }.
  useEffect(() => {
    setLoading(true);
    const params = { page, limit: pageSize };
    if (channelFilter !== 'all') params.channel = channelFilter;
    getTemplates(params)
      .then(res => {
        setTemplates(res.data || []);
        setTotal(res.total ?? (res.data?.length || 0));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, pageSize, channelFilter]);

  // Reset to page 1 whenever the page-size or channel filter changes.
  useEffect(() => { setPage(1); }, [pageSize, channelFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function openPreview(tpl) {
    setPreviewDevice('desktop');
    setPreview({ template: tpl, html: null, loading: true });
    try {
      const res = await previewTemplate(tpl.id);
      setPreview({ template: tpl, html: res?.data?.html || '', loading: false });
    } catch (err) {
      setPreview({ template: tpl, html: `<pre style="padding:20px;color:#f87171">${err.message || 'Preview failed'}</pre>`, loading: false });
    }
  }

  // AI preview — renders the real Claude-ranked version (slow, ~15-25s first call)
  async function openPreviewAI(tpl) {
    setPreviewDevice('desktop');
    setPreview({ template: tpl, html: null, loading: true, ai: true });
    try {
      const res = await previewTemplateAI(tpl.id);
      setPreview({ template: tpl, html: res?.data?.html || '', loading: false, ai: true });
    } catch (err) {
      setPreview({ template: tpl, html: `<pre style="padding:20px;color:#f87171">${err.message || 'AI preview failed'}</pre>`, loading: false, ai: true });
    }
  }

  function openCreate() {
    setForm({ ...BLANK_FORM });
    setDynVars([]);
    setModal('create');
  }

  async function openEdit(tpl) {
    // Open immediately with whatever the list row has (may be empty body for
    // templates linked via html_template_id) so the modal feels instant…
    setForm({
      name: tpl.name || '',
      channel: tpl.channel || 'email',
      subject: tpl.subject || '',
      body: tpl.body || '',
      fileName: tpl.body ? 'existing-template.html' : '',
    });
    setDynVars(extractVars(tpl.body || ''));
    setModal(tpl);

    // …then fetch the full record. getById now LEFT JOINs email_html_templates
    // and returns the SOURCE html_body so the editor shows the actual template
    // (with Liquid tags intact), not a rendered output. Falls back to the
    // server-rendered preview if no source HTML exists.
    try {
      const res = await getTemplate(tpl.id);
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
        const res = await previewTemplate(tpl.id);
        const html = res?.data?.html || '';
        if (html) {
          setForm(f => ({ ...f, body: html, fileName: 'existing-template.html' }));
          setDynVars(extractVars(html));
        }
      } catch { /* leave editor empty if render fails */ }
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const html = ev.target.result;
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
      hotToast.error(err.message || 'Failed to delete template');
    } finally {
      setDeleting(null);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) { hotToast.error('Template name is required'); return; }
    if (!form.body.trim()) { hotToast.error('Please upload an HTML file'); return; }

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
        const res = await createTemplate(payload);
        setTemplates(prev => [res.data, ...prev]);
        setTotal(t => t + 1);
        hotToast.success('Template created');
      } else {
        const res = await updateTemplate(modal.id, payload);
        setTemplates(prev => prev.map(t => t.id === modal.id ? res.data : t));
        hotToast.success('Template updated');
      }
      setModal(null);
    } catch (err) {
      hotToast.error(err.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="spinner">Loading templates...</div>;

  // Channel filter is now server-side, so the list we render is already filtered.
  const filtered = templates;

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ padding: 24 }}>
      <motion.div variants={fadeInUp} style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Content Templates</h1>
            <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}
              –{(page - 1) * pageSize + filtered.length} of {total} templates
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 'all', label: 'All' },
                ...CHANNELS,
              ].map(ch => {
                const Icon = ch.icon;
                const active = channelFilter === ch.key;
                return (
                  <button
                    key={ch.key}
                    onClick={() => setChannelFilter(ch.key)}
                    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    {Icon && <Icon size={13} />}
                    {ch.label}
                  </button>
                );
              })}
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={openCreate}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={14} /> Add Template
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── Recipients (for Test Send) ── */}
      <motion.div variants={fadeInUp} style={{ marginBottom: 16, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <Send size={14} color="#16a34a" /> Recipients · {selectedEmails.length} selected of {recipTotal.toLocaleString()}
          </div>
          {selectedEmails.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedEmails([])} style={{ fontSize: 11 }}>Clear selection</button>
          )}
        </div>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input className="form-input" placeholder="Filter by email or name… (min 2 chars)" value={recipQuery}
            onChange={e => setRecipQuery(e.target.value)} style={{ paddingLeft: 36, width: '100%' }} />
        </div>
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            maxHeight: 260,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {recipLoading && recipients.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading…</div>
          )}
          {!recipLoading && recipients.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No contacts</div>
          )}
          {recipients.map((c) => {
            const email = c.email || c.actual_email;
            const checked = selectedEmails.includes(email);

            return (
              <label
                key={c.id || email}
                onClick={() => toggleRecipient(email)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  background: checked
                    ? 'rgba(34,197,94,0.06)'
                    : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  style={{
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                />

                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        color: 'var(--text-primary)',
                        wordBreak: 'break-word',
                      }}
                    >
                      {email}
                    </span>

                    {c.contact_type && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(139,92,246,0.12)',
                          color: '#8b5cf6',
                        }}
                      >
                        {c.contact_type}
                      </span>
                    )}

                    {c.booking_status && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(34,197,94,0.12)',
                          color: '#16a34a',
                        }}
                      >
                        {c.booking_status}
                      </span>
                    )}
                  </div>

                  {(c.name || c.country) && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {c.name}
                      {c.country && ` • ${c.country}`}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      </motion.div>

      {/* ── Email Tracking Flow ── */}
      <motion.div variants={fadeInUp} style={{ marginBottom: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>📧 Email Tracking Flow</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {[
            { label: 'Sent', value: flowStats.sent, color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
            { label: 'Opened', value: flowStats.opened, color: '#16a34a', bg: 'rgba(34,197,94,0.08)' },
            { label: 'Clicked', value: flowStats.clicked, color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
            { label: 'UTM Captured', value: flowStats.utm, color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
            { label: 'Failed', value: flowStats.failed, color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '14px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-auto" style={{ gap: 16 }}>
        {filtered.map(t => {
          const Icon = CHANNEL_ICON[t.channel] || Mail;
          return (
            <div key={t.id} style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
              padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge ${STATUS_BADGE[t.status] || 'badge-gray'}`}>{t.status}</span>
                <span className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon size={12} /> {t.channel}
                </span>
                {t.segment_label && <span className="badge badge-gray">{t.segment_label}</span>}
                {/* (i) View stored QA report — Day 1-7 email templates */}
                {t.id >= 1 && t.id <= 7 && t.channel === 'email' && (
                  <button onClick={() => viewStoredReport(t)} title="View email QA report"
                    style={{ marginLeft: 'auto', width: 26, height: 26, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: '#3b82f6', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Info size={15} />
                  </button>
                )}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{t.name}</div>
                {t.subject && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Subject: {t.subject}</div>}
              </div>
              {(t.body_plain || t.body) && (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {t.body_plain || stripHtml(t.body)}
                </div>
              )}
              {t.cta_text && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>CTA: {t.cta_text}</div>
              )}
              {(() => {
                const hasAI = t.id >= 1 && t.id <= 7 && t.channel === 'email';
                const previewBtn = (
                  <button className="btn btn-secondary btn-sm" onClick={() => openPreview(t)} style={{ gap: 6, flex: 1 }}>
                    <Eye size={14} /> Preview
                  </button>
                );
                const editBtn = (
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(t)} style={{ gap: 6, flex: 1 }}>
                    <Edit2 size={14} /> Edit
                  </button>
                );
                const deleteBtn = (
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(t)} disabled={deleting === t.id}
                    style={{ gap: 6, flex: 1, color: 'var(--red, #ef4444)' }} title="Delete template">
                    <Trash2 size={14} />{deleting === t.id ? '…' : 'Delete'}
                  </button>
                );
                const aiBtn = (
                  <button className="btn btn-sm" onClick={() => openPreviewAI(t)}
                    style={{ gap: 6, flex: 1, background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.25)' }}>
                    <Sparkles size={14} /> Preview AI Template
                  </button>
                );
                const noRecipients = selectedEmails.length === 0;
                const isSending = sendingDay === t.id;
                const rockySending = isSending && sendingMode === 'rocky';
                const selSending = isSending && sendingMode === 'selected';
                // Button 1 — always enabled: sends the AI template to the fixed QA inbox (Rocky)
                const rockyBtn = (
                  <button className="btn btn-sm" onClick={() => handleCardTestSend(t, { emails: [ROCKY_EMAIL], mode: 'rocky' })}
                    disabled={isSending}
                    title={`Send a QA test to ${ROCKY_EMAIL}`}
                    style={{ gap: 6, flex: 1, background: 'rgba(59,130,246,0.1)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.25)', cursor: isSending ? 'not-allowed' : 'pointer', opacity: isSending && !rockySending ? 0.5 : 1 }}>
                    <Send size={14} /> {rockySending ? 'Sending…' : 'Test Send'}
                  </button>
                );
                // Button 2 — disabled until ≥1 recipient selected: sends to selected users
                const selectedBtn = (
                  <button className="btn btn-sm" onClick={() => handleCardTestSend(t, { emails: selectedEmails, mode: 'selected' })}
                    disabled={noRecipients || isSending}
                    title={noRecipients ? 'Select recipients above first' : `Send to ${selectedEmails.length} selected`}
                    style={{ gap: 6, flex: 1, background: 'rgba(34,197,94,0.1)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.25)', cursor: noRecipients || isSending ? 'not-allowed' : 'pointer', opacity: noRecipients || (isSending && !selSending) ? 0.5 : 1 }}>
                    <Send size={14} /> {selSending ? 'Sending…' : noRecipients ? 'Test Send (select recipients)' : `Test Send to ${selectedEmails.length} selected`}
                  </button>
                );
                // Email Day 1-7 (hasAI) → Preview/AI · Edit/Delete · two Test Send buttons
                return hasAI ? (
                  <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8 }}>{previewBtn}{aiBtn}</div>
                    <div style={{ display: 'flex', gap: 8 }}>{editBtn}{deleteBtn}</div>
                    <div style={{ display: 'flex', gap: 8 }}>{rockyBtn}{selectedBtn}</div>
                  </div>
                ) : (
                  <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
                    {previewBtn}{editBtn}{deleteBtn}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </motion.div>

      {/* ── Pagination ── */}
      {total > 0 && (
        <motion.div
          variants={fadeInUp}
          style={{
            marginTop: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            padding: '12px 16px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="form-input"
              style={{ padding: '4px 8px', fontSize: 13, width: 'auto', minWidth: 64 }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ marginLeft: 8 }}>
              Page <strong style={{ color: 'var(--text-primary)' }}>{page}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{totalPages}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage(1)}
              disabled={page === 1}
              style={{ opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? 'not-allowed' : 'pointer' }}
              title="First page"
            >«</button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{ opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? 'not-allowed' : 'pointer' }}
            >Prev</button>

            {/* Compact page numbers: show first, last, current ±1, with ellipses */}
            {(() => {
              const pages = new Set([1, totalPages, page, page - 1, page + 1]);
              const visible = [...pages]
                .filter((p) => p >= 1 && p <= totalPages)
                .sort((a, b) => a - b);
              const out = [];
              visible.forEach((p, i) => {
                if (i > 0 && p - visible[i - 1] > 1) {
                  out.push(<span key={`gap-${p}`} style={{ padding: '0 4px', color: 'var(--text-tertiary)' }}>…</span>);
                }
                out.push(
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ minWidth: 32 }}
                  >
                    {p}
                  </button>
                );
              });
              return out;
            })()}

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{ opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
            >Next</button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              style={{ opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
              title="Last page"
            >»</button>
          </div>
        </motion.div>
      )}

      {/* ── Delete Confirm Modal ── */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => setConfirmDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ background: 'var(--card)', borderRadius: 16, width: '100%', maxWidth: 420, boxShadow: '0 24px 80px rgba(0,0,0,0.3)', overflow: 'hidden' }}
            >
              <div style={{ padding: '28px 28px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Trash2 size={20} color="#ef4444" />
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Delete Template</div>
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, paddingLeft: 54 }}>
                  Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>{confirmDelete.name}</strong>? This action cannot be undone.
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 28px', borderTop: '1px solid var(--border)' }}>
                <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
                <button
                  className="btn btn-sm"
                  onClick={confirmAndDelete}
                  style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* ── Email QA Report Modal (after Test Send) ── */}
      {qaReport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setQaReport(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 14, maxWidth: 640, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>📋 Email QA Report</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {qaReport.template.name}
                  {qaReport.report?.generatedAt ? ` — stored ${new Date(qaReport.report.generatedAt).toLocaleString()}` : ' — analyzed'}
                </div>
              </div>
              <button onClick={() => setQaReport(null)} className="btn btn-ghost btn-sm"><X size={18} /></button>
            </div>
            <div style={{ padding: '18px 22px', overflow: 'auto', flex: 1 }}>
              {qaLoading ? (
                <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-secondary)' }}>
                  <Sparkles size={28} style={{ color: '#8b5cf6', marginBottom: 12 }} />
                  <div style={{ fontWeight: 600 }}>Generating report…</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Grammar · content · URLs · delivering & checking real inbox placement (~30-50s)</div>
                </div>
              ) : qaReport.report?.error ? (
                <div style={{ padding: 16, borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 13 }}>Analysis failed: {qaReport.report.error}</div>
              ) : qaReport.report ? (() => {
                const r = qaReport.report;
                const Section = ({ icon, title, items, okText, danger }) => (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>{icon} {title}</div>
                    {items.length === 0 ? (
                      <div style={{ fontSize: 13, color: '#16a34a' }}>✓ {okText}</div>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {items.map((it, i) => <li key={i} style={{ fontSize: 13, color: danger ? '#ef4444' : 'var(--text-primary)' }}>{it}</li>)}
                      </ul>
                    )}
                  </div>
                );
                const sr = r.spamRisk || {};
                const srColor = sr.level === 'High' ? '#ef4444' : sr.level === 'Medium' ? '#f59e0b' : '#16a34a';
                return (
                  <div>
                    {/* SPAM CHECK = real IMAP placement in rocky's inbox (auto after send) */}
                    {(() => {
                      const known = placement?.available && placement.placement !== 'not_found';
                      const isInbox = placement?.placement === 'inbox';
                      const c = known ? (isInbox ? '#16a34a' : '#ef4444') : '#3b82f6';
                      return (
                        <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: c + '14', border: `1px solid ${c}40` }}>
                          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 6 }}>📬 Spam Check (real — rocky's inbox)</div>
                          {placementLoading && !known ? (
                            <div style={{ fontSize: 13, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Delivering & checking rocky's Gmail… (~15-40s)
                            </div>
                          ) : known ? (
                            <div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{isInbox ? 'INBOX ✅ — not spam' : 'SPAM ❌'}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Verified in rocky.86agency@gmail.com via IMAP{placement.foundAt ? ` · ${new Date(placement.foundAt).toLocaleString()}` : ''}</div>
                            </div>
                          ) : (
                            <div>
                              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{placement?.error ? `⚠ ${placement.error}` : (placement?.note || 'Not found yet in the inbox.')}</div>
                              <button className="btn btn-sm" onClick={checkPlacement} disabled={placementLoading}
                                style={{ marginTop: 8, gap: 6, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.25)' }}>
                                {placementLoading ? 'Checking…' : '🔍 Re-check now'}
                              </button>
                            </div>
                          )}
                          {/* heuristic as a small secondary hint */}
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                            Quick heuristic: <span style={{ color: srColor, fontWeight: 700 }}>{sr.level}</span> risk{sr.reasons?.length ? ` — ${sr.reasons.slice(0,2).join('; ')}` : ''}
                          </div>
                        </div>
                      );
                    })()}
                    <Section icon="✍️" title="Grammar" items={r.grammar || []} okText="No grammar issues found" />
                    <Section icon="📦" title="Missing Content" items={r.missingContent || []} okText="No missing content" danger />
                    {/* URLs */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>🔗 URLs ({r.urls?.total || 0} found, {r.urls?.broken || 0} broken)</div>
                      {(r.urls?.results || []).length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No links</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflow: 'auto' }}>
                          {r.urls.results.map((u, i) => (
                            <div key={i} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: u.ok ? '#16a34a' : '#ef4444', fontWeight: 700, flexShrink: 0 }}>{u.ok ? '✓' : '✗'} {u.status || u.error}</span>
                              <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.url}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Section icon="⚠️" title="Other Errors" items={r.errors || []} okText="No other issues" danger />
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>Content analysis: {r.analysisSource === 'claude' ? 'Claude AI' : r.analysisSource}</div>
                  </div>
                );
              })() : null}
            </div>
          </div>
        </div>
      )}

      {/* ── Preview Modal ── */}
      {preview && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setPreview(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 'var(--radius-xl)', maxWidth: previewDevice === 'tablet' ? 840 : 720, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {preview.template.name}
                  {preview.ai && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>✨ AI</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {preview.template.channel} · {preview.template.segment_label || 'ALL'} · {preview.template.status}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Device-view toggle */}
                <div style={{ display: 'flex', gap: 2, background: 'var(--bg-secondary)', borderRadius: 8, padding: 2 }}>
                  {[
                    { key: 'desktop', icon: Monitor,    label: 'Desktop' },
                    { key: 'tablet',  icon: Tablet,     label: 'Tablet'  },
                    { key: 'mobile',  icon: Smartphone, label: 'Mobile'  },
                  ].map(d => {
                    const DIcon = d.icon;
                    const active = previewDevice === d.key;
                    return (
                      <button key={d.key} onClick={() => setPreviewDevice(d.key)} title={d.label}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 30, borderRadius: 6, border: 'none', cursor: 'pointer',
                          background: active ? 'var(--card)' : 'transparent', color: active ? 'var(--brand-primary, #3b82f6)' : 'var(--text-tertiary)', boxShadow: active ? 'var(--shadow)' : 'none' }}>
                        <DIcon size={15} />
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setPreview(null)} className="btn btn-ghost btn-sm"><X size={18} /></button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: previewDevice === 'desktop' ? '#fff' : 'var(--bg-secondary)', display: 'flex', justifyContent: 'center', padding: previewDevice === 'desktop' ? 0 : '16px 0' }}>
              {preview.loading ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#888' }}>
                  {preview.ai ? '✨ Generating AI preview with Claude… (~15-25s)' : 'Rendering preview…'}
                </div>
              ) : (() => {
                const frameW = { desktop: null, tablet: 768, mobile: 390 }[previewDevice];
                // Inject a viewport meta so responsive emails reflow at the iframe width.
                const VP = '<meta name="viewport" content="width=device-width, initial-scale=1">';
                let html = preview.html || '';
                if (!/name=["']viewport["']/i.test(html)) {
                  html = /<head[^>]*>/i.test(html)
                    ? html.replace(/<head[^>]*>/i, m => `${m}${VP}`)
                    : `${VP}${html}`;
                }
                if (previewDevice === 'desktop') {
                  return (
                    <iframe ref={previewIframeRef} srcDoc={html} onLoad={fitPreview}
                      style={{ width: '100%', height: '70vh', border: 0, background: '#fff' }}
                      title={preview.template.name} />
                  );
                }
                // Device frame: render the iframe at the email's NATURAL content width
                // (so it has no internal horizontal scrollbar), then scale that whole
                // iframe down to fit the device frame — Gmail-style "fit to width".
                const contentW = previewFit.contentW || frameW;
                const scale = contentW > frameW ? frameW / contentW : 1;
                const innerH = previewFit.contentH || Math.round((window.innerHeight * 0.7) / scale);
                return (
                  <div style={{ width: frameW, maxWidth: '100%', height: previewFit.height || '70vh', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                    <iframe ref={previewIframeRef} srcDoc={html} onLoad={fitPreview}
                      style={{ width: contentW, height: innerH, border: 0, background: '#fff',
                        transform: `scale(${scale})`, transformOrigin: 'top left' }}
                      title={preview.template.name} />
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      <AnimatePresence>
        {modal !== null && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => !saving && setModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 1040, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {modal === 'create' ? 'Add Template' : 'Edit Template'}
                </div>
                <button onClick={() => !saving && setModal(null)} className="btn btn-ghost btn-sm"><X size={18} /></button>
              </div>

              {/* Body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Name */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Template Name *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Summer Sale Announcement"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>

                {/* Channel */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Channel</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {CHANNELS.map(ch => {
                      const Icon = ch.icon;
                      const active = form.channel === ch.key;
                      return (
                        <button
                          key={ch.key}
                          onClick={() => setForm(f => ({ ...f, channel: ch.key }))}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: active ? '1.5px solid var(--brand-primary)' : '1.5px solid var(--border-color)', background: active ? 'color-mix(in srgb, var(--brand-primary) 12%, transparent)' : 'transparent', color: active ? 'var(--brand-primary)' : 'var(--text-secondary)' }}
                        >
                          <Icon size={13} /> {ch.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Subject — email only */}
                {form.channel === 'email' && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Subject Line</label>
                    <input
                      className="form-input"
                      placeholder="e.g. Your Exclusive Offer Awaits 🎉"
                      value={form.subject}
                      onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                    />
                  </div>
                )}

                {/* HTML body — edit directly with live preview, or upload a file */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>HTML Template *</label>
                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--brand-primary)', cursor: 'pointer', padding: '4px 10px', border: '1px solid var(--border-color)', borderRadius: 6 }}>
                      <Upload size={12} /> Upload .html
                      <input type="file" accept=".html,.htm,text/html" onChange={handleFileChange} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, height: 380 }}>
                    {/* Editor */}
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>HTML</div>
                      <textarea
                        value={form.body}
                        onChange={e => {
                          const html = e.target.value;
                          setForm(f => ({ ...f, body: html, fileName: html.trim() ? (f.fileName || 'inline-template.html') : '' }));
                          setDynVars(extractVars(html));
                        }}
                        spellCheck={false}
                        placeholder="<html>…</html> — edit directly. Use {{KEY}} placeholders (e.g. {{USER_NAME}}, {{ITEM_NAME}})."
                        style={{ flex: 1, width: '100%', resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', whiteSpace: 'pre', overflow: 'auto' }}
                      />
                    </div>
                    {/* Live preview (sample data) — server-rendered via Liquid
                        so {% case %} / {% if %} blocks expand correctly. */}
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Live Preview · sample data
                        </div>
                        {livePreviewLoading && (
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> rendering…
                          </div>
                        )}
                      </div>
                      <iframe
                        title="template-preview"
                        srcDoc={
                          form.body
                            ? (livePreviewHtml || fillPreviewHtml(form.body))
                            : '<div style="font-family:sans-serif;color:#9ca3af;padding:16px;font-size:13px">Preview appears here as you type…</div>'
                        }
                        style={{ flex: 1, width: '100%', borderRadius: 8, border: '1px solid var(--border-color)', background: '#fff' }}
                      />
                    </div>
                  </div>
                </div>

                {/* Show detected custom variables as read-only chips (system vars excluded) */}
                {form.body && dynVars.filter(v => !SYSTEM_VARS.has(v.key)).length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                    <Braces size={13} color="var(--brand-primary)" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Variables:</span>
                    {dynVars.filter(v => !SYSTEM_VARS.has(v.key)).map(v => (
                      <span key={v.key} style={{ fontSize: 11, fontFamily: 'monospace', background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', color: 'var(--brand-primary)', padding: '2px 7px', borderRadius: 5, fontWeight: 700 }}>
                        {`{{${v.key}}}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid var(--border-color)' }}>
                <button className="btn btn-ghost" onClick={() => !saving && setModal(null)} disabled={saving}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 100 }}>
                  {saving ? 'Saving…' : modal === 'create' ? 'Create Template' : 'Save Changes'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
