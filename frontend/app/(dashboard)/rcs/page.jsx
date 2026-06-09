'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Send, RefreshCcw, Loader2, CheckCircle2, XCircle, MessageSquare,
  History, AlertTriangle, Phone, Sparkles, FileText, Image as ImageIcon,
  Type, ChevronDown, ChevronUp, Zap, Users,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j.data ?? j;
}
async function apiPost(path, body) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j.data ?? j;
}

const STATUS = {
  queued:    { color: '#64748b', bg: '#f1f5f9', label: 'Queued' },
  submitted: { color: '#d97706', bg: '#fef3c7', label: 'Submitted' },
  sent:      { color: '#2563eb', bg: '#dbeafe', label: 'Sent' },
  delivered: { color: '#16a34a', bg: '#dcfce7', label: 'Delivered' },
  read:      { color: '#7c3aed', bg: '#ede9fe', label: 'Read' },
  failed:    { color: '#dc2626', bg: '#fee2e2', label: 'Failed' },
};

const card  = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 16 };
const input = { width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--background)', color: 'var(--text-primary)', outline: 'none' };
const labelStyle = { fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, display: 'block' };
const sectionTitle = { fontSize: 13, fontWeight: 700, margin: 0, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 };
const stepNumber = { width: 22, height: 22, borderRadius: '50%', background: '#7c3aed', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const pill = (palette) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: palette.color, background: palette.bg });

function relTime(iso) {
  if (!iso) return '—';
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec/60)}m ago`;
  if (sec < 86400) return `${Math.round(sec/3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function deriveStatus(row) {
  if (row.read_at)      return 'read';
  if (row.delivered_at) return 'delivered';
  if (row.failed_at)    return 'failed';
  return row.status || 'submitted';
}

// Approved templates we know about, captured from the Gupshup console.
// To add a new one: paste its `code`, infer the bot from the workspace,
// list variable names from {{...}} placeholders, copy the body/image/buttons
// from the template-details DevTools capture into `body`.
const KNOWN_TEMPLATES = [
  {
    code: 'test_raynapromo',
    bot: 'Promotional',
    type: 'Standalone Card',
    description: 'Rich card promoting Rayna activities/cruises/visas with Click here button.',
    variables: [],
    icon: ImageIcon,
    body: {
      kind: 'standalone_card',
      title: 'Rayna Tours - Book Activities, Events, Yachts, Cruises, Visas …',
      text: 'Explore top activities, visa services, events, yacht rentals, cruise trips and holiday packages with Rayna Tours. Easy booking and great deals.',
      // From the Gupshup Templates screenshot — Rayna Tours marketing banner
      mediaUrl: 'https://fss.gupshup.io/0/public/0/0/gupshup/3380/rayna-tours-hero.jpeg',
      buttons: [
        { type: 'URL', text: 'Click here', url: 'https://www.raynatours.com/' },
      ],
    },
  },
  {
    code: 'test12345',
    bot: 'Promotional',
    type: 'Standalone Card',
    description: 'USA Visa apply card. Substitutes {{custom_param}} into "Hi {{custom_param}}, Apply For USA Visa".',
    variables: ['custom_param'],
    icon: ImageIcon,
    body: {
      kind: 'standalone_card',
      title: 'Welcome To Rayna Tours',
      text: 'Hi {{custom_param}}, Apply For USA Visa',
      mediaUrl: 'https://fss.gupshup.io/0/public/0/0/gupshup/3380/b26ff81a-aed8-4119-9694-5ce6fb2deb13/1779182120312_Instagram%20post%20-%2091.jpeg',
      buttons: [
        { type: 'URL', text: 'Apply Now', url: 'https://www.raynatours.com/' },
      ],
    },
  },
  {
    code: 'test_raynatrans',
    bot: 'Transactional',
    type: 'Text',
    description: 'Inquiry acknowledgement — "Dear Customer, We have received your inquiry...". Awaiting Trans bot creds.',
    variables: [],
    icon: Type,
    disabled: true,
    body: {
      kind: 'text',
      text: 'Dear Customer,\nWe have received your inquiry placed on website. Our representative will reach out to you within 24 hours. Thanks for choosing Rayna Tours',
      buttons: [
        { type: 'URL', text: 'Click here', url: 'https://www.raynatours.com/terms-and-condition' },
      ],
    },
  },
];

// Quick-fill presets to save typing for repeated tests.
const QUICK_RECIPIENTS = [
  { label: 'My number', phones: ['919019533772'] },
];

export default function RCSPage() {
  const [config, setConfig] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const loadConfig = useCallback(async () => {
    try { setConfig(await apiGet('/api/v3/gupshup/rcs/config')); }
    catch (e) { setConfig({ configured: false }); }
  }, []);
  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    try { setMessages(await apiGet('/api/v3/gupshup/rcs/messages?limit=50')); }
    catch (e) { setMessages([]); }
    finally { setMessagesLoading(false); }
  }, []);
  useEffect(() => { loadConfig(); loadMessages(); }, [loadConfig, loadMessages]);

  return (
    <div style={{ padding: 32, maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <MessageSquare size={28} style={{ color: '#7c3aed' }} />
            RCS Send
          </h1>
          <p style={{ marginTop: 6, color: 'var(--muted-foreground)', fontSize: 13 }}>
            Per-message send via Gupshup&apos;s documented GatewayAPI/rest. One API call per recipient.
          </p>
        </div>
        {config && (
          <div style={pill(config.configured ? STATUS.delivered : STATUS.failed)}>
            {config.configured ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {config.configured ? 'Credentials set' : 'Not configured'}
          </div>
        )}
      </div>

      {config && !config.configured && (
        <div style={{ ...card, borderColor: '#fde68a', background: '#fffbeb' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertTriangle size={18} style={{ color: '#d97706', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: '#92400e' }}>
              <strong>Gupshup credentials not set.</strong> Set <code>GUPSHUP_SMS_USER_ID</code> and <code>GUPSHUP_SMS_PASSWORD</code> in <code>backend/.env</code> and restart.
            </div>
          </div>
        </div>
      )}

      <SendForm onSent={loadMessages} configured={config?.configured} bot={config?.bot} />

      <HistoryTable rows={messages} loading={messagesLoading} onRefresh={loadMessages} />
    </div>
  );
}

// ─── Send form ─────────────────────────────────────────────────────
function SendForm({ onSent, configured, bot }) {
  const [selectedCode, setSelectedCode] = useState(KNOWN_TEMPLATES[0].code);
  const [customCode, setCustomCode]     = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [customParamsText, setCustomParamsText] = useState('');
  const [showPreview, setShowPreview]   = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);

  const selectedTemplate = useMemo(() => {
    if (selectedCode === '__custom__') return null;
    return KNOWN_TEMPLATES.find(t => t.code === selectedCode) || null;
  }, [selectedCode]);

  const effectiveCode = selectedCode === '__custom__' ? customCode.trim() : selectedCode;

  // Auto-populate the customParams JSON skeleton when a template with vars is picked
  useEffect(() => {
    if (!selectedTemplate || selectedTemplate.variables.length === 0) {
      if (customParamsText.trim() === '' || /^\{\s*"\w+"\s*:\s*""\s*\}$/.test(customParamsText.trim())) {
        setCustomParamsText('');
      }
      return;
    }
    // If field is empty or matches an old skeleton, refresh the skeleton with new vars
    const isEmptyOrSkeleton = customParamsText.trim() === '' || /^\{[^{}]*""[^{}]*\}$/.test(customParamsText.trim());
    if (isEmptyOrSkeleton) {
      const skeleton = {};
      selectedTemplate.variables.forEach(v => { skeleton[v] = ''; });
      setCustomParamsText(JSON.stringify(skeleton, null, 2));
    }
  }, [selectedTemplate]);  // eslint-disable-line

  const phones = useMemo(() => {
    return recipientsText.split(/[\n,]/)
      .map(s => s.trim().replace(/^\+/, ''))
      .filter(s => /^\d{7,15}$/.test(s));
  }, [recipientsText]);

  const customParams = useMemo(() => {
    if (!customParamsText.trim()) return null;
    try { return JSON.parse(customParamsText); } catch { return undefined; }
  }, [customParamsText]);

  const requestPreview = useMemo(() => {
    if (!effectiveCode || phones.length === 0) return null;
    const inner = { contentMessage: { templateMessage: { templateCode: effectiveCode } } };
    if (customParams && Object.keys(customParams).length > 0) {
      inner.contentMessage.templateMessage.customParams = JSON.stringify(customParams);
    }
    return {
      method: 'POST',
      url: 'https://enterprise.smsgupshup.com/GatewayAPI/rest',
      form: {
        method: 'SendMessage',
        send_to: phones[0] + (phones.length > 1 ? `  (+${phones.length - 1} more)` : ''),
        msg: JSON.stringify(inner),
        msg_type: 'TEXT',
        auth_scheme: 'plain',
        v: '1.1',
        format: 'json',
      },
    };
  }, [effectiveCode, phones, customParams]);

  function addQuickRecipient(phones) {
    const existing = new Set(recipientsText.split(/[\n,]/).map(s => s.trim().replace(/^\+/, '')).filter(Boolean));
    const newOnes = phones.filter(p => !existing.has(p));
    if (!newOnes.length) return;
    setRecipientsText(prev => prev.trim() ? `${prev.trim()}\n${newOnes.join('\n')}` : newOnes.join('\n'));
  }

  async function handleSend() {
    setError(null); setResult(null);
    if (!effectiveCode) return setError('Template code required');
    if (phones.length === 0)  return setError('Enter at least one valid phone number');
    if (customParams === undefined) return setError('Custom params must be valid JSON (or leave empty)');
    if (selectedTemplate?.variables?.length > 0) {
      const missing = selectedTemplate.variables.filter(v => !customParams?.[v] || String(customParams[v]).trim() === '');
      if (missing.length) return setError(`Template requires values for: ${missing.join(', ')}`);
    }
    setSending(true);
    try {
      const r = await apiPost('/api/v3/gupshup/rcs/send', {
        templateCode: effectiveCode,
        recipients: phones,
        customParams,
      });
      setResult(r);
      onSent?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  const promoTemplates = KNOWN_TEMPLATES.filter(t => t.bot === 'Promotional');
  const transTemplates = KNOWN_TEMPLATES.filter(t => t.bot === 'Transactional');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={card}>
        <h3 style={sectionTitle}><span style={stepNumber}>1</span> Compose</h3>

        {bot?.id && (
          <div style={{ marginBottom: 14, padding: 10, background: 'var(--background)', borderRadius: 6, fontSize: 11, color: 'var(--muted-foreground)' }}>
            Routes via bot <strong>{bot.brand}</strong> ({bot.category || 'unknown category'})
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, marginTop: 2 }}>{bot.id}</div>
          </div>
        )}

        {/* Template picker */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Template</label>
          <select
            style={input}
            value={selectedCode}
            onChange={e => setSelectedCode(e.target.value)}
          >
            <optgroup label="Promotional bot">
              {promoTemplates.map(t => (
                <option key={t.code} value={t.code} disabled={t.disabled}>
                  {t.code} — {t.type}{t.variables.length ? ` (needs: ${t.variables.join(', ')})` : ''}
                </option>
              ))}
            </optgroup>
            <optgroup label="Transactional bot (creds pending)">
              {transTemplates.map(t => (
                <option key={t.code} value={t.code} disabled={t.disabled}>
                  {t.code} — {t.type} {t.disabled ? '— awaiting creds' : ''}
                </option>
              ))}
            </optgroup>
            <option value="__custom__">— Custom template code —</option>
          </select>
          {selectedCode === '__custom__' && (
            <input
              style={{ ...input, marginTop: 8 }}
              placeholder="Paste an approved template code from the Gupshup console"
              value={customCode}
              onChange={e => setCustomCode(e.target.value)}
            />
          )}
          {selectedTemplate && (
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 6, padding: 8, background: 'var(--background)', borderRadius: 6 }}>
              <selectedTemplate.icon size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {selectedTemplate.description}
            </div>
          )}
        </div>

        {/* Recipients */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>
            Recipients
            <span style={{ float: 'right', color: 'var(--muted-foreground)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              {phones.length} valid
            </span>
          </label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            {QUICK_RECIPIENTS.map(q => (
              <button
                key={q.label}
                type="button"
                onClick={() => addQuickRecipient(q.phones)}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 500,
                  border: '1px solid var(--border)', borderRadius: 14,
                  background: 'var(--background)', color: 'var(--text-primary)',
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <Zap size={10} /> {q.label}
              </button>
            ))}
          </div>
          <textarea
            style={{ ...input, minHeight: 90, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            placeholder={'919019533772\n919876543210'}
            value={recipientsText}
            onChange={e => setRecipientsText(e.target.value)}
          />
        </div>

        {/* Custom params */}
        {(selectedTemplate?.variables?.length > 0 || selectedCode === '__custom__') && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>
              Custom Params (JSON)
              {customParams === undefined && <span style={{ color: '#dc2626', float: 'right', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>invalid JSON</span>}
            </label>
            <textarea
              style={{ ...input, minHeight: 70, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
              placeholder={selectedTemplate?.variables?.length ? `{"${selectedTemplate.variables[0]}":"..."}` : '{"VAR":"value"}'}
              value={customParamsText}
              onChange={e => setCustomParamsText(e.target.value)}
            />
            {selectedTemplate?.variables?.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4 }}>
                Required: {selectedTemplate.variables.map(v => <code key={v} style={{ marginRight: 6 }}>{v}</code>)}
              </div>
            )}
          </div>
        )}

        {/* Request preview (collapsible) */}
        {requestPreview && (
          <div style={{ marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => setShowPreview(p => !p)}
              style={{
                background: 'transparent', border: 'none', color: 'var(--muted-foreground)',
                cursor: 'pointer', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: 0,
              }}
            >
              {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showPreview ? 'Hide' : 'Show'} request payload
            </button>
            {showPreview && (
              <pre style={{
                marginTop: 6, padding: 10, background: 'var(--background)', borderRadius: 6,
                fontSize: 10, lineHeight: 1.5, overflow: 'auto', maxHeight: 200,
                fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)',
              }}>
{`POST ${requestPreview.url}
Content-Type: application/x-www-form-urlencoded

method=${requestPreview.form.method}
send_to=${requestPreview.form.send_to}
msg=${requestPreview.form.msg}
msg_type=${requestPreview.form.msg_type}
auth_scheme=${requestPreview.form.auth_scheme}
v=${requestPreview.form.v}
format=${requestPreview.form.format}
userid=<from env>
password=<from env>`}
              </pre>
            )}
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={sending || !configured || phones.length === 0 || !effectiveCode || customParams === undefined}
          style={{
            width: '100%', padding: '12px', fontSize: 13, fontWeight: 600,
            background: sending ? '#a78bfa' : '#7c3aed', color: '#fff',
            border: 'none', borderRadius: 8, cursor: sending ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: (!configured || phones.length === 0 || !effectiveCode || customParams === undefined) ? 0.5 : 1,
          }}
        >
          {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          {sending ? 'Sending…' : `Send to ${phones.length} recipient${phones.length === 1 ? '' : 's'}`}
        </button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={card}>
        <h3 style={sectionTitle}>
          <span style={stepNumber}>2</span> {result ? 'Result' : 'Preview'}
        </h3>

        {!sending && !result && !error && (
          <TemplatePreview template={selectedTemplate} customParams={customParams} />
        )}

        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20, fontSize: 13 }}>
            <Loader2 size={16} className="spin" /> Sending {phones.length} request{phones.length === 1 ? '' : 's'} to Gupshup…
          </div>
        )}

        {error && (
          <div style={{ padding: 16, background: '#fee2e2', borderRadius: 8, color: '#991b1b' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <XCircle size={14} /> Failed
            </div>
            <div style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{error}</div>
          </div>
        )}

        {result && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={pill(result.sent === result.total ? STATUS.delivered : (result.sent === 0 ? STATUS.failed : STATUS.submitted))}>
                {result.sent}/{result.total} sent
              </span>
              {result.failed > 0 && <span style={pill(STATUS.failed)}>{result.failed} failed</span>}
            </div>
            <div style={{ background: 'var(--background)', borderRadius: 8, padding: 10, maxHeight: 280, overflowY: 'auto' }}>
              {result.results?.map((r, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 4px', borderBottom: i < result.results.length - 1 ? '1px solid var(--border)' : 'none',
                  fontSize: 12,
                }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{r.phone}</span>
                  {r.success ? (
                    <span style={{ color: '#16a34a', fontSize: 11 }}>
                      <CheckCircle2 size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {r.externalId ? `id: ${String(r.externalId).slice(0, 20)}…` : 'sent'}
                    </span>
                  ) : (
                    <span style={{ color: '#dc2626', fontSize: 11, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.error}>
                      <XCircle size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {r.error || 'failed'}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {result.failed > 0 && result.results.some(r => /method.*not.*supported/i.test(r.error || '')) && (
              <div style={{ marginTop: 12, padding: 10, background: '#fef3c7', borderRadius: 6, fontSize: 11, color: '#92400e' }}>
                <strong>Heads up:</strong> Gupshup is rejecting <code>SendMessage</code> on this account. Open a support ticket asking them to enable the legacy GatewayAPI/rest <code>SendMessage</code> method for your account.
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ─── History table ────────────────────────────────────────────────
function HistoryTable({ rows, loading, onRefresh }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ ...sectionTitle, marginBottom: 0 }}>
          <History size={14} /> Recent sends ({rows.length})
        </h3>
        <button onClick={onRefresh} disabled={loading} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '6px 10px', fontSize: 11, fontWeight: 500,
          border: '1px solid var(--border)', borderRadius: 6,
          background: 'var(--background)', color: 'var(--text-primary)', cursor: 'pointer',
        }}>
          <RefreshCcw size={12} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
          <Loader2 size={18} className="spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
          <FileText size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div>No sends yet.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--background)', textAlign: 'left' }}>
                {['ID', 'Phone', 'Template', 'Status', 'Sent', 'Delivered', 'Read', 'Failure'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const s = deriveStatus(r);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={td}>{r.id}</td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>
                      <Phone size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      {r.destination}
                    </td>
                    <td style={td}>{r.template_code || '—'}</td>
                    <td style={td}>
                      <span style={pill(STATUS[s] || STATUS.queued)}>{(STATUS[s] || STATUS.queued).label}</span>
                      {r.error_code && <span style={{ marginLeft: 6, fontSize: 10, color: '#dc2626' }}>{r.error_code}</span>}
                    </td>
                    <td style={td}>{relTime(r.sent_at)}</td>
                    <td style={td}>{relTime(r.delivered_at)}</td>
                    <td style={td}>{relTime(r.read_at)}</td>
                    <td style={{ ...td, color: r.error_reason ? '#dc2626' : 'var(--muted-foreground)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.error_reason}>
                      {r.error_reason || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted-foreground)' }}>
        Delivered/Read populate only once Gupshup&apos;s &quot;Chatbot Webhook&quot; points at <code>/api/v3/gupshup/webhook/rcs</code>.
      </div>
    </div>
  );
}

const td = { padding: '10px', borderBottom: '1px solid var(--border)' };

// ─── Template preview ─────────────────────────────────────────────
// Renders an approximation of how the message will look in Google Messages.
// Not pixel-perfect — Gupshup/Google render with their own theming — but
// close enough to spot mistakes before sending.
function TemplatePreview({ template, customParams }) {
  if (!template?.body) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>
        <ImageIcon size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
        <div>No preview available for this template.</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>Add its body data to <code>KNOWN_TEMPLATES</code> to enable preview.</div>
      </div>
    );
  }

  // Substitute {{variableName}} placeholders with values from customParams.
  // Variables left empty render as a dim placeholder so you can see what's missing.
  const substitute = (raw) => {
    if (!raw) return '';
    return raw.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const v = customParams?.[key];
      if (v && String(v).trim()) return String(v);
      return `‹${key}›`;  // visible placeholder
    });
  };
  const hasMissing = template.variables.some(v => !customParams?.[v] || String(customParams[v]).trim() === '');

  const { body } = template;
  const bodyText  = substitute(body.text);
  const titleText = body.title ? substitute(body.title) : null;

  return (
    <div>
      {/* Phone-frame */}
      <div style={{
        margin: '0 auto', maxWidth: 320, background: '#f5f5f5',
        borderRadius: 28, padding: 12, border: '1px solid var(--border)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
      }}>
        {/* Top bar: sender */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px 10px', borderBottom: '1px solid #e5e7eb',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: '#7c3aed', color: '#fff', fontSize: 11, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>R</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>Rayna Tours <span style={{ color: '#16a34a' }}>✓</span></div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>RCS Business Messaging</div>
          </div>
        </div>

        {/* Message bubble */}
        <div style={{
          marginTop: 10, background: '#fff', borderRadius: 16,
          overflow: 'hidden', border: '1px solid #e5e7eb',
        }}>
          {body.kind === 'standalone_card' && body.mediaUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={body.mediaUrl}
              alt=""
              style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block', background: '#e5e7eb' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement.querySelector('[data-img-fallback]').style.display = 'flex';
              }}
            />
          )}
          {body.kind === 'standalone_card' && (
            <div data-img-fallback style={{
              display: 'none', height: 140, alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
              color: '#fff', fontSize: 11,
            }}>
              <ImageIcon size={24} style={{ opacity: 0.6 }} />
            </div>
          )}

          <div style={{ padding: '12px 14px' }}>
            {titleText && (
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: '#111' }}>
                {titleText}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
              {bodyText.split(/(‹\w+›)/g).map((chunk, i) =>
                chunk.startsWith('‹') && chunk.endsWith('›')
                  ? <span key={i} style={{ background: '#fef3c7', color: '#92400e', padding: '0 4px', borderRadius: 3 }}>{chunk}</span>
                  : <span key={i}>{chunk}</span>
              )}
            </div>
          </div>

          {body.buttons?.length > 0 && (
            <div style={{ borderTop: '1px solid #e5e7eb' }}>
              {body.buttons.map((btn, i) => (
                <div key={i} style={{
                  padding: '10px 14px', fontSize: 12, fontWeight: 600,
                  color: '#1d4ed8', textAlign: 'center',
                  borderTop: i > 0 ? '1px solid #e5e7eb' : 'none',
                }}>
                  {btn.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom meta */}
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8, textAlign: 'center' }}>
          {body.kind === 'standalone_card' ? 'Rich card' : 'Text message'} • via Gupshup RBM
        </div>
      </div>

      {hasMissing && (
        <div style={{
          marginTop: 10, padding: 8, background: '#fef3c7', borderRadius: 6,
          fontSize: 11, color: '#92400e', textAlign: 'center',
        }}>
          ⚠ Highlighted <code>‹variable›</code> tags will be filled when you set Custom Params.
        </div>
      )}
    </div>
  );
}
