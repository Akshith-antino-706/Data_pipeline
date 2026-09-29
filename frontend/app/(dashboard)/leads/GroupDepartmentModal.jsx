'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import { getDepartments, createDepartmentGroup, updateDepartmentGroup } from '@/lib/api';

/**
 * Add / Edit a Department Group.
 *   - group name input
 *   - multiselect department list
 *   - a department already assigned to ANOTHER group is DISABLED (one dept → one group).
 *     When editing, that group's own departments stay selectable.
 */
export default function GroupDepartmentModal({ open, onClose, onSaved, editGroup = null }) {
  const [name, setName] = useState('');
  const [departments, setDepartments] = useState([]);
  const [selected, setSelected] = useState(new Set()); // receivers
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSearch('');
    setName(editGroup?.name || '');
    setSelected(new Set((editGroup?.departments || []).map((d) => String(d.receiver))));
    setLoading(true);
    getDepartments()
      .then((res) => setDepartments(res.departments || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, editGroup]);

  if (!open) return null;

  const editId = editGroup?.id || null;
  // disabled only if assigned to a DIFFERENT group than the one being edited
  const isDisabled = (d) => d.assigned && d.group_id !== editId;

  const toggle = (rec) => {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(rec) ? s.delete(rec) : s.add(rec);
      return s;
    });
  };

  const q = search.trim().toLowerCase();
  const filtered = departments.filter(
    (d) => !q || (d.name || '').toLowerCase().includes(q) || String(d.receiver).includes(q)
  );

  const save = async () => {
    if (!name.trim()) { setError('Group name is required'); return; }
    if (selected.size === 0) { setError('Select at least one department'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        name: name.trim(),
        departments: departments
          .filter((d) => selected.has(String(d.receiver)))
          .map((d) => ({ receiver: d.receiver, name: d.name })),
      };
      if (editId) await updateDepartmentGroup(editId, payload);
      else await createDepartmentGroup(payload);
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e.message || 'Failed to save group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', borderRadius: 12, width: '100%', maxWidth: 540, maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{editId ? 'Edit' : 'Add'} Department Group</h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Close"><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Group Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. UAE Sales"
            style={{ width: '100%', padding: '10px 12px', margin: '6px 0 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }} />

          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Departments — {selected.size} selected
          </label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search departments…"
            style={{ width: '100%', padding: '8px 12px', margin: '6px 0 10px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 13 }} />

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center' }}><Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} /></div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
              {filtered.map((d) => {
                const rec = String(d.receiver);
                const disabled = isDisabled(d);
                const checked = selected.has(rec);
                return (
                  <label key={rec} title={disabled ? `Already in group: ${d.group_name}` : ''}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderBottom: '1px solid var(--border-color)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, background: checked ? 'rgba(14,165,233,0.08)' : 'transparent' }}>
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(rec)}
                      style={{ width: 16, height: 16, flexShrink: 0, margin: 0, cursor: 'inherit', accentColor: 'var(--brand-primary)' }} />
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name || '(no name)'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{rec}</div>
                    </div>
                    {disabled && <span style={{ fontSize: 11, color: 'var(--orange)', whiteSpace: 'nowrap', flexShrink: 0 }}>in “{d.group_name}”</span>}
                  </label>
                );
              })}
              {!filtered.length && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No departments found</div>}
            </div>
          )}

          {error && <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border-color)' }}>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={16} />}
            {editId ? 'Save' : 'Create'} Group
          </button>
        </div>
      </div>
    </div>
  );
}
