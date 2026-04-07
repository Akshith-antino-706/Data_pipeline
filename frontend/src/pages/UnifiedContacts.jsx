import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getUnifiedContacts, getUnifiedContact, getUnifiedStats } from '../api';
import {
  Users, Search, Globe, MessageSquare, Mail, X, Phone, Building2,
  Calendar, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, Eye,
  MapPin, Hash, Clock, Ticket, Map, DollarSign, Plane, Hotel, MessageCircle, Layers,
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
  { key: 'phone', label: 'Phone', sortable: false },
  { key: 'company_name', label: 'Company', sortable: true },
  { key: 'country', label: 'Country', sortable: true },
  { key: 'total_chats', label: 'Chats', sortable: true },
  { key: 'total_travel_bookings', label: 'Bookings', sortable: true },
  { key: 'sources', label: 'Sources', sortable: false },
  { key: 'last_seen_at', label: 'Last Seen', sortable: true },
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
  const limit = 50;

  const showToast = (msg, type = 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); };

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit, sortBy, sortDir };
      if (search) params.search = search;
      const res = await getUnifiedContacts(params);
      setContacts(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) { showToast(err.message); }
    finally { setLoading(false); }
  }, [page, search, sortBy, sortDir]);

  useEffect(() => { loadContacts(); }, [loadContacts]);
  useEffect(() => { getUnifiedStats().then(res => setStats(res.data)).catch(() => {}); }, []);

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
    { label: 'With Chats', value: formatNum(stats?.with_chats), icon: MessageSquare, color: '#25D366' },
    { label: 'With Bookings', value: formatNum(stats?.with_travel), icon: Map, color: 'var(--green)' },
    { label: 'Multi-Source', value: formatNum(stats?.multi_source), icon: Layers, color: 'var(--purple)' },
    { label: 'Total Revenue', value: formatAED(stats?.total_revenue), icon: DollarSign, color: 'var(--yellow)' },
  ];

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <motion.div variants={fadeInUp} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Unified Contacts</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            All customers across chats, tickets, CRM &amp; bookings &middot; {formatNum(total)} records
          </p>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} className="kpi-strip">
        {kpis.map(k => (
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
        </form>
      </motion.div>

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
                <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40 }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading...</td></tr>
              ) : contacts.length === 0 ? (
                <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>No contacts found{search ? ` for "${search}"` : ''}.</td></tr>
              ) : contacts.map(c => (
                <tr key={c.unified_id} onClick={() => openDetail(c.unified_id)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500 }}>{c.name || '\u2014'}</td>
                  <td style={{ fontSize: 12 }}>{c.email || '\u2014'}</td>
                  <td style={{ fontSize: 12 }}>{c.phone || '\u2014'}</td>
                  <td>{c.company_name || '\u2014'}</td>
                  <td>{c.country ? <span className="badge badge-blue" style={{ fontSize: 11 }}>{c.country}</span> : '\u2014'}</td>
                  <td>{c.total_chats > 0 ? <span className="badge badge-green">{c.total_chats}</span> : <span style={{ color: 'var(--text-tertiary)' }}>0</span>}</td>
                  <td>{c.total_travel_bookings > 0 ? <span className="badge badge-blue">{c.total_travel_bookings}</span> : <span style={{ color: 'var(--text-tertiary)' }}>0</span>}</td>
                  <td style={{ fontSize: 11 }}>{c.sources ? c.sources.split(', ').map(s => <span key={s} className={`badge ${s === 'chat' ? 'badge-green' : s === 'ticket' ? 'badge-orange' : s === 'rayna' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 9, marginRight: 3 }}>{s}</span>) : '\u2014'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(c.last_seen_at)}</td>
                  <td><button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); openDetail(c.unified_id); }}><Eye size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Showing {((page - 1) * limit) + 1}\u2013{Math.min(page * limit, total)} of {formatNum(total)}</span>
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
              onClick={e => e.stopPropagation()} style={{ maxWidth: 680, width: '90vw', maxHeight: '85vh', overflow: 'auto' }}>
              {detailLoading && !selected ? (
                <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} /></div>
              ) : selected && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selected.name || 'Unknown'}</h3>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>ID: {selected.unified_id}</span>
                      <div style={{ marginTop: 6 }}>{selected.sources?.split(', ').map(s => <span key={s} className={`badge ${s === 'chat' ? 'badge-green' : s === 'ticket' ? 'badge-orange' : s === 'rayna' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 10, marginRight: 4 }}>{s}</span>)}</div>
                    </div>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelected(null)}><X size={16} /></button>
                  </div>

                  {/* Contact Info */}
                  <Section title="Contact Information">
                    <DetailRow icon={Mail} label="Email" value={selected.email} />
                    <DetailRow icon={Phone} label="Phone" value={selected.phone} />
                    <DetailRow icon={Building2} label="Company" value={selected.company_name} />
                    <DetailRow icon={Hash} label="Designation" value={selected.designation} />
                    <DetailRow icon={MapPin} label="City" value={selected.city} />
                    <DetailRow icon={Globe} label="Country" value={selected.country} />
                    <DetailRow icon={Hash} label="Type" value={selected.contact_type} />
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

                  {/* Chat Activity */}
                  <Section title="Chat Activity">
                    <DetailRow icon={MessageSquare} label="Total Chats" value={selected.total_chats || 0} color="#25D366" />
                    <DetailRow icon={Hash} label="Departments" value={selected.chat_departments} />
                    <DetailRow icon={Clock} label="First Chat" value={formatDateTime(selected.first_chat_at)} />
                    <DetailRow icon={Clock} label="Last Chat" value={formatDateTime(selected.last_chat_at)} />
                  </Section>

                  {/* Travel Bookings */}
                  <Section title="Travel Bookings">
                    <DetailRow icon={Map} label="Total Bookings" value={selected.total_travel_bookings || 0} color="var(--brand-primary)" />
                    <DetailRow icon={Hash} label="Types" value={selected.travel_types} />
                    <DetailRow icon={Hash} label="Services" value={selected.travel_services} truncate />
                    <DetailRow icon={Calendar} label="First Booking" value={formatDate(selected.first_travel_at)} />
                    <DetailRow icon={Clock} label="Last Booking" value={formatDate(selected.last_travel_at)} />
                  </Section>

                  {/* Rayna API Bookings */}
                  {(selected.total_tour_bookings > 0 || selected.total_hotel_bookings > 0 || selected.total_visa_bookings > 0 || selected.total_flight_bookings > 0) && (
                    <Section title="Rayna API Bookings">
                      <DetailRow icon={Map} label="Tours" value={selected.total_tour_bookings || 0} color="var(--brand-primary)" />
                      <DetailRow icon={Hotel} label="Hotels" value={selected.total_hotel_bookings || 0} color="var(--purple)" />
                      <DetailRow icon={Globe} label="Visas" value={selected.total_visa_bookings || 0} color="var(--green)" />
                      <DetailRow icon={Plane} label="Flights" value={selected.total_flight_bookings || 0} color="var(--red)" />
                      <DetailRow icon={DollarSign} label="Revenue" value={formatAED(selected.total_booking_revenue)} color="var(--yellow)" />
                      <DetailRow icon={Calendar} label="First" value={formatDateTime(selected.first_booking_at)} />
                      <DetailRow icon={Clock} label="Last" value={formatDateTime(selected.last_booking_at)} />
                    </Section>
                  )}

                  {/* Timeline */}
                  <Section title="Timeline">
                    <DetailRow icon={Calendar} label="First Seen" value={formatDateTime(selected.first_seen_at)} />
                    <DetailRow icon={Clock} label="Last Seen" value={formatDateTime(selected.last_seen_at)} />
                  </Section>
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
