'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { getUnifiedContacts, getUnifiedStats, getUnifiedFilters, createUnifiedContact, deleteUnifiedContact } from '@/lib/api';
import { useBusinessType } from '@/context/BusinessTypeContext';
import {
  Users, Search, MessageSquare,
  ArrowUpDown, ChevronLeft, ChevronRight, Eye,
  Map, DollarSign, Layers,
  Filter, RotateCcw, ChevronDown, UserPlus, X, Check, Loader2, Trash2,
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
  const [toast, setToast] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, name }
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', mobile: '', city: '', country: '', contact_type: 'B2C', geography: '', wa_unsubscribe: 'no', email_unsubscribe: 'no' });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterOptions, setFilterOptions] = useState(null);
  const [filters, setFilters] = useState({ country: '', contactType: '', source: '', bookingStatus: '', productTier: '', geography: '', chatDepartment: '', hasChats: '', hasBookings: '', waStatus: '', emailStatus: '' });
  const limit = 50;
  const { businessType } = useBusinessType();
  const router = useRouter();

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

  const openDetail = (id) => router.push('/contacts/' + id);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleteLoading(true);
    try {
      await deleteUnifiedContact(deleteConfirm.id);
      setDeleteConfirm(null);
      showToast('Contact deleted', 'success');
      setContacts(cs => cs.filter(c => (c.id || c.unified_id) !== deleteConfirm.id));
      setTotal(t => t - 1);
    } catch (err) {
      showToast(err.message || 'Failed to delete contact');
    } finally {
      setDeleteLoading(false);
    }
  };

  const setAddField = (k, v) => setAddForm(f => ({ ...f, [k]: v }));
  const openAddModal = () => {
    setAddForm({ name: '', email: '', mobile: '', city: '', country: '', contact_type: 'B2C', geography: '', wa_unsubscribe: 'no', email_unsubscribe: 'no' });
    setAddError(null);
    setShowAddModal(true);
  };
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!addForm.name && !addForm.email && !addForm.mobile) { setAddError('Provide at least a name, email, or phone.'); return; }
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await createUnifiedContact(addForm);
      setShowAddModal(false);
      showToast('Contact created successfully', 'success');
      loadContacts();
      if (res.data?.id) router.push('/contacts/' + res.data.id);
    } catch (err) {
      setAddError(err.message || 'Failed to create contact');
    } finally {
      setAddLoading(false);
    }
  };

  const kpis = [
    { label: 'Total Contacts', value: formatNum(stats?.total_contacts), icon: Users, color: 'var(--brand-primary)' },
    { label: 'With Chats', value: formatNum(stats?.with_chats), icon: MessageSquare, color: '#25D366' },
    { label: 'With Bookings', value: formatNum(stats?.with_travel), icon: Map, color: 'var(--green)' },
    { label: 'Multi-Source', value: formatNum(stats?.multi_source), icon: Layers, color: 'var(--purple)' },
    { label: 'Total Revenue', value: formatAED(stats?.total_revenue), icon: DollarSign, color: 'var(--yellow)' },
  ];

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <motion.div variants={fadeInUp} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Unified Contacts</h2>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, padding: '3px 10px', borderRadius: 12, background: '#C9A96E', color: '#fff' }}>{businessType}</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {businessType === 'B2B' ? 'B2B partners & agents' : 'B2C end-customers'} &middot; across chats, tickets, CRM &amp; bookings &middot; {formatNum(total)} records
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAddModal}
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600 }}>
          <UserPlus size={16} /> Add Contact
        </button>
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
            className="card" style={{ padding: '16px 20px', position: 'relative', zIndex: 100, overflow: 'visible' }}>
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
                  <td style={{ fontSize: 12, fontWeight: 500 }}>{parseFloat(c.total_booking_revenue) > 0 ? formatAED(c.total_booking_revenue) : <span style={{ color: 'var(--text-tertiary)' }}>\u2014</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); openDetail(c.id || c.unified_id); }}><Eye size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: c.id || c.unified_id, name: c.name || c.email || 'this contact' }); }}
                        style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                    </div>
                  </td>
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


      {/* Delete Confirm Dialog */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}
            onClick={() => !deleteLoading && setDeleteConfirm(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 12 }}
              onClick={e => e.stopPropagation()}
              className="card" style={{ width: '100%', maxWidth: 400, padding: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Trash2 size={18} style={{ color: '#ef4444' }} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Delete Contact</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>This action cannot be undone.</div>
                </div>
              </div>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)' }}>
                Are you sure you want to permanently delete <strong style={{ color: 'var(--text-primary)' }}>{deleteConfirm.name}</strong>?
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)} disabled={deleteLoading}>Cancel</button>
                <button className="btn btn-primary" onClick={handleDelete} disabled={deleteLoading}
                  style={{ background: '#ef4444', borderColor: '#ef4444', display: 'flex', alignItems: 'center', gap: 6, minWidth: 100 }}>
                  {deleteLoading
                    ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Deleting…</>
                    : <><Trash2 size={14} /> Delete</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Contact Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !addLoading && setShowAddModal(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
              onClick={e => e.stopPropagation()}
              className="card" style={{ width: '100%', maxWidth: 560, padding: 28, position: 'relative' }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Add New Contact</h3>
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Booking status will be set to</span>
                    <span className="badge badge-gray" style={{ fontSize: 10, fontWeight: 700 }}>PROSPECT</span>
                  </div>
                </div>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => !addLoading && setShowAddModal(false)}>
                  <X size={16} />
                </button>
              </div>

              {addError && (
                <div style={{ marginBottom: 16, padding: '9px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', fontSize: 13, color: '#ef4444' }}>
                  {addError}
                </div>
              )}

              <form onSubmit={handleAddSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>
                  <AddField label="Full Name *" value={addForm.name} onChange={v => setAddField('name', v)} placeholder="e.g. John Smith" />
                  <AddField label="Email" value={addForm.email} onChange={v => setAddField('email', v)} type="email" placeholder="e.g. john@example.com" />
                  <AddField label="Phone / Mobile" value={addForm.mobile} onChange={v => setAddField('mobile', v)} type="tel" placeholder="e.g. +971501234567" />
                  <AddField label="City" value={addForm.city} onChange={v => setAddField('city', v)} placeholder="e.g. Dubai" />
                  <AddField label="Country" value={addForm.country} onChange={v => setAddField('country', v)} placeholder="e.g. United Arab Emirates" />
                  <AddSelect label="Contact Type" value={addForm.contact_type} onChange={v => setAddField('contact_type', v)}
                    options={[{ value: 'B2C', label: 'B2C — Individual' }, { value: 'B2B', label: 'B2B — Business' }]} />
                  <AddSelect label="Geography" value={addForm.geography} onChange={v => setAddField('geography', v)}
                    options={[{ value: '', label: 'Unknown' }, { value: 'LOCAL', label: 'Local (UAE)' }, { value: 'INTERNATIONAL', label: 'International' }]} />
                  <AddSelect label="WA Status" value={addForm.wa_unsubscribe} onChange={v => setAddField('wa_unsubscribe', v)}
                    options={[{ value: 'no', label: 'Active' }, { value: 'yes', label: 'Unsubscribed' }]} />
                  <AddSelect label="Email Status" value={addForm.email_unsubscribe} onChange={v => setAddField('email_unsubscribe', v)}
                    options={[{ value: 'no', label: 'Active' }, { value: 'yes', label: 'Unsubscribed' }]} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => !addLoading && setShowAddModal(false)} disabled={addLoading}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={addLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
                    {addLoading
                      ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</>
                      : <><Check size={14} /> Create Contact</>}
                  </button>
                </div>
              </form>
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
          border: '1px solid var(--border)', background: 'var(--bg-card)', color: value ? 'var(--text-primary)' : 'var(--text-tertiary)',
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayValue}</span>
        <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 300,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)', maxHeight: 220, display: 'flex', flexDirection: 'column' }}>
          {showSearch && (
            <input autoFocus type="text" placeholder="Search..." value={filterText}
              onChange={e => setFilterText(e.target.value)}
              style={{ padding: '8px 10px', fontSize: 12, border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          )}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div onClick={() => { onChange(''); setOpen(false); }}
              style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', color: !value ? 'var(--brand-primary)' : 'var(--text-primary)', fontWeight: !value ? 600 : 400 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>All</div>
            {filtered.map((o) => {
              const display = labels ? labels[options.indexOf(o)] || o : o;
              const isSelected = value === o;
              return (
                <div key={o} onClick={() => { onChange(o); setOpen(false); }}
                  style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', color: isSelected ? 'var(--brand-primary)' : 'var(--text-primary)', fontWeight: isSelected ? 600 : 400 }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
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

function AddField({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 4 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
        onFocus={e => { e.target.style.borderColor = '#C9A96E'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--border)'; }} />
    </div>
  );
}

function AddSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 4 }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

