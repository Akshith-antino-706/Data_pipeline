'use client';

import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getUnifiedContact, getContactGTMEvents, updateUnifiedContact, getContactJourneys, getContactRecommendations, getContactAffinity, getContactBookings } from '@/lib/api';
import type { ContactBookingType } from '@/lib/api';
import { CONTACT_TYPES } from '@/lib/contactTypes';
import {
  ChevronDown, ChevronUp, ExternalLink, Check, Loader2, Send, Eye, MousePointerClick,
  ShoppingBag, Mail, Globe, MessageCircle, UserPlus, Pencil,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Chip, StatusChip, Field, Input, Select, Skeleton, Table, Tabs, EmptyState } from '@/components/ui';
import { SegmentPager } from '@/components/ui/SegmentPager';
import type { ChipTone } from '@/components/ui';
import { ContactStatusChip } from '@/components/ui/ContactStatusChip';
import { ContactAvatar } from '@/components/ui/ContactAvatar';
import s from '../contacts.module.css';

type DateInput = string | number | Date | null | undefined;
type TableRow = Record<string, string>;
interface TableColumn { key: string; label: string; render?: (v: string, r: TableRow) => ReactNode }

interface ContactDetail {
  id?: string | number; unified_id?: string | number;
  name?: string; email?: string; mobile?: string; phone?: string; city?: string; country?: string;
  contact_type?: string; wa_unsubscribe?: string; email_unsubscribe?: string;
  actual_email?: string; actual_mobile?: string; mobile_country?: string;
  company_name?: string; designation?: string;
  sources?: string; booking_status: string; product_tier?: string; geography?: string; segment_label?: string;
  total_tour_bookings?: number; total_package_bookings?: number; total_hotel_bookings?: number;
  total_visa_bookings?: number; total_other_bookings?: number; total_flight_bookings?: number;
  total_booking_revenue?: number | string;
  rayna_tours?: TableRow[]; rayna_packages?: TableRow[]; rayna_hotels?: TableRow[];
  rayna_visas?: TableRow[]; rayna_others?: TableRow[]; rayna_flights?: TableRow[];
  /** How many rows per type the profile carries; longer lists are paged from the API. */
  bookings_per_type?: number;
  revenue_by_type?: Partial<Record<ContactBookingType, number>>;
  cancelled_count?: number; cancelled_revenue?: number;
  total_chats: number; chat_departments?: string; first_chat_at?: string; last_chat_at?: string;
  first_msg_text?: string; last_msg_text?: string;
  first_seen_at?: string; last_seen_at?: string; created_at?: string;
}
interface GtmSummaryRow { event_name: string; count: number; total_value: string; last_seen?: string }
interface GtmData { summary?: GtmSummaryRow[]; events?: TableRow[] }
interface JourneyNodeStat {
  node_id: string; label?: string; subject?: string; day_number?: number;
  delivered?: boolean; opened?: boolean; clicked?: boolean;
  sent_at?: string; opened_at?: string; clicked_at?: string;
}
interface ContactJourney {
  journey_id: string | number; name?: string; journey_status: string; entry_status: string;
  exit_reason?: string; current_node_id?: string; nodes?: JourneyNodeStat[];
}
interface AiProduct { product_id: string | number; url?: string; image?: string; name?: string; category?: string; sale_price?: number | string | null }
interface AiRecommendation {
  recommendationType: string; computedAt?: string; source?: string;
  basedOnProductName?: string; destinationCity?: string; products: AiProduct[];
}
interface AffinityRankRow { rank: number; bookings: number; last_booking_date?: string; affinity_score?: number | string | null }
interface AffinityServiceRow extends AffinityRankRow { service: string; revenue?: number | string }
interface AffinityProductRow extends AffinityRankRow { product_name?: string; services?: string[] }
interface ContactAffinity {
  customer: { affinity_score?: number | string | null; is_bulk?: boolean; product_count?: number; built_at?: string };
  services: AffinityServiceRow[];
  products: AffinityProductRow[];
}

type TimelineKind = 'booking' | 'message' | 'website' | 'chat' | 'profile';
interface TimelineItem { at: Date; dateOnly: boolean; kind: TimelineKind; title: string; sub?: string }
type ProfileTab = 'activity' | 'bookings' | 'website' | 'messages';

function parseDate(d: DateInput) {
  if (!d) return null;
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d));
  const dt = ddmmyyyy ? new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`) : new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}
function isDateOnly(d: DateInput) { return /^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})$/.test(String(d ?? '')); }
function formatDate(d: DateInput) { const dt = parseDate(d); return dt ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function formatDateTime(d: DateInput) { const dt = parseDate(d); return dt ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'; }
function formatAED(n: string | number | null | undefined) { return `AED ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }
function formatCurrency(v: string | number | null | undefined) { if (v == null || v === '') return '—'; return formatAED(v); }
function pathOf(u?: string) { if (!u) return ''; try { return new URL(u).pathname; } catch { return u; } }
function humanize(v: string) { const t = v.replace(/[_-]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); }
const isUnsub = (v?: string) => (v || '').toLowerCase() === 'yes';

const GEO_LABEL: Record<string, string> = { LOCAL: 'Lives in UAE', INTERNATIONAL: 'Lives abroad' };
const AFFINITY_SERVICE_LABEL: Record<string, string> = { tours: 'Tours', packages: 'Packages', hotels: 'Hotels', visas: 'Visas', flights: 'Flights', others: 'Others' };

const KIND_STYLE: Record<TimelineKind, { icon: LucideIcon; bg: string; fg: string }> = {
  booking: { icon: ShoppingBag, bg: 'var(--gold-soft)', fg: 'var(--gold-ink)' },
  message: { icon: Mail, bg: 'var(--info-soft)', fg: 'var(--info)' },
  website: { icon: Globe, bg: 'var(--sunken)', fg: 'var(--ink2)' },
  chat: { icon: MessageCircle, bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  profile: { icon: UserPlus, bg: 'var(--sunken)', fg: 'var(--ink2)' },
};
const KIND_FILTERS: { key: TimelineKind | 'all'; label: string }[] = [
  { key: 'all', label: 'Everything' }, { key: 'booking', label: 'Bookings' }, { key: 'message', label: 'Messages' },
  { key: 'website', label: 'Website' }, { key: 'chat', label: 'Chats' },
];
const JOURNEY_STATUS: Record<string, { tone: ChipTone; label: string }> = {
  active: { tone: 'ok', label: 'Active' }, draft: { tone: 'mute', label: 'Draft' },
  paused: { tone: 'warn', label: 'Paused' }, completed: { tone: 'info', label: 'Completed' },
};
const PAGE = 30;

export default function ContactProfile() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [gtmData, setGtmData] = useState<GtmData | null>(null);
  const [gtmLoading, setGtmLoading] = useState(true);
  const [journeys, setJourneys] = useState<ContactJourney[]>([]);
  const [journeysLoading, setJourneysLoading] = useState(true);
  const [aiRec, setAiRec] = useState<AiRecommendation | null>(null);
  const [affinity, setAffinity] = useState<ContactAffinity | null>(null);
  const [expandedJourneys, setExpandedJourneys] = useState(() => new Set<string | number>());
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>('activity');
  const [kind, setKind] = useState<TimelineKind | 'all'>('all');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!id) return;
    setContactLoading(true);
    (getUnifiedContact(id) as Promise<{ data?: ContactDetail }>)
      .then(res => setContact(res.data!))
      .catch(() => setContact(null))
      .finally(() => setContactLoading(false));

    setGtmLoading(true);
    (getContactGTMEvents(id) as Promise<GtmData>)
      .then(res => setGtmData(res))
      .catch(() => setGtmData(null))
      .finally(() => setGtmLoading(false));

    setJourneysLoading(true);
    (getContactJourneys(id) as Promise<{ data?: ContactJourney[] }>)
      .then(res => setJourneys(res.data || []))
      .catch(() => setJourneys([]))
      .finally(() => setJourneysLoading(false));

    // Cached AI recommendation — the card is hidden when there is none.
    (getContactRecommendations(id) as Promise<{ recommendation?: AiRecommendation } | null>)
      .then(res => setAiRec(res?.recommendation || null))
      .catch(() => setAiRec(null));

    // Top services / products from bookings — 404 (no bookings) just hides the card.
    (getContactAffinity(id) as Promise<ContactAffinity | null>)
      .then(res => setAffinity(res?.customer ? res : null))
      .catch(() => setAffinity(null));
  }, [id]);

  if (contactLoading) return <ProfileSkeleton />;
  if (!contact) return (
    <div className={s.page}>
      <EmptyState title="Contact not found."
        description="It may have been deleted or merged into another contact."
        action={<Button size="sm" onClick={() => router.push('/contacts')}>Back to Contacts</Button>} />
    </div>
  );

  const startEdit = () => {
    setEditForm({
      name: contact.name || '', email: contact.email || '', mobile: contact.mobile || '',
      city: contact.city || '', country: contact.country || '', contact_type: contact.contact_type || '',
      wa_unsubscribe: contact.wa_unsubscribe || 'no', email_unsubscribe: contact.email_unsubscribe || 'no',
      actual_email: contact.actual_email || '', actual_mobile: contact.actual_mobile || '', mobile_country: contact.mobile_country || '',
    });
    setSaveError(null);
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setSaveError(null); };
  const setField = (key: string, val: string) => setEditForm(f => ({ ...f, [key]: val }));
  const saveEdit = async () => {
    setSaveLoading(true);
    setSaveError(null);
    try {
      const res = await updateUnifiedContact(id, editForm) as { data?: Partial<ContactDetail> };
      setContact(prev => ({ ...prev, ...res.data } as ContactDetail));
      setEditing(false);
    } catch (err) {
      setSaveError((err as Error).message || 'Failed to save changes');
    } finally {
      setSaveLoading(false);
    }
  };

  const types: { key: ContactBookingType; label: string; count: number; rows?: TableRow[] }[] = [
    { key: 'tours', label: 'Tours', count: contact.total_tour_bookings || 0, rows: contact.rayna_tours },
    { key: 'packages', label: 'Packages', count: contact.total_package_bookings || 0, rows: contact.rayna_packages },
    { key: 'hotels', label: 'Hotels', count: contact.total_hotel_bookings || 0, rows: contact.rayna_hotels },
    { key: 'visas', label: 'Visas', count: contact.total_visa_bookings || 0, rows: contact.rayna_visas },
    { key: 'others', label: 'Others', count: contact.total_other_bookings || 0, rows: contact.rayna_others },
    { key: 'flights', label: 'Flights', count: contact.total_flight_bookings || 0, rows: contact.rayna_flights },
  ];
  const totalBookings = types.reduce((sum, t) => sum + t.count, 0);
  const totalRevenue = Number(contact.total_booking_revenue) || 0;
  const allRows = types.flatMap(t => t.rows || []);
  // Exact figures come from the API aggregate; the row sums are a fallback for older payloads.
  const cancelledCount = typeof contact.cancelled_count === 'number' ? contact.cancelled_count : allRows.filter(r => r.is_cancel === '1').length;
  const cancelledRevenue = typeof contact.cancelled_revenue === 'number' ? contact.cancelled_revenue : allRows.filter(r => r.is_cancel === '1').reduce((sum, r) => sum + (parseFloat(r.selling_price) || 0), 0);
  const revenueFor = (t: typeof types[number]) => typeof contact.revenue_by_type?.[t.key] === 'number'
    ? contact.revenue_by_type[t.key] as number
    : (t.rows || []).filter(r => r.is_cancel !== '1').reduce((sum, r) => sum + (parseFloat(r.selling_price) || 0), 0);
  const perType = contact.bookings_per_type || 20;
  const gtmTotal = (gtmData?.summary || []).reduce((sum, e) => sum + (Number(e.count) || 0), 0);
  const gtmLast = (gtmData?.summary || []).map(e => parseDate(e.last_seen)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  const phone = contact.phone || contact.mobile;
  const sources = (contact.sources || '').split(',').map(x => x.trim()).filter(Boolean);
  const hasMessages = Boolean(contact.first_msg_text || contact.last_msg_text);

  // ── Activity timeline: merged from data the APIs already return, newest first ──
  const timeline: TimelineItem[] = [];
  const push = (when: DateInput, kindKey: TimelineKind, title: string, sub?: string) => {
    const at = parseDate(when);
    if (at) timeline.push({ at, dateOnly: isDateOnly(when), kind: kindKey, title, sub });
  };
  types.forEach(t => (t.rows || []).forEach(r => {
    const price = parseFloat(r.selling_price) > 0 ? ` — ${formatAED(r.selling_price)}` : '';
    const sub = [t.label.replace(/s$/, ''), r.bill_no && `Bill ${r.bill_no}`, r.travel_date && `travel ${formatDate(r.travel_date)}`, r.is_cancel === '1' && 'Cancelled'].filter(Boolean).join(' · ');
    push(r.booking_date, 'booking', `Booked ${r.service_name || t.label.toLowerCase()}${price}`, sub);
  }));
  journeys.forEach(j => (j.nodes || []).forEach(n => {
    const what = n.subject || n.label || n.node_id;
    const jn = j.name || `Journey ${j.journey_id}`;
    const step = n.day_number ? ` · day ${n.day_number}` : '';
    if (n.sent_at) push(n.sent_at, 'message', `Sent email “${what}”`, `${jn}${step}`);
    if (n.opened_at) push(n.opened_at, 'message', `Opened email “${what}”`, `${jn}${step}`);
    if (n.clicked_at) push(n.clicked_at, 'message', `Clicked a link in “${what}”`, `${jn}${step}`);
  }));
  (gtmData?.events || []).forEach(e => {
    const page = e.page_title || pathOf(e.page_url);
    const sub = [page && e.page_title ? pathOf(e.page_url) : '', parseFloat(e.event_value) > 0 ? formatAED(e.event_value) : '', e.device_type, e.city, e.utm_source && `from ${e.utm_source}`].filter(Boolean).join(' · ');
    push(e.created_at, 'website', `${humanize(e.event_name || 'Website event')}${page ? ` · ${page}` : ''}`, sub || undefined);
  });
  if (contact.first_chat_at) push(contact.first_chat_at, 'chat', 'First chat', contact.first_msg_text || contact.chat_departments);
  if (contact.last_chat_at && contact.last_chat_at !== contact.first_chat_at) push(contact.last_chat_at, 'chat', 'Latest chat', contact.last_msg_text || contact.chat_departments);
  if (contact.created_at) push(contact.created_at, 'profile', 'Contact created', sources.length ? `From ${sources.join(', ')}` : undefined);
  if (contact.first_seen_at && contact.first_seen_at !== contact.created_at) push(contact.first_seen_at, 'profile', 'First seen');
  timeline.sort((a, b) => b.at.getTime() - a.at.getTime());
  const kindsPresent = new Set(timeline.map(t => t.kind));
  const visibleTimeline = timeline.filter(t => kind === 'all' || t.kind === kind);

  const tabs: { key: ProfileTab; label: ReactNode }[] = [
    { key: 'activity', label: <>Activity {timeline.length > 0 && <Chip className={s.miniChip}>{timeline.length}</Chip>}</> },
    { key: 'bookings', label: <>Bookings <Chip className={s.miniChip}>{totalBookings}</Chip></> },
    { key: 'website', label: <>Website {gtmTotal > 0 && <Chip className={s.miniChip}>{gtmTotal}</Chip>}</> },
    ...(hasMessages ? [{ key: 'messages' as const, label: 'Chat messages' }] : []),
  ];

  return (
    <div className={s.page}>
      <nav className={s.crumbs} aria-label="Breadcrumb">
        <span>Audience</span><span aria-hidden="true">/</span>
        <button type="button" onClick={() => router.push('/contacts')}>Contacts</button><span aria-hidden="true">/</span>
        <span className={s.crumbCurrent} aria-current="page">{contact.name || 'Unknown'}</span>
      </nav>

      <div className={s.ph}>
        <div className={s.identity}>
          <ContactAvatar name={contact.name} fallback={contact.email || phone} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <h1>{contact.name || 'Unknown'}</h1>
            <div className={s.chips}>
              <ContactStatusChip status={contact.booking_status} />
              {contact.contact_type && <Chip>{contact.contact_type}</Chip>}
              {contact.product_tier && <Chip tone={contact.product_tier === 'LUXURY' ? 'gold' : 'mute'}>{humanize(contact.product_tier.toLowerCase())}</Chip>}
              {contact.geography && <Chip>{GEO_LABEL[contact.geography] || contact.geography}{contact.country ? ` · ${contact.country}` : ''}</Chip>}
              {sources.length > 0 && <Chip>From: {sources.join(', ')}</Chip>}
            </div>
            <span className={`${s.mono} ${s.help}`}>ID: {contact.id || contact.unified_id}</span>
          </div>
        </div>
        <div className={s.actions}>
          {!editing && <Button variant="primary" onClick={startEdit}><Pencil size={14} aria-hidden="true" /> Edit details</Button>}
        </div>
      </div>

      <div className={s.layout}>
        <aside className={s.aside}>
          <section className={s.card} aria-labelledby="cp-details">
            <div className={s.cardHead}>
              <h2 id="cp-details" className={s.cardTitle}>Contact details</h2>
              {editing && (
                <div className={s.actions}>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saveLoading}>Cancel</Button>
                  <Button size="sm" variant="primary" onClick={saveEdit} disabled={saveLoading}>
                    {saveLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                    {saveLoading ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              )}
            </div>
            {saveError && <div className={s.alert} role="alert">{saveError}</div>}
            {editing ? (
              <div className={s.editGrid}>
                <EditField label="Name" value={editForm.name} onChange={v => setField('name', v)} />
                <EditField label="Email" value={editForm.email} onChange={v => setField('email', v)} type="email" />
                <EditField label="Phone" value={editForm.mobile} onChange={v => setField('mobile', v)} type="tel" />
                <EditField label="City" value={editForm.city} onChange={v => setField('city', v)} />
                <EditField label="Country" value={editForm.country} onChange={v => setField('country', v)} />
                <EditSelect label="Type" value={editForm.contact_type} onChange={v => setField('contact_type', v)}
                  options={CONTACT_TYPES.map(t => ({ value: t, label: t }))} />
                <EditSelect label="Email status" value={editForm.email_unsubscribe} onChange={v => setField('email_unsubscribe', v)}
                  options={[{ value: 'no', label: 'Active' }, { value: 'yes', label: 'Unsubscribed' }]} />
                <EditSelect label="WhatsApp status" value={editForm.wa_unsubscribe} onChange={v => setField('wa_unsubscribe', v)}
                  options={[{ value: 'no', label: 'Active' }, { value: 'yes', label: 'Unsubscribed' }]} />
                <EditField label="Actual email" value={editForm.actual_email} onChange={v => setField('actual_email', v)} type="email" />
                <EditField label="Actual mobile" value={editForm.actual_mobile} onChange={v => setField('actual_mobile', v)} type="tel" />
                <EditField label="Mobile country" value={editForm.mobile_country} onChange={v => setField('mobile_country', v)} />
              </div>
            ) : (
              <dl className={s.dl}>
                {contact.email && <><dt>Email</dt><dd>{contact.email}</dd></>}
                {phone && <><dt>Mobile</dt><dd>{phone}</dd></>}
                {contact.actual_email && <><dt>Actual email</dt><dd>{contact.actual_email}</dd></>}
                {contact.actual_mobile && <><dt>Actual mobile</dt><dd>{contact.actual_mobile}</dd></>}
                {contact.mobile_country && <><dt>Mobile country</dt><dd>{contact.mobile_country}</dd></>}
                {(contact.city || contact.country) && <><dt>City</dt><dd>{[contact.city, contact.country].filter(Boolean).join(', ')}</dd></>}
                {contact.company_name && <><dt>Company</dt><dd>{contact.company_name}</dd></>}
                {contact.designation && <><dt>Designation</dt><dd>{contact.designation}</dd></>}
                {contact.contact_type && <><dt>Type</dt><dd>{contact.contact_type}</dd></>}
                {contact.first_seen_at && <><dt>First seen</dt><dd>{formatDateTime(contact.first_seen_at)}</dd></>}
                {contact.last_seen_at && <><dt>Last seen</dt><dd>{formatDateTime(contact.last_seen_at)}</dd></>}
                {contact.created_at && <><dt>Created</dt><dd>{formatDateTime(contact.created_at)}</dd></>}
                <dt>Customer ID</dt><dd className={s.mono}>{contact.id || contact.unified_id}</dd>
              </dl>
            )}
          </section>

          <section className={s.card} aria-labelledby="cp-consent">
            <h2 id="cp-consent" className={s.cardTitle}>Can we message them?</h2>
            <div className={s.line}><span>Email</span>
              <Chip tone={isUnsub(contact.email_unsubscribe) ? 'bad' : 'ok'}>{isUnsub(contact.email_unsubscribe) ? 'Unsubscribed' : 'Active'}</Chip></div>
            <div className={s.line}><span>WhatsApp</span>
              <Chip tone={isUnsub(contact.wa_unsubscribe) ? 'bad' : 'ok'}>{isUnsub(contact.wa_unsubscribe) ? 'Unsubscribed' : 'Active'}</Chip></div>
            <span className={s.help}>Change these with Edit details.</span>
          </section>

          <section className={s.card} aria-labelledby="cp-segment">
            <h2 id="cp-segment" className={s.cardTitle}>Segment</h2>
            <dl className={s.dl}>
              <dt>Status</dt><dd><ContactStatusChip status={contact.booking_status} /></dd>
              <dt>Product tier</dt><dd>{contact.product_tier || 'N/A'}</dd>
              <dt>Geography</dt><dd>{contact.geography || 'Unknown'}</dd>
              {contact.segment_label && <><dt>Full segment</dt><dd>{contact.segment_label}</dd></>}
            </dl>
          </section>

          {affinity && <AffinitySection affinity={affinity} />}

          <section className={s.card} aria-labelledby="cp-journeys">
            <div className={s.cardHead}>
              <h2 id="cp-journeys" className={s.cardTitle}>Journeys</h2>
              {!journeysLoading && journeys.length > 0 && <span className={s.help}>{journeys.length} enrolled</span>}
            </div>
            {journeysLoading ? (
              <><Skeleton height={44} /><Skeleton height={44} /></>
            ) : journeys.length === 0 ? (
              <span className={s.help}>Not enrolled in any journey</span>
            ) : journeys.map(j => {
              const js = JOURNEY_STATUS[j.journey_status] || { tone: 'mute' as const, label: humanize(j.journey_status || '—') };
              const entry = ({
                active: 'In progress', completed: 'Completed', converted: 'Converted', snapshot: 'Queued',
                exited: `Exited${j.exit_reason ? ` · ${j.exit_reason}` : ''}`,
              } as Record<string, string>)[j.entry_status] || j.entry_status || '—';
              const nodes = j.nodes || [];
              const isOpen = expandedJourneys.has(j.journey_id);
              const toggle = () => setExpandedJourneys(prev => {
                const next = new Set(prev);
                if (next.has(j.journey_id)) next.delete(j.journey_id); else next.add(j.journey_id);
                return next;
              });
              return (
                <div key={j.journey_id} className={s.journey}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button type="button" className={s.journeyHead} onClick={toggle} aria-expanded={isOpen}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={s.journeyName}>{j.name || `Journey ${j.journey_id}`}</div>
                        <div className={s.help}>
                          {entry}
                          {j.current_node_id && j.entry_status === 'active' && <> · at {j.current_node_id}</>}
                          {nodes.length > 0 && <> · {nodes.length} email{nodes.length > 1 ? 's' : ''}</>}
                        </div>
                      </div>
                      <StatusChip tone={js.tone}>{js.label}</StatusChip>
                      <ChevronDown size={15} aria-hidden="true" style={{ color: 'var(--ink3)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .18s', flexShrink: 0 }} />
                    </button>
                    <Button size="sm" variant="ghost" icon aria-label="Open journey" style={{ marginRight: 6 }}
                      onClick={() => router.push(`/journeys/${j.journey_id}`)}><ExternalLink size={13} /></Button>
                  </div>
                  {isOpen && (
                    <div className={s.journeyBody}>
                      {nodes.length === 0 ? (
                        <span className={s.help} style={{ textAlign: 'center', padding: 6 }}>No emails sent to this contact in this journey yet</span>
                      ) : nodes.map((n, i) => (
                        <div key={`${n.node_id}-${i}`} className={s.node}>
                          <div className={s.nodeTitle}>
                            {n.day_number ? <Chip tone="info" className={s.miniChip}>Day {n.day_number}</Chip> : <span />}
                            <span>{n.label || n.subject || n.node_id}</span>
                          </div>
                          <div className={s.chips}>
                            {([
                              { on: n.delivered, at: n.sent_at, Icon: Send, label: 'Delivered' },
                              { on: n.opened, at: n.opened_at, Icon: Eye, label: 'Opened' },
                              { on: n.clicked, at: n.clicked_at, Icon: MousePointerClick, label: 'Clicked' },
                            ]).map(({ on, at, Icon, label }) => (
                              <Chip key={label} tone={on ? 'ok' : 'mute'} className={s.miniChip} title={at ? formatDateTime(at) : 'Not yet'}>
                                <Icon size={11} aria-hidden="true" /> {label}{on ? <Check size={11} aria-label="yes" /> : null}
                              </Chip>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {contact.total_chats > 0 && (
            <section className={s.card} aria-labelledby="cp-chats">
              <h2 id="cp-chats" className={s.cardTitle}>Chat activity</h2>
              <dl className={s.dl}>
                <dt>Total chats</dt><dd className={s.num}>{contact.total_chats}</dd>
                {contact.chat_departments && <><dt>Departments</dt><dd>{contact.chat_departments}</dd></>}
                {contact.first_chat_at && <><dt>First chat</dt><dd>{formatDateTime(contact.first_chat_at)}</dd></>}
                {contact.last_chat_at && <><dt>Last chat</dt><dd>{formatDateTime(contact.last_chat_at)}</dd></>}
              </dl>
            </section>
          )}
        </aside>

        <section className={s.main} aria-label="Activity and bookings">
          <div className={s.kpis} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Kpi label="Bookings" value={totalBookings} sub={cancelledCount > 0 ? `${cancelledCount} cancelled · ${formatAED(cancelledRevenue)}` : 'None cancelled'} />
            <Kpi label="Revenue" value={formatAED(totalRevenue)} sub="Confirmed only" />
            <Kpi label="Website events" value={gtmLoading ? '…' : gtmTotal} sub={gtmLast ? `Last: ${formatDate(gtmLast)}` : 'None recorded'} />
            <Kpi label="Chats" value={contact.total_chats || 0} sub={contact.last_chat_at ? `Last: ${formatDate(contact.last_chat_at)}` : 'None'} />
          </div>

          <Tabs label="Profile sections" items={tabs} value={tab} onChange={k => setTab(k)} />

          {tab === 'activity' && (
            <div className={s.card} style={{ gap: 4 }}>
              <div className={s.cardHead} style={{ marginBottom: 8 }}>
                <h2 className={s.cardTitle}>Activity timeline</h2>
                <div role="group" aria-label="Show" className={s.pills}>
                  {KIND_FILTERS.filter(f => f.key === 'all' || kindsPresent.has(f.key)).map(f => (
                    <button key={f.key} type="button" aria-pressed={kind === f.key}
                      className={`${s.pill} ${kind === f.key ? s.pillOn : ''}`}
                      onClick={() => { setKind(f.key); setShown(PAGE); }}>{f.label}</button>
                  ))}
                </div>
              </div>
              {(gtmLoading || journeysLoading) && timeline.length === 0 ? (
                <><Skeleton height={36} /><Skeleton height={36} /></>
              ) : visibleTimeline.length === 0 ? (
                <span className={s.help} style={{ padding: '12px 0' }}>No activity recorded for this contact yet.</span>
              ) : (
                <Timeline items={visibleTimeline.slice(0, shown)} />
              )}
              {visibleTimeline.length > shown && (
                <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShown(n => n + PAGE)}>
                  Show older activity ({visibleTimeline.length - shown} more)
                </Button>
              )}
            </div>
          )}

          {tab === 'bookings' && (
            totalBookings === 0 ? (
              <div className={s.card}><EmptyState title="No bookings yet" description="Bookings from tours, packages, hotels, visas, flights and others show here." /></div>
            ) : (
              <>
                <div className={s.card}>
                  <h2 className={s.cardTitle}>Booking overview</h2>
                  <div className={s.typeGrid}>
                    {types.map(t => {
                      const rev = revenueFor(t);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      return (
                        <div key={t.key} className={s.typeCell}>
                          <span className={s.help} style={{ fontWeight: 600 }}>{t.label}</span>
                          <div className={s.line}><b className={s.num} style={{ fontSize: 18 }}>{t.count}</b><span className={s.help}>{formatAED(rev)}</span></div>
                          <div className={s.bar}><div className={s.barFill} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {types.filter(t => t.count > 0).map(t => (
                  <PagedBookingsTable key={t.key} contactId={id} type={t.key} title={`${t.label} bookings`} total={t.count}
                    firstPage={t.rows || []} pageSize={perType} columns={bookingColumns} defaultOpen={types.filter(x => x.count > 0).length === 1} />
                ))}
              </>
            )
          )}

          {tab === 'website' && (
            <div className={s.card}>
              <h2 className={s.cardTitle}>Website events</h2>
              {gtmLoading ? (
                <><Skeleton height={38} /><Skeleton height={48} /></>
              ) : !gtmData?.summary?.length ? (
                <span className={s.help}>No website events recorded for this contact</span>
              ) : (
                <>
                  <div className={s.gtmChips}>
                    {gtmData.summary.map(ev => (
                      <div key={ev.event_name} className={s.gtmChip}>
                        <b>{ev.event_name}</b>
                        <Chip tone="warn" className={s.miniChip}>{ev.count}</Chip>
                        {parseFloat(ev.total_value) > 0 && <span className={s.num}>{formatAED(ev.total_value)}</span>}
                        <span className={s.help}>Last: {formatDate(ev.last_seen)}</span>
                      </div>
                    ))}
                  </div>
                  <CollapsibleTable title="Full event log" rows={gtmData.events} columns={gtmEventColumns} />
                </>
              )}
            </div>
          )}

          {tab === 'messages' && hasMessages && (
            <div className={s.card}>
              <h2 className={s.cardTitle}>Chat messages</h2>
              {contact.first_msg_text && <><span className={s.help}>First message{contact.first_chat_at ? ` · ${formatDateTime(contact.first_chat_at)}` : ''}</span><div className={s.quote}>{contact.first_msg_text}</div></>}
              {contact.last_msg_text && <><span className={s.help}>Last message{contact.last_chat_at ? ` · ${formatDateTime(contact.last_chat_at)}` : ''}</span><div className={s.quote}>{contact.last_msg_text}</div></>}
            </div>
          )}

          {aiRec && Array.isArray(aiRec.products) && aiRec.products.length > 0 && <AIRecommendationSection rec={aiRec} />}
        </section>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel}>{label}</span>
      <span className={s.kpiValue}>{value}</span>
      {sub && <span className={s.kpiSub}>{sub}</span>}
    </div>
  );
}

function dayLabel(d: Date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  return diff === 0 ? `Today · ${date}` : diff === 1 ? `Yesterday · ${date}` : date;
}

function Timeline({ items }: { items: TimelineItem[] }) {
  const groups: { day: string; items: TimelineItem[] }[] = [];
  items.forEach(it => {
    const day = dayLabel(it.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it); else groups.push({ day, items: [it] });
  });
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {groups.map(g => (
        <li key={g.day}>
          <div className={s.day}>{g.day}</div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {g.items.map((e, i) => {
              const st = KIND_STYLE[e.kind];
              return (
                <li key={i} className={s.event}>
                  <span className={`${s.mono} ${s.eventTime}`}>{e.dateOnly ? '' : e.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={s.eventIcon} style={{ background: st.bg, color: st.fg }} aria-hidden="true"><st.icon size={15} /></span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span className={s.eventTitle}>{e.title}</span>
                    {e.sub && <span className={s.eventSub}>{e.sub}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

// Affinity — the contact's services and products ranked by affinity score
// (each booking adds 10 points, halving every 6 months). Top 3 by default.
function AffinitySection({ affinity }: { affinity: ContactAffinity }) {
  const [showAll, setShowAll] = useState(false);
  const { customer, services, products } = affinity;
  const hasMore = services.length > 3 || products.length > 3;
  const score = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toFixed(Number(n) < 1 ? 2 : 1));
  const day = (v: string | null | undefined) => (v ? formatDate(String(v).slice(0, 10)) : '—');

  const rankList = <T extends AffinityRankRow,>(title: string, rows: T[], name: (r: T) => ReactNode, sub?: (r: T) => string) => (
    <div style={showAll ? { maxHeight: 420, overflowY: 'auto' } : undefined}>
      <div className={s.help} style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {rows.length === 0 ? (
        <span className={s.help}>None — only fee or add-on lines.</span>
      ) : rows.map(r => (
        <div key={r.rank} className={s.rank}>
          <span className={`${s.rankNo} ${r.rank === 1 ? s.rankNoTop : ''}`}>{r.rank}</span>
          <div style={{ minWidth: 0 }}>
            <div className={s.ellipsis} style={{ fontWeight: 600 }}>{name(r)}</div>
            <div className={s.help}>{r.bookings} booking{r.bookings === 1 ? '' : 's'} · last {day(r.last_booking_date)}{sub ? ` · ${sub(r)}` : ''}</div>
          </div>
          <span className={s.num} style={{ fontWeight: 700 }} title="Affinity score">{score(r.affinity_score)}</span>
        </div>
      ))}
    </div>
  );

  return (
    <section className={s.card} aria-labelledby="cp-affinity">
      <div className={s.cardHead}>
        <h2 id="cp-affinity" className={s.cardTitle}>Booking interests</h2>
        <Chip tone="gold">Score {score(customer.affinity_score)}</Chip>
      </div>
      {customer.is_bulk && <Chip tone="warn">Bulk / internal account</Chip>}
      {rankList(`Top services${showAll ? ` (${services.length})` : ''}`, showAll ? services : services.slice(0, 3), r => AFFINITY_SERVICE_LABEL[r.service] || r.service, r => formatAED(Number(r.revenue)))}
      {rankList(`Top products${showAll ? ` (${customer.product_count})` : ''}`, showAll ? products : products.slice(0, 3), r => r.product_name, r => (r.services || []).map(x => AFFINITY_SERVICE_LABEL[x] || x).join(', '))}
      <span className={s.help}>Each booking adds 10 points, halving every 6 months · built {customer.built_at ? formatDateTime(customer.built_at) : '—'}</span>
      {hasMore && (
        <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll(v => !v)}>
          {showAll ? <>Top 3 only <ChevronUp size={13} aria-hidden="true" /></> : <>Show all <ChevronDown size={13} aria-hidden="true" /></>}
        </Button>
      )}
    </section>
  );
}

function AIRecommendationSection({ rec }: { rec: AiRecommendation }) {
  const TYPE_LABEL: Record<string, string> = { on_trip: 'On trip', future_trip: 'Future trip', past_trip: 'Past trip' };
  const label = TYPE_LABEL[rec.recommendationType] || rec.recommendationType;
  const computedAgo = (() => {
    if (!rec.computedAt) return '—';
    const days = Math.floor((Date.now() - new Date(rec.computedAt).getTime()) / 86400000);
    if (isNaN(days)) return '—';
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  })();
  return (
    <section className={s.card} aria-labelledby="cp-recs">
      <div className={s.cardHead}>
        <h2 id="cp-recs" className={s.cardTitle}>Suggested next · {label}</h2>
        <Chip tone={rec.source === 'claude' ? 'gold' : 'mute'}>{rec.source || 'fallback'}</Chip>
      </div>
      <span className={s.help}>
        {rec.basedOnProductName ? <>Based on <b>{rec.basedOnProductName}</b></> : 'Based on their booking'}
        {rec.destinationCity && <> in <b>{rec.destinationCity}</b></>} · computed {computedAgo}
      </span>
      <div className={s.recGrid}>
        {rec.products.map(p => (
          <a key={p.product_id} href={p.url || 'https://www.raynatours.com'} target="_blank" rel="noopener noreferrer" className={s.recTile}>
            {p.image && <img src={p.image} alt={p.name || ''} />}
            <div style={{ padding: 10, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className={s.recName}>{p.name}</div>
              {p.category && <span className={s.help}>{p.category}</span>}
              <div className={s.line} style={{ marginTop: 'auto' }}>
                <b className={s.num}>{p.sale_price != null ? `AED ${Math.round(Number(p.sale_price))}` : '—'}</b>
                <ExternalLink size={11} aria-hidden="true" style={{ color: 'var(--ink3)' }} />
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

/**
 * Booking table that pages on the server: page 1 is what the profile already carries,
 * later pages are fetched only when the user asks for them (20 per page).
 */
function PagedBookingsTable({ contactId, type, title, total, firstPage, pageSize, columns, defaultOpen = false }: {
  contactId: string; type: ContactBookingType; title: string; total: number; firstPage: TableRow[]; pageSize: number; columns: TableColumn[]; defaultOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<Record<number, TableRow[]>>({ 1: firstPage });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (!expanded || pages[page]) return;
    let alive = true;
    setLoading(true);
    setError(null);
    getContactBookings(contactId, { type, page, limit: pageSize })
      .then(res => { if (alive) setPages(prev => ({ ...prev, [page]: (res?.rows ?? []) as TableRow[] })); })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : 'Could not load this page'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [expanded, page, pages, contactId, type, pageSize]);

  if (total === 0) return null;
  const rows = pages[page];
  return (
    <div className={`${s.card} ${s.flush}`}>
      <button type="button" className={s.collapse} onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b>{title}</b><Chip className={s.miniChip}>{total}</Chip></span>
        {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {expanded && (
        <>
          {error ? (
            <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className={s.help}>{error}</span>
              <Button size="sm" onClick={() => setPages(prev => { const next = { ...prev }; delete next[page]; return next; })}>Try again</Button>
            </div>
          ) : !rows || loading ? (
            <div style={{ padding: 12, display: 'grid', gap: 8 }} aria-busy="true"><Skeleton height={18} /><Skeleton height={18} /><Skeleton height={18} /></div>
          ) : (
            <Table label={title}>
              <thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.bill_serial ?? r.bill_no ?? i}`}>{columns.map(c => <td key={c.key} style={{ whiteSpace: 'nowrap' }}>{c.render ? c.render(r[c.key], r) : (r[c.key] ?? '—')}</td>)}</tr>
                ))}
              </tbody>
            </Table>
          )}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 12px', flexWrap: 'wrap' }}>
              <span className={s.help}>{Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}</span>
              <SegmentPager page={page} totalPages={totalPages} onPage={p => setPage(p)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CollapsibleTable({ title, rows, columns, defaultOpen = false }: { title: string; rows?: TableRow[]; columns: TableColumn[]; defaultOpen?: boolean }) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const count = rows?.length || 0;
  if (count === 0) return null;
  return (
    <div className={`${s.card} ${s.flush}`}>
      <button type="button" className={s.collapse} onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b>{title}</b><Chip className={s.miniChip}>{count}</Chip></span>
        {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {expanded && (
        <Table label={title}>
          <thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows!.map((r, i) => (
              <tr key={i}>{columns.map(c => <td key={c.key} style={{ whiteSpace: 'nowrap' }}>{c.render ? c.render(r[c.key], r) : (r[c.key] ?? '—')}</td>)}</tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className={s.page} aria-busy="true">
      <Skeleton width={180} height={14} />
      <div className={s.identity}>
        <Skeleton width={56} height={56} radius="50%" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Skeleton width={200} height={24} /><Skeleton width={140} height={14} /></div>
      </div>
      <div className={s.layout}>
        <div className={s.aside}>{[0, 1].map(i => <div key={i} className={s.card}><Skeleton width={100} height={14} /><Skeleton height={14} /><Skeleton height={14} /></div>)}</div>
        <div className={s.main}><div className={s.kpis}>{[0, 1, 2, 3].map(i => <div key={i} className={s.kpi}><Skeleton width={70} height={12} /><Skeleton width={90} height={22} /></div>)}</div><div className={s.card}><Skeleton height={120} /></div></div>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <Field label={label}>{p => <Input {...p} type={type} value={value} onChange={e => onChange(e.target.value)} />}</Field>;
}

function EditSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Field label={label}>{p => (
      <Select {...p} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    )}</Field>
  );
}

// ── Column definitions ──────────────────────────────────────────────────────

const bookingColumns: TableColumn[] = [
  { key: 'bill_no', label: 'Bill #', render: v => <span className={s.mono}>{v || '—'}</span> },
  { key: 'service_name', label: 'Service', render: v => v ? (v.length > 35 ? v.slice(0, 35) + '…' : v) : '—' },
  { key: 'travel_date', label: 'Travel date', render: v => formatDate(v) },
  { key: 'booking_date', label: 'Booked', render: v => formatDate(v) },
  { key: 'guest_name', label: 'Guest' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'selling_price', label: 'Amount', render: v => <span className={s.num}>{formatCurrency(v)}</span> },
  { key: 'is_cancel', label: 'Status', render: v => v === '1' ? <Chip tone="bad">Cancelled</Chip> : <Chip tone="ok">Active</Chip> },
];

const gtmEventColumns: TableColumn[] = [
  { key: 'event_name', label: 'Event' },
  { key: 'page_url', label: 'Page', render: v => pathOf(v) || '—' },
  { key: 'event_value', label: 'Value', render: v => parseFloat(v) > 0 ? formatCurrency(v) : '—' },
  { key: 'device_type', label: 'Device', render: v => v || '—' },
  { key: 'city', label: 'City', render: v => v || '—' },
  { key: 'utm_source', label: 'UTM source', render: v => v || '—' },
  { key: 'created_at', label: 'Time', render: v => formatDateTime(v) },
];
