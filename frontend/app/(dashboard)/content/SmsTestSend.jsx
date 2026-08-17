'use client';

/**
 * SMS Test Send — the SMS analogue of the Email and WhatsApp test-send cards.
 * Pick a Gupshup SMS template (from content_templates, channel='sms'), enter one
 * test number, and fire a single SMS via POST /api/v3/gupshup/sms/test-send.
 * Fully isolated: the endpoint calls GupshupService.sendSMS directly and does not
 * touch the JOURNEY_SMS_ENABLED worker or any live journey.
 */
import { useState, useEffect } from 'react';
import { MessageSquare, Send, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getSmsConfig, getSmsTemplates, smsTestSend } from '@/lib/api';

export default function SmsTestSend() {
  const [configured, setConfigured] = useState(null); // null = loading
  const [templates, setTemplates]   = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [phone, setPhone]           = useState('');
  const [name, setName]             = useState('');
  const [sending, setSending]       = useState(false);
  const [result, setResult]         = useState(null);
  const [err, setErr]               = useState(null);

  useEffect(() => {
    getSmsConfig().then(r => setConfigured(!!r.data?.configured)).catch(() => setConfigured(false));
    getSmsTemplates()
      .then(r => setTemplates(r.data || []))
      .catch(e => setErr(e.message));
  }, []);

  const digits = phone.replace(/[^\d]/g, '');
  const canSend = digits.length >= 10 && digits.length <= 15 && templateId && !sending;
  const tpl = templates.find(t => String(t.id) === String(templateId));
  const firstName = name ? name.split(' ')[0] : 'there';
  const previewBody = (tpl?.body || '').replace(/\{\{first_name\}\}/g, firstName);

  const send = async () => {
    setSending(true); setResult(null);
    try {
      const r = await smsTestSend({ phone: digits, name, templateId });
      const res = r?.data?.result || {};
      const msg = res.blocked
        ? 'Blocked — template not DLT-approved'
        : res.simulated
          ? 'Simulated (no SMS creds set) — logged, not delivered'
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
        <MessageSquare size={18} color="#6366f1" />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>SMS Test Send</h3>
        {configured !== null && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
            background: configured ? 'rgba(34,197,94,0.14)' : 'rgba(148,163,184,0.18)',
            color: configured ? '#16a34a' : 'var(--text-tertiary)' }}>
            {configured ? 'Credentials set' : 'Simulation mode'}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', margin: '0 0 14px' }}>
        Send one SMS to a test number via Gupshup. Templates come from content templates (SMS channel) and must be DLT-approved to actually deliver.
      </p>

      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>Couldn’t load SMS templates: {err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Template
          <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={{ ...ctrl, marginTop: 4 }}>
            <option value="">{templates.length ? 'Select template' : 'No SMS templates'}</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.external_status && t.external_status !== 'approved' ? ` (${t.external_status})` : ''}
              </option>
            ))}
          </select>
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

      {tpl && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700, marginBottom: 6 }}>
            Preview {tpl.external_status && tpl.external_status !== 'approved' ? `· ⚠ template status: ${tpl.external_status}` : ''}
          </div>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', maxWidth: 360 }}>
            {previewBody || <span style={{ color: 'var(--text-tertiary)' }}>(template has no body)</span>}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={send} disabled={!canSend} className="btn btn-sm"
          style={{ gap: 6, background: canSend ? '#6366f1' : 'var(--bg-secondary)', color: canSend ? '#fff' : 'var(--text-tertiary)', border: 'none', padding: '8px 16px', cursor: canSend ? 'pointer' : 'not-allowed' }}>
          {sending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
          {sending ? 'Sending…' : 'Test Send (SMS)'}
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
