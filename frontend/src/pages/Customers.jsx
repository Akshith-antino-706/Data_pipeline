import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCustomers, getCustomer, getCustomerStats } from '../api';
import {
  Users, Search, Globe, MessageSquare, Mail, X, Phone, Building2,
  Calendar, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, Eye,
  MapPin, Hash, Clock, Ticket, Map, MessageCircle,
} from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

function formatDate(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(d) {
  if (!d) return '\u2014';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function formatNum(n) { return (n || 0).toLocaleString(); }

const COLUMNS = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'email', label: 'Email', sortable: true },
  { key: 'phone', label: 'Phone', sortable: false },
  { key: 'company_name', label: 'Company', sortable: true },
  { key: 'country', label: 'Country', sortable: true },
  { key: 'status', label: 'Status', sortable: false },
  { key: 'total_chats', label: 'Chats', sortable: true },
  { key: 'total_tickets', label: 'Tickets', sortable: true },
  { key: 'total_bookings', label: 'Bookings', sortable: true },
  { key: 'created_at', label: 'Created', sortable: true },
];

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('DESC');
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const limit = 50;

  const showToast = (msg, type = 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit, sortBy, sortDir };
      if (search) params.search = search;
      const res = await getCustomers(params);
      setCustomers(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, sortBy, sortDir]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  useEffect(() => {
    getCustomerStats().then(res => setStats(res.data)).catch(() => {});
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortDir(d => d === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(col);
      setSortDir('DESC');
    }
    setPage(1);
  };

  const openDetail = async (customerNo) => {
    setDetailLoading(true);
    try {
      const res = await getCustomer(customerNo);
      setSelected(res.data);
    } catch (err) {
      showToast('Failed to load customer details');
    } finally {
      setDetailLoading(false);
    }
  };

  const kpis = [
    { label: 'Total Customers', value: formatNum(stats?.total_customers), icon: Users, color: 'var(--brand-primary)' },
    { label: 'Countries', value: formatNum(stats?.countries), icon: Globe, color: 'var(--green)' },
    { label: 'Total Chats', value: formatNum(stats?.total_chats), icon: MessageSquare, color: '#25D366' },
    { label: 'With Bookings', value: formatNum(stats?.customers_with_bookings), icon: Map, color: 'var(--orange)' },
  ];

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <motion.div variants={fadeInUp} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Customer Master</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Complete customer database &middot; {formatNum(total)} records
          </p>
        </div>
      </motion.div>

      {/* KPI Cards */}
      <motion.div variants={fadeInUp} className="card-grid-4">
        {kpis.map(k => (
          <div key={k.label} className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: `${k.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <k.icon size={18} style={{ color: k.color }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{k.value}</div>
              </div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Search Bar */}
      <motion.div variants={fadeInUp}>
        <form onSubmit={handleSearch} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search by name, email, phone, customer # or company..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-primary)', fontSize: 14 }}
          />
          <button type="submit" className="btn btn-primary btn-sm">Search</button>
          {search && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>
              Clear
            </button>
          )}
        </form>
      </motion.div>

      {/* Table */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                    style={{ cursor: col.sortable ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {col.label}
                      {col.sortable && sortBy === col.key && (
                        <span style={{ fontSize: 10 }}>{sortDir === 'ASC' ? '\u25B2' : '\u25BC'}</span>
                      )}
                      {col.sortable && sortBy !== col.key && (
                        <ArrowUpDown size={11} style={{ opacity: 0.3 }} />
                      )}
                    </span>
                  </th>
                ))}
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40 }}>
                  <Loader2 size={20} className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }} /> Loading...
                </td></tr>
              ) : customers.length === 0 ? (
                <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                  No customers found{search ? ` for "${search}"` : ''}.
                </td></tr>
              ) : customers.map(c => (
                <tr key={c.id} onClick={() => openDetail(c.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500 }}>{c.name || '\u2014'}</td>
                  <td style={{ fontSize: 12 }}>{c.email || '\u2014'}</td>
                  <td style={{ fontSize: 12 }}>{c.phone || '\u2014'}</td>
                  <td>{c.company_name || '\u2014'}</td>
                  <td>
                    {c.country ? (
                      <span className="badge badge-blue" style={{ fontSize: 11 }}>{c.country}</span>
                    ) : '\u2014'}
                  </td>
                  <td>
                    {c.is_unsubscribed ? (
                      <span className="badge badge-red" style={{ fontSize: 10 }}>Unsub</span>
                    ) : c.is_hard_bounced ? (
                      <span className="badge badge-orange" style={{ fontSize: 10 }}>Bounced</span>
                    ) : (
                      <span className="badge badge-green" style={{ fontSize: 10 }}>Active</span>
                    )}
                  </td>
                  <td>
                    {c.total_chats > 0 ? (
                      <span className="badge badge-green">{c.total_chats}</span>
                    ) : <span style={{ color: 'var(--text-tertiary)' }}>0</span>}
                  </td>
                  <td>
                    {c.total_tickets > 0 ? (
                      <span className="badge badge-orange">{c.total_tickets}</span>
                    ) : <span style={{ color: 'var(--text-tertiary)' }}>0</span>}
                  </td>
                  <td>
                    {c.total_bookings > 0 ? (
                      <span className="badge badge-blue">{c.total_bookings}</span>
                    ) : <span style={{ color: 'var(--text-tertiary)' }}>0</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(c.created_at)}</td>
                  <td>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); openDetail(c.id); }}>
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Showing {((page - 1) * limit) + 1}\u2013{Math.min(page * limit, total)} of {formatNum(total)}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={14} /> Prev
              </button>
              <span style={{ fontSize: 13, padding: '0 8px' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Detail Modal */}
      <AnimatePresence>
        {(selected || detailLoading) && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => { setSelected(null); }}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: 640, width: '90vw', maxHeight: '85vh', overflow: 'auto' }}
            >
              {detailLoading && !selected ? (
                <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} /></div>
              ) : selected && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selected.name || 'Unknown'}</h3>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>ID: {selected.id}</span>
                    </div>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelected(null)}><X size={16} /></button>
                  </div>

                  {/* Contact Info */}
                  <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>Contact Information</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                      <DetailRow icon={Mail} label="Email" value={selected.primary_email || selected.email} />
                      <DetailRow icon={Phone} label="Phone" value={selected.mobile || selected.phone} />
                      <DetailRow icon={Building2} label="Company" value={selected.company_name} />
                      <DetailRow icon={Hash} label="Designation" value={selected.designation} />
                      <DetailRow icon={MapPin} label="City" value={[selected.city, selected.cstate].filter(Boolean).join(', ')} />
                      <DetailRow icon={Globe} label="Country" value={selected.country} />
                      {selected.emails && <DetailRow icon={Mail} label="All Emails" value={selected.emails} truncate />}
                      {selected.phones && <DetailRow icon={Phone} label="All Phones" value={selected.phones} truncate />}
                      <DetailRow icon={Mail} label="Email Status"
                        value={selected.is_unsubscribed ? 'Unsubscribed' : selected.is_hard_bounced ? 'Hard Bounced' : 'Active'}
                        color={selected.is_unsubscribed || selected.is_hard_bounced ? 'var(--red)' : 'var(--green)'} />
                    </div>
                  </div>

                  {/* First Message */}
                  {selected.first_msg_text && (
                    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>First Message</div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, padding: '8px 12px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 80, overflow: 'auto' }}>
                        <MessageCircle size={13} style={{ color: '#25D366', marginRight: 6, verticalAlign: 'middle' }} />
                        {selected.first_msg_text}
                      </div>
                    </div>
                  )}

                  {/* Chat Activity */}
                  <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>Chat Activity</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                      <DetailRow icon={MessageSquare} label="Total Chats" value={selected.total_chats || 0} color="#25D366" />
                      <DetailRow icon={Clock} label="First Chat" value={formatDateTime(selected.first_chat_at)} />
                      <DetailRow icon={Clock} label="Last Chat" value={formatDateTime(selected.last_chat_at)} />
                    </div>
                    {selected.last_message && (
                      <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-primary)', padding: '8px 12px', background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <MessageCircle size={13} style={{ color: 'var(--orange)', marginRight: 6, verticalAlign: 'middle' }} />
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 6 }}>Last:</span>
                        {selected.last_message}
                      </div>
                    )}
                  </div>

                  {/* Ticket Activity */}
                  <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>Ticket Activity</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                      <DetailRow icon={Ticket} label="Total Tickets" value={selected.total_tickets || 0} color="var(--orange)" />
                      <DetailRow icon={Clock} label="First Ticket" value={formatDateTime(selected.first_ticket_at)} />
                      <DetailRow icon={Clock} label="Last Ticket" value={formatDateTime(selected.last_ticket_at)} />
                    </div>
                  </div>

                  {/* Bookings */}
                  <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>Travel Bookings</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                      <DetailRow icon={Map} label="Total Bookings" value={selected.total_bookings || 0} color="var(--brand-primary)" />
                      <DetailRow icon={Calendar} label="First Booking" value={formatDateTime(selected.first_booking_at)} />
                      <DetailRow icon={Clock} label="Last Booking" value={formatDateTime(selected.last_booking_at)} />
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="card" style={{ padding: 16 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>Timeline</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                      <DetailRow icon={Calendar} label="Created" value={formatDateTime(selected.created_at)} />
                      <DetailRow icon={Clock} label="Updated" value={formatDateTime(selected.updated_at)} />
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}
            className={`toast toast-${toast.type}`}
            style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1000 }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
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
