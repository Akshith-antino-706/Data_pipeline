'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { getUnifiedContact, getContactGTMEvents, updateUnifiedContact, getContactJourneys } from '@/lib/api';
import {
  ArrowLeft, Globe, MessageSquare, Mail, Phone, Building2,
  Calendar, Clock, Ticket, DollarSign, Plane, Hotel, MessageCircle,
  Layers, FileText, Palmtree, Hash, MapPin, ChevronDown, ChevronUp,
  Zap, Activity, User, Pencil, X, Check, Loader2, GitBranch,
} from 'lucide-react';

const fadeIn = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } };
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };

function parseDate(d) {
  if (!d) return null;
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d));
  const dt = ddmmyyyy ? new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`) : new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}
function formatDate(d) { const dt = parseDate(d); return dt ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function formatDateTime(d) { const dt = parseDate(d); return dt ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'; }
function formatAED(n) { return `AED ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }
function formatCurrency(v) { if (v == null) return '—'; return `AED ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }

const STATUS_COLOR = {
  ON_TRIP: 'var(--green)', FUTURE_TRAVEL: '#3b82f6', ACTIVE_ENQUIRY: '#f59e0b',
  PAST_BOOKING: 'var(--text-secondary)', PROSPECT: 'var(--text-tertiary)',
};

export default function ContactProfile() {
  const { id } = useParams();
  const router = useRouter();

  const [contact, setContact] = useState(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [gtmData, setGtmData] = useState(null);
  const [gtmLoading, setGtmLoading] = useState(true);
  const [journeys, setJourneys] = useState([]);
  const [journeysLoading, setJourneysLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!id) return;
    setContactLoading(true);
    getUnifiedContact(id)
      .then(res => setContact(res.data))
      .catch(() => setContact(null))
      .finally(() => setContactLoading(false));

    setGtmLoading(true);
    getContactGTMEvents(id)
      .then(res => setGtmData(res))
      .catch(() => setGtmData(null))
      .finally(() => setGtmLoading(false));

    setJourneysLoading(true);
    getContactJourneys(id)
      .then(res => setJourneys(res.data || []))
      .catch(() => setJourneys([]))
      .finally(() => setJourneysLoading(false));
  }, [id]);

  if (contactLoading) return <ProfileSkeleton />;
  if (!contact) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
      Contact not found. <button className="btn btn-ghost btn-sm" onClick={() => router.push('/contacts')}>Back to Contacts</button>
    </div>
  );

  const startEdit = () => {
    setEditForm({
      name:              contact.name || '',
      email:             contact.email || '',
      mobile:            contact.mobile || '',
      city:              contact.city || '',
      country:           contact.country || '',
      contact_type:      contact.contact_type || '',
      wa_unsubscribe:    contact.wa_unsubscribe || 'no',
      email_unsubscribe: contact.email_unsubscribe || 'no',
      actual_email:      contact.actual_email || '',
      actual_mobile:     contact.actual_mobile || '',
      mobile_country:    contact.mobile_country || '',
    });
    setSaveError(null);
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setSaveError(null); };
  const setField = (key, val) => setEditForm(f => ({ ...f, [key]: val }));
  const saveEdit = async () => {
    setSaveLoading(true);
    setSaveError(null);
    try {
      const res = await updateUnifiedContact(id, editForm);
      setContact(prev => ({ ...prev, ...res.data }));
      setEditing(false);
    } catch (err) {
      setSaveError(err.message || 'Failed to save changes');
    } finally {
      setSaveLoading(false);
    }
  };

  const types = [
    { key: 'tour',    label: 'Tours',    icon: Palmtree,     color: '#10b981', count: contact.total_tour_bookings || 0,    rows: contact.rayna_tours },
    { key: 'package', label: 'Packages', icon: Layers,       color: '#8b5cf6', count: contact.total_package_bookings || 0, rows: contact.rayna_packages },
    { key: 'hotel',   label: 'Hotels',   icon: Hotel,        color: '#6366f1', count: contact.total_hotel_bookings || 0,   rows: contact.rayna_hotels },
    { key: 'visa',    label: 'Visas',    icon: FileText,     color: '#f59e0b', count: contact.total_visa_bookings || 0,    rows: contact.rayna_visas },
    { key: 'other',   label: 'Others',   icon: Ticket,       color: '#ec4899', count: contact.total_other_bookings || 0,   rows: contact.rayna_others },
    { key: 'flight',  label: 'Flights',  icon: Plane,        color: '#3b82f6', count: contact.total_flight_bookings || 0,  rows: contact.rayna_flights },
  ];
  const totalBookings = types.reduce((s, t) => s + t.count, 0);
  const totalRevenue = contact.total_booking_revenue || 0;
  const allRows = types.flatMap(t => t.rows || []);
  const cancelledCount = allRows.filter(r => r.is_cancel === '1').length;
  const cancelledRevenue = allRows.filter(r => r.is_cancel === '1').reduce((s, r) => s + (parseFloat(r.selling_price) || 0), 0);

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger}>

      {/* Back + Header */}
      <motion.div variants={fadeIn} style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.push('/contacts')}
          className="btn btn-ghost btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={15} /> Back to Contacts
        </button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          {/* Left: avatar + name + id + badges */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(201,169,110,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
              <User size={22} color="var(--brand-primary, #C9A96E)" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{contact.name || 'Unknown'}</h2>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>ID: {contact.id || contact.unified_id}</span>
              <div style={{ marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {contact.sources?.split(', ').map(s => (
                  <span key={s} className={`badge ${s === 'chat' ? 'badge-green' : s === 'ticket' ? 'badge-orange' : s === 'rayna' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 10 }}>{s}</span>
                ))}
                {contact.booking_status && (
                  <span className="badge" style={{ fontSize: 10, background: `${STATUS_COLOR[contact.booking_status]}20`, color: STATUS_COLOR[contact.booking_status] }}>
                    {contact.booking_status}
                  </span>
                )}
                {contact.product_tier && (
                  <span className={`badge ${contact.product_tier === 'LUXURY' ? 'badge-orange' : 'badge-gray'}`} style={{ fontSize: 10 }}>{contact.product_tier}</span>
                )}
                {contact.geography && (
                  <span className={`badge ${contact.geography === 'LOCAL' ? 'badge-green' : 'badge-blue'}`} style={{ fontSize: 10 }}>{contact.geography}</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: quick stat chips */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <StatChip icon={Ticket}      label="Bookings"   value={totalBookings}          color="var(--brand-primary, #C9A96E)" />
            <StatChip icon={DollarSign}  label="Revenue"    value={formatAED(totalRevenue)} color="#10b981" />
            {gtmData?.summary?.length > 0 && (
              <StatChip icon={Zap} label="GTM Events" value={gtmData.summary.reduce((s, e) => s + e.count, 0)} color="#f59e0b" />
            )}
          </div>
        </div>
      </motion.div>

      {/* Segment */}
      <motion.div variants={fadeIn}>
        <Section title="Segment">
          <DetailRow icon={Hash}  label="Status"       value={contact.booking_status} color={STATUS_COLOR[contact.booking_status]} />
          <DetailRow icon={Hash}  label="Product Tier" value={contact.product_tier || 'N/A'} color={contact.product_tier === 'LUXURY' ? 'var(--orange)' : undefined} />
          <DetailRow icon={Globe} label="Geography"    value={contact.geography || 'Unknown'} />
          {contact.segment_label && <DetailRow icon={Layers} label="Full Segment" value={contact.segment_label} />}
        </Section>
      </motion.div>

      {/* Contact Info — inline edit */}
      <motion.div variants={fadeIn}>
        <div className="card" style={{ padding: 20, marginBottom: 12 }}>
          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: 0.5, fontWeight: 600 }}>Contact Information</span>
            {!editing ? (
              <button className="btn btn-ghost btn-sm" onClick={startEdit}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
                <Pencil size={13} /> Edit
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={cancelEdit} disabled={saveLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <X size={13} /> Cancel
                </button>
                <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saveLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  {saveLoading
                    ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Check size={13} />}
                  {saveLoading ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>

          {/* Error banner */}
          {saveError && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', fontSize: 12, color: '#ef4444' }}>
              {saveError}
            </div>
          )}

          {/* Edit mode */}
          {editing ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 32px' }}>
              <EditField label="Name"    value={editForm.name}    onChange={v => setField('name', v)} />
              <EditField label="Email"   value={editForm.email}   onChange={v => setField('email', v)}  type="email" />
              <EditField label="Phone"   value={editForm.mobile}  onChange={v => setField('mobile', v)} type="tel" />
              <EditField label="City"    value={editForm.city}    onChange={v => setField('city', v)} />
              <EditField label="Country" value={editForm.country} onChange={v => setField('country', v)} />
              <EditSelect label="Type" value={editForm.contact_type} onChange={v => setField('contact_type', v)}
                options={[{ value: 'B2C', label: 'B2C' }, { value: 'B2B', label: 'B2B' }]} />
              <EditSelect label="Email Status" value={editForm.email_unsubscribe} onChange={v => setField('email_unsubscribe', v)}
                options={[{ value: 'no', label: 'Active' }, { value: 'yes', label: 'Unsubscribed' }]} />
              <EditSelect label="WA Status" value={editForm.wa_unsubscribe} onChange={v => setField('wa_unsubscribe', v)}
                options={[{ value: 'no', label: 'Active' }, { value: 'yes', label: 'Unsubscribed' }]} />
              <EditField label="Actual Email"  value={editForm.actual_email}   onChange={v => setField('actual_email', v)}  type="email" />
              <EditField label="Actual Mobile" value={editForm.actual_mobile}  onChange={v => setField('actual_mobile', v)} type="tel" />
              <EditField label="Mobile Country" value={editForm.mobile_country} onChange={v => setField('mobile_country', v)} />
            </div>
          ) : (
            /* View mode */
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 32px' }}>
              {contact.email                        && <DetailRow icon={Mail}          label="Email"          value={contact.email} />}
              {(contact.phone || contact.mobile)    && <DetailRow icon={Phone}         label="Phone"          value={contact.phone || contact.mobile} />}
              {contact.actual_email                 && <DetailRow icon={Mail}          label="Actual Email"   value={contact.actual_email} />}
              {contact.actual_mobile                && <DetailRow icon={Phone}         label="Actual Mobile"  value={contact.actual_mobile} />}
              {contact.mobile_country               && <DetailRow icon={Globe}         label="Mobile Country" value={contact.mobile_country} />}
              {contact.company_name                 && <DetailRow icon={Building2}     label="Company"        value={contact.company_name} />}
              {contact.designation                  && <DetailRow icon={Hash}          label="Designation"    value={contact.designation} />}
              {contact.city                         && <DetailRow icon={MapPin}        label="City"           value={contact.city} />}
              {contact.country                      && <DetailRow icon={Globe}         label="Country"        value={contact.country} />}
              {contact.contact_type                 && <DetailRow icon={Hash}          label="Type"           value={contact.contact_type} />}
              <DetailRow icon={Mail}         label="Email Status"
                value={(contact.email_unsubscribe || '').toLowerCase() === 'yes' ? 'Unsubscribed' : 'Active'}
                color={(contact.email_unsubscribe || '').toLowerCase() === 'yes' ? 'var(--red)' : 'var(--green)'} />
              <DetailRow icon={MessageSquare} label="WA Status"
                value={(contact.wa_unsubscribe || '').toLowerCase() === 'yes' ? 'Unsubscribed' : 'Active'}
                color={(contact.wa_unsubscribe || '').toLowerCase() === 'yes' ? 'var(--red)' : 'var(--green)'} />
            </div>
          )}
        </div>
      </motion.div>

      {/* Booking Overview */}
      {totalBookings > 0 && (
        <motion.div variants={fadeIn}>
          <div className="card" style={{ padding: 20, marginBottom: 12 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 16, letterSpacing: 0.5, fontWeight: 600 }}>Booking Overview</div>

            {/* Summary KPIs */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <div style={{ padding: '10px 18px', borderRadius: 10, background: 'rgba(201,169,110,0.1)', border: '1px solid rgba(201,169,110,0.4)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 2 }}>Total Bookings</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--brand-primary, #C9A96E)' }}>{totalBookings}</div>
              </div>
              <div style={{ padding: '10px 18px', borderRadius: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid #10b981' }}>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 2 }}>Confirmed Revenue</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#10b981' }}>{formatAED(totalRevenue)}</div>
              </div>
              {cancelledCount > 0 && (
                <div style={{ padding: '10px 18px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 2 }}>Cancelled</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 26, fontWeight: 700, color: '#ef4444' }}>{cancelledCount}</span>
                    <span style={{ fontSize: 11, color: '#ef4444', opacity: 0.7 }}>{formatAED(cancelledRevenue)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Per-type grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {types.map(t => {
                const rev = (t.rows || []).filter(r => r.is_cancel !== '1').reduce((s, r) => s + (parseFloat(r.selling_price) || 0), 0);
                const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                return (
                  <div key={t.key} style={{ padding: '10px 14px', borderRadius: 10, background: `${t.color}08`, border: `1px solid ${t.color}30` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <t.icon size={14} style={{ color: t.color }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: t.color }}>{t.label}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 18, fontWeight: 700 }}>{t.count}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatAED(rev)}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: `${t.color}20`, marginTop: 6 }}>
                      <div style={{ height: '100%', borderRadius: 2, background: t.color, width: `${Math.min(pct, 100)}%`, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Expandable per-type booking tables */}
          {types.filter(t => t.count > 0).map(t => (
            <BookingTable key={t.key} icon={t.icon} title={`${t.label} Bookings`} color={t.color} rows={t.rows} columns={bookingColumns} />
          ))}
        </motion.div>
      )}

      {/* Journeys this contact is enrolled in */}
      <motion.div variants={fadeIn}>
        <div className="card" style={{ padding: 20, marginBottom: 12 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 16, letterSpacing: 0.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <GitBranch size={13} color="#8b5cf6" /> Journeys
            {!journeysLoading && journeys.length > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 0 }}>{journeys.length} enrolled</span>
            )}
          </div>

          {journeysLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...Array(2)].map((_, i) => <div key={i} className="skeleton" style={{ width: '100%', height: 52, borderRadius: 8 }} />)}
            </div>
          ) : journeys.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              Not enrolled in any journey
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {journeys.map(j => {
                const JSTATUS = {
                  active:    { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e', label: 'ACTIVE' },
                  draft:     { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af', label: 'DRAFT' },
                  paused:    { bg: 'rgba(251,146,60,0.15)',  color: '#fb923c', label: 'PAUSED' },
                  completed: { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6', label: 'COMPLETED' },
                }[j.journey_status] || { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af', label: (j.journey_status || '').toUpperCase() };
                const ESTATUS = {
                  active:    { color: '#22c55e', label: 'In progress' },
                  completed: { color: '#3b82f6', label: 'Completed' },
                  exited:    { color: '#ef4444', label: `Exited${j.exit_reason ? ` · ${j.exit_reason}` : ''}` },
                  converted: { color: '#22c55e', label: 'Converted' },
                  snapshot:  { color: '#9ca3af', label: 'Queued' },
                }[j.entry_status] || { color: 'var(--text-tertiary)', label: j.entry_status || '—' };
                return (
                  <div
                    key={j.journey_id}
                    onClick={() => router.push(`/journeys?id=${j.journey_id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                      borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {j.name || `Journey ${j.journey_id}`}
                      </div>
                      <div style={{ fontSize: 11, color: ESTATUS.color, marginTop: 2 }}>
                        {ESTATUS.label}
                        {j.current_node_id && j.entry_status === 'active' && <span style={{ color: 'var(--text-tertiary)' }}> · at {j.current_node_id}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: JSTATUS.bg, color: JSTATUS.color, letterSpacing: 0.6, whiteSpace: 'nowrap' }}>
                      {JSTATUS.label}
                    </span>
                    <ChevronDown size={14} color="var(--text-tertiary)" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>

      {/* GTM Events */}
      <motion.div variants={fadeIn}>
        <div className="card" style={{ padding: 20, marginBottom: 12 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 16, letterSpacing: 0.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Zap size={13} color="#f59e0b" /> GTM Events
          </div>

          {gtmLoading ? (
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ width: 120, height: 38, borderRadius: 10 }} />)}
              </div>
              <div className="skeleton" style={{ width: '100%', height: 48, borderRadius: 8 }} />
            </div>
          ) : !gtmData?.summary?.length ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              No GTM events recorded for this contact
            </div>
          ) : (
            <>
              {/* Event summary chips */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {gtmData.summary.map(s => (
                  <div key={s.event_name} style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Zap size={12} color="#f59e0b" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{s.event_name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, background: '#f59e0b', color: '#fff', borderRadius: 10, padding: '2px 8px', minWidth: 22, textAlign: 'center' }}>{s.count}</span>
                    {parseFloat(s.total_value) > 0 && (
                      <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>{formatAED(s.total_value)}</span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Last: {formatDate(s.last_seen)}</span>
                  </div>
                ))}
              </div>

              {/* Full event log table */}
              <BookingTable icon={Activity} title="Full Event Log" color="#f59e0b" rows={gtmData.events} columns={gtmEventColumns} />
            </>
          )}
        </div>
      </motion.div>

      {/* Chat Activity */}
      {contact.total_chats > 0 && (
        <motion.div variants={fadeIn}>
          <Section title="Chat Activity">
            <DetailRow icon={MessageSquare} label="Total Chats" value={contact.total_chats} color="#25D366" />
            {contact.chat_departments && <DetailRow icon={Hash}  label="Departments" value={contact.chat_departments} />}
            {contact.first_chat_at     && <DetailRow icon={Clock} label="First Chat"  value={formatDateTime(contact.first_chat_at)} />}
            {contact.last_chat_at      && <DetailRow icon={Clock} label="Last Chat"   value={formatDateTime(contact.last_chat_at)} />}
          </Section>
        </motion.div>
      )}

      {/* Messages */}
      {(contact.first_msg_text || contact.last_msg_text) && (
        <motion.div variants={fadeIn}>
          <Section title="Messages">
            {contact.first_msg_text && (
              <div style={{ gridColumn: '1 / -1', fontSize: 13, padding: '8px 12px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8, maxHeight: 60, overflow: 'auto' }}>
                <MessageCircle size={13} style={{ color: '#25D366', marginRight: 6, verticalAlign: 'middle' }} />
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginRight: 4 }}>First:</span>
                {contact.first_msg_text}
              </div>
            )}
            {contact.last_msg_text && (
              <div style={{ gridColumn: '1 / -1', fontSize: 13, padding: '8px 12px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 60, overflow: 'auto' }}>
                <MessageCircle size={13} style={{ color: 'var(--orange)', marginRight: 6, verticalAlign: 'middle' }} />
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginRight: 4 }}>Last:</span>
                {contact.last_msg_text}
              </div>
            )}
          </Section>
        </motion.div>
      )}

      {/* Timeline */}
      {(contact.first_seen_at || contact.last_seen_at || contact.created_at) && (
        <motion.div variants={fadeIn}>
          <Section title="Timeline">
            {contact.first_seen_at && <DetailRow icon={Calendar} label="First Seen" value={formatDateTime(contact.first_seen_at)} />}
            {contact.last_seen_at  && <DetailRow icon={Clock}    label="Last Seen"  value={formatDateTime(contact.last_seen_at)} />}
            {contact.created_at    && <DetailRow icon={Calendar} label="Created"    value={formatDateTime(contact.created_at)} />}
          </Section>
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Reusable sub-components ─────────────────────────────────────────────────

function StatChip({ icon: Icon, label, value, color }) {
  return (
    <div style={{ padding: '10px 18px', borderRadius: 10, background: `${color}12`, border: `1px solid ${color}35`, textAlign: 'center', minWidth: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 3 }}>
        <Icon size={12} style={{ color }} />
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card" style={{ padding: 20, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 16, letterSpacing: 0.5, fontWeight: 600 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 32px' }}>{children}</div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, color }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '16px 100px 1fr', alignItems: 'center', gap: '0 8px', minHeight: 26 }}>
      <Icon size={13} style={{ color: color || 'var(--text-tertiary)' }} />
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: color || 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</span>
    </div>
  );
}

function BookingTable({ icon: Icon, title, color, rows, columns }) {
  const [expanded, setExpanded] = useState(false);
  const count = rows?.length || 0;
  if (count === 0) return null;
  return (
    <div className="card" style={{ padding: 0, marginBottom: 10, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={14} style={{ color }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
          <span className="badge" style={{ background: `${color}20`, color, fontSize: 11 }}>{count}</span>
        </div>
        {expanded ? <ChevronUp size={16} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-tertiary)' }} />}
      </div>
      {expanded && (
        <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
          <table style={{ fontSize: 12 }}>
            <thead>
              <tr>{columns.map(c => <th key={c.key} style={{ whiteSpace: 'nowrap', fontSize: 11, padding: '8px 12px' }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map(c => (
                    <td key={c.key} style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                      {c.render ? c.render(r[c.key], r) : (r[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div style={{ padding: 4 }}>
      <div className="skeleton" style={{ width: 130, height: 28, borderRadius: 6, marginBottom: 20 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div className="skeleton" style={{ width: 48, height: 48, borderRadius: '50%' }} />
        <div>
          <div className="skeleton" style={{ width: 200, height: 22, borderRadius: 6, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 100, height: 12, borderRadius: 4 }} />
        </div>
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="card" style={{ padding: 20, marginBottom: 12 }}>
          <div className="skeleton" style={{ width: 80, height: 10, borderRadius: 4, marginBottom: 14 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
            {[...Array(4)].map((_, j) => <div key={j} className="skeleton" style={{ height: 14, borderRadius: 4 }} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function EditField({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
        onFocus={e => { e.target.style.borderColor = 'var(--brand-primary, #C9A96E)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--border)'; }}
      />
    </div>
  );
}

function EditSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 4 }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' }}
      >
        {options.map(o => {
          const val = typeof o === 'string' ? o : o.value;
          const lbl = typeof o === 'string' ? o : o.label;
          return <option key={val} value={val}>{lbl}</option>;
        })}
      </select>
    </div>
  );
}

// ── Column definitions ──────────────────────────────────────────────────────

const bookingColumns = [
  { key: 'bill_no',       label: 'Bill #' },
  { key: 'service_name',  label: 'Service',      render: v => v ? (v.length > 35 ? v.slice(0, 35) + '…' : v) : '—' },
  { key: 'travel_date',   label: 'Travel Date',  render: v => formatDate(v) },
  { key: 'booking_date',  label: 'Booked',       render: v => formatDate(v) },
  { key: 'guest_name',    label: 'Guest' },
  { key: 'nationality',   label: 'Nationality' },
  { key: 'selling_price', label: 'Amount',       render: v => formatCurrency(v) },
  { key: 'is_cancel',     label: 'Status',       render: v => v === '1' ? '❌ Cancelled' : '✅ Active' },
];

const gtmEventColumns = [
  { key: 'event_name',  label: 'Event' },
  { key: 'page_url',    label: 'Page',       render: v => { try { return new URL(v).pathname; } catch { return v || '—'; } } },
  { key: 'event_value', label: 'Value',      render: v => parseFloat(v) > 0 ? formatCurrency(v) : '—' },
  { key: 'device_type', label: 'Device',     render: v => v || '—' },
  { key: 'city',        label: 'City',       render: v => v || '—' },
  { key: 'utm_source',  label: 'UTM Source', render: v => v || '—' },
  { key: 'created_at',  label: 'Time',       render: v => formatDateTime(v) },
];
