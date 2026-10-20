'use client';

import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { X, Plus, Trash2, Loader2, Search } from 'lucide-react';
import { Button, Skeleton } from '@/components/ui';
import b from './builder.module.css';
import { previewSegmentCount, createCustomSegment, updateCustomSegment, getGTMAnalytics, searchContactsByEmail, searchAffinityProducts } from '@/lib/api';
import { CONTACT_TYPES } from '@/lib/contactTypes';
import type { JsonBody } from '@/types/api';
import type { SegmentCondition, EditableCustomSegment, GiveawaySource } from '@/types/f2Segments';

interface BooleanOption { label: string; value: boolean }
interface FieldConfig {
  label: string;
  type: string;
  defaultOperator: string;
  options?: string[] | BooleanOption[];
  labels?: Record<string, string>;
  placeholder?: string;
}
interface ConditionInputProps {
  condition: SegmentCondition;
  onChange: (updated: SegmentCondition) => void;
}
interface ConditionValueInputProps extends ConditionInputProps {
  fieldKey: string;
  cfgOverride?: FieldConfig;
}
interface EmailSearchResult { id: string | number; email: string; name?: string | null }
interface AffinityProductResult {
  product_key: string;
  product_name: string;
  customers_rank1: number | string;
  customers_top3: number | string;
}
interface GtmAnalyticsResponse { top_events?: { event_name: string }[] }
interface CreateSegmentModalProps {
  onClose: () => void;
  onCreated?: () => void;
  segment?: EditableCustomSegment | null;
  onUpdated?: () => void;
}

const FIELD_CONFIG: Record<string, FieldConfig> = {
  email: {
    label: 'Email Address', type: 'email-search',
    defaultOperator: 'in',
  },
  booking_status: {
    label: 'Booking Status', type: 'multi-select',
    options: ['ON_TRIP', 'FUTURE_TRAVEL', 'PAST_BOOKING', 'CANCELLED', 'PROSPECT'],
    labels: { ON_TRIP: 'On Trip', FUTURE_TRAVEL: 'Future Travel', PAST_BOOKING: 'Past Booking', CANCELLED: 'Cancelled', PROSPECT: 'Prospect' },
    defaultOperator: 'in',
  },
  product_tier: {
    label: 'Product Tier', type: 'multi-select',
    options: ['LUXURY', 'STANDARD'],
    labels: { LUXURY: 'Luxury', STANDARD: 'Standard' },
    defaultOperator: 'in',
  },
  geography: {
    label: 'Geography', type: 'multi-select',
    options: ['LOCAL', 'INTERNATIONAL'],
    labels: { LOCAL: 'Local', INTERNATIONAL: 'International' },
    defaultOperator: 'in',
  },
  contact_type: {
    label: 'Contact Type', type: 'single-select',
    options: CONTACT_TYPES,
    defaultOperator: 'eq',
  },
  country: {
    label: 'Country', type: 'text',
    placeholder: 'e.g. INDIA, UAE',
    defaultOperator: 'eq',
  },
  mobile_country: {
    label: 'Mobile Country', type: 'text',
    placeholder: 'e.g. India, UAE, United States',
    defaultOperator: 'eq',
  },
  wa_last_msg: {
    label: 'WhatsApp Last Msg', type: 'date-range',
    defaultOperator: 'between',
  },
  is_indian: {
    label: 'Is Indian', type: 'boolean',
    options: [{ label: 'Yes', value: true }, { label: 'No', value: false }],
    defaultOperator: 'eq',
  },
  wa_status: {
    label: 'WhatsApp Status', type: 'single-select',
    options: ['active', 'unsubscribed'],
    labels: { active: 'Active', unsubscribed: 'Unsubscribed' },
    defaultOperator: 'eq',
  },
  email_status: {
    label: 'Email Status', type: 'single-select',
    options: ['active', 'unsubscribed'],
    labels: { active: 'Active', unsubscribed: 'Unsubscribed' },
    defaultOperator: 'eq',
  },
  source: {
    label: 'Source', type: 'single-select',
    options: ['tours', 'hotels', 'visas', 'flights', 'packages', 'others'],
    labels: { tours: 'Tours', hotels: 'Hotels', visas: 'Visas', flights: 'Flights', packages: 'Packages', others: 'Others' },
    defaultOperator: 'contains',
  },
  travel_date: {
    label: 'Travel Date', type: 'date-range',
    defaultOperator: 'between',
  },
  booking_date: {
    label: 'Booking Date', type: 'date-range',
    defaultOperator: 'between',
  },
  travel_date_within: {
    label: 'Travel Date within ± days (today)', type: 'days-window',
    defaultOperator: 'within',
  },
  booking_date_within: {
    label: 'Booking Date within ± days (today)', type: 'days-window',
    defaultOperator: 'within',
  },
  last_booking_age: {
    label: 'Last Booking (recency)', type: 'single-select',
    options: ['recent_90', '90_180', '90_plus', '180_plus'],
    labels: {
      recent_90: 'Within last 90 days',
      '90_180':  'Last booking 90–180 days ago',
      '90_plus': 'Last booking > 90 days ago',
      '180_plus':'Last booking 180+ days ago',
    },
    defaultOperator: 'eq',
  },
  revenue: {
    label: 'Revenue (AED)', type: 'number-range',
    defaultOperator: 'between',
  },
  // Booking affinity (user_affinity_top3, rebuilt nightly). operator: top1 = #1 only, top3 = in the top 3.
  top_service: {
    label: 'Top Service (booking affinity)', type: 'affinity-service',
    options: ['tours', 'packages', 'hotels', 'visas', 'flights', 'others'],
    labels: { tours: 'Tours', packages: 'Packages', hotels: 'Hotels', visas: 'Visas', flights: 'Flights', others: 'Others' },
    defaultOperator: 'top1',
  },
  top_product: {
    label: 'Top Product (booking affinity)', type: 'affinity-product',
    defaultOperator: 'top1',
  },
};

const FIELD_KEYS = Object.keys(FIELD_CONFIG);

const inputStyle: React.CSSProperties = {
  font: 'inherit', height: 36, padding: '0 10px', fontSize: 13, border: '1px solid var(--line)',
  borderRadius: 8, backgroundColor: 'var(--surface)', color: 'var(--ink)', width: '100%', minWidth: 0,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
  paddingRight: 28,
};

function EmailSearchInput({ condition, onChange }: ConditionInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EmailSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = Array.isArray(condition.value) ? condition.value : [];

  useEffect(() => {
    clearTimeout(debounceRef.current!);
    if (query.trim().length < 2) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchContactsByEmail(query.trim()) as { data?: EmailSearchResult[] } | null;
        setResults(res?.data || []);
        setOpen(true);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(debounceRef.current!);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addEmail = (email: string) => {
    if (!selected.includes(email)) onChange({ ...condition, value: [...selected, email] });
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const removeEmail = (email: string) => {
    onChange({ ...condition, value: selected.filter(e => e !== email) });
  };

  return (
    <div ref={containerRef}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {selected.map(email => (
            <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: 'var(--info-soft)', color: 'var(--info)', border: '1px solid transparent' }}>
              {email}
              <button type="button" onClick={() => removeEmail(email)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--info)', padding: 0, lineHeight: 1, fontSize: 14, display: 'flex', alignItems: 'center' }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', pointerEvents: 'none' }} />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Type email or name to search…"
          style={{ ...inputStyle, paddingLeft: 28, maxWidth: 320 }}
        />
        {searching && <Loader2 size={13} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', animation: 'spin 1s linear infinite', color: 'var(--ink3)' }} />}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 50, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', maxHeight: 220, overflowY: 'auto', minWidth: 320 }}>
          {results.map(r => {
            const alreadyAdded = selected.includes(r.email);
            return (
              <button key={r.id} type="button" onClick={() => !alreadyAdded && addEmail(r.email)} disabled={alreadyAdded}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: alreadyAdded ? 'default' : 'pointer', textAlign: 'left', borderBottom: '1px solid var(--line)', opacity: alreadyAdded ? 0.5 : 1, transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--sunken)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--info-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--info)' }}>
                  {(r.name || r.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{r.name || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{r.email}</div>
                </div>
                {alreadyAdded && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ok)', fontWeight: 600 }}>Added</span>}
              </button>
            );
          })}
        </div>
      )}
      {selected.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
          {selected.length} email{selected.length > 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  );
}

// "#1 only" / "in top 3" picker for the booking-affinity fields.
function AffinityRankSelect({ condition, onChange }: ConditionInputProps) {
  return (
    <select value={condition.operator === 'top3' ? 'top3' : 'top1'} onChange={e => onChange({ ...condition, operator: e.target.value })}
      style={{ ...selectStyle, maxWidth: 150 }}>
      <option value="top1">is #1</option>
      <option value="top3">is in the top 3</option>
    </select>
  );
}

const AFFINITY_HINT = 'Ranked from bookings (booked often and recently first) and rebuilt nightly — contacts can join or leave when their ranking changes.';

// product_key is the lower-case product name → show it title-cased on chips.
const productKeyLabel = (key: string) => String(key).replace(/\b\w/g, ch => ch.toUpperCase());

function AffinityProductInput({ condition, onChange }: ConditionInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AffinityProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = Array.isArray(condition.value) ? condition.value : [];

  useEffect(() => {
    clearTimeout(debounceRef.current!);
    if (!open && !query) return;
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchAffinityProducts(query.trim(), 15) as { data?: AffinityProductResult[] } | null;
        setResults(res?.data || []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(debounceRef.current!);
  }, [query, open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (key: string) => onChange({ ...condition, value: selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key] });
  const pick = (key: string) => { toggle(key); setQuery(''); setOpen(false); };

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Contact&apos;s top product</span>
        <AffinityRankSelect condition={condition} onChange={onChange} />
      </div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {selected.map(key => (
            <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: 'var(--gold-soft)', color: 'var(--gold-ink)', border: '1px solid transparent' }}>
              {productKeyLabel(key)}
              <button type="button" onClick={() => toggle(key)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gold-ink)', padding: 0, lineHeight: 1, display: 'flex', alignItems: 'center' }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', pointerEvents: 'none' }} />
        <input type="text" value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder="Search products, e.g. Desert Safari…" style={{ ...inputStyle, paddingLeft: 28, maxWidth: 320 }} />
        {searching && <Loader2 size={13} style={{ position: 'absolute', left: 296, top: '50%', transform: 'translateY(-50%)', animation: 'spin 1s linear infinite', color: 'var(--ink3)' }} />}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 50, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', maxHeight: 240, overflowY: 'auto', minWidth: 340 }}>
          {results.map(r => {
            const added = selected.includes(r.product_key);
            return (
              <button key={r.product_key} type="button" onClick={() => pick(r.product_key)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--line)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--sunken)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{r.product_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)' }}>#1 for {Number(r.customers_rank1).toLocaleString()} · top 3 for {Number(r.customers_top3).toLocaleString()} contacts</div>
                </div>
                {added && <span style={{ fontSize: 10, color: 'var(--ok)', fontWeight: 600 }}>Added</span>}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>{AFFINITY_HINT}</div>
    </div>
  );
}

function ConditionValueInput({ fieldKey, condition, onChange, cfgOverride }: ConditionValueInputProps) {
  // cfgOverride: render these options as a plain multi-select (used by the affinity-service field).
  const cfg = cfgOverride ? { ...cfgOverride, type: 'multi-select' } : FIELD_CONFIG[fieldKey];
  if (!cfg) return null;

  switch (cfg.type) {
    case 'email-search':
      return <EmailSearchInput condition={condition} onChange={onChange} />;

    case 'affinity-product':
      return <AffinityProductInput condition={condition} onChange={onChange} />;

    case 'affinity-service':
      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Contact&apos;s top service</span>
            <AffinityRankSelect condition={condition} onChange={onChange} />
          </div>
          <ConditionValueInput fieldKey={fieldKey} condition={condition} onChange={onChange} cfgOverride={cfg} />
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>{AFFINITY_HINT}</div>
        </div>
      );

    case 'multi-select':
      return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(cfg.options as string[]).map(opt => {
            const selected = Array.isArray(condition.value) && condition.value.includes(opt);
            return (
              <button key={opt} type="button"
                onClick={() => {
                  const current = Array.isArray(condition.value) ? condition.value : [];
                  const next = selected ? current.filter(v => v !== opt) : [...current, opt];
                  onChange({ ...condition, value: next.length ? next : [] });
                }}
                style={{
                  font: 'inherit', height: 30, padding: '0 12px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${selected ? 'var(--gold)' : 'var(--line)'}`,
                  background: selected ? 'var(--gold-soft)' : 'var(--surface)',
                  color: selected ? 'var(--gold-ink)' : 'var(--ink)',
                  fontWeight: selected ? 600 : 400, transition: 'all 0.15s',
                }}>
                {cfg.labels?.[opt] || opt}
              </button>
            );
          })}
        </div>
      );

    case 'single-select':
      return (
        <select value={condition.value as string || ''} onChange={e => onChange({ ...condition, value: e.target.value })}
          style={{ ...selectStyle, maxWidth: 200 }}>
          <option value="">Select...</option>
          {(cfg.options as string[]).map(opt => (
            <option key={opt} value={opt}>{cfg.labels?.[opt] || opt}</option>
          ))}
        </select>
      );

    case 'boolean':
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          {(cfg.options as BooleanOption[]).map(opt => {
            const selected = condition.value === opt.value;
            return (
              <button key={String(opt.value)} type="button"
                onClick={() => onChange({ ...condition, value: opt.value })}
                style={{
                  font: 'inherit', height: 30, padding: '0 14px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${selected ? 'var(--gold)' : 'var(--line)'}`,
                  background: selected ? 'var(--gold-soft)' : 'var(--surface)',
                  color: selected ? 'var(--gold-ink)' : 'var(--ink)',
                  fontWeight: selected ? 600 : 400, transition: 'all 0.15s',
                }}>
                {opt.label}
              </button>
            );
          })}
        </div>
      );

    case 'text':
      return (
        <input type="text" value={condition.value as string || ''} placeholder={cfg.placeholder || ''}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          style={{ ...inputStyle, maxWidth: 220 }} />
      );

    case 'date-range':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="date" value={(condition.value as string[] | null)?.[0] || ''}
            onChange={e => onChange({ ...condition, value: [e.target.value, (condition.value as string[] | null)?.[1] || ''] })}
            style={{ ...inputStyle, maxWidth: 160 }} />
          <span style={{ fontSize: 12, color: 'var(--ink3)' }}>to</span>
          <input type="date" value={(condition.value as string[] | null)?.[1] || ''}
            onChange={e => onChange({ ...condition, value: [(condition.value as string[] | null)?.[0] || '', e.target.value] })}
            style={{ ...inputStyle, maxWidth: 160 }} />
        </div>
      );

    case 'days-window': {
      // Single number X + direction → dynamic window vs CURRENT_DATE (re-evaluated daily).
      //   within → [today-X, today+X] | after (+) → [today, today+X] | before (−) → [today-X, today]
      const dir = condition.operator || 'within';
      const sign = dir === 'after' ? '+' : dir === 'before' ? '−' : '±';
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <select value={dir} onChange={e => onChange({ ...condition, operator: e.target.value })}
            style={{ ...selectStyle, maxWidth: 180 }}>
            <option value="within">± before &amp; after</option>
            <option value="after">+ after today (upcoming)</option>
            <option value="before">− before today (past)</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--ink3)' }}>today {sign}</span>
          <input type="number" min="0" placeholder="X"
            value={(condition.value ?? '') === '' ? '' : condition.value as string | number}
            onChange={e => onChange({ ...condition, value: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0) })}
            style={{ ...inputStyle, maxWidth: 80 }} />
          <span style={{ fontSize: 12, color: 'var(--ink3)' }}>days = date</span>
        </div>
      );
    }

    case 'number-range': {
      const opVal = condition.operator || 'between';
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select value={opVal} onChange={e => {
            const op = e.target.value;
            const val = op === 'between' ? [(condition.value as string[] | null)?.[0] || '', (condition.value as string[] | null)?.[1] || ''] : ((condition.value as string[] | null)?.[0] || condition.value || '');
            onChange({ ...condition, operator: op, value: val });
          }} style={{ ...selectStyle, maxWidth: 120 }}>
            <option value="gte">Min (≥)</option>
            <option value="lte">Max (≤)</option>
            <option value="between">Between</option>
          </select>
          {opVal === 'between' ? (
            <>
              <input type="number" placeholder="Min" value={(condition.value as string[] | null)?.[0] ?? ''}
                onChange={e => onChange({ ...condition, value: [e.target.value, (condition.value as string[] | null)?.[1] ?? ''] })}
                style={{ ...inputStyle, maxWidth: 110 }} />
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>–</span>
              <input type="number" placeholder="Max" value={(condition.value as string[] | null)?.[1] ?? ''}
                onChange={e => onChange({ ...condition, value: [(condition.value as string[] | null)?.[0] ?? '', e.target.value] })}
                style={{ ...inputStyle, maxWidth: 110 }} />
            </>
          ) : (
            <input type="number" placeholder={opVal === 'gte' ? 'Min value' : 'Max value'}
              value={typeof condition.value === 'object' ? '' : (condition.value as string | number ?? '')}
              onChange={e => onChange({ ...condition, value: e.target.value === '' ? '' : Number(e.target.value) })}
              style={{ ...inputStyle, maxWidth: 140 }} />
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

function isFieldValid(cond: SegmentCondition) {
  if (!cond.field) return false;
  const cfg = FIELD_CONFIG[cond.field];
  if (!cfg) return false;
  switch (cfg.type) {
    case 'email-search':  return Array.isArray(cond.value) && cond.value.length > 0;
    case 'affinity-service':
    case 'affinity-product': return Array.isArray(cond.value) && cond.value.length > 0;
    case 'multi-select':  return Array.isArray(cond.value) && cond.value.length > 0;
    case 'single-select': return !!cond.value;
    case 'boolean':       return cond.value === true || cond.value === false;
    case 'text':          return typeof cond.value === 'string' && cond.value.trim().length > 0;
    case 'date-range':    return Array.isArray(cond.value) && !!(cond.value[0] || cond.value[1]);
    case 'days-window':   return cond.value !== '' && cond.value != null && Number.isFinite(Number(cond.value)) && Number(cond.value) >= 0;
    case 'number-range':
      if (cond.operator === 'between') return Array.isArray(cond.value) && (cond.value[0] !== '' || cond.value[1] !== '');
      return cond.value !== '' && cond.value != null;
    default: return false;
  }
}

function isConditionValid(cond: SegmentCondition) {
  if (cond.type === 'gtm') {
    const cv = cond.countValue;
    const hasCount = Array.isArray(cv) ? cv.some(v => v !== '' && v != null) : (cv !== '' && cv != null);
    return !!cond.gtmEvent || hasCount;   // valid with a specific event OR a count (any event)
  }
  if (cond.type === 'giveaway' || cond.type === 'giveaway_affiliate') {
    const cv = cond.countValue;
    const hasCount = Array.isArray(cv) ? cv.some(v => v !== '' && v != null) : (cv !== '' && cv != null);
    return !!cond.giveawayType || !!cond.giveawayName || hasCount;  // valid with a type/name OR a count
  }
  if (cond.type === 'contact') return isFieldValid(cond);
  return false;
}

// Event types from the RabbitMQ feeds. Both land in giveaway_affiliate_events, told apart
// by `source`; a blank/any source counts BOTH feeds.
const GIVEAWAY_TYPES  = ['participation', 'eligible', 'winner', 'loser'];
const AFFILIATE_TYPES = ['joined', 'coupon_assigned', 'commission_assigned', 'link_generated', 'card_offer_generated'];
const TYPES_BY_SOURCE: Record<GiveawaySource, string[]> = {
  any: [...GIVEAWAY_TYPES, ...AFFILIATE_TYPES], GIVEAWAY: GIVEAWAY_TYPES, AFFILIATE: AFFILIATE_TYPES,
};
const SOURCE_OPTIONS: { k: GiveawaySource; l: string }[] = [
  { k: 'any', l: 'Any' }, { k: 'GIVEAWAY', l: 'Giveaway' }, { k: 'AFFILIATE', l: 'Affiliate' },
];
/** Words for a feed in the plain-words summary and the type picker. */
const SOURCE_WORDS: Record<GiveawaySource, string> = { any: 'giveaway or affiliate', GIVEAWAY: 'giveaway', AFFILIATE: 'affiliate' };
const typeWords = (t: string) => t.replace(/_/g, ' ');

const emptyCondition = (): SegmentCondition => ({
  type: '',
  field: '',
  operator: '',
  value: null,
  gtmEvent: '',
  giveawayType: '',
  giveawayName: '',
  giveawaySource: 'any',
  exclude: false,
  joinOp: 'AND',
});

// ── Plain-words summary ───────────────────────────────────────────────
const shortLabel = (key: string) => (FIELD_CONFIG[key]?.label || key).replace(/ within ± days \(today\)$/, '').replace(/ \(booking affinity\)$/, '');
const optLabel = (key: string, v: string) => FIELD_CONFIG[key]?.labels?.[v] || v;
const listWords = (items: string[], max = 3) => (items.length > max ? `${items.slice(0, max).join(', ')} +${items.length - max} more` : items.join(', '));

function countWords(cond: SegmentCondition): string {
  const cv = cond.countValue;
  if (Array.isArray(cv)) {
    if (!cv.some(v => v !== '' && v != null)) return '';
    return `between ${cv[0] || '0'} and ${cv[1] || 'any number of'} times`;
  }
  if (cv === '' || cv == null) return '';
  return `${(cond.countOp || 'gte') === 'lte' ? 'at most' : 'at least'} ${cv} times`;
}

/** One condition in plain words; mirrors exactly what is sent to the API. */
function describeCondition(cond: SegmentCondition): string {
  const win = cond.windowDays ? ` in the last ${cond.windowDays} days` : '';
  if (cond.type === 'gtm') {
    const evt = cond.gtmEvent ? `the website event "${cond.gtmEvent}"` : 'any website event';
    const cnt = countWords(cond);
    return `triggered ${evt}${cnt ? ` ${cnt}` : ''}${win}`;
  }
  if (cond.type === 'giveaway' || cond.type === 'giveaway_affiliate') {
    const feed = SOURCE_WORDS[cond.giveawaySource || 'any'];
    const kind = cond.giveawayType ? `${/^[aeiou]/.test(feed) ? 'an' : 'a'} ${feed} "${typeWords(cond.giveawayType)}" event` : `any ${feed} activity`;
    const nm = cond.giveawayName ? ` for "${cond.giveawayName}"` : '';
    const cnt = countWords(cond);
    return `had ${kind}${nm}${cnt ? ` ${cnt}` : ''}${win}`;
  }
  const key = cond.field;
  const cfg = FIELD_CONFIG[key];
  if (!cfg) return '';
  const label = shortLabel(key).toLowerCase();
  const v = cond.value;
  switch (cfg.type) {
    case 'email-search': return `have the email ${listWords(Array.isArray(v) ? v : [])}`;
    case 'multi-select': return `have ${label} ${listWords((Array.isArray(v) ? v : []).map(x => optLabel(key, x)))}`;
    case 'affinity-service':
    case 'affinity-product': {
      const items = (Array.isArray(v) ? v : []).map(x => (cfg.type === 'affinity-product' ? productKeyLabel(x) : optLabel(key, x)));
      return `have ${listWords(items)} as their ${cond.operator === 'top3' ? 'top-3' : 'number 1'} ${cfg.type === 'affinity-product' ? 'product' : 'service'}`;
    }
    case 'single-select': return `have ${label} ${optLabel(key, String(v))}`;
    case 'boolean': return `${v === true ? 'are' : 'are not'} ${label.replace(/^is /, '')}`;
    case 'text': return `have ${label} "${String(v).trim()}"`;
    case 'date-range': {
      const [a, z] = Array.isArray(v) ? v : ['', ''];
      return `have ${label} ${a && z ? `from ${a} to ${z}` : a ? `on or after ${a}` : `on or before ${z}`}`;
    }
    case 'days-window': {
      const dir = cond.operator || 'within';
      const span = dir === 'after' ? `in the next ${v} days` : dir === 'before' ? `in the last ${v} days` : `within ${v} days of today`;
      return `have ${label} ${span}`;
    }
    case 'number-range': {
      if (cond.operator === 'between') {
        const [a, z] = Array.isArray(v) ? v : ['', ''];
        return `have ${label} ${a !== '' && z !== '' ? `between ${a} and ${z}` : a !== '' ? `of at least ${a}` : `of at most ${z}`}`;
      }
      return `have ${label} of ${cond.operator === 'lte' ? 'at most' : 'at least'} ${String(v)}`;
    }
    default: return '';
  }
}

function negate(d: string): string {
  const swaps: [RegExp, string][] = [[/^had /, 'did not have '], [/^triggered /, 'did not trigger '], [/^have /, 'do not have '], [/^are not /, 'are '], [/^are /, 'are not ']];
  const hit = swaps.find(([re]) => re.test(d));
  return hit ? d.replace(hit[0], hit[1]) : `not: ${d}`;
}

function PlainWords({ conditions }: { conditions: SegmentCondition[] }) {
  if (conditions.length === 0) return <span className={b.note}>Add a rule to describe who belongs in this segment.</span>;
  const parts: ReactNode[] = [];
  conditions.forEach((c, i) => {
    if (i > 0) parts.push(<span key={`j${i}`}> {conditions[i - 1].joinOp === 'OR' ? 'or' : 'and'} </span>);
    parts.push(c.exclude
      ? <b key={i}>{negate(describeCondition(c))}</b>
      : <b key={i}>{describeCondition(c)}</b>);
  });
  return <span>Contacts who {parts}.</span>;
}

const RULE_KINDS = [
  { type: 'contact', name: 'Contact property', desc: 'Booking status, product, location, revenue, dates…' },
  { type: 'gtm', name: 'Website event (GTM)', desc: 'Events tracked on the website' },
  { type: 'giveaway_affiliate', name: 'Giveaway / Affiliate', desc: 'Giveaway entries and results, affiliate activity' },
];
const kindName = (type: string) => RULE_KINDS.find(k => k.type === type)?.name || type;

export default function CreateSegmentModal({ onClose, onCreated, segment = null, onUpdated }: CreateSegmentModalProps) {
  const isEditMode = !!segment;
  const [name, setName] = useState(segment?.name || '');
  const [description, setDescription] = useState(segment?.description || '');
  const [conditions, setConditions] = useState<SegmentCondition[]>(() => {
    if (segment?.conditions?.length as number > 0) {
      return segment!.conditions!.map(c => ({
        // Legacy segments stored type:'giveaway'; show them in the merged editor.
        type: (c.type === 'giveaway' ? 'giveaway_affiliate' : c.type)
              || (c.giveawayType || c.giveawayName ? 'giveaway_affiliate' : c.gtmEvent ? 'gtm' : c.field ? 'contact' : ''),
        field: c.field || '',
        operator: c.operator || '',
        value: c.value ?? null,
        gtmEvent: c.gtmEvent || '',
        giveawayType: c.giveawayType || '',
        giveawayName: c.giveawayName || '',
        giveawaySource: c.giveawaySource || 'any',
        countOp: c.countOp || 'gte',
        countValue: c.countValue ?? '',
        windowDays: c.windowDays ?? '',
        exclude: c.exclude || false,
        joinOp: c.joinOp || 'AND',
      }));
    }
    return [emptyCondition()];
  });
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [gtmEventNames, setGtmEventNames] = useState<string[]>([]);

  useEffect(() => {
    (getGTMAnalytics() as Promise<GtmAnalyticsResponse | null>).then(res => {
      const names = (res?.top_events || []).map(e => e.event_name).filter(Boolean);
      setGtmEventNames(names);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const updateCondition = (idx: number, updated: SegmentCondition) => {
    const next = [...conditions];
    next[idx] = updated;
    setConditions(next);
  };

  const changeType = (idx: number, type: string) => {
    const cond = conditions[idx];
    updateCondition(idx, { ...emptyCondition(), type, exclude: cond.exclude, joinOp: cond.joinOp });
  };

  const changeField = (idx: number, newField: string) => {
    if (!newField) { updateCondition(idx, { ...conditions[idx], field: '', operator: '', value: null }); return; }
    const cfg = FIELD_CONFIG[newField];
    const defaultValue = cfg?.type === 'multi-select' ? [] :
      cfg?.type === 'email-search' ? [] :
      cfg?.type === 'affinity-service' || cfg?.type === 'affinity-product' ? [] :
      cfg?.type === 'date-range' ? ['', ''] :
      cfg?.type === 'number-range' ? ['', ''] :
      cfg?.type === 'boolean' ? null : '';
    updateCondition(idx, {
      ...conditions[idx],
      field: newField,
      operator: cfg?.defaultOperator || 'eq',
      value: defaultValue,
    });
  };

  const removeCondition = (idx: number) => setConditions(conditions.filter((_, i) => i !== idx));
  const addCondition = () => setConditions([...conditions, emptyCondition()]);

  const validConditions = useMemo(() => conditions.filter(isConditionValid), [conditions]);
  const incompleteCount = conditions.filter(c => c.type && !isConditionValid(c)).length;

  const refreshPreview = useCallback(async (conds: SegmentCondition[]) => {
    if (!conds.length) { setPreviewCount(null); return; }
    setPreviewLoading(true);
    setPreviewError(false);
    try {
      const res = await previewSegmentCount(conds, 'AND') as { count: number };
      setPreviewCount(res.count);
    } catch (err) {
      console.error('Preview count failed:', err);
      setPreviewCount(null);
      setPreviewError(true);
    }
    setPreviewLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (validConditions.length > 0) refreshPreview(validConditions);
      else { setPreviewCount(null); setPreviewError(false); }
    }, 600);
    return () => clearTimeout(timer);
  }, [validConditions, refreshPreview]);

  const canSave = !saving && !!name.trim() && validConditions.length > 0;

  const handleSave = async (status?: 'draft') => {
    if (!name.trim() || validConditions.length === 0) return;
    setSaving(true);
    setSaveError(false);
    try {
      const body = { name: name.trim(), description: description.trim() || null, conditions: validConditions };
      if (isEditMode) {
        await updateCustomSegment(segment!.id, body);
        onUpdated?.();
      } else {
        await createCustomSegment(status ? { ...body, status } : body);
        onCreated?.();
      }
      onClose();
    } catch (err) {
      console.error(`Failed to ${isEditMode ? 'update' : 'create'} segment:`, err);
      setSaveError(true);
    }
    setSaving(false);
  };

  // Fields already chosen in other rows (for disabling duplicates)
  const usedFields = new Set(conditions.map(c => c.type === 'contact' ? c.field : '').filter(Boolean));

  const countControls = (cond: SegmentCondition, setCond: (patch: Partial<SegmentCondition>) => void, example: string) => {
    const countOp = cond.countOp || 'gte';
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className={b.help} style={{ minWidth: 48 }}>Count</span>
          <select aria-label="Count condition" value={countOp}
            onChange={e => { const op = e.target.value; setCond({ countOp: op, countValue: op === 'between' ? ['', ''] : '' }); }}
            style={{ ...selectStyle, maxWidth: 140 }}>
            <option value="gte">at least (≥)</option>
            <option value="lte">at most (≤)</option>
            <option value="between">between</option>
          </select>
          {countOp === 'between' ? (
            <>
              <input type="number" min="0" placeholder="min" aria-label="Minimum count" value={cond.countValue?.[0] ?? ''}
                onChange={e => setCond({ countValue: [e.target.value, cond.countValue?.[1] ?? ''] })}
                style={{ ...inputStyle, maxWidth: 84 }} />
              <span className={b.help}>–</span>
              <input type="number" min="0" placeholder="max" aria-label="Maximum count" value={cond.countValue?.[1] ?? ''}
                onChange={e => setCond({ countValue: [cond.countValue?.[0] ?? '', e.target.value] })}
                style={{ ...inputStyle, maxWidth: 84 }} />
            </>
          ) : (
            <input type="number" min="0" placeholder={example} aria-label="Count"
              value={typeof cond.countValue === 'object' ? '' : (cond.countValue ?? '')}
              onChange={e => setCond({ countValue: e.target.value })}
              style={{ ...inputStyle, maxWidth: 100 }} />
          )}
          <span className={b.help}>events</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className={b.help} style={{ minWidth: 48 }}>Within</span>
          <select aria-label="Time window" value={cond.windowDays ?? ''} onChange={e => setCond({ windowDays: e.target.value })} style={{ ...selectStyle, maxWidth: 160 }}>
            <option value="">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="180">Last 180 days</option>
          </select>
        </div>
      </>
    );
  };

  return (
    <div className={b.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={b.panel} role="dialog" aria-modal="true" aria-labelledby="segment-builder-title">
        <div className={b.top}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className={b.crumbs}>Segments / {isEditMode ? 'Edit' : 'New'}</span>
            <h2 id="segment-builder-title" className={b.title}>{isEditMode ? 'Edit segment' : 'New segment'}</h2>
          </div>
          <Button variant="ghost" size="sm" icon aria-label="Close" onClick={onClose}><X size={18} /></Button>
        </div>

        <div className={b.top}>
          <div className={b.fields}>
            <div className={b.field} style={{ flexGrow: 2 }}>
              <label className={b.label} htmlFor="sb-name">Segment name <span className={b.req}>*</span></label>
              <input id="sb-name" className={b.nameInput} type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. High-Value Local Travelers" />
            </div>
            <div className={b.field}>
              <label className={b.label} htmlFor="sb-desc">Description</label>
              <input id="sb-desc" className={b.descInput} type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
            </div>
          </div>
          <div className={b.actions}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {!isEditMode && <Button onClick={() => handleSave('draft')} disabled={!canSave}>Save as draft</Button>}
            <Button variant="primary" onClick={() => handleSave()} disabled={!canSave}>
              {saving && <Loader2 size={14} className="spin" />}
              {saving ? 'Saving…' : (isEditMode ? 'Save changes' : 'Save segment')}
            </Button>
          </div>
        </div>
        {saveError && <span className={b.err} role="alert">Couldn&apos;t save the segment. Your rules are still here — try again.</span>}

        <div className={b.cols}>
          <section className={b.rules} aria-label="Rules">
            <div className={b.plain}>
              <span className={b.eyebrow}>In plain words</span>
              <PlainWords conditions={validConditions} />
            </div>

            <span className={b.help}>Rules are checked in order. Each rule joins the one before it with AND or OR.</span>

            {conditions.map((cond, idx) => {
              const setCond = (patch: Partial<SegmentCondition>) => updateCondition(idx, { ...cond, ...patch });
              const invalid = !!cond.type && !isConditionValid(cond);
              return (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {idx > 0 && (
                    <div className={b.join}>
                      <span className={b.joinLine} />
                      <div className={b.seg} role="group" aria-label={`Join rule ${idx} and rule ${idx + 1}`}>
                        {['AND', 'OR'].map(op => (
                          <button key={op} type="button" className={b.segBtn} aria-pressed={conditions[idx - 1].joinOp === op}
                            onClick={() => updateCondition(idx - 1, { ...conditions[idx - 1], joinOp: op })}>{op}</button>
                        ))}
                      </div>
                      <span className={b.joinLine} />
                    </div>
                  )}

                  <div className={b.rule} data-exclude={cond.exclude ? 'true' : undefined} data-invalid={invalid ? 'true' : undefined}>
                    <div className={b.ruleBody}>
                      {!cond.type ? (
                        <>
                          <span className={b.note}>Choose what this rule looks at:</span>
                          <div className={b.kindPicker}>
                            {RULE_KINDS.map(k => (
                              <button key={k.type} type="button" className={b.kind} onClick={() => changeType(idx, k.type)}>
                                <span className={b.kindName}>{k.name}</span>
                                <span className={b.help}>{k.desc}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className={b.ruleHead}>
                          <span className={b.ruleKind}>{kindName(cond.type)}</span>
                          <button type="button" onClick={() => changeType(idx, '')} title="Change type" aria-label="Change rule type"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1, padding: 2, display: 'flex' }}>
                            <X size={14} />
                          </button>
                        </div>
                      )}

                      {cond.type === 'contact' && (
                        <>
                          <select aria-label="Field" value={cond.field || ''} onChange={e => changeField(idx, e.target.value)} style={selectStyle}>
                            <option value="">Select a property...</option>
                            {FIELD_KEYS.map(key => {
                              const taken = usedFields.has(key) && cond.field !== key;
                              return <option key={key} value={key} disabled={taken}>{FIELD_CONFIG[key].label}{taken ? ' (already used)' : ''}</option>;
                            })}
                          </select>
                          {cond.field && <ConditionValueInput fieldKey={cond.field} condition={cond} onChange={updated => updateCondition(idx, updated)} />}
                        </>
                      )}

                      {cond.type === 'gtm' && (
                        <>
                          <select aria-label="Website event" value={cond.gtmEvent || ''} onChange={e => setCond({ gtmEvent: e.target.value })} style={selectStyle}>
                            <option value="">— Any event (total activity) —</option>
                            {gtmEventNames.map(evtName => <option key={evtName} value={evtName}>{evtName}</option>)}
                          </select>
                          {countControls(cond, setCond, 'e.g. 5')}
                        </>
                      )}

                      {(cond.type === 'giveaway' || cond.type === 'giveaway_affiliate') && (
                        <>
                          {/* Feed: both land in one table, told apart by `source`.
                              'any' counts BOTH — which is exactly what legacy segments did. */}
                          <div className={b.seg} role="group" aria-label="Feed">
                            {SOURCE_OPTIONS.map(o => (
                              <button key={o.k} type="button" className={b.segBtn} aria-pressed={(cond.giveawaySource || 'any') === o.k}
                                onClick={() => setCond({ giveawaySource: o.k, giveawayType: '' })}>{o.l}</button>
                            ))}
                          </div>
                          {/* Event type — the list follows the selected feed */}
                          <select aria-label="Event type" value={cond.giveawayType || ''} onChange={e => setCond({ giveawayType: e.target.value })} style={selectStyle}>
                            <option value="">— Any type (all {(cond.giveawaySource || 'any') === 'any' ? '' : `${SOURCE_WORDS[cond.giveawaySource || 'any']} `}activity) —</option>
                            {(TYPES_BY_SOURCE[cond.giveawaySource || 'any'] || TYPES_BY_SOURCE.any).map(t => <option key={t} value={t}>{typeWords(t)}</option>)}
                          </select>
                          <input type="text" aria-label="Giveaway name" placeholder="Giveaway name (optional, exact match)"
                            value={cond.giveawayName || ''} onChange={e => setCond({ giveawayName: e.target.value })} style={inputStyle} />
                          {countControls(cond, setCond, 'e.g. 3')}
                        </>
                      )}

                      {invalid && <span className={b.err}>Finish this rule or remove it. Incomplete rules are not saved.</span>}
                    </div>

                    {(cond.type || conditions.length > 1) && (
                      <div className={b.ruleFoot}>
                        {cond.type ? (
                          <div className={b.seg} role="group" aria-label="Include or leave out">
                            <button type="button" className={b.segBtn} aria-pressed={!cond.exclude} onClick={() => setCond({ exclude: false })}>Include</button>
                            <button type="button" className={b.segBtn} data-tone="bad" aria-pressed={!!cond.exclude} onClick={() => setCond({ exclude: true })}>Leave out</button>
                          </div>
                        ) : <span />}
                        {conditions.length > 1 && (
                          <Button variant="ghost" size="sm" onClick={() => removeCondition(idx)}><Trash2 size={14} aria-hidden="true" />Remove</Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <button type="button" className={b.addRule} onClick={addCondition}><Plus size={14} aria-hidden="true" />Add rule</button>
          </section>

          <aside className={b.aside} aria-label="Who matches" aria-live="polite">
            <span className={b.eyebrow}>Who matches</span>
            {previewLoading ? (
              <>
                <Skeleton height={40} width="60%" />
                <span className={b.help}>Counting…</span>
              </>
            ) : previewError ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <b style={{ color: 'var(--bad)' }}>Couldn&apos;t count contacts</b>
                <span className={b.note}>Your rules are kept; the count service didn&apos;t respond.</span>
                <Button size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => refreshPreview(validConditions)}>Count again</Button>
              </div>
            ) : previewCount != null ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className={b.count}>{previewCount.toLocaleString()}</span>
                <span className={b.note}>contacts match {validConditions.length} complete rule{validConditions.length !== 1 ? 's' : ''}</span>
              </div>
            ) : (
              <span className={b.note}>Add a complete rule to see how many contacts match.</span>
            )}
            {incompleteCount > 0 && <span className={b.err}>{incompleteCount} incomplete rule{incompleteCount !== 1 ? 's are' : ' is'} left out of the count.</span>}
          </aside>
        </div>
      </div>
    </div>
  );
}
