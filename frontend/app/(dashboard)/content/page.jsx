'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getTemplates, previewTemplate, previewTemplateAI, createTemplate, updateTemplate, deleteTemplate, sendTestDay } from '@/lib/api';
import { Eye, X, Mail, MessageCircle, Smartphone, Bell, Plus, Upload, Edit2, FileText, Braces, Trash2, Sparkles, Send, Search } from 'lucide-react';
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

const SYSTEM_VARS = new Set(['first_name', 'full_name', 'email', 'phone', 'country', 'city', 'company', 'segment', 'unsubscribe_link', 'utm_link']);

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const stripHtml = (html) => {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

export default function Content() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [channelFilter, setChannelFilter] = useState('all');

  // modal state: null = closed, 'create' = new, object = editing existing
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [dynVars, setDynVars] = useState([]); // [{ key: 'first_name', value: '' }, ...]
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // template object to confirm

  // ── Global recipients (shared by all card Test Send buttons) ──
  const [recipients, setRecipients] = useState([]);        // searched/listed contacts
  const [recipQuery, setRecipQuery] = useState('');
  const [recipTotal, setRecipTotal] = useState(0);
  const [recipLoading, setRecipLoading] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState([]); // globally selected
  const [sendingDay, setSendingDay] = useState(null);       // templateId currently sending
  const [flowStats, setFlowStats] = useState({ sent: 0, opened: 0, clicked: 0, utm: 0, failed: 0 });

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

  async function handleCardTestSend(tpl) {
    if (selectedEmails.length === 0) return;
    const day = tpl.id; // template id 1-7 == day number
    setSendingDay(tpl.id);
    try {
      const data = await sendTestDay(day, selectedEmails);
      hotToast.success(`Sent ${tpl.name} to ${data?.sent ?? selectedEmails.length} recipient(s)`);
    } catch (err) {
      hotToast.error(err.message || 'Send failed');
    } finally { setSendingDay(null); }
  }

  function extractVars(html) {
    const matches = [...html.matchAll(/\{\{(\w+)\}\}/g)];
    const unique = [...new Set(matches.map(m => m[1]))];
    return unique.map(key => ({ key, value: '' }));
  }

  useEffect(() => {
    getTemplates({ limit: 50 })
      .then(res => { setTemplates(res.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function openPreview(tpl) {
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

  function openEdit(tpl) {
    const body = tpl.body || '';
    setForm({
      name: tpl.name || '',
      channel: tpl.channel || 'email',
      subject: tpl.subject || '',
      body,
      fileName: body ? 'existing-template.html' : '',
    });
    setDynVars(extractVars(body));
    setModal(tpl);
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

  const filtered = channelFilter === 'all'
    ? templates
    : templates.filter(t => t.channel === channelFilter);

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ padding: 24 }}>
      <motion.div variants={fadeInUp} style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Content Templates</h1>
            <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              {filtered.length} of {templates.length} templates
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
                const testSendBtn = (
                  <button className="btn btn-sm" onClick={() => handleCardTestSend(t)}
                    disabled={noRecipients || isSending}
                    title={noRecipients ? 'Select recipients above first' : `Send to ${selectedEmails.length}`}
                    style={{ gap: 6, width: '100%', background: 'rgba(34,197,94,0.1)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.25)', cursor: noRecipients || isSending ? 'not-allowed' : 'pointer', opacity: noRecipients ? 0.5 : 1 }}>
                    <Send size={14} /> {isSending ? 'Sending…' : noRecipients ? 'Test Send (select recipients)' : `Test Send to ${selectedEmails.length}`}
                  </button>
                );
                // Email Day 1-7 (hasAI) → Preview/AI · Edit/Delete · Test Send (full width)
                return hasAI ? (
                  <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8 }}>{previewBtn}{aiBtn}</div>
                    <div style={{ display: 'flex', gap: 8 }}>{editBtn}{deleteBtn}</div>
                    {testSendBtn}
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


      {/* ── Preview Modal ── */}
      {preview && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setPreview(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 'var(--radius-xl)', maxWidth: 720, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
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
              <button onClick={() => setPreview(null)} className="btn btn-ghost btn-sm"><X size={18} /></button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
              {preview.loading ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#888' }}>
                  {preview.ai ? '✨ Generating AI preview with Claude… (~15-25s)' : 'Rendering preview…'}
                </div>
              ) : (
                <iframe
                  srcDoc={preview.html}
                  style={{ width: '100%', height: '70vh', border: 0, background: '#fff' }}
                  title={preview.template.name}
                />
              )}
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
              style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}
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

                {/* HTML file upload */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>HTML Template File *</label>
                  <div style={{ position: 'relative', border: `2px dashed ${form.body ? 'var(--green)' : 'var(--border-color)'}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: form.body ? 'color-mix(in srgb, var(--green) 5%, transparent)' : 'var(--bg-secondary)', transition: 'all 0.2s', overflow: 'hidden' }}>
                    {/* invisible overlay input — most reliable cross-browser approach */}
                    <input
                      type="file"
                      accept=".html,.htm,text/html"
                      onChange={handleFileChange}
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', zIndex: 2 }}
                    />
                    {form.body ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
                        <FileText size={24} color="var(--green)" />
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{form.fileName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Click to replace</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
                        <Upload size={24} color="var(--text-tertiary)" />
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Click to upload HTML file</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Accepts .html / .htm files</div>
                      </div>
                    )}
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
