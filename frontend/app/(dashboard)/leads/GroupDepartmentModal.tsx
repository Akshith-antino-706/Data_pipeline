'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import { getDepartments, createDepartmentGroup, updateDepartmentGroup } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Chip } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/States';
import styles from './leads.module.css';

/**
 * Add / Edit a Department Group.
 *   - group name input
 *   - multiselect department list
 *   - a department already assigned to ANOTHER group is DISABLED (one dept → one group).
 *     When editing, that group's own departments stay selectable.
 */
interface Department { receiver: string | number; name?: string; assigned?: boolean; group_id?: string | number | null; group_name?: string }
interface EditGroup { id?: string | number; name?: string; departments?: { receiver: string | number }[] }
interface GroupDepartmentModalProps { open: boolean; onClose?: () => void; onSaved?: () => void; editGroup?: EditGroup | null }

export default function GroupDepartmentModal({ open, onClose, onSaved, editGroup = null }: GroupDepartmentModalProps) {
  const [name, setName] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // receivers
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSearch('');
    setName(editGroup?.name || '');
    setSelected(new Set((editGroup?.departments || []).map((d) => String(d.receiver))));
    setLoading(true);
    getDepartments()
      .then((res) => setDepartments((res as { departments?: Department[] }).departments || []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, editGroup]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const editId = editGroup?.id || null;
  // disabled only if assigned to a DIFFERENT group than the one being edited
  const isDisabled = (d: Department) => d.assigned && d.group_id !== editId;

  const toggle = (rec: string) => {
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
      setError((e as Error).message || 'Failed to save group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ui-dialog-backdrop" onClick={onClose}>
      <div className={`ui-dialog ${styles.modal}`} role="dialog" aria-modal="true" aria-labelledby="group-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 id="group-modal-title">{editId ? 'Edit' : 'Add'} Department Group</h2>
          <Button variant="ghost" icon size="sm" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </div>

        <div className={styles.modalBody}>
          <Field label="Group name" required>
            {(ctl) => <Input {...ctl} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. UAE Sales" />}
          </Field>

          <Field label={`Departments — ${selected.size} selected`}>
            {(ctl) => <Input {...ctl} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search departments…" />}
          </Field>

          {loading ? (
            <div aria-busy="true" aria-label="Loading departments" className={styles.modalList}>
              {[0, 1, 2, 3].map(i => <div key={i} className={styles.modalItem}><Skeleton width="60%" /></div>)}
            </div>
          ) : (
            <div className={styles.modalList}>
              {filtered.map((d) => {
                const rec = String(d.receiver);
                const disabled = isDisabled(d);
                const checked = selected.has(rec);
                return (
                  <label key={rec} title={disabled ? `Already in group: ${d.group_name ?? ''}` : ''}
                    className={styles.modalItem} data-checked={checked || undefined} data-disabled={disabled || undefined}>
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(rec)} className={styles.check} />
                    <span className={styles.modalItemText}>
                      <span className={styles.ellipsis}>{d.name || '(no name)'}</span>
                      <span className={styles.mono}>{rec}</span>
                    </span>
                    {disabled && <Chip tone="warn">in “{d.group_name}”</Chip>}
                  </label>
                );
              })}
              {!filtered.length && <div className={styles.emptyLine}>No departments found</div>}
            </div>
          )}

          {error && <p className="ui-err" role="alert">{error}</p>}
        </div>

        <div className="ui-dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={16} className={styles.spin} /> : <Check size={16} />}
            {editId ? 'Save' : 'Create'} Group
          </Button>
        </div>
      </div>
    </div>
  );
}
