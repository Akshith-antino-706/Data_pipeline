'use client';

/**
 * RCS Test Send — the RCS (Google RBM) analogue of the SMS / WhatsApp test-send
 * cards. Pick an approved RCS template (or type a templateCode), enter one test
 * number, and fire a single RCS message via POST /api/v3/gupshup/rcs/test-send.
 *
 * Templates are listed from the Gupshup console (CTM) API — the send API itself
 * has no template-list endpoint. The eye button previews the selected template's
 * body / buttons / image. Until RCS creds are set the send runs in simulation mode.
 */
import { useState, useEffect } from 'react';
import { Radio, Send, Loader2, CheckCircle2, XCircle, Eye, X } from 'lucide-react';
import { getRcsConfig, getRcsTemplates, rcsTestSend } from '@/lib/api';

const DEFAULT_CODE = 'test_raynatrans';

export default function RcsTestSend() {
  const [configured, setConfigured] = useState(null); // null = loading
  const [templates, setTemplates]   = useState([]);
  const [tplErr, setTplErr]         = useState(null);
  const [templateCode, setTemplateCode] = useState(DEFAULT_CODE);
  const [phone, setPhone]           = useState('');
  const [name, setName]             = useState('');
  const [paramsText, setParamsText] = useState('');
  const [smsFallback, setSmsFallback] = useState('');
  const [sending, setSending]       = useState(false);
  const [result, setResult]         = useState(null);
  const [preview, setPreview]       = useState(null); // template object shown in the modal

  useEffect(() => {
    getRcsConfig().then(r => setConfigured(!!r.data?.configured)).catch(() => setConfigured(false));
    getRcsTemplates()
      .then(r => {
        if (r?.success === false) { setTplErr(r.error || 'Could not load templates'); return; }
        setTemplates(r.data || []);
      })
      .catch(e => setTplErr(e.message));
  }, []);

  const digits = phone.replace(/[^\d]/g, '');
  let paramsErr = null, customParams = null;
  if (paramsText.trim()) {
    try { customParams = JSON.parse(paramsText); } catch { paramsErr = 'Params must be valid JSON, e.g. {"DISCOUNT":"20%"}'; }
  }
  const canSend = digits.length >= 10 && digits.length <= 15 && templateCode.trim() && !paramsErr && !sending;
  const selectedTpl = templates.find(t => t.code === templateCode) || null;

  const send = async () => {
    setSending(true); setResult(null);
    try {
      const r = await rcsTestSend({ phone: digits, name, templateCode: templateCode.trim(), customParams, smsFallback: smsFallback.trim() || undefined });
      const res = r?.data?.result || {};
      const msg = res.simulated
        ? 'Simulated (no RCS creds set) — logged, not delivered'
        : r.success ? 'Sent' : `Send failed${res.error ? ` — ${res.error}` : ''}`;
      setResult({ ok: !!r.success || !!res.simulated, msg });
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    } finally { setSending(false); }
  };

  const ctrl = {
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, width: '100%',
  };

  return (
    <div className="card" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Radio size={18} color="#0ea5e9" />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>RCS Test Send</h3>
        {configured !== null && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
            background: configured ? 'rgba(34,197,94,0.14)' : 'rgba(148,163,184,0.18)',
            color: configured ? '#16a34a' : 'var(--text-tertiary)' }}>
            {configured ? 'Credentials set' : 'Simulation mode'}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', margin: '0 0 14px' }}>
        Send one RCS message to a test number via Gupshup. Templates are listed from the Gupshup console; the eye button previews the selected template. Requires an approved RCS template + RBM agent to actually deliver.
      </p>

      {tplErr && <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 10 }}>⚠ Template list unavailable: {tplErr} — you can still type a templateCode manually.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Template
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {templates.length > 0 ? (
              <select value={templateCode} onChange={e => setTemplateCode(e.target.value)} style={{ ...ctrl, flex: 1 }}>
                {!templates.some(t => t.code === templateCode) && <option value={templateCode}>{templateCode}</option>}
                {templates.map(t => (
                  <option key={t.code} value={t.code}>
                    {t.code}{t.status && t.status !== 'APPROVED' ? ` (${t.status})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input value={templateCode} onChange={e => setTemplateCode(e.target.value)} placeholder="e.g. test_raynatrans" style={{ ...ctrl, flex: 1 }} />
            )}
            <button type="button" onClick={() => setPreview(selectedTpl || { code: templateCode, body: '(no preview — template not in the loaded list)', buttons: [] })}
              title="Preview template"
              style={{ padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <Eye size={15} />
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Custom params (optional JSON)
          <input value={paramsText} onChange={e => setParamsText(e.target.value)} placeholder='{"DISCOUNT":"20%"}' style={{ ...ctrl, marginTop: 4 }} />
          {paramsErr && <span style={{ display: 'block', color: '#ef4444', fontSize: 11, marginTop: 4 }}>{paramsErr}</span>}
        </label>

        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          SMS fallback text (optional)
          <input value={smsFallback} onChange={e => setSmsFallback(e.target.value)} placeholder="Sent if RCS can't deliver" style={{ ...ctrl, marginTop: 4 }} />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={send} disabled={!canSend} className="btn btn-sm"
          style={{ gap: 6, background: canSend ? '#0ea5e9' : 'var(--bg-secondary)', color: canSend ? '#fff' : 'var(--text-tertiary)', border: 'none', padding: '8px 16px', cursor: canSend ? 'pointer' : 'not-allowed' }}>
          {sending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
          {sending ? 'Sending…' : 'Test Send (RCS)'}
        </button>
        {result && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: result.ok ? '#16a34a' : '#ef4444' }}>
            {result.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {result.msg}
          </span>
        )}
      </div>

      {preview && <RcsPreviewModal tpl={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function RcsPreviewModal({ tpl, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 14, maxWidth: 420, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>📱 RCS Preview</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {tpl.code}{tpl.status ? ` · ${tpl.status}` : ''}{tpl.type ? ` · ${tpl.type}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm"><X size={18} /></button>
        </div>
        <div style={{ padding: 18, overflow: 'auto' }}>
          {/* Phone-style bubble */}
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', maxWidth: 300 }}>
            {tpl.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tpl.image} alt="" style={{ width: '100%', display: 'block', maxHeight: 180, objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
            )}
            <div style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {tpl.body || <span style={{ color: 'var(--text-tertiary)' }}>(no body text)</span>}
              </div>
              {Array.isArray(tpl.buttons) && tpl.buttons.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                  {tpl.buttons.map((b, i) => (
                    <div key={i} style={{ textAlign: 'center', padding: '7px 10px', borderRadius: 20, border: '1px solid #0ea5e9', color: '#0ea5e9', fontSize: 12.5, fontWeight: 600 }}>
                      {b.text || 'Button'}{b.action ? ` ↗` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
