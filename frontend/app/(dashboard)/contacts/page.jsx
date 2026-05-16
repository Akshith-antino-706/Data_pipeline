'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getUnifiedContacts, getUnifiedContact, getUnifiedStats, getUnifiedFilters } from '@/lib/api';
import { useBusinessType } from '@/context/BusinessTypeContext';
import {
  Users, Search, Globe, MessageSquare, Mail, X, Phone, Building2,
  Calendar, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, Eye,
  MapPin, Hash, Clock, Ticket, Map, DollarSign, Plane, Hotel, MessageCircle, Layers,
  Filter, RotateCcw, ChevronDown, ChevronUp, FileText, Palmtree,
} from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

function formatDate(d) { if (!d) return '\u2014'; return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function formatDateTime(d) { if (!d) return '\u2014'; const dt = new Date(d); return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function formatNum(n) { return (n || 0).toLocaleString(); }
function formatAED(n) { return `AED ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }

const COLUMNS = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'email', label: 'Email', sortable: true },
  { key: 'phone', label: 'Phone', sortable: true },
  { key: 'country', label: 'Country', sortable: true },
  { key: 'booking_status', label: 'Status', sortable: true },
  { key: 'product_tier', label: 'Tier', sortable: true },
  { key: 'geography', label: 'Geo', sortable: true },
  { key: 'total_bookings', label: 'Bookings', sortable: true },
  { key: 'total_booking_revenue', label: 'Revenue', sortable: true },
];

export default function UnifiedContacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState('last_seen_at');
  const [sortDir, setSortDir] = useState('DESC');
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterOptions, setFilterOptions] = useState(null);
  const [filters, setFilters] = useState({ country: '', contactType: '', source: '', bookingStatus: '', productTier: '', geography: '', chatDepartment: '', hasChats: '', hasBookings: '', waStatus: '', emailStatus: '' });
  const limit = 50;
  const { businessType } = useBusinessType();

  const showToast = (msg, type = 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const updateFilter = (key, value) => { setFilters(f => ({ ...f, [key]: value })); setPage(1); };
  const clearFilters = () => { setFilters({ country: '', contactType: '', source: '', bookingStatus: '', productTier: '', geography: '', chatDepartment: '', hasChats: '', hasBookings: '', waStatus: '', emailStatus: '' }); setPage(1); };

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit, sortBy, sortDir };
      if (businessType !== 'All') params.businessType = businessType;
      if (search) params.search = search;
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const res = await getUnifiedContacts(params);
      setContacts(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) { showToast(err.message); }
    finally { setLoading(false); }
  }, [page, search, sortBy, sortDir, filters, businessType]);

  useEffect(() => { loadContacts(); }, [loadContacts]);
  useEffect(() => {
    // Stats + filter options both scope to the current B2B/B2C selection
    const btParam = businessType === 'All' ? {} : { businessType };
    getUnifiedStats(btParam).then(res => setStats(res.data)).catch(() => {});
    getUnifiedFilters(btParam).then(res => setFilterOptions(res.data)).catch(() => {});
    // Reset page when the business scope changes so the user sees the first page of filtered results
    setPage(1);
  }, [businessType]);

  const handleSearch = (e) => { e.preventDefault(); setPage(1); setSearch(searchInput); };
  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'ASC' ? 'DESC' : 'ASC');
    else { setSortBy(col); setSortDir('DESC'); }
    setPage(1);
  };

  const openDetail = async (id) => {
    setDetailLoading(true);
    try { const res = await getUnifiedContact(id); setSelected(res.data); }
    catch { showToast('Failed to load contact'); }
    finally { setDetailLoading(false); }
  };

  const kpis = [
    { label: 'Total Contacts', value: formatNum(stats?.total_contacts), icon: Users, color: 'var(--brand-primary)' },
    { label: 'Total Bookings', value: formatNum(stats?.total_bookings), icon: Map, color: 'var(--green)' },
    { label: 'Total Revenue', value: formatAED(stats?.total_revenue), icon: DollarSign, color: 'var(--yellow)' },
  ];

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <motion.div variants={fadeInUp} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Unified Contacts</h2>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5, padding: '3px 10px',
              borderRadius: 12, background: '#C9A96E', color: '#fff',
            }}>{businessType}</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {businessType === 'B2B' ? 'B2B partners & agents' : 'B2C end-customers'} &middot; across chats, tickets, CRM &amp; bookings &middot; {formatNum(total)} records
          </p>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} className="kpi-strip">
        {!stats ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="card" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
                <div>
                  <div className="skeleton" style={{ width: 70, height: 10, borderRadius: 4, marginBottom: 6 }} />
                  <div className="skeleton" style={{ width: 50, height: 18, borderRadius: 4 }} />
                </div>
              </div>
            </div>
          ))
        ) : kpis.map(k => (
          <div key={k.label} className="card" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: `${k.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <k.icon size={18} style={{ color: k.color }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{k.value}</div>
              </div>
            </div>
          </div>
        ))}
      </motion.div>

      <motion.div variants={fadeInUp}>
        <form onSubmit={handleSearch} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input type="text" placeholder="Search by name, email, phone or company..."
            value={searchInput} onChange={e => setSearchInput(e.target.value)}
            style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-primary)', fontSize: 14 }} />
          <button type="submit" className="btn btn-primary btn-sm">Search</button>
          {search && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>Clear</button>}
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters(f => !f)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, position: 'relative' }}>
            <Filter size={14} /> Filters
            {activeFilterCount > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -6, background: 'var(--brand-primary)', color: '#fff', fontSize: 10, fontWeight: 700, width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </form>
      </motion.div>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div variants={fadeInUp} initial="hidden" animate="visible" exit="hidden"
            className="card" style={{ padding: '16px 20px', position: 'relative', zIndex: 20, overflow: 'visible' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: 0.5 }}>Filters</span>
              {activeFilterCount > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={clearFilters} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <RotateCcw size={12} /> Reset all
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
              <UCFilterSelect label="Country" value={filters.country} onChange={v => updateFilter('country', v)}
                options={filterOptions?.countries || []} />
              <UCFilterSelect label="Type" value={filters.contactType} onChange={v => updateFilter('contactType', v)}
                options={filterOptions?.contactTypes || []} />
              <UCFilterSelect label="Source" value={filters.source} onChange={v => updateFilter('source', v)}
                options={filterOptions?.sources || []} />
              <UCFilterSelect label="Booking Status" value={filters.bookingStatus} onChange={v => updateFilter('bookingStatus', v)}
                options={filterOptions?.bookingStatuses || []} />
              <UCFilterSelect label="Tier" value={filters.productTier} onChange={v => updateFilter('productTier', v)}
                options={filterOptions?.productTiers || []} />
              <UCFilterSelect label="Geography" value={filters.geography} onChange={v => updateFilter('geography', v)}
                options={filterOptions?.geographies || []} />
              <UCFilterSelect label="Chat Dept" value={filters.chatDepartment} onChange={v => updateFilter('chatDepartment', v)}
                options={['B2B', 'B2C']} />
              <UCFilterSelect label="Has Chats" value={filters.hasChats} onChange={v => updateFilter('hasChats', v)}
                options={['yes', 'no']} labels={['Yes', 'No']} />
              <UCFilterSelect label="Has Bookings" value={filters.hasBookings} onChange={v => updateFilter('hasBookings', v)}
                options={['yes', 'no']} labels={['Yes', 'No']} />
              <UCFilterSelect label="WA Status" value={filters.waStatus} onChange={v => updateFilter('waStatus', v)}
                options={['active', 'unsubscribed']} labels={['Active', 'Unsubscribed']} />
              <UCFilterSelect label="Email Status" value={filters.emailStatus} onChange={v => updateFilter('emailStatus', v)}
                options={['active', 'unsubscribed']} labels={['Active', 'Unsubscribed']} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={fadeInUp} className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th key={col.key} onClick={col.sortable ? () => handleSort(col.key) : undefined}
                    style={{ cursor: col.sortable ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {col.label}
                      {col.sortable && sortBy === col.key && <span style={{ fontSize: 10 }}>{sortDir === 'ASC' ? '\u25B2' : '\u25BC'}</span>}
                      {col.sortable && sortBy !== col.key && <ArrowUpDown size={11} style={{ opacity: 0.3 }} />}
                    </span>
                  </th>
                ))}
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    {COLUMNS.map(col => (
                      <td key={col.key} style={{ padding: '12px 10px' }}>
                        <div className="skeleton" style={{
                          width: col.key === 'name' ? 120 : col.key === 'email' ? 150 : col.key === 'phone' ? 100 :
                            col.key === 'company_name' ? 90 : col.key === 'country' ? 60 : col.key === 'last_seen_at' ? 80 : 55,
                          height: 14, borderRadius: 4
                        }} />
                      </td>
                    ))}
                    <td><div className="skeleton" style={{ width: 24, height: 24, borderRadius: 4 }} /></td>
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>No contacts found{search ? ` for "${search}"` : ''}.</td></tr>
              ) : contacts.map(c => {
                const totalBookings = (c.total_tour_bookings||0)+(c.total_package_bookings||0)+(c.total_hotel_bookings||0)+(c.total_visa_bookings||0)+(c.total_other_bookings||0)+(c.total_flight_bookings||0);
                return (
                <tr key={c.id || c.unified_id} onClick={() => openDetail(c.id || c.unified_id)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500 }}>{c.name || '\u2014'}</td>
                  <td style={{ fontSize: 12 }}>{c.email || '\u2014'}</td>
                  <td style={{ fontSize: 12 }}>{c.phone || c.mobile || '\u2014'}</td>
                  <td>{c.country ? <span className="badge badge-blue" style={{ fontSize: 11 }}>{c.country}</span> : '\u2014'}</td>
                  <td><span className={`badge ${
                    c.booking_status === 'ON_TRIP' ? 'badge-green' :
                    c.booking_status === 'FUTURE_TRAVEL' ? 'badge-blue' :
                    c.booking_status === 'ACTIVE_ENQUIRY' ? 'badge-orange' :
                    c.booking_status === 'PAST_BOOKING' ? 'badge-gray' :
                    c.booking_status === 'PAST_ENQUIRY' ? 'badge-red' : 'badge-gray'
                  }`} style={{ fontSize: 9 }}>{c.booking_status || 'PROSPECT'}</span></td>
                  <td>{c.product_tier ? <span className={`badge ${c.product_tier === 'LUXURY' ? 'badge-orange' : 'badge-gray'}`} style={{ fontSize: 9 }}>{c.product_tier}</span> : '\u2014'}</td>
                  <td>{c.geography ? <span className={`badge ${c.geography === 'LOCAL' ? 'badge-green' : 'badge-blue'}`} style={{ fontSize: 9 }}>{c.geography}</span> : '\u2014'}</td>
                  <td>{totalBookings > 0 ? <span className="badge badge-blue">{totalBookings}</span> : <span style={{ color: 'var(--text-tertiary)' }}>0</span>}</td>
                  <td style={{ fontSize: 12, fontWeight: 500 }}>{formatAED(c.total_booking_revenue)}</td>
                  <td><button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); openDetail(c.id || c.unified_id); }}><Eye size={14} /></button></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Showing {((page - 1) * limit) + 1} - {Math.min(page * limit, total)} of {formatNum(total)}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /> Prev</button>
              <span style={{ fontSize: 13, padding: '0 8px' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next <ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Detail Modal */}
      <AnimatePresence>
        {(selected || detailLoading) && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelected(null)}>
            <motion.div className="modal" initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()} style={{ maxWidth: 800, width: '92vw', maxHeight: '85vh', overflow: 'auto' }}>
              {detailLoading && !selected ? (
                <div style={{ padding: 24 }}>
                  {/* Header skeleton */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div>
                      <div className="skeleton" style={{ width: 180, height: 20, borderRadius: 6, marginBottom: 8 }} />
                      <div className="skeleton" style={{ width: 100, height: 12, borderRadius: 4, marginBottom: 8 }} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div className="skeleton" style={{ width: 45, height: 18, borderRadius: 10 }} />
                        <div className="skeleton" style={{ width: 45, height: 18, borderRadius: 10 }} />
                      </div>
                    </div>
                    <div className="skeleton" style={{ width: 28, height: 28, borderRadius: 6 }} />
                  </div>
                  {/* Segment skeleton */}
                  <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                    <div className="skeleton" style={{ width: 70, height: 10, borderRadius: 4, marginBottom: 12 }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                      {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 14, borderRadius: 4 }} />)}
                    </div>
                  </div>
                  {/* Contact Info skeleton */}
                  <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                    <div className="skeleton" style={{ width: 130, height: 10, borderRadius: 4, marginBottom: 12 }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                      {[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: 14, borderRadius: 4 }} />)}
                    </div>
                  </div>
                  {/* Booking Overview skeleton */}
                  <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                    <div className="skeleton" style={{ width: 110, height: 10, borderRadius: 4, marginBottom: 12 }} />
                    <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                      <div className="skeleton" style={{ width: 120, height: 50, borderRadius: 8 }} />
                      <div className="skeleton" style={{ width: 120, height: 50, borderRadius: 8 }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      {[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: 70, borderRadius: 8 }} />)}
                    </div>
                  </div>
                </div>
              ) : selected && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selected.name || 'Unknown'}</h3>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>ID: {selected.id || selected.unified_id}</span>
                      <div style={{ marginTop: 6 }}>{selected.sources?.split(', ').map(s => <span key={s} className={`badge ${s === 'chat' ? 'badge-green' : s === 'ticket' ? 'badge-orange' : s === 'rayna' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 10, marginRight: 4 }}>{s}</span>)}</div>
                    </div>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelected(null)}><X size={16} /></button>
                  </div>

                  {/* Segment */}
                  <Section title="Segment">
                    <DetailRow icon={Hash} label="Status" value={selected.booking_status} color={
                      selected.booking_status === 'ON_TRIP' ? 'var(--green)' :
                      selected.booking_status === 'FUTURE_TRAVEL' ? 'var(--brand-primary)' :
                      selected.booking_status === 'ACTIVE_ENQUIRY' ? 'var(--orange)' : 'var(--text-secondary)'} />
                    <DetailRow icon={Hash} label="Product Tier" value={selected.product_tier || 'N/A'} color={selected.product_tier === 'LUXURY' ? 'var(--orange)' : undefined} />
                    <DetailRow icon={Globe} label="Geography" value={selected.geography || 'Unknown'} />
                    {selected.segment_label && <DetailRow icon={Layers} label="Full Segment" value={selected.segment_label} />}
                  </Section>

                  {/* Contact Info — only show fields that have data */}
                  <Section title="Contact Information">
                    {selected.email && <DetailRow icon={Mail} label="Email" value={selected.email} />}
                    {(selected.phone || selected.mobile) && <DetailRow icon={Phone} label="Phone" value={selected.phone || selected.mobile} />}
                    {selected.company_name && <DetailRow icon={Building2} label="Company" value={selected.company_name} />}
                    {selected.designation && <DetailRow icon={Hash} label="Designation" value={selected.designation} />}
                    {selected.city && <DetailRow icon={MapPin} label="City" value={selected.city} />}
                    {selected.country && <DetailRow icon={Globe} label="Country" value={selected.country} />}
                    {selected.contact_type && <DetailRow icon={Hash} label="Type" value={selected.contact_type} />}
                    <DetailRow icon={Mail} label="Email Status" value={selected.email_unsubscribed === 'Yes' ? 'Unsubscribed' : 'Active'} color={selected.email_unsubscribed === 'Yes' ? 'var(--red)' : 'var(--green)'} />
                    <DetailRow icon={MessageSquare} label="WA Status" value={selected.wa_unsubscribed === 'Yes' ? 'Unsubscribed' : 'Active'} color={selected.wa_unsubscribed === 'Yes' ? 'var(--red)' : 'var(--green)'} />
                  </Section>

                  {/* First & Last Message */}
                  {(selected.first_msg_text || selected.last_msg_text) && (
                    <Section title="Messages">
                      {selected.first_msg_text && (
                        <div style={{ fontSize: 13, padding: '8px 12px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8, maxHeight: 60, overflow: 'auto' }}>
                          <MessageCircle size={13} style={{ color: '#25D366', marginRight: 6, verticalAlign: 'middle' }} />
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginRight: 4 }}>First:</span>
                          {selected.first_msg_text}
                        </div>
                      )}
                      {selected.last_msg_text && (
                        <div style={{ fontSize: 13, padding: '8px 12px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 60, overflow: 'auto' }}>
                          <MessageCircle size={13} style={{ color: 'var(--orange)', marginRight: 6, verticalAlign: 'middle' }} />
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginRight: 4 }}>Last:</span>
                          {selected.last_msg_text}
                        </div>
                      )}
                    </Section>
                  )}

                  {/* Chat Activity — only show if has chats */}
                  {selected.total_chats > 0 && (
                    <Section title="Chat Activity">
                      <DetailRow icon={MessageSquare} label="Total Chats" value={selected.total_chats} color="#25D366" />
                      {selected.chat_departments && <DetailRow icon={Hash} label="Departments" value={selected.chat_departments} />}
                      {selected.first_chat_at && <DetailRow icon={Clock} label="First Chat" value={formatDateTime(selected.first_chat_at)} />}
                      {selected.last_chat_at && <DetailRow icon={Clock} label="Last Chat" value={formatDateTime(selected.last_chat_at)} />}
                    </Section>
                  )}

                  {/* Booking Summary with per-type breakdown */}
                  {(() => {
                    const types = [
                      { key: 'tour', label: 'Tours', icon: Palmtree, color: '#10b981', count: selected.total_tour_bookings || 0, rows: selected.rayna_tours },
                      { key: 'package', label: 'Packages', icon: Layers, color: '#8b5cf6', count: selected.total_package_bookings || 0, rows: selected.rayna_packages },
                      { key: 'hotel', label: 'Hotels', icon: Hotel, color: '#6366f1', count: selected.total_hotel_bookings || 0, rows: selected.rayna_hotels },
                      { key: 'visa', label: 'Visas', icon: FileText, color: '#f59e0b', count: selected.total_visa_bookings || 0, rows: selected.rayna_visas },
                      { key: 'other', label: 'Others', icon: Ticket, color: '#ec4899', count: selected.total_other_bookings || 0, rows: selected.rayna_others },
                      { key: 'flight', label: 'Flights', icon: Plane, color: '#3b82f6', count: selected.total_flight_bookings || 0, rows: selected.rayna_flights },
                    ];
                    const totalBookings = types.reduce((s, t) => s + t.count, 0);
                    const totalRevenue = selected.total_booking_revenue || 0;
                    const allRows = types.flatMap(t => t.rows || []);
                    const cancelledCount = allRows.filter(r => r.is_cancel === '1').length;
                    const cancelledRevenue = allRows.filter(r => r.is_cancel === '1').reduce((s, r) => s + (parseFloat(r.selling_price) || 0), 0);
                    const hasBookings = totalBookings > 0;

                    return hasBookings ? (
                      <>
                        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12, letterSpacing: 0.5, fontWeight: 600 }}>Booking Overview</div>
                          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                            <div style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--brand-primary-alpha, rgba(201,169,110,0.1))', border: '1px solid var(--brand-primary, #C9A96E)' }}>
                              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Total Bookings</div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand-primary, #C9A96E)' }}>{totalBookings}</div>
                            </div>
                            <div style={{ padding: '10px 16px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid #10b981' }}>
                              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Total Revenue</div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: '#10b981' }}>{formatAED(totalRevenue)}</div>
                            </div>
                            {cancelledCount > 0 && (
                              <div style={{ padding: '10px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444' }}>
                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Cancelled</div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                  <span style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{cancelledCount}</span>
                                  <span style={{ fontSize: 11, color: '#ef4444', opacity: 0.7 }}>{formatAED(cancelledRevenue)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                            {types.map(t => {
                              const rev = (t.rows || []).filter(r => r.is_cancel !== '1').reduce((s, r) => s + (parseFloat(r.selling_price) || 0), 0);
                              const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                              return (
                                <div key={t.key} style={{ padding: '10px 12px', borderRadius: 8, background: `${t.color}08`, border: `1px solid ${t.color}30` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                    <t.icon size={14} style={{ color: t.color }} />
                                    <span style={{ fontSize: 12, fontWeight: 600, color: t.color }}>{t.label}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                    <span style={{ fontSize: 16, fontWeight: 700 }}>{t.count}</span>
                                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatAED(rev)}</span>
                                  </div>
                                  <div style={{ height: 4, borderRadius: 2, background: `${t.color}20`, marginTop: 6 }}>
                                    <div style={{ height: '100%', borderRadius: 2, background: t.color, width: `${Math.min(pct, 100)}%`, transition: 'width 0.3s ease' }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Expandable Booking Tables */}
                        {types.filter(t => t.count > 0).map(t => (
                          <BookingTable key={t.key} icon={t.icon} title={`${t.label} Bookings`} color={t.color} rows={t.rows} columns={bookingColumns} />
                        ))}
                      </>
                    ) : null;
                  })()}

                  <BookingTable icon={MessageSquare} title="Chats" color="#25D366" rows={selected.chats_list} columns={chatTableColumns} />

                  {/* Timeline — only show if has dates */}
                  {(selected.first_seen_at || selected.last_seen_at || selected.created_at) && (
                    <Section title="Timeline">
                      {selected.first_seen_at && <DetailRow icon={Calendar} label="First Seen" value={formatDateTime(selected.first_seen_at)} />}
                      {selected.last_seen_at && <DetailRow icon={Clock} label="Last Seen" value={formatDateTime(selected.last_seen_at)} />}
                      {selected.created_at && <DetailRow icon={Calendar} label="Created" value={formatDateTime(selected.created_at)} />}
                    </Section>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}
            className={`toast toast-${toast.type}`} style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1000 }}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>{children}</div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, color, truncate }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={13} style={{ color: color || 'var(--text-tertiary)', flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 70 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
        ...(truncate ? { maxHeight: 40, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 250 } : {})
      }}>{value || '\u2014'}</span>
    </div>
  );
}

function UCFilterSelect({ label, value, onChange, options, labels }) {
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const ref = useRef(null);
  const showSearch = options.length > 10;
  const filtered = filterText
    ? options.filter((o, i) => (labels ? labels[i] : o).toLowerCase().includes(filterText.toLowerCase()))
    : options;
  const displayValue = value ? (labels ? labels[options.indexOf(value)] || value : value) : 'All';

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
      <button type="button" onClick={() => { setOpen(o => !o); setFilterText(''); }}
        style={{ width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6, textAlign: 'left',
          border: '1px solid var(--border)', background: 'var(--card-bg)', color: value ? 'var(--text-primary)' : 'var(--text-tertiary)',
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayValue}</span>
        <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 50,
          background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 220, display: 'flex', flexDirection: 'column' }}>
          {showSearch && (
            <input autoFocus type="text" placeholder="Search..." value={filterText}
              onChange={e => setFilterText(e.target.value)}
              style={{ padding: '8px 10px', fontSize: 12, border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', background: 'transparent', color: 'var(--text-primary)' }} />
          )}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div onClick={() => { onChange(''); setOpen(false); }}
              style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', color: !value ? 'var(--brand-primary)' : 'var(--text-primary)', fontWeight: !value ? 600 : 400 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>All</div>
            {filtered.map((o) => {
              const display = labels ? labels[options.indexOf(o)] || o : o;
              const isSelected = value === o;
              return (
                <div key={o} onClick={() => { onChange(o); setOpen(false); }}
                  style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', color: isSelected ? 'var(--brand-primary)' : 'var(--text-primary)', fontWeight: isSelected ? 600 : 400 }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>{display}</div>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Booking Detail Components ───────────────────────────────

function MiniStat({ icon: Icon, label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Icon size={14} style={{ color }} />
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}:</span>
      <span style={{ fontSize: 13, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function BookingTable({ icon: Icon, title, color, rows, columns }) {
  const [expanded, setExpanded] = useState(false);
  const count = rows?.length || 0;
  if (count === 0) return null;

  return (
    <div className="card" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}>
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
        <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
          <table style={{ fontSize: 12 }}>
            <thead>
              <tr>{columns.map(c => <th key={c.key} style={{ whiteSpace: 'nowrap', fontSize: 11, padding: '8px 10px' }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map(c => (
                    <td key={c.key} style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                      {c.render ? c.render(r[c.key], r) : (r[c.key] ?? '\u2014')}
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

function formatCurrency(v) {
  if (v == null) return '\u2014';
  return `AED ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const bookingColumns = [
  { key: 'bill_no', label: 'Bill #' },
  { key: 'service_name', label: 'Service', render: v => v ? (v.length > 35 ? v.slice(0, 35) + '...' : v) : '\u2014' },
  { key: 'travel_date', label: 'Travel Date', render: v => formatDate(v) },
  { key: 'booking_date', label: 'Booked', render: v => formatDate(v) },
  { key: 'guest_name', label: 'Guest' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'selling_price', label: 'Amount', render: v => formatCurrency(v) },
  { key: 'is_cancel', label: 'Status', render: v => v === '1' ? '\u274C Cancelled' : '\u2705 Active' },
];

const chatTableColumns = [
  { key: 'wa_name', label: 'WA Name' },
  { key: 'wa_id', label: 'WA ID' },
  { key: 'country', label: 'Country' },
  { key: 'status', label: 'Status', render: v => v === 0 ? 'Open' : v === 1 ? 'Resolved' : v },
  { key: 'last_short', label: 'Last Msg', render: v => v ? (v.length > 30 ? v.slice(0, 30) + '...' : v) : '\u2014' },
  { key: 'last_msg_at', label: 'Last Msg At', render: v => formatDateTime(v) },
];
