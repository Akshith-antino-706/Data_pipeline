'use client';

/**
 * Create WhatsApp Template — submits a NEW WhatsApp template to ChatHead → Meta review,
 * via POST /api/v3/chathead/templates/create. Handles every category / format / button
 * type + enum from the ChatHead Templates API:
 *   category : utility | marketing | authentication
 *   formate  : text | media_image | media_document | media_video   (non-auth)
 *   buttons  : quick_reply(text) · call_to_action(url|phone) · url_dynamic(url + {{1}}) · OTP(COPY_CODE)
 *   auth-only: add_security_recommendation, code_expiration_minutes
 *
 * Styled to match the other content-screen cards (WhatsApp Test Send etc.):
 * `card` wrapper, --bg-secondary / --border / --text-* tokens, `btn btn-sm`.
 */
import { useState, useEffect, useMemo } from 'react';
import { MessageSquarePlus, Plus, Trash2, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getWhatsAppChannels, createWhatsAppTemplate, getWhatsAppTemplateStatus } from '@/lib/api';

const CATEGORIES = [
  { value: 'utility',        label: 'Utility',        hint: 'Order / booking updates' },
  { value: 'marketing',      label: 'Marketing',      hint: 'Promotions & offers' },
  { value: 'authentication', label: 'Authentication', hint: 'OTP / verification' },
];
const FORMATS = [
  { value: 'text',           label: 'Text only' },
  { value: 'media_image',    label: 'Image header' },
  { value: 'media_document', label: 'Document header' },
  { value: 'media_video',    label: 'Video header' },
];
const BLANK_BTN = { type: 'quick_reply', sub_type: 'text', value: '', text: '', example: '' };

// shared control + label styles (mirrors WhatsAppTestSend)
const ctrl = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, width: '100%' };
const labelStyle = { fontSize: 11.5, color: 'var(--text-tertiary)', display: 'block' };
const sectionLabel = { fontSize: 11.5, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' };

export default function CreateWhatsAppTemplate() {
  const [channels, setChannels] = useState([]);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({
    channel: '', name: '', category: 'marketing', formate: 'text',
    body: '', footer_text: '', media_file: '',
    add_security_recommendation: true, code_expiration_minutes: 10,
  });
  const [examples, setExamples] = useState({});
  const [buttons, setButtons] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => { getWhatsAppChannels().then(r => setChannels(r.data || [])).catch(e => setErr(e.message)); }, []);

  const isAuth = f.category === 'authentication';
  const isMedia = !isAuth && f.formate !== 'text';

  const placeholders = useMemo(() => {
    const found = [...String(f.body).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1]);
    return [...new Set(found)];
  }, [f.body]);

  const addButton = () => setButtons(b => [...b, { ...BLANK_BTN }]);
  const updateButton = (i, patch) => setButtons(b => b.map((x, j) => j === i ? { ...x, ...patch } : x));
  const removeButton = (i) => setButtons(b => b.filter((_, j) => j !== i));

  const submit = async () => {
    setResult(null); setSubmitting(true);
    try {
      const payload = { channel: f.channel, name: f.name.trim(), category: f.category };
      if (isAuth) {
        payload.add_security_recommendation = !!f.add_security_recommendation;
        payload.code_expiration_minutes = Number(f.code_expiration_minutes) || 10;
        payload.buttons = [{ type: 'OTP', otp_type: 'COPY_CODE' }];
      } else {
        payload.formate = f.formate;
        payload.body = f.body;
        if (placeholders.length) payload.body_examples = Object.fromEntries(placeholders.map(p => [p, examples[p] || '']));
        if (f.footer_text.trim()) payload.footer_text = f.footer_text.trim();
        if (isMedia) payload.media_file = f.media_file.trim();
        if (buttons.length) {
          payload.buttons = buttons.map(b => {
            if (b.type === 'quick_reply') return { type: 'quick_reply', sub_type: 'text', value: b.value };
            if (b.type === 'url_dynamic') return { type: 'url_dynamic', sub_type: 'url', value: b.value, text: b.text, example: b.example };
            return { type: 'call_to_action', sub_type: b.sub_type, value: b.value, text: b.text };
          });
        }
      }
      const r = await createWhatsAppTemplate(payload);
      setResult({ ok: !!r.success, data: r.data, msg: r.msg, error: r.error });
    } catch (e) {
      setResult({ ok: false, error: e.message });
    } finally { setSubmitting(false); }
  };

  const checkStatus = async () => {
    if (!result?.data?.template_id) return;
    const r = await getWhatsAppTemplateStatus(result.data.template_id).catch(e => ({ error: e.message }));
    setResult(p => ({ ...p, statusData: r.data, statusError: r.error }));
  };

  const nameValid = /^[a-z0-9_]+$/.test(f.name);
  const canSubmit = f.channel && nameValid && !submitting &&
    (isAuth || (f.body.trim() && (!isMedia || f.media_file.trim())));

  return (
    <div className="card" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <MessageSquarePlus size={18} color="#25D366" />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Create WhatsApp Template</h3>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', margin: '0 0 14px' }}>
        Submit a new WhatsApp template to ChatHead for Meta review. Supports every category, format and button type.
      </p>

      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>Couldn’t load WhatsApp channels: {err}</div>}

      {/* Channel + name */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <label style={labelStyle}>
          Channel
          <select value={f.channel} onChange={e => set('channel', e.target.value)} style={{ ...ctrl, marginTop: 4 }}>
            <option value="">Select channel</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name} (#{c.id})</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          Template name (a-z, 0-9, _)
          <input value={f.name} onChange={e => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
            placeholder="rayna_booking_confirmation" style={{ ...ctrl, marginTop: 4, borderColor: f.name && !nameValid ? '#ef4444' : 'var(--border)' }} />
        </label>
      </div>

      {/* Category */}
      <label style={{ ...sectionLabel, display: 'block', marginBottom: 6 }}>Category</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
        {CATEGORIES.map(c => {
          const on = f.category === c.value;
          return (
            <button key={c.value} type="button" onClick={() => set('category', c.value)}
              style={{ padding: '9px 11px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                border: `1px solid ${on ? '#25D366' : 'var(--border)'}`, background: on ? 'rgba(37,211,102,0.10)' : 'var(--bg-secondary)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: on ? '#128C4B' : 'var(--text-primary)' }}>{c.label}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>{c.hint}</div>
            </button>
          );
        })}
      </div>

      {isAuth ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
          <label style={labelStyle}>
            Code expiry (minutes)
            <input type="number" min="1" max="90" value={f.code_expiration_minutes} onChange={e => set('code_expiration_minutes', e.target.value)} style={{ ...ctrl, marginTop: 4 }} />
          </label>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', paddingBottom: 9 }}>
            <input type="checkbox" checked={f.add_security_recommendation} onChange={e => set('add_security_recommendation', e.target.checked)} />
            Add security recommendation
          </label>
          <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            Authentication templates auto-include a <strong>COPY_CODE OTP</strong> button — no body or media needed.
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
            <label style={labelStyle}>
              Format
              <select value={f.formate} onChange={e => set('formate', e.target.value)} style={{ ...ctrl, marginTop: 4 }}>
                {FORMATS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {isMedia && (
              <label style={labelStyle}>
                Media file URL ({f.formate.replace('media_', '')})
                <input value={f.media_file} onChange={e => set('media_file', e.target.value)} placeholder="https://…/example.jpg" style={{ ...ctrl, marginTop: 4 }} />
              </label>
            )}
          </div>

          <label style={labelStyle}>
            Body — use {'{{placeholder}}'} for variables
            <textarea value={f.body} onChange={e => set('body', e.target.value)} rows={4}
              placeholder="Hi {{customer_name}}, your booking {{booking_id}} is confirmed…"
              style={{ ...ctrl, marginTop: 4, minHeight: 90, resize: 'vertical', fontFamily: 'inherit' }} />
          </label>

          {placeholders.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: 6 }}>Example values (for review)</label>
              <div style={{ display: 'grid', gap: 8 }}>
                {placeholders.map(ph => (
                  <div key={ph} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ fontSize: 12, minWidth: 130, color: 'var(--text-secondary)' }}>{`{{${ph}}}`}</code>
                    <input value={examples[ph] || ''} onChange={e => setExamples(x => ({ ...x, [ph]: e.target.value }))} placeholder={`example for ${ph}`} style={ctrl} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <label style={{ ...labelStyle, display: 'block', marginTop: 12 }}>
            Footer (optional)
            <input value={f.footer_text} onChange={e => set('footer_text', e.target.value)} placeholder="Rayna Tours - raynatours.com" style={{ ...ctrl, marginTop: 4 }} />
          </label>

          {/* Buttons */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={sectionLabel}>Buttons (optional)</span>
              <button type="button" onClick={addButton} className="btn btn-sm" style={{ gap: 5, padding: '5px 10px' }}>
                <Plus size={13} /> Add button
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {buttons.map((b, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg-secondary)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={b.type} onChange={e => {
                      const type = e.target.value;
                      const sub_type = type === 'quick_reply' ? 'text' : 'url';
                      updateButton(i, { ...BLANK_BTN, type, sub_type });
                    }} style={{ ...ctrl, flex: 1 }}>
                      <option value="quick_reply">Quick reply</option>
                      <option value="call_to_action">Call to action</option>
                      <option value="url_dynamic">Dynamic URL ({'{{1}}'})</option>
                    </select>
                    {b.type === 'call_to_action' && (
                      <select value={b.sub_type} onChange={e => updateButton(i, { sub_type: e.target.value })} style={{ ...ctrl, width: 110 }}>
                        <option value="url">URL</option>
                        <option value="phone">Phone</option>
                      </select>
                    )}
                    <button type="button" onClick={() => removeButton(i)} title="Remove"
                      style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: '#ef4444', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: b.type === 'quick_reply' ? '1fr' : 'repeat(auto-fit, minmax(180px,1fr))', gap: 8, marginTop: 8 }}>
                    {b.type === 'quick_reply' ? (
                      <input value={b.value} onChange={e => updateButton(i, { value: e.target.value })} placeholder="Button label (e.g. View Deals)" style={ctrl} />
                    ) : (
                      <>
                        <input value={b.text} onChange={e => updateButton(i, { text: e.target.value })} placeholder="Button text (e.g. Book Now)" style={ctrl} />
                        <input value={b.value} onChange={e => updateButton(i, { value: e.target.value })} placeholder={b.sub_type === 'phone' ? '+971500000000' : (b.type === 'url_dynamic' ? 'https://…/track/{{1}}' : 'https://…')} style={ctrl} />
                        {b.type === 'url_dynamic' && <input value={b.example} onChange={e => updateButton(i, { example: e.target.value })} placeholder="Example for {{1}} (e.g. RT-1001)" style={{ ...ctrl, gridColumn: '1 / -1' }} />}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={submit} disabled={!canSubmit} className="btn btn-sm"
          style={{ gap: 6, border: 'none', padding: '8px 16px', background: canSubmit ? '#25D366' : 'var(--bg-secondary)', color: canSubmit ? '#fff' : 'var(--text-tertiary)', cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          {submitting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <MessageSquarePlus size={14} />}
          {submitting ? 'Submitting…' : 'Submit for Meta review'}
        </button>
        {f.name && !nameValid && <span style={{ fontSize: 12, color: '#ef4444' }}>name: lowercase, digits, underscores only</span>}
      </div>

      {result && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 8, border: `1px solid ${result.ok ? '#25D36655' : '#ef444455'}`, background: result.ok ? 'rgba(37,211,102,0.07)' : 'rgba(239,68,68,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: result.ok ? '#16a34a' : '#ef4444' }}>
            {result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {result.ok ? 'Template submitted!' : 'Submission failed'}
          </div>
          {result.ok ? (
            <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div>template_id: <code>{result.data?.template_id}</code></div>
              <div>meta_id: <code>{result.data?.meta_id}</code></div>
              <div>status: <strong>{result.statusData?.meta_status || result.data?.meta_status}</strong></div>
              <div style={{ marginTop: 6 }}>
                <button type="button" onClick={checkStatus} className="btn btn-sm" style={{ padding: '5px 12px' }}>Refresh status</button>
                {result.statusError && <span style={{ color: '#ef4444', marginLeft: 8 }}>{result.statusError}</span>}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 6, fontSize: 12.5, color: '#ef4444' }}>{result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
