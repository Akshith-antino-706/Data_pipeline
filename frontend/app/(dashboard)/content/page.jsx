'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getTemplates, previewTemplate, createTemplate, updateTemplate } from '@/lib/api';
import { Eye, X, Mail, MessageCircle, Smartphone, Bell, Plus, Upload, Edit2, FileText, Braces } from 'lucide-react';
import hotToast from 'react-hot-toast';

const STATUS_BADGE = { draft: 'badge-gray', pending_approval: 'badge-orange', approved: 'badge-green', rejected: 'badge-red' };
const CHANNEL_ICON = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, push: Bell };
const CHANNELS = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'sms', label: 'SMS', icon: Smartphone },
  { key: 'push', label: 'Push', icon: Bell },
];

const BLANK_FORM = { name: '', channel: 'email', subject: '', body: '', ctaText: '', ctaUrl: '', fileName: '' };

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
      ctaText: tpl.cta_text || '',
      ctaUrl: tpl.cta_url || '',
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

  function applyVars(html) {
    let result = html;
    dynVars.forEach(({ key, value }) => {
      if (value.trim()) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value.trim());
      }
    });
    return result;
  }

  async function handleSave() {
    if (!form.name.trim()) { hotToast.error('Template name is required'); return; }
    if (!form.body.trim()) { hotToast.error('Please upload an HTML file'); return; }

    setSaving(true);
    const resolvedBody = applyVars(form.body);
    try {
      const payload = {
        name: form.name.trim(),
        channel: form.channel,
        subject: form.subject.trim() || null,
        body: resolvedBody,
        bodyPlain: stripHtml(resolvedBody),
        ctaText: form.ctaText.trim() || null,
        ctaUrl: form.ctaUrl.trim() || null,
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
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openPreview(t)} style={{ gap: 6 }}>
                  <Eye size={14} /> Preview
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(t)} style={{ gap: 6 }}>
                  <Edit2 size={14} /> Edit
                </button>
              </div>
            </div>
          );
        })}
      </motion.div>

      {/* ── Preview Modal ── */}
      {preview && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setPreview(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 'var(--radius-xl)', maxWidth: 720, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{preview.template.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {preview.template.channel} · {preview.template.segment_label || 'ALL'} · {preview.template.status}
                </div>
              </div>
              <button onClick={() => setPreview(null)} className="btn btn-ghost btn-sm"><X size={18} /></button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
              {preview.loading ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#888' }}>Rendering preview…</div>
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

                {/* Dynamic Variables */}
                {form.body && dynVars.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                    No <code style={{ fontSize: 11 }}>{`{{variables}}`}</code> found in this template.
                  </div>
                )}
                {dynVars.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                      <Braces size={14} color="var(--brand-primary)" />
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Template Variables ({dynVars.length})
                      </span>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '4px 0', maxHeight: 260, overflowY: 'auto' }}>
                      {dynVars.map((v, i) => (
                        <div key={v.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: i < dynVars.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, fontFamily: 'monospace', background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', color: 'var(--brand-primary)', padding: '2px 7px', borderRadius: 5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {`{{${v.key}}}`}
                            </span>
                          </div>
                          <input
                            className="form-input"
                            style={{ fontSize: 12, padding: '5px 10px' }}
                            placeholder={`Value for ${v.key}`}
                            value={v.value}
                            onChange={e => {
                              const val = e.target.value;
                              setDynVars(prev => prev.map((d, idx) => idx === i ? { ...d, value: val } : d));
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                      Filled values will be baked into the saved HTML. Leave blank to keep as a dynamic placeholder.
                    </div>
                  </div>
                )}

                {/* CTA */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>CTA Text</label>
                    <input
                      className="form-input"
                      placeholder="e.g. Book Now"
                      value={form.ctaText}
                      onChange={e => setForm(f => ({ ...f, ctaText: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>CTA URL</label>
                    <input
                      className="form-input"
                      placeholder="https://..."
                      value={form.ctaUrl}
                      onChange={e => setForm(f => ({ ...f, ctaUrl: e.target.value }))}
                    />
                  </div>
                </div>
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
