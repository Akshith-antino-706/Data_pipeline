import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

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
    try { const res = await getCoupons(); setCoupons(Array.isArray(res) ? res : (res.data || [])); } catch (err) { console.error(err); }
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
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="p-24">
      <motion.div variants={fadeInUp} className="flex justify-between items-center mb-24">
        <div>
          <h1 className="font-bold mb-0" style={{ fontSize: 28 }}>Coupon System</h1>
          <p className="text-secondary mt-8 mb-0">Manage discount codes across segments and channels</p>
        </div>
        <button onClick={() => { setShowCreate(!showCreate); setEditingId(null); setForm({ ...EMPTY_FORM }); }}
          className="btn btn-danger btn-lg">
          <Plus size={16} /> Create Coupon
        </button>
      </motion.div>

      {/* Coupon Validator */}
      <motion.div variants={fadeInUp} className="card mb-24" style={{ padding: 24 }}>
        <h3 className="flex items-center gap-8 mb-16" style={{ margin: 0 }}><Tag size={18} /> Validate Coupon</h3>
        <div className="flex gap-12">
          <input value={validateCode} onChange={e => setValidateCode(e.target.value.toUpperCase())}
            placeholder="Enter coupon code (e.g. RAYNOW)"
            className="coupon-code"
            style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 14 }} />
          <button onClick={handleValidate} className="btn btn-success btn-lg">
            Validate
          </button>
        </div>
        {validateResult && (
          <div className={`alert mt-8 ${validateResult.valid ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 0 }}>
            {validateResult.valid ? (
              <div className="flex items-center gap-8">
                <Check size={18} style={{ color: 'var(--green)' }} />
                <span className="font-semibold">Valid! Discount: AED {parseFloat(validateResult.discount_amount || 0).toFixed(2)}</span>
                <span className="text-secondary" style={{ marginLeft: 8, fontSize: 13 }}>({validateResult.coupon?.discount_value}% off)</span>
              </div>
            ) : (
              <div className="flex items-center gap-8">
                <X size={18} style={{ color: 'var(--red)' }} />
                <span className="font-semibold">{validateResult.reason}</span>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* Create / Edit Coupon Form */}
      {(showCreate || editingId) && (
        <motion.div variants={fadeInUp} className="card mb-24" style={{ padding: 24, borderColor: editingId ? 'var(--yellow)' : undefined }}>
          <h3 style={{ margin: '0 0 16px' }}>{editingId ? 'Edit Coupon' : 'Create New Coupon'}</h3>
          <div className="mb-16" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {FORM_FIELDS.map(f => (
              <div key={f.key}>
                <label className="text-sm font-semibold text-secondary" style={{ display: 'block', marginBottom: 4 }}>{f.label}</label>
                {f.type === 'select' ? (
                  <select value={form[f.key]} onChange={e => setForm({...form, [f.key]: e.target.value})}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 6 }}>
                    {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type || 'text'} value={form[f.key]} onChange={e => setForm({...form, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value.toUpperCase()})}
                    placeholder={f.placeholder} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 13 }} />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-8">
            {editingId ? (
              <>
                <button onClick={handleUpdate} className="btn btn-lg font-semibold" style={{ background: 'var(--yellow)', color: 'var(--text-primary)' }}>
                  Save Changes
                </button>
                <button onClick={cancelEdit} className="btn btn-secondary btn-lg">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={handleCreate} className="btn btn-danger btn-lg">
                Create Coupon
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Coupon Grid */}
      <motion.div variants={fadeInUp} className="grid-auto">
        {coupons.map(c => (
          <div key={c.coupon_id} className="card" style={{ position: 'relative', overflow: 'hidden', borderColor: editingId === c.coupon_id ? 'var(--yellow)' : undefined }}>
            <span className={`badge text-xs font-semibold ${c.is_active && c.currently_valid !== false ? 'badge-green' : 'badge-red'}`}
              style={{ position: 'absolute', top: 0, right: 0, borderRadius: '0 0 0 12px' }}>
              {c.is_active && c.currently_valid !== false ? 'Active' : 'Inactive'}
            </span>
            <div className="flex items-center gap-12 mb-12">
              <Ticket size={24} color="var(--red)" />
              <div style={{ flex: 1 }}>
                <div className="coupon-code" style={{ fontSize: 20 }}>{c.code}</div>
                <div className="text-sm text-secondary">{c.description?.substring(0, 60)}</div>
              </div>
            </div>
            <div className="text-base" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><span className="text-secondary">Discount:</span> <b>{c.discount_type === 'percentage' ? `${c.discount_value}%` : `AED ${c.discount_value}`}</b></div>
              <div><span className="text-secondary">Min Order:</span> AED {c.min_order_value}</div>
              <div><span className="text-secondary">Used:</span> {c.used_count}{c.usage_limit ? ` / ${c.usage_limit}` : ''}</div>
              <div><span className="text-secondary">Remaining:</span> {c.remaining_uses != null ? c.remaining_uses : 'Unlimited'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span className="text-secondary">Valid Until:</span> {c.valid_until ? new Date(c.valid_until).toLocaleDateString() : 'No expiry'}</div>
              {(() => {
                const labels = Array.isArray(c.segment_labels) ? c.segment_labels : typeof c.segment_labels === 'string' ? c.segment_labels.replace(/[{}]/g, '').split(',').filter(Boolean) : [];
                return labels.length > 0 ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span className="text-secondary">Segments:</span>{' '}
                    <span className="text-xs">{labels.slice(0, 8).join(', ')}{labels.length > 8 ? ` +${labels.length - 8} more` : ''}</span>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Edit / Delete buttons */}
            <div className="flex gap-8" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bg-secondary)' }}>
              <button onClick={() => startEdit(c)} className="btn btn-sm badge-orange font-semibold" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--orange-dim)' }}>
                <Pencil size={13} /> Edit
              </button>
              <button onClick={() => setConfirmDelete(c.coupon_id)} className="btn btn-sm badge-red font-semibold" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--red-dim)' }}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', zIndex: 200 }}
          className="flex items-center justify-center"
          onClick={() => setConfirmDelete(null)}>
          <div className="card text-center" style={{ padding: 28, width: '90%', maxWidth: 400, boxShadow: '0 10px 40px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}>
            <Trash2 size={32} color="var(--red)" style={{ marginBottom: 12 }} />
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Delete Coupon?</h3>
            <p className="text-secondary" style={{ fontSize: 14, marginBottom: 24 }}>
              This will permanently delete the coupon <b>{coupons.find(c => c.coupon_id === confirmDelete)?.code}</b> and all its usage history.
            </p>
            <div className="flex gap-8 justify-center">
              <button onClick={() => setConfirmDelete(null)} className="btn btn-secondary btn-lg">
                Cancel
              </button>
              <button onClick={() => handleDelete(confirmDelete)} className="btn btn-danger btn-lg font-semibold">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
