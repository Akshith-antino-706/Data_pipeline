'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { getCustomSegments, deleteCustomSegment, updateCustomSegment } from '@/lib/api';
import CreateSegmentModal from '../CreateSegmentModal';
import {
  ArrowLeft, Plus, Filter, Trash2, Pencil, Search,
  Loader2, Calendar, ToggleLeft, ToggleRight, AlertTriangle,
} from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } };

export default function AllSegmentsPage() {
  const router = useRouter();

  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSegment, setEditingSegment] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // segment object to confirm delete

  const loadSegments = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await getCustomSegments(params);
      setSegments(res.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load segments');
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { loadSegments(); }, [loadSegments]);

  const filtered = segments.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDeleteClick = (seg, e) => {
    e.stopPropagation();
    setDeleteConfirm(seg);
  };

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

  const handleToggleStatus = async (seg, e) => {
    e.stopPropagation();
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
  const activeCount = segments.filter(s => s.status === 'active').length;
  const draftCount = segments.filter(s => s.status === 'draft').length;

  const tabs = [
    { key: 'all', label: 'All', count: allCount },
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'draft', label: 'Draft', count: draftCount },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <Link href="/segmentation" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted-foreground)', textDecoration: 'none' }}>
          <ArrowLeft size={14} /> Segmentation
        </Link>
        <span style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>All Segments</span>
      </div>

      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>All Segments</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
            {loading ? 'Loading...' : `${allCount} segment${allCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={() => setShowCreateModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px',
            background: 'var(--primary)', color: 'var(--primary-foreground)',
            border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
            fontSize: 13, fontWeight: 500,
          }}>
          <Plus size={14} /> Create Segment
        </button>
      </div>

      {/* Filter tabs + Search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
              style={{
                padding: '6px 16px', fontSize: 13, fontWeight: 500,
                borderRadius: 'var(--radius)', cursor: 'pointer',
                background: statusFilter === tab.key ? 'var(--primary)' : 'var(--card)',
                color: statusFilter === tab.key ? 'var(--primary-foreground)' : 'var(--foreground)',
                border: statusFilter === tab.key ? 'none' : '1px solid var(--border)',
                transition: 'all 0.2s',
              }}>
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search segments..."
            style={{
              width: '100%', padding: '8px 12px 8px 32px',
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', color: 'var(--foreground)',
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Segments Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={24} className="spin" />
        </div>
      ) : filtered.length > 0 ? (
        <motion.div variants={staggerContainer} initial="hidden" animate="visible"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {filtered.map(seg => (
            <motion.div key={seg.id} variants={fadeInUp}
              onClick={() => router.push(`/segmentation/custom/${seg.id}`)}
              style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xl)', padding: '18px 20px',
                cursor: 'pointer', transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              whileHover={{ borderColor: seg.color || '#3b82f6', boxShadow: `0 0 0 1px ${seg.color || '#3b82f6'}40` }}>

              {/* Top row: icon + name + actions */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 'var(--radius)', flexShrink: 0,
                  background: `${seg.color || '#3b82f6'}18`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Filter size={16} style={{ color: seg.color || '#3b82f6' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {seg.name}
                  </div>
                  {seg.description && (
                    <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {seg.description}
                    </div>
                  )}
                </div>
                {/* Status badge */}
                <span style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 600, flexShrink: 0,
                  background: seg.status === 'draft' ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
                  color: seg.status === 'draft' ? '#f59e0b' : '#22c55e',
                }}>
                  {seg.status === 'draft' ? 'Draft' : 'Active'}
                </span>
              </div>

              {/* Count + contacts */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: seg.color || '#3b82f6' }}>
                  {(seg.cached_count || 0).toLocaleString()}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>contacts</span>
              </div>

              {/* Condition tags */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                {(seg.conditions || []).slice(0, 3).map((c, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--secondary)', color: 'var(--muted-foreground)' }}>
                    {c.field?.replace(/_/g, ' ')}
                  </span>
                ))}
                {(seg.conditions || []).length > 3 && (
                  <span style={{ fontSize: 10, padding: '2px 6px', color: 'var(--muted-foreground)' }}>
                    +{seg.conditions.length - 3} more
                  </span>
                )}
              </div>

              {/* Footer: date + actions */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted-foreground)' }}>
                  <Calendar size={11} />
                  {new Date(seg.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
                <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button onClick={(e) => handleToggleStatus(seg, e)}
                    disabled={togglingId === seg.id}
                    style={{
                      width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--background)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', cursor: 'pointer',
                    }}
                    title={seg.status === 'active' ? 'Set to Draft' : 'Activate'}>
                    {togglingId === seg.id ? <Loader2 size={12} className="spin" /> :
                      seg.status === 'active' ? <ToggleRight size={13} style={{ color: '#22c55e' }} /> : <ToggleLeft size={13} style={{ color: '#f59e0b' }} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setEditingSegment(seg); }}
                    style={{
                      width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--background)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', cursor: 'pointer',
                    }}
                    title="Edit">
                    <Pencil size={12} style={{ color: 'var(--muted-foreground)' }} />
                  </button>
                  <button onClick={(e) => handleDeleteClick(seg, e)}
                    disabled={deletingId === seg.id}
                    style={{
                      width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--background)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', cursor: 'pointer',
                    }}
                    title="Delete">
                    {deletingId === seg.id ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} style={{ color: '#ef4444' }} />}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <div style={{
          textAlign: 'center', padding: 60,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
        }}>
          <Filter size={32} style={{ color: 'var(--muted-foreground)', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            {searchQuery ? 'No segments match your search' : 'No custom segments yet'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 16 }}>
            {searchQuery ? 'Try a different search term' : 'Create your first segment to get started'}
          </div>
          {!searchQuery && (
            <button onClick={() => setShowCreateModal(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 20px',
                background: 'var(--primary)', color: 'var(--primary-foreground)',
                border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
                fontSize: 13, fontWeight: 500,
              }}>
              <Plus size={14} /> Create Segment
            </button>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setDeleteConfirm(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--card)', borderRadius: 'var(--radius-xl)', padding: '28px 32px',
                width: 420, maxWidth: '90vw',
                border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 'var(--radius)',
                  background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <AlertTriangle size={20} style={{ color: '#ef4444' }} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Delete Segment</div>
                  <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>This action cannot be undone</div>
                </div>
              </div>

              <div style={{
                padding: '14px 16px', background: 'var(--background)', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', marginBottom: 20,
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{deleteConfirm.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                  {deleteConfirm.conditions?.length || 0} condition{(deleteConfirm.conditions?.length || 0) !== 1 ? 's' : ''}
                  {' · '}
                  {(deleteConfirm.cached_count || 0).toLocaleString()} contacts
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setDeleteConfirm(null)}
                  style={{
                    padding: '8px 20px', fontSize: 13,
                    background: 'var(--secondary)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--foreground)',
                  }}>
                  Cancel
                </button>
                <button onClick={confirmDelete}
                  style={{
                    padding: '8px 20px', fontSize: 13, fontWeight: 500,
                    background: '#ef4444', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
                  }}>
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {(showCreateModal || editingSegment) && (
          <CreateSegmentModal
            segment={editingSegment}
            onClose={() => { setShowCreateModal(false); setEditingSegment(null); }}
            onCreated={() => { toast.success('Segment created'); loadSegments(); }}
            onUpdated={() => { toast.success('Segment updated'); loadSegments(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
