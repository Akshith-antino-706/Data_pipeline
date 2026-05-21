'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Trash2, Filter, Loader2, Users } from 'lucide-react';
import { previewSegmentCount, createCustomSegment, updateCustomSegment, getGTMAnalytics } from '@/lib/api';

const FIELD_CONFIG = {
  name: {
    label: 'Contact Name', type: 'text',
    placeholder: 'e.g. John, Ahmed',
    defaultOperator: 'contains',
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

function ConditionValueInput({ fieldKey, condition, onChange }) {
  const cfg = FIELD_CONFIG[fieldKey];
  if (!cfg) return null;

  switch (cfg.type) {
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

function isConditionValid(cond) {
  const hasGtm = Array.isArray(cond.gtmEvents) && cond.gtmEvents.length > 0;
  if (hasGtm) return true;

  if (!cond.field) return false;
  const cfg = FIELD_CONFIG[cond.field];
  if (!cfg) return false;

  switch (cfg.type) {
    case 'multi-select': return Array.isArray(cond.value) && cond.value.length > 0;
    case 'single-select': return !!cond.value;
    case 'boolean': return cond.value === true || cond.value === false;
    case 'text': return typeof cond.value === 'string' && cond.value.trim().length > 0;
    case 'date-range': return Array.isArray(cond.value) && (cond.value[0] || cond.value[1]);
    case 'number-range': {
      if (cond.operator === 'between') return Array.isArray(cond.value) && (cond.value[0] !== '' || cond.value[1] !== '');
      return cond.value !== '' && cond.value != null;
    }
    default: return false;
  }
}

export default function CreateSegmentModal({ onClose, onCreated, segment = null, onUpdated }) {
  const isEditMode = !!segment;
  const [name, setName] = useState(segment?.name || '');
  const [description, setDescription] = useState(segment?.description || '');
  const [conditions, setConditions] = useState(
    segment?.conditions?.length > 0
      ? segment.conditions.map(c => ({ ...c }))
      : [{ field: '', operator: '', value: null }]
  );
  const [operator, setOperator] = useState(segment?.operator || 'OR');
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

  const changeField = (idx, newField) => {
    const cfg = FIELD_CONFIG[newField];
    const defaultValue = cfg?.type === 'multi-select' ? [] :
      cfg?.type === 'date-range' ? ['', ''] :
      cfg?.type === 'number-range' ? ['', ''] :
      cfg?.type === 'boolean' ? null : '';
    updateCondition(idx, {
      field: newField,
      operator: cfg?.defaultOperator || 'eq',
      value: defaultValue,
      gtmEvents: conditions[idx]?.gtmEvents || [],
      exclude: conditions[idx]?.exclude || false,
    });
  };

  const toggleGtmEvent = (idx, eventName) => {
    const cond = conditions[idx];
    const current = cond.gtmEvents || [];
    const next = current.includes(eventName)
      ? current.filter(e => e !== eventName)
      : [...current, eventName];
    updateCondition(idx, { ...cond, gtmEvents: next });
  };

  const removeCondition = (idx) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  const addCondition = () => {
    setConditions([...conditions, { field: '', operator: '', value: null, gtmEvents: [], exclude: false }]);
  };

  const validConditions = conditions.filter(isConditionValid);

  // Debounced preview count
  const refreshPreview = useCallback(async (conds, op) => {
    if (!conds.length) { setPreviewCount(null); return; }
    setPreviewLoading(true);
    try {
      const res = await previewSegmentCount(conds, op);
      setPreviewCount(res.count);
    } catch (err) {
      console.error('Preview count failed:', err);
      setPreviewCount(null);
    }
    setPreviewLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (validConditions.length > 0) refreshPreview(validConditions, operator);
      else setPreviewCount(null);
    }, 600);
    return () => clearTimeout(timer);
  }, [conditions, operator, refreshPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!name.trim() || validConditions.length === 0) return;
    setSaving(true);
    try {
      if (isEditMode) {
        await updateCustomSegment(segment.id, {
          name: name.trim(),
          description: description.trim() || null,
          conditions: validConditions,
          operator,
        });
        onUpdated?.();
      } else {
        await createCustomSegment({
          name: name.trim(),
          description: description.trim() || null,
          conditions: validConditions,
          operator,
        });
        onCreated?.();
      }
      onClose();
    } catch (err) {
      console.error(`Failed to ${isEditMode ? 'update' : 'create'} segment:`, err);
    }
    setSaving(false);
  };

  // Determine which fields are already used
  const usedFields = new Set(conditions.map(c => c.field).filter(Boolean));

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
          width: 720, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto',
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Conditions ({operator === 'OR' ? 'any must match' : 'all must match'})
            </div>
            {/* AND / OR toggle */}
            <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              {['AND', 'OR'].map(op => (
                <button key={op} type="button" onClick={() => setOperator(op)}
                  style={{
                    padding: '4px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
                    background: operator === op ? (op === 'OR' ? '#3b82f6' : '#8b5cf6') : 'var(--background)',
                    color: operator === op ? '#fff' : 'var(--muted-foreground)',
                    transition: 'all 0.15s',
                  }}>
                  {op}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {conditions.map((cond, idx) => (
              <div key={idx}>
                {/* AND / OR separator badge between conditions */}
                {idx > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                      background: operator === 'OR' ? '#3b82f620' : '#8b5cf620',
                      color: operator === 'OR' ? '#3b82f6' : '#8b5cf6',
                      border: `1px solid ${operator === 'OR' ? '#3b82f640' : '#8b5cf640'}`,
                      letterSpacing: '0.5px',
                    }}>{operator}</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                )}
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px',
                  background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                }}>
                  {/* Top row: both dropdowns + include/exclude + remove */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>

                    {/* Dropdown 1 — contact property fields */}
                    <div style={{ minWidth: 155, flexShrink: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Contact Property</div>
                      <select
                        value={cond.field || ''}
                        onChange={e => changeField(idx, e.target.value)}
                        style={{ ...selectStyle, width: '100%' }}>
                        <option value="">Select field...</option>
                        {FIELD_KEYS.map(key => (
                          <option key={key} value={key} disabled={usedFields.has(key) && cond.field !== key}>
                            {FIELD_CONFIG[key].label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Dropdown 2 — GTM events (multi-select via chips) */}
                    <div style={{ minWidth: 155, flexShrink: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>GTM / Analytics Event</div>
                      <select
                        value=""
                        onChange={e => { if (e.target.value) toggleGtmEvent(idx, e.target.value); }}
                        style={{ ...selectStyle, width: '100%' }}>
                        <option value="">Select GTM event...</option>
                        {gtmEventNames.map(name => (
                          <option key={name} value={name} disabled={(cond.gtmEvents || []).includes(name)}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Include / Exclude toggle */}
                    {(cond.field || (cond.gtmEvents || []).length > 0) && (
                      <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)', minWidth: 130, flexShrink: 0, alignSelf: 'flex-end' }}>
                        {[{ label: 'Include', val: false }, { label: 'Exclude', val: true }].map(({ label, val }) => {
                          const active = !!cond.exclude === val;
                          return (
                            <button key={label} type="button"
                              onClick={() => updateCondition(idx, { ...cond, exclude: val })}
                              style={{
                                flex: 1, padding: '5px 8px', fontSize: 11, fontWeight: active ? 600 : 400,
                                cursor: 'pointer', border: 'none',
                                background: active ? (val ? '#ef4444' : '#22c55e') : 'var(--background)',
                                color: active ? '#fff' : 'var(--muted-foreground)',
                                transition: 'all 0.15s',
                              }}>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Remove button */}
                    {conditions.length > 1 && (
                      <button onClick={() => removeCondition(idx)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: 6, marginTop: 18, marginLeft: 'auto', flexShrink: 0 }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  {/* Bottom row: field value input + GTM event chips */}
                  {(cond.field || (cond.gtmEvents || []).length > 0) && (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                      {/* Field value input */}
                      {cond.field && (
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <ConditionValueInput fieldKey={cond.field} condition={cond}
                            onChange={updated => updateCondition(idx, updated)} />
                        </div>
                      )}

                      {/* GTM event chips */}
                      {(cond.gtmEvents || []).length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          {cond.field && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', padding: '2px 0' }}>OR</span>
                          )}
                          {(cond.gtmEvents || []).map(evt => (
                            <span key={evt} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '3px 8px 3px 10px', fontSize: 12, borderRadius: 20,
                              background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
                              border: '1px solid rgba(59,130,246,0.3)',
                            }}>
                              {evt}
                              <button type="button" onClick={() => toggleGtmEvent(idx, evt)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: '#3b82f6', fontSize: 14 }}>
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
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
              display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
              padding: '6px 12px', fontSize: 12, color: 'var(--primary)',
              background: 'none', border: '1px dashed var(--border)', borderRadius: 'var(--radius)',
              cursor: 'pointer', transition: 'border-color 0.2s',
            }}>
            <Plus size={13} /> Add Condition
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
