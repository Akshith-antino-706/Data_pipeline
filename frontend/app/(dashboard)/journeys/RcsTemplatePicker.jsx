'use client';

/**
 * RCS (Gupshup RBM) template picker for the journey builder — mirrors the WhatsApp
 * picker. Loads approved RCS templates once from the official Gupshup RCS Template
 * List API (via /api/v3/gupshup/rcs/templates) and returns the selected template's
 * code + metadata to store on the node.
 *
 * value:    { rcsTemplateCode }
 * onChange: ({ rcsTemplateCode, rcsTemplateName, rcsTemplateType, rcsTemplateStatus }) => void
 */
import { useState, useEffect } from 'react';
import { getRcsTemplates } from '@/lib/api';

export default function RcsTemplatePicker({ value, onChange }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [note, setNote]           = useState(null);
  const code = value?.rcsTemplateCode || '';

  useEffect(() => {
    let cancelled = false;
    getRcsTemplates()
      .then(r => {
        if (cancelled) return;
        if (r?.success === false) { setNote(r.error || 'Could not load RCS templates'); setTemplates([]); return; }
        setTemplates(r.data || []);
        if ((r.data || []).length === 0 && r.note) setNote(r.note);
      })
      .catch(e => { if (!cancelled) setNote(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const ctrl = {
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, width: '100%',
  };

  const pick = (c) => {
    const t = templates.find(x => String(x.code) === String(c));
    onChange?.({
      rcsTemplateCode:   c || null,
      rcsTemplateName:   t?.name || c || null,
      rcsTemplateType:   t?.type || null,
      rcsTemplateStatus: t?.status || null,
    });
  };

  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>RCS Template</label>
      {templates.length > 0 ? (
        <select value={code} onChange={e => pick(e.target.value)} disabled={loading} style={ctrl}>
          <option value="">{loading ? 'Loading templates…' : 'Select RCS template'}</option>
          {templates.map(t => (
            <option key={t.code} value={t.code}>
              {t.code}{t.status && t.status !== 'Approved' ? ` (${t.status})` : ''}{t.type ? ` · ${t.type}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input value={code} onChange={e => pick(e.target.value)} placeholder="RCS templateCode" style={ctrl} />
      )}
      {note && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{note}</div>}
    </div>
  );
}
