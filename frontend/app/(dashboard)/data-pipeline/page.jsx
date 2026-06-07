'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getRaynaSyncStatus, getMappingStats, triggerRaynaSync, triggerRaynaSyncEndpoint, refreshBookingMapping } from '@/lib/api';
import { RefreshCw, Database, ArrowRightLeft, CheckCircle2, Clock, Loader2, Plane, Building2, Globe, MapPin, Phone, Mail, Users, MessageSquare } from 'lucide-react';
import { useBusinessType } from '@/context/BusinessTypeContext';

const SOURCE_ICONS = { tours: MapPin, hotels: Building2, visas: Globe, flights: Plane, packages: MapPin, others: Database };
const SOURCE_COLORS = { tours: 'var(--brand-primary)', hotels: 'var(--orange)', visas: 'var(--green)', flights: 'var(--red)', packages: 'var(--purple)', others: '#888' };

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

function formatDate(d) {
  if (!d) return '--';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatNum(n) {
  return (n || 0).toLocaleString();
}

function StatusBadge() {
  return (
    <span className="badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
      <CheckCircle2 size={13} /> Synced
    </span>
  );
}

// Mirrors the layout of the populated page so the user sees structural placeholders
// (header → KPI strip → data sources → breakdown → sync cards → cron jobs → mapping)
// while the data is being fetched, rather than a generic spinner.
function SkelBlock({ w = '100%', h = 16, r = 6, mb = 0, mt = 0, style }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, marginBottom: mb, marginTop: mt, ...style }} />;
}

function DataPipelineSkeleton() {
  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Header */}
      <div className="card-header" style={{ marginBottom: 28 }}>
        <div>
          <SkelBlock w={180} h={24} mb={8} />
          <SkelBlock w={260} h={14} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <SkelBlock w={100} h={36} r={8} />
          <SkelBlock w={120} h={36} r={8} />
        </div>
      </div>

      {/* KPI Row (5 cards) */}
      <div className="kpi-strip" style={{ marginBottom: 28 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 18px' }}>
            <SkelBlock w={42} h={42} r={10} />
            <div style={{ flex: 1 }}>
              <SkelBlock w={80} h={22} mb={6} />
              <SkelBlock w="70%" h={12} />
            </div>
          </div>
        ))}
      </div>

      {/* Data Sources Overview (11 mini cards) */}
      <div className="card" style={{ padding: 24, marginBottom: 28 }}>
        <SkelBlock w={180} h={18} mb={18} />
        <div className="kpi-strip">
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} className="card" style={{ padding: '16px 14px', textAlign: 'center' }}>
              <SkelBlock w={20} h={20} r={4} style={{ margin: '0 auto 6px' }} />
              <SkelBlock w={60} h={20} mb={6} style={{ margin: '0 auto 6px' }} />
              <SkelBlock w="80%" h={11} style={{ margin: '0 auto 4px' }} />
              <SkelBlock w="60%" h={10} style={{ margin: '0 auto' }} />
            </div>
          ))}
        </div>
      </div>

      {/* B2B vs B2C Breakdown */}
      <div className="card" style={{ padding: 24, marginBottom: 28 }}>
        <SkelBlock w={200} h={18} mb={16} />
        <div className="grid-auto">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card" style={{ padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <SkelBlock w={60} h={18} mb={6} />
                <SkelBlock w={100} h={11} />
              </div>
              <div style={{ display: 'flex', gap: 14 }}>
                <SkelBlock w={40} h={32} />
                <SkelBlock w={40} h={32} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sync Status: Rayna API + Chats (2 cards) */}
      <div className="card-grid card-grid-2" style={{ marginBottom: 28 }}>
        {Array.from({ length: 2 }).map((_, ci) => (
          <div key={ci} className="card" style={{ padding: 24 }}>
            <SkelBlock w={160} h={18} mb={18} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                    <SkelBlock w={18} h={18} r={4} />
                    <div style={{ flex: 1 }}>
                      <SkelBlock w={70} h={14} mb={4} />
                      <SkelBlock w="60%" h={11} />
                    </div>
                  </div>
                  <SkelBlock w={70} h={22} r={11} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Active Cron Jobs */}
      <div className="card" style={{ padding: 24, marginBottom: 28 }}>
        <SkelBlock w={180} h={18} mb={18} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <SkelBlock w={140} h={16} />
                <SkelBlock w={70} h={22} r={11} />
              </div>
              <SkelBlock w="80%" h={11} mb={6} />
              <SkelBlock w="60%" h={11} mb={6} />
              <SkelBlock w="45%" h={11} />
            </div>
          ))}
        </div>
      </div>

      {/* Booking ↔ Customer Mapping */}
      <div className="card" style={{ padding: 24, marginBottom: 28 }}>
        <div className="card-header" style={{ marginBottom: 20 }}>
          <div>
            <SkelBlock w={220} h={18} mb={6} />
            <SkelBlock w={300} h={13} />
          </div>
          <SkelBlock w={140} h={36} r={8} />
        </div>
        <div className="card-grid card-grid-2">
          <div>
            <SkelBlock w={130} h={14} mb={12} />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <SkelBlock w={80} h={13} />
                  <SkelBlock w={100} h={12} />
                </div>
                <SkelBlock w="100%" h={8} r={4} />
              </div>
            ))}
          </div>
          <div>
            <SkelBlock w={120} h={14} mb={12} />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', marginBottom: 8, borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                <SkelBlock w={140} h={14} />
                <div style={{ textAlign: 'right' }}>
                  <SkelBlock w={50} h={14} mb={4} />
                  <SkelBlock w={70} h={11} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DataPipeline() {
  const [syncStatus, setSyncStatus] = useState(null);
  const [mappingStats, setMappingStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const { businessType } = useBusinessType();

  const loadData = async () => {
    setLoading(true);
    try {
      const btParam = businessType === 'All' ? {} : { businessType };
      const [sync, mapping] = await Promise.all([getRaynaSyncStatus(), getMappingStats(btParam)]);
      setSyncStatus(sync);
      setMappingStats(mapping);
    } catch (err) {
      console.error('Failed to load pipeline data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [businessType]);

  const handleSyncAll = async () => {
    setSyncing({ all: true });
    try {
      await triggerRaynaSync();
      await loadData();
    } catch (err) {
      console.error('Sync failed:', err);
    }
    setSyncing({});
  };

  const handleSyncOne = async (ep) => {
    setSyncing({ [ep]: true });
    try {
      await triggerRaynaSyncEndpoint(ep);
      await loadData();
    } catch (err) {
      console.error(`Sync ${ep} failed:`, err);
    }
    setSyncing(prev => ({ ...prev, [ep]: false }));
  };

  const handleRefreshMapping = async () => {
    setRefreshing(true);
    try {
      await refreshBookingMapping();
      await loadData();
    } catch (err) {
      console.error('Mapping refresh failed:', err);
    }
    setRefreshing(false);
  };

  if (loading) return <DataPipelineSkeleton />;

  const tables = syncStatus?.tables || [];
  const overall = mappingStats?.overall || {};
  const coverage = mappingStats?.coverage || {};
  const breakdown = mappingStats?.breakdown || [];
  const dataOverview = mappingStats?.dataOverview || {};
  const deptBreakdown = mappingStats?.deptBreakdown || [];
  const mysqlStatus = mappingStats?.mysqlStatus || [];
  // Daily-only — drop the every-5-min and every-minute Journey jobs.
  const cronJobs = (mappingStats?.cronJobs || []).filter(j => !/^\*/.test(j.schedule));


  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ padding: '0 0 40px' }}>
      {/* Header */}
      <motion.div variants={fadeInUp} className="card-header" style={{ marginBottom: 28 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24 }}>Data Pipeline</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
            Rayna API sync, MySQL sync, and booking-customer mapping
          </p>
        </div>
      </motion.div>

      {/* KPI Row */}
      <motion.div variants={fadeInUp} className="kpi-strip" style={{ marginBottom: 28 }}>
        {[
          { label: `Unified Contacts (${businessType})`, value: formatNum(dataOverview.unifiedContacts), color: 'var(--brand-primary)', icon: Users },
          { label: `Travel Bookings (${businessType})`, value: formatNum(dataOverview.travelBookings), color: 'var(--green)', icon: MapPin },
          { label: 'Chats', value: formatNum(dataOverview.chats), color: '#25D366', icon: MessageSquare },
          { label: `Total Unified Contacts`, value: formatNum(dataOverview.totalUsers), color: 'var(--red)', icon: Database },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 18px' }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: `color-mix(in srgb, ${color} 10%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={20} style={{ color }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Data Sources Overview */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 24, marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 18px', fontSize: 16 }}>Data Sources Overview</h3>
        <div className="kpi-strip">
          {[
            { label: `Unified Contacts (${businessType})`, value: formatNum(dataOverview.unifiedContacts), sub: `of ${formatNum(dataOverview.totalUsers)} total`, icon: Users, color: 'var(--brand-primary)' },
            { label: 'Emails', value: formatNum(dataOverview.uniqueEmails), sub: 'unified_contacts', icon: Mail, color: 'var(--purple)' },
            { label: 'Mobiles', value: formatNum(dataOverview.phones), sub: 'unified_contacts', icon: Phone, color: '#25D366' },
            { label: 'Travel Bookings', value: formatNum(dataOverview.travelBookings), sub: 'all sources', icon: MapPin, color: 'var(--green)' },
            { label: 'Chats', value: formatNum(dataOverview.chats), sub: 'WhatsApp', icon: MessageSquare, color: '#25D366' },
            { label: 'Tours', value: formatNum(dataOverview.tours), sub: 'from API', icon: MapPin, color: SOURCE_COLORS.tours },
            { label: 'Hotels', value: formatNum(dataOverview.hotels), sub: 'from API', icon: Building2, color: SOURCE_COLORS.hotels },
            { label: 'Visas', value: formatNum(dataOverview.visas), sub: 'from API', icon: Globe, color: SOURCE_COLORS.visas },
            { label: 'Flights', value: formatNum(dataOverview.flights), sub: 'from API', icon: Plane, color: SOURCE_COLORS.flights },
            { label: 'Packages', value: formatNum(dataOverview.packages), sub: 'from API', icon: MapPin, color: 'var(--purple)' },
            { label: 'Others', value: formatNum(dataOverview.others), sub: 'from API', icon: Database, color: 'var(--orange)' },
          ].map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="card" style={{ padding: '16px 14px', textAlign: 'center' }}>
              <Icon size={20} style={{ color, marginBottom: 6 }} />
              <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{label}</div>
              <div style={{ fontSize: 10, color, marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Sync Status: Rayna API + Chats */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-2" style={{ marginBottom: 28 }}>

        {/* Rayna API Sync Status */}
        <div className="card" style={{ padding: 24 }}>
          <div className="card-header" style={{ marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Rayna API Sync</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {['tours', 'hotels', 'visas', 'flights', 'packages', 'others'].map(ep => {
              const t = tables.find(r => r.table_name === `rayna_${ep}`) || {};
              const Icon = SOURCE_ICONS[ep];
              return (
                <div key={ep} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 8, background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon size={18} style={{ color: SOURCE_COLORS[ep] }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{ep}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {formatNum(dataOverview[ep] || 0)} rows  |  Last: {formatDate(t.last_synced_at)}
                      </div>
                    </div>
                  </div>
                  <StatusBadge />
                </div>
              );
            })}
          </div>
        </div>

        {/* Chats Sync Status (MySQL → RDS) */}
        <div className="card" style={{ padding: 24 }}>
          <div className="card-header" style={{ marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Chats Sync</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mysqlStatus.length > 0 ? mysqlStatus.map(t => (
              <div key={t.table_name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: 8, background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {t.table_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {formatNum(t.rows_synced)} rows | {t.sync_duration_ms ? `${(t.sync_duration_ms / 1000).toFixed(1)}s` : '--'} | Last: {formatDate(t.last_synced_at)}
                  </div>
                </div>
                <StatusBadge />
              </div>
            )) : (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>
                No chats sync data yet
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Cron Jobs — only ones with run history (active) */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 24, marginBottom: 28 }}>
        <div className="card-header" style={{ marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Cron Jobs</h3>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{cronJobs.length} scheduled</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {cronJobs.map(job => (
            <div key={job.name} style={{
              padding: '14px 16px', borderRadius: 8, background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={15} style={{ color: 'var(--brand-primary)' }} />
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{job.label}</div>
                </div>
                {job.meta?.sync_status && <StatusBadge status={job.meta.sync_status} />}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <div><span style={{ opacity: 0.7 }}>Schedule:</span> {job.humanSchedule} <span style={{ opacity: 0.5 }}>({job.schedule})</span></div>
                {job.meta ? (
                  <>
                    <div><span style={{ opacity: 0.7 }}>Last run:</span> {formatDate(job.meta.last_synced_at)}</div>
                    <div>
                      <span style={{ opacity: 0.7 }}>Rows:</span> {formatNum(job.meta.rows_synced)}
                      {job.meta.sync_duration_ms != null && (
                        <> <span style={{ opacity: 0.5 }}>· {(job.meta.sync_duration_ms / 1000).toFixed(1)}s</span></>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ opacity: 0.6, fontStyle: 'italic' }}>No history tracked</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Booking <-> Customer Mapping */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 24, marginBottom: 28 }}>
        <div className="card-header" style={{ marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>Booking ↔ Customer Mapping</h3>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
              Matched {formatNum(overall.totalMapped)} bookings to {formatNum(overall.customersWithBookings)} customers ({overall.matchRate || 0}% of customer base)
            </p>
          </div>
        </div>

        {/* Coverage + Match type grid */}
        <div className="card-grid card-grid-2" style={{ marginBottom: 20 }}>
          {/* Coverage bars */}
          <div>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>Coverage by Source</h4>
            {['tours', 'hotels', 'visas', 'flights', 'packages', 'others'].map(src => {
              const c = coverage[src] || { total: 0, mapped: 0 };
              const pct = c.total > 0 ? ((c.mapped / c.total) * 100).toFixed(1) : 0;
              const Icon = SOURCE_ICONS[src];
              return (
                <div key={src} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
                      <Icon size={14} style={{ color: SOURCE_COLORS[src] }} /> {src}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {formatNum(c.mapped)} / {formatNum(c.total)} ({pct}%)
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, borderRadius: 4, background: SOURCE_COLORS[src], transition: 'width 0.5s' }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Match type breakdown */}
          <div>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>Match Method</h4>
            {breakdown.length > 0 ? breakdown.map((b, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', marginBottom: 8, borderRadius: 8, background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {b.match_type === 'phone' ? <Phone size={14} style={{ color: 'var(--brand-primary)' }} /> : <Mail size={14} style={{ color: 'var(--orange)' }} />}
                  <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
                    {b.booking_source} ({b.match_type})
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{formatNum(b.matched_bookings)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatNum(b.unique_customers)} customers</div>
                </div>
              </div>
            )) : (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-secondary)', fontSize: 13 }}>
                No mapping data yet. Run sync first, then refresh mapping.
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </motion.div>
  );
}
