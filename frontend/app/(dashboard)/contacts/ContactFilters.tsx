'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui';
import s from './contacts.module.css';

export interface ContactFilterState {
  country: string; contactType: string; source: string; bookingStatus: string; productTier: string;
  geography: string; chatDepartment: string; hasChats: string; hasBookings: string; waStatus: string;
  emailStatus: string; bookingDateFrom: string; bookingDateTo: string; travelDateFrom: string; travelDateTo: string;
}
export type ContactFilterKey = keyof ContactFilterState;

export const EMPTY_FILTERS: ContactFilterState = {
  country: '', contactType: '', source: '', bookingStatus: '', productTier: '', geography: '', chatDepartment: '',
  hasChats: '', hasBookings: '', waStatus: '', emailStatus: '', bookingDateFrom: '', bookingDateTo: '', travelDateFrom: '', travelDateTo: '',
};

export interface FilterOptions {
  countries?: string[]; contactTypes?: string[]; sources?: string[];
  bookingStatuses?: string[]; productTiers?: string[]; geographies?: string[];
}

interface SelectDef { key: ContactFilterKey; label: string; options: (o: FilterOptions | null) => string[]; labels?: string[] }

const YES_NO = ['yes', 'no'];
const ACTIVE_UNSUB = ['active', 'unsubscribed'];

/** Every select filter the list API accepts, grouped like the design's "Add filter" menu. */
export const FILTER_GROUPS: { label: string; items: SelectDef[] }[] = [
  { label: 'Booking', items: [
    { key: 'bookingStatus', label: 'Booking status', options: o => o?.bookingStatuses || [] },
    { key: 'hasBookings', label: 'Has bookings', options: () => YES_NO, labels: ['Yes', 'No'] },
    { key: 'productTier', label: 'Tier', options: o => o?.productTiers || [] },
  ] },
  { label: 'Location', items: [
    { key: 'country', label: 'Country', options: o => o?.countries || [] },
    { key: 'geography', label: 'Geography', options: o => o?.geographies || [] },
  ] },
  { label: 'Contact', items: [
    { key: 'contactType', label: 'Type', options: o => o?.contactTypes || [] },
    { key: 'source', label: 'Source', options: o => o?.sources || [] },
  ] },
  { label: 'Messaging', items: [
    { key: 'emailStatus', label: 'Email status', options: () => ACTIVE_UNSUB, labels: ['Active', 'Unsubscribed'] },
    { key: 'waStatus', label: 'WhatsApp status', options: () => ACTIVE_UNSUB, labels: ['Active', 'Unsubscribed'] },
  ] },
  { label: 'Chats', items: [
    { key: 'hasChats', label: 'Has chats', options: () => YES_NO, labels: ['Yes', 'No'] },
    { key: 'chatDepartment', label: 'Chat department', options: () => ['B2B', 'B2C'] },
  ] },
];

const DATE_LABELS: Partial<Record<ContactFilterKey, string>> = {
  bookingDateFrom: 'Booked from', bookingDateTo: 'Booked to', travelDateFrom: 'Travel from', travelDateTo: 'Travel to',
};

/** Human label + display value for an active filter chip. */
export function describeFilter(key: ContactFilterKey, value: string): string {
  if (DATE_LABELS[key]) return `${DATE_LABELS[key]}: ${value}`;
  for (const g of FILTER_GROUPS) {
    const def = g.items.find(i => i.key === key);
    if (def) {
      const opts = def.options(null);
      const idx = opts.indexOf(value);
      return `${def.label}: ${def.labels && idx >= 0 ? def.labels[idx] : value}`;
    }
  }
  return `${key}: ${value}`;
}

interface PanelProps {
  filters: ContactFilterState;
  options: FilterOptions | null;
  onChange: (key: ContactFilterKey, value: string) => void;
}

export function ContactFilterPanel({ filters, options, onChange }: PanelProps) {
  return (
    <div className={s.filterGrid}>
      {FILTER_GROUPS.map(g => (
        <FilterGroup key={g.label} label={g.label}>
          {g.items.map(i => (
            <FilterSelect key={i.key} label={i.label} value={filters[i.key]} onChange={v => onChange(i.key, v)}
              options={i.options(options)} labels={i.labels} />
          ))}
        </FilterGroup>
      ))}
      <FilterGroup label="Dates">
        <DateRangeFilter label="Booking date" from={filters.bookingDateFrom} to={filters.bookingDateTo}
          onFrom={v => onChange('bookingDateFrom', v)} onTo={v => onChange('bookingDateTo', v)} />
        <DateRangeFilter label="Travel date" from={filters.travelDateFrom} to={filters.travelDateTo}
          onFrom={v => onChange('travelDateFrom', v)} onTo={v => onChange('travelDateTo', v)} />
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (<><div className={s.filterGroup}>{label}</div>{children}</>);
}

interface FilterSelectProps { label: string; value: string; onChange: (v: string) => void; options: string[]; labels?: string[] }

function FilterSelect({ label, value, onChange, options, labels }: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const showSearch = options.length > 10;
  const nameOf = (o: string) => (labels ? labels[options.indexOf(o)] || o : o);
  const filtered = filterText ? options.filter(o => nameOf(o).toLowerCase().includes(filterText.toLowerCase())) : options;
  const displayValue = value ? nameOf(value) : 'All';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (v: string) => { onChange(v); setOpen(false); };

  return (
    <div ref={ref} className={s.fsWrap}>
      <label className="ui-label" htmlFor={id}>{label}</label>
      <button id={id} type="button" className={`ui-input ${s.fsButton}`} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => { setOpen(o => !o); setFilterText(''); }}
        style={{ color: value ? 'var(--ink)' : 'var(--ink3)' }}>
        <span>{displayValue}</span>
        <ChevronDown size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
      </button>
      {open && (
        <div className={s.fsMenu}>
          {showSearch && (
            <Input autoFocus aria-label={`Search ${label}`} placeholder="Search…" value={filterText}
              onChange={e => setFilterText(e.target.value)} style={{ border: 0, borderBottom: '1px solid var(--line)', borderRadius: 0 }} />
          )}
          <div className={s.fsMenuList} role="listbox" aria-label={label}>
            <button type="button" role="option" aria-selected={!value} className={`${s.fsOption} ${!value ? s.fsOptionOn : ''}`} onClick={() => pick('')}>All</button>
            {filtered.map(o => (
              <button key={o} type="button" role="option" aria-selected={value === o}
                className={`${s.fsOption} ${value === o ? s.fsOptionOn : ''}`} onClick={() => pick(o)}>{nameOf(o)}</button>
            ))}
            {filtered.length === 0 && <div className={s.help} style={{ padding: 10, textAlign: 'center' }}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

interface DateRangeFilterProps { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }

function DateRangeFilter({ label, from, to, onFrom, onTo }: DateRangeFilterProps) {
  return (
    <fieldset className={s.dateRange} style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="ui-label" style={{ padding: 0, marginBottom: 6 }}>{label}</legend>
      <div className={s.dateRow}>
        <Input type="date" aria-label={`${label} from`} value={from} onChange={e => onFrom(e.target.value)} />
        <Input type="date" aria-label={`${label} to`} value={to} onChange={e => onTo(e.target.value)} />
      </div>
    </fieldset>
  );
}
