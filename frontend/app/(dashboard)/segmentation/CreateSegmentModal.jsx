'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Trash2, Filter, Loader2, Users, Search } from 'lucide-react';
import { previewSegmentCount, createCustomSegment, updateCustomSegment, getGTMAnalytics, searchContactsByEmail } from '@/lib/api';

const FIELD_CONFIG = {
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
    options: ['B2B', 'B2C'],
    defaultOperator: 'eq',
  },
  country: {
    label: 'Country', type: 'text',
    placeholder: 'e.g. INDIA, UAE',
    defaultOperator: 'eq',
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
  revenue: {
    label: 'Revenue (AED)', type: 'number-range',
    defaultOperator: 'between',
  },
};

const FIELD_KEYS = Object.keys(FIELD_CONFIG);

const inputStyle = {
  padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', background: 'var(--background)', color: 'var(--foreground)',
  outline: 'none', width: '100%',
};

const selectStyle = {
  ...inputStyle, cursor: 'pointer', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
  paddingRight: 28,
};

function EmailSearchInput({ condition, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  const selected = Array.isArray(condition.value) ? condition.value : [];

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchContactsByEmail(query.trim());
        setResults(res?.data || []);
        setOpen(true);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addEmail = (email) => {
    if (!selected.includes(email)) onChange({ ...condition, value: [...selected, email] });
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const removeEmail = (email) => {
    onChange({ ...condition, value: selected.filter(e => e !== email) });
  };

  return (
    <div ref={containerRef}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {selected.map(email => (
            <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}>
              {email}
              <button type="button" onClick={() => removeEmail(email)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: 0, lineHeight: 1, fontSize: 14, display: 'flex', alignItems: 'center' }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)', pointerEvents: 'none' }} />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Type email or name to search…"
          style={{ ...inputStyle, paddingLeft: 28, maxWidth: 320 }}
        />
        {searching && <Loader2 size={13} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', animation: 'spin 1s linear infinite', color: 'var(--muted-foreground)' }} />}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 50, marginTop: 4, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 220, overflowY: 'auto', minWidth: 320 }}>
          {results.map(r => {
            const alreadyAdded = selected.includes(r.email);
            return (
              <button key={r.id} type="button" onClick={() => !alreadyAdded && addEmail(r.email)} disabled={alreadyAdded}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: alreadyAdded ? 'default' : 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border)', opacity: alreadyAdded ? 0.5 : 1, transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--background)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(59,130,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#3b82f6' }}>
                  {(r.name || r.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>{r.name || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{r.email}</div>
                </div>
                {alreadyAdded && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#22c55e', fontWeight: 600 }}>Added</span>}
              </button>
            );
          })}
        </div>
      )}
      {selected.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 6 }}>
          {selected.length} email{selected.length > 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  );
}

function ConditionValueInput({ fieldKey, condition, onChange }) {
  const cfg = FIELD_CONFIG[fieldKey];
  if (!cfg) return null;

  switch (cfg.type) {
    case 'email-search':
      return <EmailSearchInput condition={condition} onChange={onChange} />;

    case 'multi-select':
      return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {cfg.options.map(opt => {
            const selected = Array.isArray(condition.value) && condition.value.includes(opt);
            return (
              <button key={opt} type="button"
                onClick={() => {
                  const current = Array.isArray(condition.value) ? condition.value : [];
                  const next = selected ? current.filter(v => v !== opt) : [...current, opt];
                  onChange({ ...condition, value: next.length ? next : [] });
                }}
                style={{
                  padding: '4px 10px', fontSize: 12, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                  background: selected ? 'var(--primary)' : 'var(--background)',
                  color: selected ? 'var(--primary-foreground)' : 'var(--foreground)',
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
        <select value={condition.value || ''} onChange={e => onChange({ ...condition, value: e.target.value })}
          style={{ ...selectStyle, maxWidth: 200 }}>
          <option value="">Select...</option>
          {cfg.options.map(opt => (
            <option key={opt} value={opt}>{cfg.labels?.[opt] || opt}</option>
          ))}
        </select>
      );

    case 'boolean':
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          {cfg.options.map(opt => {
            const selected = condition.value === opt.value;
            return (
              <button key={String(opt.value)} type="button"
                onClick={() => onChange({ ...condition, value: opt.value })}
                style={{
                  padding: '4px 14px', fontSize: 12, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                  background: selected ? 'var(--primary)' : 'var(--background)',
                  color: selected ? 'var(--primary-foreground)' : 'var(--foreground)',
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
        <input type="text" value={condition.value || ''} placeholder={cfg.placeholder || ''}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          style={{ ...inputStyle, maxWidth: 220 }} />
      );

    case 'date-range':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="date" value={condition.value?.[0] || ''}
            onChange={e => onChange({ ...condition, value: [e.target.value, condition.value?.[1] || ''] })}
            style={{ ...inputStyle, maxWidth: 160 }} />
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>to</span>
          <input type="date" value={condition.value?.[1] || ''}
            onChange={e => onChange({ ...condition, value: [condition.value?.[0] || '', e.target.value] })}
            style={{ ...inputStyle, maxWidth: 160 }} />
        </div>
      );

    case 'number-range': {
      const opVal = condition.operator || 'between';
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select value={opVal} onChange={e => {
            const op = e.target.value;
            const val = op === 'between' ? [condition.value?.[0] || '', condition.value?.[1] || ''] : (condition.value?.[0] || condition.value || '');
            onChange({ ...condition, operator: op, value: val });
          }} style={{ ...selectStyle, maxWidth: 120 }}>
            <option value="gte">Min (≥)</option>
            <option value="lte">Max (≤)</option>
            <option value="between">Between</option>
          </select>
          {opVal === 'between' ? (
            <>
              <input type="number" placeholder="Min" value={condition.value?.[0] || ''}
                onChange={e => onChange({ ...condition, value: [e.target.value, condition.value?.[1] || ''] })}
                style={{ ...inputStyle, maxWidth: 110 }} />
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>–</span>
              <input type="number" placeholder="Max" value={condition.value?.[1] || ''}
                onChange={e => onChange({ ...condition, value: [condition.value?.[0] || '', e.target.value] })}
                style={{ ...inputStyle, maxWidth: 110 }} />
            </>
          ) : (
            <input type="number" placeholder={opVal === 'gte' ? 'Min value' : 'Max value'}
              value={typeof condition.value === 'object' ? '' : (condition.value || '')}
              onChange={e => onChange({ ...condition, value: Number(e.target.value) || '' })}
              style={{ ...inputStyle, maxWidth: 140 }} />
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

function isFieldValid(cond) {
  if (!cond.field) return false;
  const cfg = FIELD_CONFIG[cond.field];
  if (!cfg) return false;
  switch (cfg.type) {
    case 'email-search':  return Array.isArray(cond.value) && cond.value.length > 0;
    case 'multi-select':  return Array.isArray(cond.value) && cond.value.length > 0;
    case 'single-select': return !!cond.value;
    case 'boolean':       return cond.value === true || cond.value === false;
    case 'text':          return typeof cond.value === 'string' && cond.value.trim().length > 0;
    case 'date-range':    return Array.isArray(cond.value) && !!(cond.value[0] || cond.value[1]);
    case 'number-range':
      if (cond.operator === 'between') return Array.isArray(cond.value) && (cond.value[0] !== '' || cond.value[1] !== '');
      return cond.value !== '' && cond.value != null;
    default: return false;
  }
}

function isConditionValid(cond) {
  if (cond.type === 'gtm') return !!cond.gtmEvent;
  if (cond.type === 'contact') return isFieldValid(cond);
  return false;
}

const emptyCondition = () => ({
  type: '',
  field: '',
  operator: '',
  value: null,
  gtmEvent: '',
  exclude: false,
  joinOp: 'AND',
});

export default function CreateSegmentModal({ onClose, onCreated, segment = null, onUpdated }) {
  const isEditMode = !!segment;
  const [name, setName] = useState(segment?.name || '');
  const [description, setDescription] = useState(segment?.description || '');
  const [conditions, setConditions] = useState(() => {
    if (segment?.conditions?.length > 0) {
      return segment.conditions.map(c => ({
        type: c.type || (c.gtmEvent ? 'gtm' : c.field ? 'contact' : ''),
        field: c.field || '',
        operator: c.operator || '',
        value: c.value ?? null,
        gtmEvent: c.gtmEvent || '',
        exclude: c.exclude || false,
        joinOp: c.joinOp || 'AND',
      }));
    }
    return [emptyCondition()];
  });
  const [previewCount, setPreviewCount] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gtmEventNames, setGtmEventNames] = useState([]);

  useEffect(() => {
    getGTMAnalytics().then(res => {
      const names = (res?.top_events || []).map(e => e.event_name).filter(Boolean);
      setGtmEventNames(names);
    }).catch(() => {});
  }, []);

  const updateCondition = (idx, updated) => {
    const next = [...conditions];
    next[idx] = updated;
    setConditions(next);
  };

  const changeType = (idx, type) => {
    const cond = conditions[idx];
    updateCondition(idx, { ...emptyCondition(), type, exclude: cond.exclude, joinOp: cond.joinOp });
  };

  const changeField = (idx, newField) => {
    if (!newField) { updateCondition(idx, { ...conditions[idx], field: '', operator: '', value: null }); return; }
    const cfg = FIELD_CONFIG[newField];
    const defaultValue = cfg?.type === 'multi-select' ? [] :
      cfg?.type === 'email-search' ? [] :
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

  const removeCondition = (idx) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  const addCondition = () => {
    setConditions([...conditions, emptyCondition()]);
  };

  const validConditions = conditions.filter(isConditionValid);

  const refreshPreview = useCallback(async (conds) => {
    if (!conds.length) { setPreviewCount(null); return; }
    setPreviewLoading(true);
    try {
      const res = await previewSegmentCount(conds);
      setPreviewCount(res.count);
    } catch (err) {
      console.error('Preview count failed:', err);
      setPreviewCount(null);
    }
    setPreviewLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (validConditions.length > 0) refreshPreview(validConditions);
      else setPreviewCount(null);
    }, 600);
    return () => clearTimeout(timer);
  }, [conditions, refreshPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!name.trim() || validConditions.length === 0) return;
    setSaving(true);
    try {
      if (isEditMode) {
        await updateCustomSegment(segment.id, {
          name: name.trim(),
          description: description.trim() || null,
          conditions: validConditions,
        });
        onUpdated?.();
      } else {
        await createCustomSegment({
          name: name.trim(),
          description: description.trim() || null,
          conditions: validConditions,
        });
        onCreated?.();
      }
      onClose();
    } catch (err) {
      console.error(`Failed to ${isEditMode ? 'update' : 'create'} segment:`, err);
    }
    setSaving(false);
  };

  // Fields and GTM events already chosen in other rows (for disabling duplicates)
  const usedFields = new Set(conditions.map(c => c.type === 'contact' ? c.field : '').filter(Boolean));
  const usedGtmEvents = new Set(conditions.map(c => c.type === 'gtm' ? c.gtmEvent : '').filter(Boolean));

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--card)', borderRadius: 'var(--radius-xl)', padding: '24px 28px',
          width: 620, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto',
          border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: 'rgba(59,130,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Filter size={18} style={{ color: '#3b82f6' }} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{isEditMode ? 'Edit Segment' : 'Create Custom Segment'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{isEditMode ? 'Modify conditions and details' : 'Define conditions to group contacts'}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Name & Description */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: 4, display: 'block' }}>Segment Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. High-Value Local Travelers"
              style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: 4, display: 'block' }}>Description</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
              style={inputStyle} />
          </div>
        </div>

        {/* Conditions */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Conditions
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {conditions.map((cond, idx) => (
              <div key={idx}>
                {/* Per-pair AND / OR segmented toggle */}
                {idx > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <div style={{
                      display: 'flex', borderRadius: 20, overflow: 'hidden',
                      border: '1px solid var(--border)',
                      background: 'var(--background)',
                    }}>
                      {['AND', 'OR'].map(op => {
                        const active = conditions[idx - 1].joinOp === op;
                        const color = op === 'OR' ? '#3b82f6' : '#8b5cf6';
                        return (
                          <button
                            key={op}
                            type="button"
                            onClick={() => updateCondition(idx - 1, { ...conditions[idx - 1], joinOp: op })}
                            style={{
                              padding: '4px 14px', fontSize: 10, fontWeight: 700,
                              letterSpacing: '0.5px', cursor: 'pointer', border: 'none',
                              background: active ? color : 'transparent',
                              color: active ? '#fff' : 'var(--muted-foreground)',
                              transition: 'all 0.15s',
                            }}>
                            {op}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                )}

                {/* Condition card */}
                <div style={{
                  background: 'var(--background)', borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)', overflow: 'hidden',
                }}>
                  <div style={{ padding: '12px 14px' }}>

                    {/* ── No type selected yet — show type picker ── */}
                    {!cond.type && (
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 8 }}>
                          Select condition type:
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" onClick={() => changeType(idx, 'contact')}
                            style={{
                              flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 500,
                              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                              cursor: 'pointer', background: 'var(--card)', color: 'var(--foreground)',
                              transition: 'all 0.15s', textAlign: 'left',
                            }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Contact Property</div>
                            <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Filter by profile fields</div>
                          </button>
                          <button type="button" onClick={() => changeType(idx, 'gtm')}
                            style={{
                              flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 500,
                              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                              cursor: 'pointer', background: 'var(--card)', color: 'var(--foreground)',
                              transition: 'all 0.15s', textAlign: 'left',
                            }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>GTM / Analytics Event</div>
                            <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Filter by tracked events</div>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Contact Property ── */}
                    {cond.type === 'contact' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Property</span>
                          <button type="button" onClick={() => changeType(idx, '')}
                            title="Change type"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', lineHeight: 1, fontSize: 14, padding: '0 2px' }}>
                            ✕
                          </button>
                        </div>
                        <select
                          value={cond.field || ''}
                          onChange={e => changeField(idx, e.target.value)}
                          style={{ ...selectStyle, marginBottom: cond.field ? 10 : 0 }}>
                          <option value="">Select a property...</option>
                          {FIELD_KEYS.map(key => {
                            const taken = usedFields.has(key) && cond.field !== key;
                            return (
                              <option key={key} value={key} disabled={taken}>
                                {FIELD_CONFIG[key].label}{taken ? ' (already used)' : ''}
                              </option>
                            );
                          })}
                        </select>
                        {cond.field && (
                          <ConditionValueInput
                            fieldKey={cond.field}
                            condition={cond}
                            onChange={updated => updateCondition(idx, updated)}
                          />
                        )}
                      </div>
                    )}

                    {/* ── GTM / Analytics Event ── */}
                    {cond.type === 'gtm' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>GTM / Analytics Event</span>
                          <button type="button" onClick={() => changeType(idx, '')}
                            title="Change type"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', lineHeight: 1, fontSize: 14, padding: '0 2px' }}>
                            ✕
                          </button>
                        </div>
                        <select
                          value={cond.gtmEvent || ''}
                          onChange={e => updateCondition(idx, { ...cond, gtmEvent: e.target.value })}
                          style={selectStyle}>
                          <option value="">Select an event...</option>
                          {gtmEventNames.map(evtName => {
                            const taken = usedGtmEvents.has(evtName) && cond.gtmEvent !== evtName;
                            return (
                              <option key={evtName} value={evtName} disabled={taken}>
                                {evtName}{taken ? ' (already used)' : ''}
                              </option>
                            );
                          })}
                        </select>
                        {cond.gtmEvent && (
                          <div style={{ marginTop: 8 }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '3px 9px', fontSize: 11, borderRadius: 20,
                              background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
                              border: '1px solid rgba(59,130,246,0.3)',
                            }}>
                              {cond.gtmEvent}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bottom bar — only shown when type is selected or Remove is needed */}
                  {(cond.type || conditions.length > 1) && (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 12px', borderTop: '1px solid var(--border)',
                      background: 'var(--card)',
                    }}>
                      {cond.type ? (
                        <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                          {[{ label: 'Include', val: false }, { label: 'Exclude', val: true }].map(({ label, val }) => {
                            const active = !!cond.exclude === val;
                            return (
                              <button key={label} type="button"
                                onClick={() => updateCondition(idx, { ...cond, exclude: val })}
                                style={{
                                  padding: '4px 14px', fontSize: 11, fontWeight: active ? 600 : 400,
                                  cursor: 'pointer', border: 'none',
                                  background: active ? (val ? '#ef4444' : '#22c55e') : 'transparent',
                                  color: active ? '#fff' : 'var(--muted-foreground)',
                                  transition: 'all 0.15s',
                                }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      ) : <div />}

                      {conditions.length > 1 && (
                        <button onClick={() => removeCondition(idx)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: '2px 4px', fontSize: 11 }}>
                          <Trash2 size={12} /> Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add condition button */}
          <button onClick={addCondition}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              marginTop: 10, width: '100%',
              padding: '9px 16px', fontSize: 12, fontWeight: 500,
              color: 'var(--primary)',
              background: 'rgba(59,130,246,0.05)',
              border: '1.5px dashed rgba(59,130,246,0.35)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.6)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.05)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.35)'; }}>
            <Plus size={14} /> Add Condition
          </button>
        </div>

        {/* Preview */}
        <div style={{
          padding: '14px 16px', background: 'var(--background)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={16} style={{ color: 'var(--muted-foreground)' }} />
            <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Matching contacts:</span>
            {previewLoading ? (
              <Loader2 size={16} className="spin" style={{ color: 'var(--primary)' }} />
            ) : previewCount != null ? (
              <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--primary)' }}>
                {previewCount.toLocaleString()}
              </span>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--muted-foreground)', fontStyle: 'italic' }}>
                Add conditions to see count
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose}
            style={{
              padding: '8px 20px', fontSize: 13, background: 'var(--secondary)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              cursor: 'pointer', color: 'var(--foreground)',
            }}>
            Cancel
          </button>
          <button onClick={handleSave}
            disabled={saving || !name.trim() || validConditions.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 20px', fontSize: 13, fontWeight: 500,
              background: 'var(--primary)', color: 'var(--primary-foreground)',
              border: 'none', borderRadius: 'var(--radius)',
              cursor: (saving || !name.trim() || validConditions.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (saving || !name.trim() || validConditions.length === 0) ? 0.6 : 1,
            }}>
            {saving && <Loader2 size={14} className="spin" />}
            {saving ? (isEditMode ? 'Saving...' : 'Creating...') : (isEditMode ? 'Save Changes' : 'Create Segment')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
