'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, Trash2, Pencil, Search, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import { getCustomSegments, deleteCustomSegment, updateCustomSegment } from '@/lib/api';
import CreateSegmentModal from '../CreateSegmentModal';
import { PageHeader, Button, Input, Chip, Table, EmptyState, Skeleton, ConfirmDialog } from '@/components/ui';
import s from '@/components/ui/Segment.module.css';
import type { CustomSegment } from '@/types/f7segments';
import type { Id } from '@/types/api';

const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`;

export default function AllSegmentsPage() {
  const router = useRouter();

  const [segments, setSegments] = useState<CustomSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSegment, setEditingSegment] = useState<CustomSegment | null>(null);
  const [deletingId, setDeletingId] = useState<Id | null>(null);
  const [togglingId, setTogglingId] = useState<Id | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CustomSegment | null>(null);

  const loadSegments = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await getCustomSegments(params) as { data?: CustomSegment[] };
      setSegments(res.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load segments');
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { loadSegments(); }, [loadSegments]);

  const q = searchQuery.toLowerCase();
  const filtered = segments.filter(seg =>
    (seg.name ?? '').toLowerCase().includes(q) || (seg.description || '').toLowerCase().includes(q)
  );

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm.id;
    setDeletingId(id);
    setDeleteConfirm(null);
    try {
      await deleteCustomSegment(id);
      toast.success('Segment deleted');
      loadSegments();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete segment');
    }
    setDeletingId(null);
  };
  const cancelDelete = useCallback(() => setDeleteConfirm(null), []);

  const handleToggleStatus = async (seg: CustomSegment) => {
    const newStatus = seg.status === 'active' ? 'draft' : 'active';
    setTogglingId(seg.id);
    try {
      await updateCustomSegment(seg.id, { status: newStatus });
      toast.success(`Segment ${newStatus === 'active' ? 'activated' : 'set to draft'}`);
      loadSegments();
    } catch (err) {
      console.error(err);
      toast.error('Failed to update status');
    }
    setTogglingId(null);
  };

  const allCount = segments.length;
  const tabs = [
    { key: 'all', label: 'All', count: allCount },
    { key: 'active', label: 'Active', count: segments.filter(x => x.status === 'active').length },
    { key: 'draft', label: 'Draft', count: segments.filter(x => x.status === 'draft').length },
  ];
  const open = (seg: CustomSegment) => router.push(`/segmentation/custom/${seg.id}`);

  return (
    <div className={s.page}>
      <PageHeader
        breadcrumbs={[{ label: 'Audience' }, { label: 'Segments', href: '/segmentation' }, { label: 'All segments' }]}
        title="All segments"
        description={loading ? 'Loading...' : plural(allCount, 'segment')}
        actions={<Button variant="primary" onClick={() => setShowCreateModal(true)}><Plus size={16} aria-hidden="true" />Create segment</Button>}
      />

      <div className={s.toolbar}>
        <div className={s.search} style={{ position: 'relative' }}>
          <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)' }} />
          <Input aria-label="Search segments" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search segments..." style={{ paddingLeft: 34 }} />
        </div>
        <div className={s.pills} role="group" aria-label="Status">
          {tabs.map(tab => (
            <button key={tab.key} type="button" className={s.pill} aria-pressed={statusFilter === tab.key} onClick={() => setStatusFilter(tab.key)}>
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className={s.card}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}</div>
      ) : filtered.length > 0 ? (
        <>
          <Table label="Custom segments" style={{ minWidth: 860 }}>
            <thead>
              <tr><th>Segment</th><th>Kind</th><th className={s.r}>Contacts</th><th>Created</th><th>Status</th><th><span className={s.srOnly}>Actions</span></th></tr>
            </thead>
            <tbody>
              {filtered.map(seg => {
                const conds = seg.conditions || [];
                return (
                  <tr key={seg.id} className={s.clickRow} onClick={() => open(seg)}>
                    <td style={{ maxWidth: 380 }}>
                      <button type="button" className={s.nameBtn} onClick={e => { e.stopPropagation(); open(seg); }}>{seg.name}</button>
                      {seg.description && <div className={s.help}>{seg.description}</div>}
                      <div className={s.tags}>
                        {conds.slice(0, 3).map((c, i) => <span key={i} className={s.tag}>{c.field?.replace(/_/g, ' ')}</span>)}
                        {conds.length > 3 && <span className={s.help}>+{conds.length - 3} more</span>}
                      </div>
                    </td>
                    <td><Chip tone="gold">Custom</Chip></td>
                    <td className={`${s.r} ${s.num}`} style={{ fontWeight: 600 }}>
                      {(seg.cached_count || 0).toLocaleString()}
                      <div className={s.help} style={{ fontWeight: 400 }}>{plural(conds.length, 'rule')}</div>
                    </td>
                    <td className={s.help}>{new Date(seg.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td>{seg.status === 'draft' ? <Chip tone="mute" dot>Draft</Chip> : <Chip tone="ok" dot>Active</Chip>}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className={s.actions}>
                        <Button variant="ghost" size="sm" icon disabled={togglingId === seg.id} onClick={() => handleToggleStatus(seg)}
                          title={seg.status === 'active' ? 'Set to Draft' : 'Activate'} aria-label={seg.status === 'active' ? `Set ${seg.name} to draft` : `Activate ${seg.name}`}>
                          {togglingId === seg.id ? <Loader2 size={14} className="spin" /> : seg.status === 'active' ? <ToggleRight size={16} style={{ color: 'var(--ok)' }} /> : <ToggleLeft size={16} />}
                        </Button>
                        <Button variant="ghost" size="sm" icon title="Edit" aria-label={`Edit ${seg.name}`} onClick={() => setEditingSegment(seg)}><Pencil size={14} /></Button>
                        <Button variant="ghost" size="sm" icon title="Delete" aria-label={`Delete ${seg.name}`} disabled={deletingId === seg.id} onClick={() => setDeleteConfirm(seg)}>
                          {deletingId === seg.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} style={{ color: 'var(--bad)' }} />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <span className={s.help}>Draft segments can&apos;t be used in journeys or sends until they are made active.</span>
        </>
      ) : (
        <div className={s.card}>
          <EmptyState
            title={searchQuery ? 'No segments match your search' : 'No custom segments yet'}
            description={searchQuery ? 'Try a different search term' : 'Create your first segment to get started'}
            action={!searchQuery ? <Button variant="primary" onClick={() => setShowCreateModal(true)}><Plus size={16} aria-hidden="true" />Create segment</Button> : undefined}
          />
        </div>
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        danger
        title="Delete segment?"
        confirmLabel="Delete"
        description={deleteConfirm ? (
          <p><b>{deleteConfirm.name}</b><br />{plural(deleteConfirm.conditions?.length || 0, 'condition')} · {(deleteConfirm.cached_count || 0).toLocaleString()} contacts. This can&apos;t be undone.</p>
        ) : undefined}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

      {(showCreateModal || editingSegment) && (
        <CreateSegmentModal
          segment={editingSegment}
          onClose={() => { setShowCreateModal(false); setEditingSegment(null); }}
          onCreated={() => { toast.success('Segment created'); loadSegments(); }}
          onUpdated={() => { toast.success('Segment updated'); loadSegments(); }}
        />
      )}
    </div>
  );
}
