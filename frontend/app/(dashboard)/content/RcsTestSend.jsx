'use client';

/**
 * RCS Test Send — the RCS (Google RBM) analogue of the SMS / WhatsApp test-send
 * cards. Enter a Gupshup-issued RCS templateCode + one test number and fire a
 * single RCS message via POST /api/v3/gupshup/rcs/test-send.
 *
 * RCS templates are NOT stored in content_templates — Gupshup creates them on
 * the RBM portal and gives you a templateCode after approval, so this card takes
 * the templateCode directly (plus optional {{VAR}} params as JSON). Until the
 * account is RCS-provisioned the endpoint runs in simulation mode.
 */
import { useState, useEffect } from 'react';
import { Radio, Send, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getRcsConfig, rcsTestSend } from '@/lib/api';

export default function RcsTestSend() {
  const [configured, setConfigured] = useState(null); // null = loading
  const [templateCode, setTemplateCode] = useState('');
  const [phone, setPhone]         = useState('');
  const [name, setName]           = useState('');
  const [paramsText, setParamsText] = useState('');   // optional JSON: {"DISCOUNT":"20%"}
  const [smsFallback, setSmsFallback] = useState(''); // optional SMS text if RCS fails
  const [sending, setSending]     = useState(false);
  const [result, setResult]       = useState(null);

  useEffect(() => {
    getRcsConfig().then(r => setConfigured(!!r.data?.configured)).catch(() => setConfigured(false));
  }, []);

  const digits = phone.replace(/[^\d]/g, '');
  let paramsErr = null, customParams = null;
  if (paramsText.trim()) {
    try { customParams = JSON.parse(paramsText); } catch { paramsErr = 'Params must be valid JSON, e.g. {"DISCOUNT":"20%"}'; }
  }
  const canSend = digits.length >= 10 && digits.length <= 15 && templateCode.trim() && !paramsErr && !sending;

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
        Send one RCS message to a test number via Gupshup (mediaapi/RBM host). Use the <b>templateCode</b> issued by Gupshup after your RCS template is approved. Requires RBM agent onboarding to actually deliver.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Template code
          <input value={templateCode} onChange={e => setTemplateCode(e.target.value)} placeholder="e.g. emergency_fund" style={{ ...ctrl, marginTop: 4 }} />
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
          <input value={paramsText} onChange={e => setParamsText(e.target.value)} placeholder='{"DISCOUNT":"20%","CODE":"DISC"}' style={{ ...ctrl, marginTop: 4 }} />
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
    </div>
  );
}
