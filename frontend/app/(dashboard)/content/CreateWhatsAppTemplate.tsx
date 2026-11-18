'use client';

/**
 * Create WhatsApp Template — submits a NEW WhatsApp template to ChatHead → Meta review,
 * via POST /api/v3/chathead/templates/create. Handles every category / format / button
 * type + enum from the ChatHead Templates API:
 *   category : utility | marketing | authentication
 *   formate  : text | media_image | media_document | media_video   (non-auth)
 *   buttons  : quick_reply(text) · call_to_action(url|phone) · url_dynamic(url + {{1}}) · OTP(COPY_CODE)
 *   auth-only: add_security_recommendation, code_expiration_minutes
 *   carousel : marketing only — body on top, 2–10 cards (same image|video header, ≤160-char body,
 *              ≤2 buttons with the same layout on every card); no top-level footer/media/buttons
 *
 * Styled to match the other content-screen cards (WhatsApp Test Send etc.):
 * `card` wrapper, --bg-secondary / --border / --text-* tokens, `btn btn-sm`.
 */
import { useState, useEffect, useMemo } from 'react';
import { MessageSquarePlus, Plus, Trash2, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getWhatsAppChannels, createWhatsAppTemplate, getWhatsAppTemplateStatus } from '@/lib/api';
import type { CSSProperties } from 'react';

interface WaChannel { id: string | number; name?: string }
interface TemplateButton { type: string; sub_type: string; value: string; text: string; example: string }
interface TemplateForm {
  channel: string; name: string; category: string; formate: string;
  body: string; footer_text: string; media_file: string;
  add_security_recommendation: boolean; code_expiration_minutes: number | string;
}
interface TemplateData { template_id?: string | number; meta_id?: string; meta_status?: string }
interface WaApiResponse { success?: boolean; data?: TemplateData; msg?: string; error?: string }
/** Button kind shared by every carousel card (Meta requires the same layout on all cards). */
interface CardButtonLayout { type: 'quick_reply' | 'call_to_action' | 'url_dynamic'; sub_type: string }
/** What the user typed for one card button (fields depend on the layout's type). */
interface CardButtonValues { value?: string; text?: string; example?: string }
/** One carousel card in the form. */
interface CarouselCardForm { media_file: string; body: string; examples: Record<string, string>; buttons: CardButtonValues[] }
/** One carousel card / card button as sent to the API. */
interface CarouselCardButtonPayload { type: string; sub_type: string; value: string; text?: string; example?: string }
interface CarouselCardPayload { header_format: string; media_file: string; body?: string; body_examples?: Record<string, string>; buttons?: CarouselCardButtonPayload[] }
interface SubmitResult {
  ok?: boolean; data?: TemplateData; msg?: string; error?: string;
  statusData?: TemplateData; statusError?: string;
}

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
  { value: 'carousel',       label: 'Carousel (2–10 cards)' },
];
const BLANK_BTN = { type: 'quick_reply', sub_type: 'text', value: '', text: '', example: '' };
const CARD_MIN = 2, CARD_MAX = 10, CARD_BODY_MAX = 160, CARD_BTN_MAX = 2;
const blankCard = (): CarouselCardForm => ({ media_file: '', body: '', examples: {}, buttons: [] });

/** Unique {{named}} placeholders in a text, in order of first use. */
const findPlaceholders = (text: string): string[] =>
  [...new Set([...String(text).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1]))];

// shared control + label styles (mirrors WhatsAppTestSend)
const ctrl = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, width: '100%' };
const labelStyle = { fontSize: 11.5, color: 'var(--text-tertiary)', display: 'block' };
const sectionLabel: CSSProperties = { fontSize: 11.5, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' };

export default function CreateWhatsAppTemplate() {
  const [channels, setChannels] = useState<WaChannel[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<TemplateForm>({
    channel: '', name: '', category: 'marketing', formate: 'text',
    body: '', footer_text: '', media_file: '',
    add_security_recommendation: true, code_expiration_minutes: 10,
  });
  const [examples, setExamples] = useState<Record<string, string>>({});
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  // Carousel: one header format + one button layout shared by every card (Meta requires both to match).
  const [cardFormat, setCardFormat] = useState<'image' | 'video'>('image');
  const [cardBtnLayout, setCardBtnLayout] = useState<CardButtonLayout[]>([]);
  const [cards, setCards] = useState<CarouselCardForm[]>([blankCard(), blankCard()]);
  const set = (k: keyof TemplateForm, v: TemplateForm[keyof TemplateForm]) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => { getWhatsAppChannels().then(r => setChannels((r as { data?: WaChannel[] }).data || [])).catch((e: Error) => setErr(e.message)); }, []);

  const isAuth = f.category === 'authentication';
  const isCarousel = !isAuth && f.formate === 'carousel';
  const isMedia = !isAuth && !isCarousel && f.formate !== 'text';

  const placeholders = useMemo(() => findPlaceholders(f.body), [f.body]);

  // Carousels are marketing-only: picking carousel switches the category, and leaving marketing
  // drops the carousel format.
  const setCategory = (category: string) => setF(p => ({ ...p, category, ...(category !== 'marketing' && p.formate === 'carousel' ? { formate: 'text' } : {}) }));
  const setFormat = (formate: string) => setF(p => ({ ...p, formate, ...(formate === 'carousel' ? { category: 'marketing' } : {}) }));

  const addButton = () => setButtons(b => [...b, { ...BLANK_BTN }]);
  const updateButton = (i: number, patch: Partial<TemplateButton>) => setButtons(b => b.map((x, j) => j === i ? { ...x, ...patch } : x));
  const removeButton = (i: number) => setButtons(b => b.filter((_, j) => j !== i));

  const updateCard = (i: number, patch: Partial<CarouselCardForm>) => setCards(cs => cs.map((c, j) => j === i ? { ...c, ...patch } : c));
  const updateCardButton = (i: number, k: number, patch: CardButtonValues) => setCards(cs => cs.map((c, j) => {
    if (j !== i) return c;
    const btns = [...c.buttons];
    btns[k] = { ...(btns[k] || {}), ...patch };
    return { ...c, buttons: btns };
  }));
  const addCard = () => setCards(cs => cs.length < CARD_MAX ? [...cs, blankCard()] : cs);
  const removeCard = (i: number) => setCards(cs => cs.length > CARD_MIN ? cs.filter((_, j) => j !== i) : cs);
  const addCardBtn = () => setCardBtnLayout(l => l.length < CARD_BTN_MAX ? [...l, { type: 'call_to_action', sub_type: 'url' }] : l);
  const setCardBtnType = (k: number, value: string) => {
    // value is quick_reply | url | phone | url_dynamic — stored as the API's type + sub_type
    const L: CardButtonLayout = value === 'quick_reply' ? { type: 'quick_reply', sub_type: 'text' }
      : value === 'url_dynamic' ? { type: 'url_dynamic', sub_type: 'url' }
      : { type: 'call_to_action', sub_type: value };
    setCardBtnLayout(l => l.map((x, j) => j === k ? L : x));
    setCards(cs => cs.map(c => ({ ...c, buttons: c.buttons.map((b, j) => j === k ? {} : b) })));
  };
  const removeCardBtn = (k: number) => {
    setCardBtnLayout(l => l.filter((_, j) => j !== k));
    setCards(cs => cs.map(c => ({ ...c, buttons: c.buttons.filter((_, j) => j !== k) })));
  };

  const cardButtonPayload = (L: CardButtonLayout, v: CardButtonValues = {}): CarouselCardButtonPayload => {
    if (L.type === 'quick_reply') return { type: 'quick_reply', sub_type: 'text', value: v.value || '' };
    if (L.type === 'url_dynamic') return { type: 'url_dynamic', sub_type: 'url', value: v.value || '', text: v.text || '', example: v.example || '' };
    return { type: 'call_to_action', sub_type: L.sub_type, value: v.value || '', text: v.text || '' };
  };
  const cardButtonFilled = (L: CardButtonLayout, v: CardButtonValues = {}): boolean => {
    if (L.type === 'quick_reply') return !!v.value?.trim();
    if (!v.text?.trim() || !v.value?.trim()) return false;
    return L.type !== 'url_dynamic' || (/\{\{\s*1\s*\}\}/.test(v.value ?? '') && !!v.example?.trim());
  };
  const cardsValid = cards.length >= CARD_MIN && cards.length <= CARD_MAX && cards.every(c =>
    c.media_file.trim() && c.body.length <= CARD_BODY_MAX && cardBtnLayout.every((L, k) => cardButtonFilled(L, c.buttons[k])));

  const submit = async () => {
    setResult(null); setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { channel: f.channel, name: f.name.trim(), category: f.category };
      if (isAuth) {
        payload.add_security_recommendation = !!f.add_security_recommendation;
        payload.code_expiration_minutes = Number(f.code_expiration_minutes) || 10;
        payload.buttons = [{ type: 'OTP', otp_type: 'COPY_CODE' }];
      } else {
        payload.formate = f.formate;
        payload.body = f.body;
        if (placeholders.length) payload.body_examples = Object.fromEntries(placeholders.map(p => [p, examples[p] || '']));
        if (isCarousel) {
          payload.cards = cards.map(c => {
            const card: CarouselCardPayload = { header_format: cardFormat, media_file: c.media_file.trim() };
            if (c.body.trim()) {
              card.body = c.body;
              const phs = findPlaceholders(c.body);
              if (phs.length) card.body_examples = Object.fromEntries(phs.map(p => [p, c.examples[p] || '']));
            }
            if (cardBtnLayout.length) card.buttons = cardBtnLayout.map((L, k) => cardButtonPayload(L, c.buttons[k]));
            return card;
          });
        }
        if (!isCarousel && f.footer_text.trim()) payload.footer_text = f.footer_text.trim();
        if (isMedia) payload.media_file = f.media_file.trim();
        if (!isCarousel && buttons.length) {
          payload.buttons = buttons.map(b => {
            if (b.type === 'quick_reply') return { type: 'quick_reply', sub_type: 'text', value: b.value };
            if (b.type === 'url_dynamic') return { type: 'url_dynamic', sub_type: 'url', value: b.value, text: b.text, example: b.example };
            return { type: 'call_to_action', sub_type: b.sub_type, value: b.value, text: b.text };
          });
        }
      }
      const r = await createWhatsAppTemplate(payload) as WaApiResponse;
      setResult({ ok: !!r.success, data: r.data, msg: r.msg, error: r.error });
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally { setSubmitting(false); }
  };

  const checkStatus = async () => {
    if (!result?.data?.template_id) return;
    const r = await getWhatsAppTemplateStatus(result.data.template_id).catch((e: Error) => ({ error: e.message })) as WaApiResponse;
    setResult(p => ({ ...p, statusData: r.data, statusError: r.error }));
  };

  const nameValid = /^[a-z0-9_]+$/.test(f.name);
  const canSubmit = f.channel && nameValid && !submitting &&
    (isAuth || (f.body.trim() && (!isMedia || f.media_file.trim()) && (!isCarousel || cardsValid)));

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
            <button key={c.value} type="button" onClick={() => setCategory(c.value)}
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
            <input type="checkbox" checked={f.add_security_recommendation} onChange={e => set('add_security_recommendation', e.target.checked)}
              style={{ width: 16, height: 16, flex: 'none', margin: 0, padding: 0 }} />
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
              <select value={f.formate} onChange={e => setFormat(e.target.value)} style={{ ...ctrl, marginTop: 4 }}>
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

          {isCarousel ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                <label style={labelStyle}>
                  Card header (same on every card)
                  <select value={cardFormat} onChange={e => setCardFormat(e.target.value === 'video' ? 'video' : 'image')} style={{ ...ctrl, marginTop: 4 }}>
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </label>
              </div>

              {/* Button layout shared by every card */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={sectionLabel}>Card buttons (same on every card, max {CARD_BTN_MAX})</span>
                <button type="button" onClick={addCardBtn} disabled={cardBtnLayout.length >= CARD_BTN_MAX} className="btn btn-sm" style={{ gap: 5, padding: '5px 10px' }}>
                  <Plus size={13} /> Add button
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 6 }}>
                {cardBtnLayout.map((L, k) => (
                  <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)', minWidth: 62 }}>Button {k + 1}</span>
                    <select value={L.type === 'call_to_action' ? L.sub_type : L.type} onChange={e => setCardBtnType(k, e.target.value)} style={{ ...ctrl, flex: 1 }}>
                      <option value="url">URL</option>
                      <option value="url_dynamic">Dynamic URL ({'{{1}}'})</option>
                      <option value="phone">Phone</option>
                      <option value="quick_reply">Quick reply</option>
                    </select>
                    <button type="button" onClick={() => removeCardBtn(k)} title="Remove"
                      style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: '#ef4444', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 14 }}>
                Sending through the single-send API supports URL buttons only. A Dynamic URL needs a value for {'{{1}}'} on every card at send time.
              </div>

              {/* Cards */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={sectionLabel}>Cards ({cards.length}/{CARD_MAX})</span>
                <button type="button" onClick={addCard} disabled={cards.length >= CARD_MAX} className="btn btn-sm" style={{ gap: 5, padding: '5px 10px' }}>
                  <Plus size={13} /> Add card
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {cards.map((c, i) => {
                  const phs = findPlaceholders(c.body);
                  const tooLong = c.body.length > CARD_BODY_MAX;
                  return (
                    <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg-secondary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Card {i + 1}</span>
                        <button type="button" onClick={() => removeCard(i)} disabled={cards.length <= CARD_MIN} title={cards.length <= CARD_MIN ? `At least ${CARD_MIN} cards` : 'Remove card'}
                          style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: cards.length <= CARD_MIN ? 'var(--text-tertiary)' : '#ef4444', cursor: cards.length <= CARD_MIN ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <label style={labelStyle}>
                        {cardFormat === 'video' ? 'Video' : 'Image'} URL
                        <input value={c.media_file} onChange={e => updateCard(i, { media_file: e.target.value })} placeholder={`https://…/card-${i + 1}.${cardFormat === 'video' ? 'mp4' : 'jpg'}`} style={{ ...ctrl, marginTop: 4 }} />
                      </label>
                      <label style={{ ...labelStyle, display: 'block', marginTop: 8 }}>
                        Card text (optional, max {CARD_BODY_MAX}) — {'{{placeholder}}'} allowed
                        <textarea value={c.body} onChange={e => updateCard(i, { body: e.target.value })} rows={2}
                          placeholder="Desert Safari with {{extra}}"
                          style={{ ...ctrl, marginTop: 4, resize: 'vertical', fontFamily: 'inherit', borderColor: tooLong ? '#ef4444' : 'var(--border)' }} />
                        <span style={{ fontSize: 11, color: tooLong ? '#ef4444' : 'var(--text-tertiary)' }}>{c.body.length}/{CARD_BODY_MAX}</span>
                      </label>
                      {phs.map(ph => (
                        <div key={ph} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                          <code style={{ fontSize: 12, minWidth: 130, color: 'var(--text-secondary)' }}>{`{{${ph}}}`}</code>
                          <input value={c.examples[ph] || ''} onChange={e => updateCard(i, { examples: { ...c.examples, [ph]: e.target.value } })} placeholder={`example for ${ph}`} style={ctrl} />
                        </div>
                      ))}
                      {cardBtnLayout.map((L, k) => {
                        const v = c.buttons[k] || {};
                        return (
                          <div key={k} style={{ display: 'grid', gridTemplateColumns: L.type === 'quick_reply' ? '1fr' : 'repeat(auto-fit, minmax(160px,1fr))', gap: 8, marginTop: 8 }}>
                            {L.type === 'quick_reply' ? (
                              <input value={v.value || ''} onChange={e => updateCardButton(i, k, { value: e.target.value })} placeholder={`Button ${k + 1} label (e.g. More info)`} style={ctrl} />
                            ) : (
                              <>
                                <input value={v.text || ''} onChange={e => updateCardButton(i, k, { text: e.target.value })} placeholder={`Button ${k + 1} text (e.g. Book Now)`} style={ctrl} />
                                <input value={v.value || ''} onChange={e => updateCardButton(i, k, { value: e.target.value })}
                                  placeholder={L.sub_type === 'phone' ? '+971500000000' : (L.type === 'url_dynamic' ? 'https://www.raynatours.com/{{1}}' : 'https://…')} style={ctrl} />
                                {L.type === 'url_dynamic' && <input value={v.example || ''} onChange={e => updateCardButton(i, k, { example: e.target.value })} placeholder="Example for {{1}} (e.g. dubai/desert-safari)" style={{ ...ctrl, gridColumn: '1 / -1' }} />}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
          <>
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
