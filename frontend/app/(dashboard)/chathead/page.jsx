'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageCircle, Send, Plus, Trash2, Loader2, CheckCircle2, XCircle, Eye,
  RefreshCcw, FileText, Upload, ChevronDown, ChevronUp, Database, History,
  Clock, Hash, Layers,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ── api helpers ────────────────────────────────────────────────────────
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

// Build + upload data file via the backend. The backend hits ChatHead's
// /broadcast/data/add/index.php server-to-server (no CORS check), parses the
// response, stores chathead_filename in data_files, and returns the row.
async function buildAndUpload(contacts, filename) {
  const cleanContacts = contacts
    .map(c => ({ phone: (c.phone || '').trim(), name: (c.name || '').trim() }))
    .filter(c => c.phone);
  if (!cleanContacts.length) throw new Error('At least one phone number is required');
  return apiPost('/api/v3/chathead/data-files', {
    contacts: cleanContacts,
    filename: filename || undefined,
  });
}

// ── styling tokens ─────────────────────────────────────────────────────
const STATUS = {
  succeeded: { color: '#16a34a', bg: '#dcfce7', label: 'Succeeded' },
  submitted: { color: '#d97706', bg: '#fef3c7', label: 'Submitted' },
  queued:    { color: '#2563eb', bg: '#dbeafe', label: 'Queued' },
  failed:    { color: '#dc2626', bg: '#fee2e2', label: 'Failed' },
  unknown:   { color: '#64748b', bg: '#f1f5f9', label: 'Unknown' },
  uploaded:  { color: '#16a34a', bg: '#dcfce7', label: 'Uploaded' },
  pending:   { color: '#d97706', bg: '#fef3c7', label: 'Pending' },
};

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 12, padding: 24, marginBottom: 16,
};
const input = {
  width: '100%', padding: '10px 12px', fontSize: 13,
  border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--background)', color: 'var(--text-primary)', outline: 'none',
  transition: 'border-color 0.15s',
};
const labelStyle = {
  fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)',
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, display: 'block',
};
const sectionTitle = {
  fontSize: 13, fontWeight: 700, margin: 0, marginBottom: 14,
  display: 'flex', alignItems: 'center', gap: 8,
};
const stepNumber = {
  width: 22, height: 22, borderRadius: '50%',
  background: '#22c55e', color: '#fff', fontSize: 11, fontWeight: 700,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const pill = (palette) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600,
  color: palette.color, background: palette.bg,
});

function pad(n) { return String(n).padStart(2, '0'); }
function nowLocalISO(plusMinutes = 5) {
  const d = new Date(Date.now() + plusMinutes * 60 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function relTime(iso) {
  if (!iso) return '—';
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec/60)}m ago`;
  if (sec < 86400) return `${Math.round(sec/3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ╭──────────────────────────────────────────────────────────────────╮
// │ MAIN PAGE                                                         │
// ╰──────────────────────────────────────────────────────────────────╯
export default function ChatHeadPage() {
  const [tab, setTab] = useState('send'); // 'send' | 'files' | 'history'

  const [channels, setChannels] = useState([]);
  const [dataFiles, setDataFiles] = useState([]);
  const [broadcasts, setBroadcasts] = useState([]);

  // ── shared data loads (channels + lists) ─────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [ch, df, bc] = await Promise.all([
        apiGet('/api/v3/chathead/channels').catch(() => []),
        apiGet('/api/v3/chathead/data-files?limit=30').catch(() => []),
        apiGet('/api/v3/chathead/broadcasts?limit=30').catch(() => []),
      ]);
      setChannels(ch); setDataFiles(df); setBroadcasts(bc);
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <MessageCircle size={26} color="#22c55e" /> WhatsApp Broadcast
        </h1>
        <p style={{ color: 'var(--muted-foreground)', margin: 0, fontSize: 13 }}>
          Send approved WhatsApp templates via ChatHead v1. Build recipient .data files, fire broadcasts, audit history.
        </p>
      </header>

      <Tabs tab={tab} onChange={setTab} counts={{ files: dataFiles.length, history: broadcasts.length }} />

      <div style={{ marginTop: 16 }}>
        {tab === 'send' && (
          <SendTab channels={channels} dataFiles={dataFiles} onComplete={loadAll} />
        )}
        {tab === 'files' && (
          <FilesTab dataFiles={dataFiles} onComplete={loadAll} />
        )}
        {tab === 'history' && (
          <HistoryTab broadcasts={broadcasts} onRefresh={loadAll} />
        )}
      </div>
    </motion.div>
  );
}

// ── Tabs bar ───────────────────────────────────────────────────────────
function Tabs({ tab, onChange, counts }) {
  const items = [
    { key: 'send',    label: 'Send Broadcast', icon: Send },
    { key: 'files',   label: 'Data Files',     icon: Database, count: counts.files },
    { key: 'history', label: 'History',        icon: History,  count: counts.history },
  ];
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
      {items.map(it => {
        const active = it.key === tab;
        const Icon = it.icon;
        return (
          <button key={it.key} onClick={() => onChange(it.key)}
                  className="btn-ghost"
                  style={{
                    padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 13, fontWeight: active ? 600 : 500,
                    color: active ? 'var(--text-primary)' : 'var(--muted-foreground)',
                    background: 'transparent', border: 'none',
                    borderBottom: active ? '2px solid #22c55e' : '2px solid transparent',
                    marginBottom: -1, cursor: 'pointer',
                  }}>
            <Icon size={15} />
            {it.label}
            {it.count != null && (
              <span style={{ ...pill({ color: 'var(--muted-foreground)', bg: 'var(--background)' }), padding: '1px 6px' }}>{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ╭──────────────────────────────────────────────────────────────────╮
// │ TAB: SEND BROADCAST                                               │
// ╰──────────────────────────────────────────────────────────────────╯
function SendTab({ channels, dataFiles, onComplete }) {
  const [mode, setMode] = useState('new');                  // 'new' | 'existing'
  const [contacts, setContacts] = useState([{ phone: '', name: '' }]);
  const [filename, setFilename] = useState('');
  const [existingFileId, setExistingFileId] = useState('');

  const [channelId, setChannelId] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [name, setName] = useState('');
  const [sendTime, setSendTime] = useState(nowLocalISO(5));

  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Load templates when channel changes; clear template selection + search
  useEffect(() => {
    setTemplateSearch('');
    if (!channelId) { setTemplates([]); setTemplateId(''); return; }
    setLoadingTemplates(true);
    apiGet(`/api/v3/chathead/templates?channel=${channelId}`)
      .then(setTemplates).catch(e => setError(e.message))
      .finally(() => setLoadingTemplates(false));
  }, [channelId]);

  const selectedChannel  = channels.find(c => String(c.id) === String(channelId));
  const selectedTemplate = templates.find(t => String(t.id) === String(templateId));

  // Filter templates by search query (name or id substring, case-insensitive).
  // Always keep the currently-selected template visible so it doesn't disappear
  // when the user types something that excludes it.
  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      String(t.id) === String(templateId) ||  // keep selected
      String(t.id).includes(q) ||
      (t.name || '').toLowerCase().includes(q) ||
      (t.template_code || '').toLowerCase().includes(q)
    );
  }, [templates, templateSearch, templateId]);

  // Same for channels (55 of them)
  const filteredChannels = useMemo(() => {
    const q = channelSearch.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(c =>
      String(c.id) === String(channelId) ||
      String(c.id).includes(q) ||
      (c.name || '').toLowerCase().includes(q) ||
      (c.connection || '').toLowerCase().includes(q)
    );
  }, [channels, channelSearch, channelId]);

  const previewTemplate = async () => {
    if (!templateId) return;
    setPreviewLoading(true); setPreview(null);
    try {
      const d = await apiGet(`/api/v3/chathead/templates/${templateId}/preview`);
      setPreview(d.content || '(empty — media-only template)');
    } catch (e) { setPreview(`error: ${e.message}`); }
    setPreviewLoading(false);
  };

  const submit = async () => {
    setError(null); setResult(null);
    if (!channelId || !templateId || !name) {
      setError('Channel, template and broadcast name are all required'); return;
    }
    let body = {
      channelId, channelName: selectedChannel?.name,
      templateId, templateName: selectedTemplate?.name,
      name,
      sendTime: new Date(sendTime).toISOString(),
    };
    setSending(true);
    try {
      if (mode === 'existing') {
        if (!existingFileId) { setError('Pick a data file or switch to New recipients'); setSending(false); return; }
        body.dataFileId = Number(existingFileId);
      } else {
        // Backend builds NDJSON → uploads to ChatHead → records data_files row
        // with chathead_filename. Returns the dataFile we then reference.
        const dataFile = await buildAndUpload(contacts, filename);
        body.dataFileId = dataFile.id;
        onComplete?.();
      }
      const data = await apiPost('/api/v3/chathead/broadcasts', body);
      setResult(data);
      onComplete?.();
    } catch (e) { setError(e.message); }
    setSending(false);
  };

  return (
    <>
      {/* ── Step 1: Recipients ── */}
      <div style={card}>
        <h3 style={sectionTitle}><span style={stepNumber}>1</span> Recipients</h3>

        <div style={{ display: 'flex', gap: 4, marginBottom: 14, padding: 3, background: 'var(--background)', borderRadius: 8, width: 'fit-content' }}>
          <ModeBtn active={mode === 'new'} onClick={() => setMode('new')}>New recipients</ModeBtn>
          <ModeBtn active={mode === 'existing'} onClick={() => setMode('existing')}>Use existing .data file</ModeBtn>
        </div>

        {mode === 'new' ? (
          <RecipientEditor
            contacts={contacts} setContacts={setContacts}
            filename={filename} setFilename={setFilename}
          />
        ) : (
          <Field label="Existing data file">
            <select style={input} value={existingFileId} onChange={e => setExistingFileId(e.target.value)}>
              <option value="">{dataFiles.length ? 'Pick a file…' : 'No files yet — create one in Data Files tab'}</option>
              {dataFiles.map(f => (
                <option key={f.id} value={f.id}>
                  #{f.id} · {f.filename} · {f.contact_count} contacts · {f.upload_status}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {/* ── Step 2: Channel & Template ── */}
      <div style={card}>
        <h3 style={sectionTitle}><span style={stepNumber}>2</span> Channel &amp; Template</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Channel" hint={channelSearch ? `${filteredChannels.length} of ${channels.length}` : `${channels.length} available`}>
            <input style={{ ...input, marginBottom: 6 }} type="text" placeholder="Search channels…"
                   value={channelSearch} onChange={e => setChannelSearch(e.target.value)} />
            <select style={input} value={channelId} onChange={e => setChannelId(e.target.value)}>
              <option value="">Select channel</option>
              {filteredChannels.map(c => (
                <option key={c.id} value={c.id}>{c.id} — {c.name} ({c.connection})</option>
              ))}
            </select>
          </Field>

          <Field label="Template" hint={loadingTemplates ? 'Loading…' : (templateSearch ? `${filteredTemplates.length} of ${templates.length}` : `${templates.length} on this channel`)}>
            <input style={{ ...input, marginBottom: 6 }} type="text"
                   placeholder={channelId ? 'Search by name, ID, or code…' : 'Pick channel first'}
                   value={templateSearch} onChange={e => setTemplateSearch(e.target.value)}
                   disabled={!channelId} />
            <div style={{ display: 'flex', gap: 6 }}>
              <select style={{ ...input, flex: 1 }} value={templateId}
                      onChange={e => setTemplateId(e.target.value)} disabled={!channelId}>
                <option value="">{channelId ? `Select template${templateSearch ? ` (${filteredTemplates.length} match)` : ''}` : 'Pick channel first'}</option>
                {filteredTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.id} — {t.name}</option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary btn-sm"
                      onClick={previewTemplate} disabled={!templateId || previewLoading}
                      title="Preview template"
                      style={{ padding: '0 12px' }}>
                {previewLoading ? <Loader2 size={14} className="spin" /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
        </div>

        <AnimatePresence>
          {preview != null && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <div style={{
                marginTop: 12, padding: 14, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 8,
                maxHeight: 200, overflow: 'auto', color: 'var(--text-primary)',
                fontFamily: 'ui-monospace, "SF Mono", monospace',
              }}>
                {preview}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Step 3: Schedule ── */}
      <div style={card}>
        <h3 style={sectionTitle}><span style={stepNumber}>3</span> Schedule</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Broadcast name" hint="Shown in ChatHead UI">
            <input style={input} value={name} onChange={e => setName(e.target.value)}
                   placeholder="e.g. Dubai Visa Outbound — June 2026" />
          </Field>
          <Field label="Send time" hint="local timezone">
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="datetime-local" style={{ ...input, flex: 1 }}
                     value={sendTime} onChange={e => setSendTime(e.target.value)} />
              <QuickTimeBtn onClick={() => setSendTime(nowLocalISO(2))}>+2m</QuickTimeBtn>
              <QuickTimeBtn onClick={() => setSendTime(nowLocalISO(60))}>+1h</QuickTimeBtn>
              <QuickTimeBtn onClick={() => setSendTime(nowLocalISO(60 * 24))}>+1d</QuickTimeBtn>
            </div>
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            {error ? (
              <span style={{ color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                <XCircle size={13} /> {error}
              </span>
            ) : (
              `Ready to fire ${mode === 'existing' ? 'using existing file' : `with ${contacts.filter(c => c.phone).length} recipient(s)`}.`
            )}
          </div>
          <button type="button" className="btn btn-primary"
                  onClick={submit} disabled={sending}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px' }}>
            {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
            {sending ? 'Sending…' : 'Send broadcast'}
          </button>
        </div>
      </div>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <ResultPanel result={result} onDismiss={() => setResult(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ╭──────────────────────────────────────────────────────────────────╮
// │ TAB: DATA FILES                                                   │
// ╰──────────────────────────────────────────────────────────────────╯
function FilesTab({ dataFiles, onComplete }) {
  const [contacts, setContacts] = useState([{ phone: '', name: '' }]);
  const [filename, setFilename] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [created, setCreated] = useState(null);

  const create = async () => {
    setCreateError(null); setCreated(null);
    const clean = contacts
      .map(c => ({ phone: (c.phone || '').trim(), name: (c.name || '').trim() }))
      .filter(c => c.phone);
    if (!clean.length) { setCreateError('At least one phone is required'); return; }
    setCreating(true);
    try {
      // Backend uploads to ChatHead's /index.php endpoint, stores chathead_filename
      const data = await buildAndUpload(clean, filename);
      setCreated({ filename: data.filename, contactCount: data.contactCount ?? clean.length });
      onComplete?.();
      setContacts([{ phone: '', name: '' }]);
      setFilename('');
    } catch (e) { setCreateError(e.message); }
    setCreating(false);
  };

  return (
    <>
      <div style={card}>
        <h3 style={sectionTitle}><Upload size={15} /> Create new .data file</h3>
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: -10, marginBottom: 16 }}>
          Build a recipient file and upload it to ChatHead — without firing a broadcast. Reuse later from the Send tab.
        </p>

        <Field label="Filename" hint="optional · must end in .data">
          <input style={input} value={filename} onChange={e => setFilename(e.target.value)}
                 placeholder="e.g. eid-batch-1.data" />
        </Field>

        <div style={{ marginTop: 14 }}>
          <RecipientEditor contacts={contacts} setContacts={setContacts} showFilenameField={false} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: createError ? '#dc2626' : 'var(--muted-foreground)' }}>
            {createError ? <><XCircle size={13} style={{ marginRight: 4 }} />{createError}</>
                         : `${contacts.filter(c => c.phone).length} recipient(s) ready.`}
          </div>
          <button type="button" className="btn btn-primary"
                  onClick={create} disabled={creating}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px' }}>
            {creating ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
            {creating ? 'Uploading…' : 'Create & upload'}
          </button>
        </div>

        <AnimatePresence>
          {created && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                        style={{ marginTop: 14, padding: 12, background: STATUS.uploaded.bg, color: STATUS.uploaded.color, border: `1px solid ${STATUS.uploaded.color}33`, borderRadius: 8, fontSize: 13 }}>
              <strong>✓ {created.filename}</strong> · {created.contactCount} contacts · uploaded
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* List of past data files */}
      <div style={card}>
        <h3 style={sectionTitle}><Database size={15} /> Past .data files</h3>
        <TableScroller>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <Tr header>
                <Th>#</Th>
                <Th>Filename</Th>
                <Th>Contacts</Th>
                <Th>Bytes</Th>
                <Th>Status</Th>
                <Th>Uploaded</Th>
              </Tr>
            </thead>
            <tbody>
              {dataFiles.length === 0 && <EmptyRow cols={6} text="No data files yet — create one above" />}
              {dataFiles.map(f => (
                <Tr key={f.id}>
                  <Td muted>#{f.id}</Td>
                  <Td mono><FileText size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />{f.filename}</Td>
                  <Td>{f.contact_count}</Td>
                  <Td muted>{f.file_bytes ? `${f.file_bytes} B` : '—'}</Td>
                  <Td><StatusPill status={f.upload_status} /></Td>
                  <Td muted>{relTime(f.uploaded_at || f.created_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      </div>
    </>
  );
}

// ╭──────────────────────────────────────────────────────────────────╮
// │ TAB: HISTORY                                                      │
// ╰──────────────────────────────────────────────────────────────────╯
function HistoryTab({ broadcasts, onRefresh }) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ ...sectionTitle, marginBottom: 0 }}><History size={15} /> Broadcasts</h3>
        <button className="btn btn-ghost btn-sm" onClick={onRefresh} title="Refresh">
          <RefreshCcw size={14} />
        </button>
      </div>

      <TableScroller>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <Tr header>
              <Th>#</Th>
              <Th>Name</Th>
              <Th>Channel</Th>
              <Th>Template</Th>
              <Th>Recipients</Th>
              <Th>Status</Th>
              <Th>Fired</Th>
            </Tr>
          </thead>
          <tbody>
            {broadcasts.length === 0 && <EmptyRow cols={7} text="No broadcasts yet" />}
            {broadcasts.map(b => (
              <Tr key={b.id} onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                  style={{ cursor: 'pointer' }}>
                <Td muted>#{b.id}</Td>
                <Td>{b.name}</Td>
                <Td muted>{b.channel_id}{b.channel_name && ` · ${b.channel_name}`}</Td>
                <Td muted>{b.template_id}{b.template_name && ` · ${b.template_name}`}</Td>
                <Td>{b.contact_count != null ? <span>{b.contact_count} · <span style={{ color: 'var(--muted-foreground)', fontFamily: 'ui-monospace' }}>{b.data_filename}</span></span> : '—'}</Td>
                <Td><StatusPill status={b.status} sub={b.chathead_msg} /></Td>
                <Td muted>{relTime(b.fired_at)}</Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </div>
  );
}

// ╭──────────────────────────────────────────────────────────────────╮
// │ SHARED COMPONENTS                                                 │
// ╰──────────────────────────────────────────────────────────────────╯
function RecipientEditor({ contacts, setContacts, filename, setFilename, showFilenameField = true }) {
  const updateContact = (i, k, v) => setContacts(p => p.map((c, idx) => idx === i ? { ...c, [k]: v } : c));
  const addRow    = () => setContacts(p => [...p, { phone: '', name: '' }]);
  const removeRow = (i) => setContacts(p => p.filter((_, idx) => idx !== i));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={labelStyle}>Recipients ({contacts.filter(c => c.phone).length})</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={addRow}
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <Plus size={12} /> Add row
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {contacts.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 1fr 32px', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{i + 1}</span>
            <input style={input} placeholder="Phone (e.g. 919019533772)"
                   value={c.phone} onChange={e => updateContact(i, 'phone', e.target.value)} />
            <input style={input} placeholder="Name (optional)"
                   value={c.name} onChange={e => updateContact(i, 'name', e.target.value)} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(i)}
                    disabled={contacts.length === 1}
                    style={{ padding: '0 8px', opacity: contacts.length === 1 ? 0.3 : 1 }}>
              <Trash2 size={13} color="#ef4444" />
            </button>
          </div>
        ))}
      </div>
      {showFilenameField && (
        <div style={{ marginTop: 12 }}>
          <Field label="Filename" hint="optional · auto if blank · must end in .data">
            <input style={input} value={filename} onChange={e => setFilename(e.target.value)}
                   placeholder="e.g. eid-batch-1.data" />
          </Field>
        </div>
      )}
    </div>
  );
}

function ResultPanel({ result, onDismiss }) {
  const [showDetails, setShowDetails] = useState(false);
  const status = result?.broadcast?.status || (result?.success ? 'submitted' : 'failed');
  const palette = STATUS[status] || STATUS.unknown;
  return (
    <div style={{ ...card, borderLeft: `4px solid ${palette.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            {status === 'failed' ? <XCircle size={16} color={palette.color} /> : <CheckCircle2 size={16} color={palette.color} />}
            Broadcast {palette.label.toLowerCase()}
          </h4>
          {result?.broadcast?.chatheadBroadcastId && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted-foreground)' }}>
              ChatHead broadcast ID: <code>#{result.broadcast.chatheadBroadcastId}</code>
            </p>
          )}
          {result?.broadcast?.raw?.msg && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted-foreground)' }}>
              Response: "{result.broadcast.raw.msg}"
            </p>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onDismiss}>
          <XCircle size={14} />
        </button>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => setShowDetails(s => !s)}
              style={{ marginTop: 10, padding: 0, fontSize: 11, color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: 4 }}>
        {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {showDetails ? 'Hide' : 'Show'} raw response
      </button>
      <AnimatePresence>
        {showDetails && (
          <motion.pre initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      style={{
                        marginTop: 10, padding: 12, fontSize: 11, whiteSpace: 'pre-wrap', overflow: 'auto',
                        background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 6,
                        maxHeight: 240,
                      }}>
            {JSON.stringify(result, null, 2)}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={labelStyle}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function ModeBtn({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: 'none', borderRadius: 6,
              background: active ? 'var(--card)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--muted-foreground)',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}>
      {children}
    </button>
  );
}

function QuickTimeBtn({ onClick, children }) {
  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={onClick}
            style={{ padding: '0 10px', fontSize: 11 }}>
      {children}
    </button>
  );
}

function StatusPill({ status, sub }) {
  const palette = STATUS[status] || STATUS.unknown;
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      <span style={pill(palette)}>{palette.label}</span>
      {sub && <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>{sub}</span>}
    </div>
  );
}

function TableScroller({ children }) {
  return <div style={{ overflowX: 'auto', margin: '0 -8px' }}><div style={{ padding: '0 8px' }}>{children}</div></div>;
}
function Tr({ header, children, ...rest }) {
  return (
    <tr style={{
      borderBottom: '1px solid var(--border)',
      ...(header ? { fontSize: 10, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: 0.5 } : {}),
    }} {...rest}>{children}</tr>
  );
}
function Th({ children }) { return <th style={{ textAlign: 'left', padding: '10px 12px 10px 0', fontWeight: 600 }}>{children}</th>; }
function Td({ children, muted, mono }) {
  return <td style={{
    padding: '10px 12px 10px 0',
    color: muted ? 'var(--muted-foreground)' : 'var(--text-primary)',
    fontFamily: mono ? 'ui-monospace, "SF Mono", monospace' : 'inherit',
    fontSize: mono ? 12 : 13,
  }}>{children}</td>;
}
function EmptyRow({ cols, text }) {
  return <tr><td colSpan={cols} style={{ padding: 32, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>{text}</td></tr>;
}
