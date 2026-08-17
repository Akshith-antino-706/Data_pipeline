'use client';

/**
 * Channel-scoped WhatsApp (ChatHead) template picker for the journey builder.
 * Loads the channel list once, then templates ONLY for the selected channel (1 call) —
 * instead of fetching every channel's templates up front.
 *
 * value:    { waChannelId, waTemplateId }
 * onChange: ({ waChannelId, waChannelName, waTemplateId, waTemplateName }) => void
 */
import { useState, useEffect } from 'react';
import { getWhatsAppChannels, getWhatsAppTemplates } from '@/lib/api';

export default function WhatsAppTemplatePicker({ value, onChange }) {
  const [channels, setChannels]   = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loadingCh, setLoadingCh] = useState(true);
  const [loadingTpl, setLoadingTpl] = useState(false);

  const channelId  = value?.waChannelId ? String(value.waChannelId) : '';
  const templateId = value?.waTemplateId ? String(value.waTemplateId) : '';

  useEffect(() => {
    let cancelled = false;
    getWhatsAppChannels()
      .then(r => { if (!cancelled) setChannels(r.data || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingCh(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!channelId) { setTemplates([]); return; }
    let cancelled = false;
    setLoadingTpl(true);
    getWhatsAppTemplates(channelId)
      .then(r => { if (!cancelled) setTemplates(r.data || []); })
      .catch(() => { if (!cancelled) setTemplates([]); })
      .finally(() => { if (!cancelled) setLoadingTpl(false); });
    return () => { cancelled = true; };
  }, [channelId]);

  const ctrl = {
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, width: '100%',
  };

  const pickChannel = (id) => {
    const ch = channels.find(c => String(c.id) === String(id));
    onChange?.({ waChannelId: id || null, waChannelName: ch?.name || null, waTemplateId: null, waTemplateName: null });
  };
  const pickTemplate = (id) => {
    const t  = templates.find(x => String(x.id) === String(id));
    const ch = channels.find(c => String(c.id) === String(channelId));
    onChange?.({ waChannelId: channelId || null, waChannelName: ch?.name || null, waTemplateId: id || null, waTemplateName: t?.name || null });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>WhatsApp Channel</label>
        <select value={channelId} onChange={e => pickChannel(e.target.value)} disabled={loadingCh} style={ctrl}>
          <option value="">{loadingCh ? 'Loading channels…' : 'Select channel'}</option>
          {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>WhatsApp Template</label>
        <select value={templateId} onChange={e => pickTemplate(e.target.value)} disabled={!channelId || loadingTpl} style={ctrl}>
          <option value="">{!channelId ? 'Pick a channel first' : loadingTpl ? 'Loading templates…' : 'Select template'}</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {channelId && !loadingTpl && templates.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>No templates for this channel</div>
        )}
      </div>
    </div>
  );
}
