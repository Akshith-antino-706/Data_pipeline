'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getUnifiedContacts, getUnifiedStats, getUnifiedFilters, createUnifiedContact, deleteUnifiedContact } from '@/lib/api';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, SCOPE_DESCRIPTIONS } from '@/lib/contactTypes';
import { Search, Plus, SlidersHorizontal, X, Eye, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Loader2 } from 'lucide-react';
import type { FormEvent } from 'react';
import type { QueryParams, UnifiedStats } from '@/types/api';
import { Button, Card, Chip, ConfirmDialog, Field, Input, PageHeader, Select, Skeleton, Table, EmptyState } from '@/components/ui';
import { ContactStatusChip } from '@/components/ui/ContactStatusChip';
import { ContactFilterPanel, EMPTY_FILTERS, describeFilter, type ContactFilterKey, type ContactFilterState, type FilterOptions } from './ContactFilters';
import s from './contacts.module.css';

interface UnifiedContactRow {
  id?: string | number; unified_id?: string | number;
  name?: string; email?: string; phone?: string; mobile?: string; country?: string; city?: string;
  contact_type?: string; wa_unsubscribe?: string; email_unsubscribe?: string;
  booking_status?: string; product_tier?: string; geography?: string;
  total_tour_bookings?: number; total_package_bookings?: number; total_hotel_bookings?: number;
  total_visa_bookings?: number; total_other_bookings?: number; total_flight_bookings?: number;
  total_booking_revenue: string; updated_at?: string; created_at?: string;
}
interface ContactsListResponse { data?: UnifiedContactRow[]; total?: number; totalPages?: number }
interface ToastState { msg: string; type: string }
interface DeleteTarget { id: string | number | undefined; name: string }

const PAGE_SIZE_OPTIONS = [20, 30, 50];
const EMPTY_ADD = { name: '', email: '', mobile: '', city: '', country: '', contact_type: 'B2C', geography: '', wa_unsubscribe: 'no', email_unsubscribe: 'no' };

function formatNum(n?: number) { return (Number(n) || 0).toLocaleString(); }
function formatAED(n?: number | string) { return `AED ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }
function formatShortDate(d?: string) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const isUnsub = (v?: string) => (v || '').toLowerCase() === 'yes';

const SORT_LABELS: Record<string, string> = {
  name: 'Name', email: 'Email', phone: 'Phone', country: 'Country', booking_status: 'Status', product_tier: 'Tier',
  geography: 'Geo', total_bookings: 'Bookings', total_booking_revenue: 'Revenue', updated_at: 'Updated', created_at: 'Date added', last_seen_at: 'Date added',
};

/** Page numbers to show: first, last, current ±1, with null for gaps. */
function pageList(page: number, totalPages: number): (number | null)[] {
  const set = new Set([1, totalPages, page - 1, page, page + 1].filter(p => p >= 1 && p <= totalPages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push(null); out.push(p); });
  return out;
}

export default function UnifiedContacts() {
  const [contacts, setContacts] = useState<UnifiedContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<UnifiedStats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState('last_seen_at');
  const [sortDir, setSortDir] = useState('DESC');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteTarget | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<ContactFilterState>(EMPTY_FILTERS);
  const [limit, setLimit] = useState(20);
  const { businessType } = useBusinessType();
  const router = useRouter();

  const showToast = (msg: string, type = 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); };

  const activeFilters = (Object.entries(filters) as [ContactFilterKey, string][]).filter(([, v]) => Boolean(v));
  const activeFilterCount = activeFilters.length;
  const updateFilter = (key: ContactFilterKey, value: string) => { setFilters(f => ({ ...f, [key]: value })); setPage(1); };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setPage(1); };

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params: QueryParams = { page, limit, sortBy, sortDir };
      if (businessType !== 'All') params.businessType = businessType;
      if (search) params.search = search;
      (Object.entries(filters) as [string, string][]).forEach(([k, v]) => { if (v) params[k] = v; });
      const res = await getUnifiedContacts(params) as ContactsListResponse;
      setContacts(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) { showToast((err as Error).message); }
    finally { setLoading(false); }
  }, [page, limit, search, sortBy, sortDir, filters, businessType]);

  useEffect(() => { loadContacts(); }, [loadContacts]);
  useEffect(() => {
    // Stats + filter options both scope to the current B2C / B2B / Affiliate selection
    const btParam = businessType === 'All' ? {} : { businessType };
    getUnifiedStats(btParam).then(res => setStats(res.data)).catch(() => {});
    getUnifiedFilters(btParam).then(res => setFilterOptions((res as { data: FilterOptions }).data)).catch(() => {});
    setPage(1);
  }, [businessType]);

  const handleSearch = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(''); setSearch(''); setPage(1); };
  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'ASC' ? 'DESC' : 'ASC');
    else { setSortBy(col); setSortDir('DESC'); }
    setPage(1);
  };

  const openDetail = (id: string | number | undefined) => router.push('/contacts/' + id);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleteLoading(true);
    try {
      await deleteUnifiedContact(deleteConfirm.id!);
      setDeleteConfirm(null);
      showToast('Contact deleted', 'success');
      setContacts(cs => cs.filter(c => (c.id || c.unified_id) !== deleteConfirm.id));
      setTotal(t => t - 1);
    } catch (err) {
      showToast((err as Error).message || 'Failed to delete contact');
    } finally {
      setDeleteLoading(false);
    }
  };

  const setAddField = (k: keyof typeof EMPTY_ADD, v: string) => setAddForm(f => ({ ...f, [k]: v }));
  const openAddModal = () => { setAddForm(EMPTY_ADD); setAddError(null); setShowAddModal(true); };
  const closeAddModal = () => { if (!addLoading) setShowAddModal(false); };
  const handleAddSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!addForm.name && !addForm.email && !addForm.mobile) { setAddError('Provide at least a name, email, or phone.'); return; }
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await createUnifiedContact(addForm) as { data?: { id?: string | number } };
      setShowAddModal(false);
      showToast('Contact created successfully', 'success');
      loadContacts();
      if (res.data?.id) router.push('/contacts/' + res.data.id);
    } catch (err) {
      setAddError((err as Error).message || 'Failed to create contact');
    } finally {
      setAddLoading(false);
    }
  };

  const kpis = [
    { label: 'Contacts', value: formatNum(stats?.total_contacts) },
    { label: 'Bookings', value: formatNum(stats?.total_bookings) },
    { label: 'Revenue', value: formatAED(stats?.total_revenue) },
  ];

  const sortHead = (col: string, label: string) => {
    const on = sortBy === col;
    return (
      <button type="button" className={`${s.sortBtn} ${on ? s.sortBtnOn : ''}`} onClick={() => handleSort(col)}
        aria-label={`Sort by ${label}`}>
        {label}
        {on ? (sortDir === 'ASC' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)
          : <ArrowUpDown size={11} aria-hidden="true" style={{ opacity: 0.35 }} />}
      </button>
    );
  };
  const ariaSort = (...cols: string[]): 'ascending' | 'descending' | 'none' =>
    cols.includes(sortBy) ? (sortDir === 'ASC' ? 'ascending' : 'descending') : 'none';

  const COLS = 10;
  const from = Math.min((page - 1) * limit + 1, total);
  const to = Math.min(page * limit, total);

  return (
    <div className={s.page}>
      <PageHeader
        title="Contacts"
        breadcrumbs={[{ label: 'Audience' }, { label: 'Contacts' }]}
        description={<>{SCOPE_DESCRIPTIONS[businessType] || SCOPE_DESCRIPTIONS.All} · merged from chats, tickets, CRM and bookings.</>}
        actions={
          <Button variant="primary" onClick={openAddModal}>
            <Plus size={16} aria-hidden="true" /> Add contact
          </Button>
        }
      />

      <div className={s.kpis}>
        {!stats ? (
          [0, 1, 2].map(i => (
            <div key={i} className={s.kpi}><Skeleton width={70} height={12} /><Skeleton width={110} height={24} /></div>
          ))
        ) : kpis.map(k => (
          <div key={k.label} className={s.kpi}>
            <span className={s.kpiLabel}>{k.label}</span>
            <span className={s.kpiValue}>{k.value}</span>
          </div>
        ))}
      </div>

      <div className={s.toolbar}>
        <form onSubmit={handleSearch} className={s.search} role="search">
          <Search size={16} className={s.searchIcon} aria-hidden="true" />
          <label htmlFor="contacts-q" className="sr-only" style={{ position: 'absolute', left: -9999 }}>Search contacts</label>
          <Input id="contacts-q" type="search" className={s.searchInput} placeholder="Name, email or phone"
            value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          <Button type="submit" size="sm" style={{ height: 40 }}>Search</Button>
        </form>
        <Chip tone="gold" className={s.filterChip} style={{ paddingRight: 12 }}>Audience: {businessType}</Chip>
        {search && (
          <Chip tone="mute" className={s.filterChip}>
            Search: {search}
            <button type="button" className={s.chipX} onClick={clearSearch} aria-label="Clear search"><X size={12} /></button>
          </Chip>
        )}
        {activeFilters.map(([k, v]) => (
          <Chip key={k} tone="mute" className={s.filterChip}>
            {describeFilter(k, v)}
            <button type="button" className={s.chipX} onClick={() => updateFilter(k, '')} aria-label={`Remove filter ${describeFilter(k, v)}`}><X size={12} /></button>
          </Chip>
        ))}
        <Button size="sm" onClick={() => setShowFilters(f => !f)} aria-expanded={showFilters}>
          <SlidersHorizontal size={14} aria-hidden="true" /> Filters
          {activeFilterCount > 0 && <span className={s.badge} aria-label={`${activeFilterCount} active`}>{activeFilterCount}</span>}
        </Button>
        {(activeFilterCount > 0 || search) && (
          <Button size="sm" variant="ghost" onClick={() => { clearFilters(); if (search) clearSearch(); }}>Clear all</Button>
        )}
      </div>

      {showFilters && (
        <Card className={s.filterPanel} aria-label="Filters">
          <div className={s.meta}>
            <b style={{ color: 'var(--ink)' }}>Filters</b>
            {activeFilterCount > 0 && <Button size="sm" variant="ghost" onClick={clearFilters}>Reset all</Button>}
          </div>
          <ContactFilterPanel filters={filters} options={filterOptions} onChange={updateFilter} />
        </Card>
      )}

      <div className={s.meta}>
        <span>
          <b className={s.num} style={{ color: 'var(--ink)' }}>{formatNum(total)}</b> contacts match · sorted by <b>{SORT_LABELS[sortBy] || sortBy}</b>, {sortDir === 'ASC' ? 'oldest / lowest first' : 'newest / highest first'}
        </span>
      </div>

        <Table label="Contacts" className={s.table}>
          <thead>
            <tr>
              <th aria-sort={ariaSort('name', 'email', 'phone')}>
                {sortHead('name', 'Name')}<span className={s.sortSep} aria-hidden="true">·</span>
                {sortHead('email', 'Email')}<span className={s.sortSep} aria-hidden="true">·</span>
                {sortHead('phone', 'Phone')}
              </th>
              <th aria-sort={ariaSort('booking_status')}>{sortHead('booking_status', 'Status')}</th>
              <th aria-sort={ariaSort('product_tier')}>{sortHead('product_tier', 'Tier')}</th>
              <th aria-sort={ariaSort('geography')}>{sortHead('geography', 'Geo')}</th>
              <th aria-sort={ariaSort('country')}>{sortHead('country', 'Country')}</th>
              <th className={s.r} aria-sort={ariaSort('total_bookings')}>{sortHead('total_bookings', 'Bookings')}</th>
              <th className={s.r} aria-sort={ariaSort('total_booking_revenue')}>{sortHead('total_booking_revenue', 'Revenue')}</th>
              <th>Can message</th>
              <th aria-sort={ariaSort('updated_at')}>{sortHead('updated_at', 'Updated')}</th>
              <th><span className="sr-only" style={{ position: 'absolute', left: -9999 }}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }, (_, i) => (
                <tr key={i}><td colSpan={COLS}><Skeleton height={18} /></td></tr>
              ))
            ) : contacts.length === 0 ? (
              <tr><td colSpan={COLS} style={{ padding: 0 }}>
                <EmptyState
                  title={`No contacts found${search ? ` for "${search}"` : ''}.`}
                  description={activeFilterCount > 0 ? `Audience is ${businessType} with ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'}.` : undefined}
                  action={(activeFilterCount > 0 || search) ? (
                    <Button size="sm" onClick={() => { clearFilters(); if (search) clearSearch(); }}>Clear filters</Button>
                  ) : undefined}
                />
              </td></tr>
            ) : contacts.map(c => {
              const rowId = c.id || c.unified_id;
              const totalBookings = (c.total_tour_bookings || 0) + (c.total_package_bookings || 0) + (c.total_hotel_bookings || 0) + (c.total_visa_bookings || 0) + (c.total_other_bookings || 0) + (c.total_flight_bookings || 0);
              const phone = c.phone || c.mobile;
              const subline = [c.email, phone].filter(Boolean).join(' · ');
              return (
                <tr key={rowId} className={s.row} onClick={() => openDetail(rowId)}>
                  <td>
                    <button type="button" className={s.nameLink} onClick={e => { e.stopPropagation(); openDetail(rowId); }}>
                      {c.name || c.email || phone || '—'}
                    </button>
                    {c.name && subline && <div className={s.help}>{subline}</div>}
                    {!c.name && c.email && phone && <div className={s.help}>{phone}</div>}
                  </td>
                  <td><ContactStatusChip status={c.booking_status} /></td>
                  <td>{c.product_tier ? <Chip tone={c.product_tier === 'LUXURY' ? 'gold' : 'mute'}>{c.product_tier === 'LUXURY' ? 'Luxury' : c.product_tier}</Chip> : <span className={s.help}>—</span>}</td>
                  <td className={s.help}>{c.geography === 'LOCAL' ? 'Local (UAE)' : c.geography === 'INTERNATIONAL' ? 'International' : (c.geography || '—')}</td>
                  <td style={{ color: 'var(--ink2)' }}>{c.country || '—'}</td>
                  <td className={`${s.r} ${s.num}`}>{totalBookings}</td>
                  <td className={`${s.r} ${s.num}`}>{parseFloat(c.total_booking_revenue) > 0 ? formatAED(c.total_booking_revenue) : <span className={s.help}>—</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {c.email && <Chip tone={isUnsub(c.email_unsubscribe) ? 'mute' : 'ok'} className={s.miniChip} title={isUnsub(c.email_unsubscribe) ? 'Email: unsubscribed' : 'Email: active'}>Email</Chip>}
                      {phone && <Chip tone={isUnsub(c.wa_unsubscribe) ? 'mute' : 'ok'} className={s.miniChip} title={isUnsub(c.wa_unsubscribe) ? 'WhatsApp: unsubscribed' : 'WhatsApp: active'}>WhatsApp</Chip>}
                      {!c.email && !phone && <span className={s.help}>—</span>}
                    </div>
                  </td>
                  <td className={s.help} style={{ whiteSpace: 'nowrap' }}>{formatShortDate(c.updated_at || c.created_at)}</td>
                  <td>
                    <div className={s.rowActions}>
                      <Button size="sm" variant="ghost" icon aria-label={`Open ${c.name || c.email || 'contact'}`} onClick={e => { e.stopPropagation(); openDetail(rowId); }}><Eye size={14} /></Button>
                      <Button size="sm" variant="ghost" icon aria-label={`Delete ${c.name || c.email || 'contact'}`} style={{ color: 'var(--bad)' }}
                        onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: rowId, name: c.name || c.email || 'this contact' }); }}><Trash2 size={14} /></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>

      <div className={s.meta}>
        <span>{total > 0 ? <>Showing {formatNum(from)}–{formatNum(to)} of {formatNum(total)}</> : 'No results'}</span>
        <nav aria-label="Pagination" className={s.pager}>
          <Button size="sm" variant="ghost" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">«</Button>
          <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          {pageList(page, totalPages).map((p, i) => p === null
            ? <span key={`gap-${i}`} className={s.help}>…</span>
            : <Button key={p} size="sm" variant={p === page ? 'secondary' : 'ghost'} className={p === page ? s.pageOn : undefined}
                aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`} onClick={() => setPage(p)}>{formatNum(p)}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
          <Button size="sm" variant="ghost" onClick={() => setPage(totalPages)} disabled={page === totalPages} aria-label="Last page">»</Button>
          <label htmlFor="contacts-pp" className={s.help} style={{ marginLeft: 8 }}>Rows</label>
          <Select id="contacts-pp" className={s.rowsSel} value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}>
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
        </nav>
      </div>

      <ConfirmDialog
        open={!!deleteConfirm}
        title="Delete contact"
        description={<p>Permanently delete <b>{deleteConfirm?.name}</b>? This can&apos;t be undone.</p>}
        confirmLabel={deleteLoading ? 'Deleting…' : 'Delete'}
        danger
        busy={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => { if (!deleteLoading) setDeleteConfirm(null); }}
      />

      {showAddModal && (
        <div className="ui-dialog-backdrop" onClick={e => { if (e.target === e.currentTarget) closeAddModal(); }}>
          <div className={`ui-dialog ${s.modalBody}`} role="dialog" aria-modal="true" aria-labelledby="add-contact-title">
            <div className={s.meta} style={{ alignItems: 'flex-start' }}>
              <div>
                <h2 id="add-contact-title">Add contact</h2>
                <p className={s.help} style={{ margin: '4px 0 0' }}>Booking status starts as <Chip tone="mute" className={s.miniChip}>Prospect</Chip></p>
              </div>
              <Button size="sm" variant="ghost" icon aria-label="Close" onClick={closeAddModal}><X size={16} /></Button>
            </div>
            {addError && <div className={s.alert} role="alert">{addError}</div>}
            <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className={s.formGrid}>
                <Field label="Full name">{p => <Input {...p} value={addForm.name} onChange={e => setAddField('name', e.target.value)} placeholder="e.g. John Smith" />}</Field>
                <Field label="Email">{p => <Input {...p} type="email" value={addForm.email} onChange={e => setAddField('email', e.target.value)} placeholder="e.g. john@example.com" />}</Field>
                <Field label="Phone / mobile">{p => <Input {...p} type="tel" value={addForm.mobile} onChange={e => setAddField('mobile', e.target.value)} placeholder="e.g. +971501234567" />}</Field>
                <Field label="City">{p => <Input {...p} value={addForm.city} onChange={e => setAddField('city', e.target.value)} placeholder="e.g. Dubai" />}</Field>
                <Field label="Country">{p => <Input {...p} value={addForm.country} onChange={e => setAddField('country', e.target.value)} placeholder="e.g. United Arab Emirates" />}</Field>
                <Field label="Contact type">{p => (
                  <Select {...p} value={addForm.contact_type} onChange={e => setAddField('contact_type', e.target.value)}>
                    {CONTACT_TYPES.map(t => <option key={t} value={t}>{CONTACT_TYPE_LABELS[t]}</option>)}
                  </Select>
                )}</Field>
                <Field label="Geography">{p => (
                  <Select {...p} value={addForm.geography} onChange={e => setAddField('geography', e.target.value)}>
                    <option value="">Unknown</option><option value="LOCAL">Local (UAE)</option><option value="INTERNATIONAL">International</option>
                  </Select>
                )}</Field>
                <Field label="WhatsApp status">{p => (
                  <Select {...p} value={addForm.wa_unsubscribe} onChange={e => setAddField('wa_unsubscribe', e.target.value)}>
                    <option value="no">Active</option><option value="yes">Unsubscribed</option>
                  </Select>
                )}</Field>
                <Field label="Email status">{p => (
                  <Select {...p} value={addForm.email_unsubscribe} onChange={e => setAddField('email_unsubscribe', e.target.value)}>
                    <option value="no">Active</option><option value="yes">Unsubscribed</option>
                  </Select>
                )}</Field>
              </div>
              <p className={s.help} style={{ margin: 0 }}>Give at least a name, email or phone.</p>
              <div className="ui-dialog-actions">
                <Button variant="ghost" onClick={closeAddModal} disabled={addLoading}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={addLoading}>
                  {addLoading ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" /> Creating…</> : 'Create contact'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className={`toast toast-${toast.type}`} style={{ position: 'fixed', bottom: 24, right: 16, left: 'auto', zIndex: 1000, maxWidth: 'calc(100vw - 32px)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
