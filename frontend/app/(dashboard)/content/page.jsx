'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getTemplates, previewTemplate } from '@/lib/api';
import { Eye, X, Mail, MessageCircle, Smartphone, Bell } from 'lucide-react';

const STATUS_BADGE = { draft: 'badge-gray', pending_approval: 'badge-orange', approved: 'badge-green', rejected: 'badge-red' };
const CHANNEL_ICON = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, push: Bell };

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

export default function Content() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);          // { template, html, loading }

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

  if (loading) return <div className="spinner">Loading templates...</div>;

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ padding: 24 }}>
      <motion.div variants={fadeInUp} style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Content Templates</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          {templates.length} day-templates · server-rendered from <code>mail_templates/</code>
        </p>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid-auto" style={{ gap: 16 }}>
        {templates.map(t => {
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
              {t.body && (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {t.body}
                </div>
              )}
              {t.cta_text && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>CTA: {t.cta_text}</div>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => openPreview(t)} style={{ alignSelf: 'flex-start', gap: 6 }}>
                <Eye size={14} /> Preview
              </button>
            </div>
          );
        })}
      </motion.div>

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
    </motion.div>
  );
}
