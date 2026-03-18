import { useState, useEffect } from 'react';
import { getCoupons, validateCoupon, createCoupon, updateCoupon, deleteCoupon } from '../api';
import { Ticket, Check, X, Plus, Tag, Pencil, Trash2 } from 'lucide-react';

const EMPTY_FORM = { code: '', description: '', discountType: 'percentage', discountValue: 10, minOrderValue: 100, maxDiscount: 500, validUntil: '2026-12-31', usageLimit: 1000 };

const FORM_FIELDS = [
  { label: 'Code', key: 'code', placeholder: 'SUMMER20' },
  { label: 'Description', key: 'description', placeholder: 'Summer 20% off' },
  { label: 'Type', key: 'discountType', type: 'select', options: ['percentage', 'fixed'] },
  { label: 'Discount Value', key: 'discountValue', type: 'number' },
  { label: 'Min Order (AED)', key: 'minOrderValue', type: 'number' },
  { label: 'Max Discount (AED)', key: 'maxDiscount', type: 'number' },
  { label: 'Valid Until', key: 'validUntil', type: 'date' },
  { label: 'Usage Limit', key: 'usageLimit', type: 'number' },
];

export default function Coupons() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [validateCode, setValidateCode] = useState('');
  const [validateResult, setValidateResult] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setCoupons(await getCoupons()); } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function handleValidate() {
    try {
      const result = await validateCoupon({ code: validateCode, orderValue: 500 });
      setValidateResult(result);
    } catch (err) { setValidateResult({ valid: false, reason: err.message }); }
  }

  async function handleCreate() {
    try {
      await createCoupon(form);
      setShowCreate(false);
      setForm({ ...EMPTY_FORM });
      load();
    } catch (err) { console.error(err); }
  }

  function startEdit(c) {
    setEditingId(c.coupon_id);
    setForm({
      code: c.code,
      description: c.description || '',
      discountType: c.discount_type,
      discountValue: parseFloat(c.discount_value),
      minOrderValue: parseFloat(c.min_order_value),
      maxDiscount: parseFloat(c.max_discount || 0),
      validUntil: c.valid_until ? c.valid_until.split('T')[0] : '',
      usageLimit: c.usage_limit || '',
    });
    setShowCreate(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  }

  async function handleUpdate() {
    try {
      await updateCoupon(editingId, form);
      setEditingId(null);
      setForm({ ...EMPTY_FORM });
      load();
    } catch (err) { console.error(err); }
  }

  async function handleDelete(id) {
    try {
      await deleteCoupon(id);
      setConfirmDelete(null);
      load();
    } catch (err) { console.error(err); }
  }

  if (loading) return <div className="spinner">Loading Coupons...</div>;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Coupon System</h1>
          <p style={{ color: '#78716c', margin: '4px 0 0' }}>Manage discount codes across segments and channels</p>
        </div>
        <button onClick={() => { setShowCreate(!showCreate); setEditingId(null); setForm({ ...EMPTY_FORM }); }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          <Plus size={16} /> Create Coupon
        </button>
      </div>

      {/* Coupon Validator */}
      <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4', marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}><Tag size={18} /> Validate Coupon</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <input value={validateCode} onChange={e => setValidateCode(e.target.value.toUpperCase())}
            placeholder="Enter coupon code (e.g. RAYNOW)"
            style={{ flex: 1, padding: '10px 14px', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 14, fontFamily: 'monospace', letterSpacing: 2 }} />
          <button onClick={handleValidate}
            style={{ padding: '10px 24px', background: '#22c55e', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            Validate
          </button>
        </div>
        {validateResult && (
          <div style={{ marginTop: 12, padding: 16, borderRadius: 8, background: validateResult.valid ? '#f0fdf4' : '#fef2f2', border: `1px solid ${validateResult.valid ? '#bbf7d0' : '#fecaca'}` }}>
            {validateResult.valid ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Check size={18} color="#22c55e" />
                <span style={{ color: '#166534', fontWeight: 600 }}>Valid! Discount: AED {parseFloat(validateResult.discount_amount || 0).toFixed(2)}</span>
                <span style={{ color: '#78716c', marginLeft: 8, fontSize: 13 }}>({validateResult.coupon?.discount_value}% off)</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <X size={18} color="#ef4444" />
                <span style={{ color: '#991b1b', fontWeight: 600 }}>{validateResult.reason}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create / Edit Coupon Form */}
      {(showCreate || editingId) && (
        <div style={{ background: 'white', borderRadius: 12, padding: 24, border: `1px solid ${editingId ? '#fbbf24' : '#e7e5e4'}`, marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 16px' }}>{editingId ? 'Edit Coupon' : 'Create New Coupon'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
            {FORM_FIELDS.map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#78716c', display: 'block', marginBottom: 4 }}>{f.label}</label>
                {f.type === 'select' ? (
                  <select value={form[f.key]} onChange={e => setForm({...form, [f.key]: e.target.value})}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #e7e5e4', borderRadius: 6 }}>
                    {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type || 'text'} value={form[f.key]} onChange={e => setForm({...form, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value.toUpperCase()})}
                    placeholder={f.placeholder} style={{ width: '100%', padding: '8px 12px', border: '1px solid #e7e5e4', borderRadius: 6, fontSize: 13 }} />
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {editingId ? (
              <>
                <button onClick={handleUpdate} style={{ padding: '10px 24px', background: '#fbbf24', color: '#1c1917', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                  Save Changes
                </button>
                <button onClick={cancelEdit} style={{ padding: '10px 24px', background: '#f5f5f4', color: '#78716c', border: '1px solid #e7e5e4', borderRadius: 8, cursor: 'pointer' }}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={handleCreate} style={{ padding: '10px 24px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                Create Coupon
              </button>
            )}
          </div>
        </div>
      )}

      {/* Coupon Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {coupons.map(c => (
          <div key={c.coupon_id} style={{ background: 'white', borderRadius: 12, padding: 20, border: `1px solid ${editingId === c.coupon_id ? '#fbbf24' : '#e7e5e4'}`, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, padding: '4px 12px', borderRadius: '0 0 0 12px', background: c.is_active && c.currently_valid !== false ? '#22c55e' : '#ef4444', color: 'white', fontSize: 11, fontWeight: 600 }}>
              {c.is_active && c.currently_valid !== false ? 'Active' : 'Inactive'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Ticket size={24} color="#dc2626" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 2 }}>{c.code}</div>
                <div style={{ fontSize: 12, color: '#78716c' }}>{c.description?.substring(0, 60)}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              <div><span style={{ color: '#78716c' }}>Discount:</span> <b>{c.discount_type === 'percentage' ? `${c.discount_value}%` : `AED ${c.discount_value}`}</b></div>
              <div><span style={{ color: '#78716c' }}>Min Order:</span> AED {c.min_order_value}</div>
              <div><span style={{ color: '#78716c' }}>Used:</span> {c.used_count}{c.usage_limit ? ` / ${c.usage_limit}` : ''}</div>
              <div><span style={{ color: '#78716c' }}>Remaining:</span> {c.remaining_uses != null ? c.remaining_uses : 'Unlimited'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#78716c' }}>Valid Until:</span> {c.valid_until ? new Date(c.valid_until).toLocaleDateString() : 'No expiry'}</div>
              {c.segment_labels?.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: '#78716c' }}>Segments:</span>{' '}
                  <span style={{ fontSize: 11 }}>{c.segment_labels.slice(0, 8).join(', ')}{c.segment_labels.length > 8 ? ` +${c.segment_labels.length - 8} more` : ''}</span>
                </div>
              )}
            </div>

            {/* Edit / Delete buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f5f5f4' }}>
              <button onClick={() => startEdit(c)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', background: '#fefce8', color: '#a16207', border: '1px solid #fef9c3', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <Pencil size={13} /> Edit
              </button>
              <button onClick={() => setConfirmDelete(c.coupon_id)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setConfirmDelete(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 28, width: '90%', maxWidth: 400, textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}>
            <Trash2 size={32} color="#dc2626" style={{ marginBottom: 12 }} />
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Delete Coupon?</h3>
            <p style={{ color: '#78716c', fontSize: 14, marginBottom: 24 }}>
              This will permanently delete the coupon <b>{coupons.find(c => c.coupon_id === confirmDelete)?.code}</b> and all its usage history.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setConfirmDelete(null)}
                style={{ padding: '10px 24px', background: '#f5f5f4', color: '#78716c', border: '1px solid #e7e5e4', borderRadius: 8, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => handleDelete(confirmDelete)}
                style={{ padding: '10px 24px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
