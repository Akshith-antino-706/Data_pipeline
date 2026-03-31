import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getReportCounts, getReportPreview, downloadReportCSV, downloadReportAll } from '../api';
import {
  MapPin, Building2, Globe, Plane, Users, MessageSquare, Mail, Activity,
  Download, Loader2, FileSpreadsheet, Archive, Calendar, BarChart3,
  Eye, X, CheckCircle2, Clock, TrendingUp, DollarSign, Database,
  Hash, FileText, Receipt,
} from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const TABLE_CONFIG = [
  { key: 'rayna_tours', label: 'Rayna Tours', icon: MapPin, color: 'var(--brand-primary)', group: 'rayna' },
  { key: 'rayna_hotels', label: 'Rayna Hotels', icon: Building2, color: 'var(--orange)', group: 'rayna' },
  { key: 'rayna_visas', label: 'Rayna Visas', icon: Globe, color: 'var(--green)', group: 'rayna' },
  { key: 'rayna_flights', label: 'Rayna Flights', icon: Plane, color: 'var(--red)', group: 'rayna' },
  { key: 'mysql_contacts', label: 'CRM Contacts', icon: Users, color: 'var(--purple)', group: 'mysql' },
  { key: 'mysql_chats', label: 'WhatsApp Chats', icon: MessageSquare, color: '#25D366', group: 'mysql' },
  { key: 'mysql_tickets', label: 'Email Tickets', icon: Mail, color: 'var(--yellow)', group: 'mysql' },
  { key: 'ga4_events', label: 'GA4 Events', icon: Activity, color: '#FF6D01', group: 'ga4' },
];

const GROUPS = [
  { key: 'rayna', label: 'Rayna API Bookings', icon: Database, color: 'var(--brand-primary)' },
  { key: 'mysql', label: 'MySQL CRM Data', icon: Users, color: 'var(--green)' },
  { key: 'ga4', label: 'Google Analytics 4', icon: Activity, color: '#FF6D01' },
];

function formatNum(n) { return (n || 0).toLocaleString(); }
function formatAED(n) { return `AED ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function formatSyncTime(d) {
  if (!d) return 'Never';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function getToday() { return new Date().toISOString().split('T')[0]; }
function getYesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }
function getDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

function StatRow({ icon: Icon, label, value, color, small }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: small ? '3px 0' : '5px 0' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
        <Icon size={13} style={{ color: color || 'var(--text-tertiary)' }} /> {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

export default function DailyReport() {
  const [fromDate, setFromDate] = useState(getToday());
  const [toDate, setToDate] = useState(getToday());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState({});
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadCounts = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setPreview(null);
    try {
      const result = await getReportCounts(fromDate, toDate);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePreset = (from, to) => {
    setFromDate(from);
    setToDate(to);
    setData(null);
    setPreview(null);
  };

  const handlePreview = async (table) => {
    if (preview?.table === table) { setPreview(null); return; }
    setPreviewLoading(table);
    try {
      const result = await getReportPreview(table, fromDate, toDate);
      setPreview({ table, columns: result.columns, rows: result.rows, totalRows: result.totalRows, previewRows: result.previewRows });
    } catch (err) {
      showToast(`Preview failed: ${err.message}`, 'error');
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleDownloadCSV = async (table, label) => {
    setDownloading(prev => ({ ...prev, [table]: true }));
    try {
      await downloadReportCSV(table, fromDate, toDate);
      showToast(`${label} CSV downloaded`);
    } catch (err) {
      showToast(`Download failed: ${err.message}`, 'error');
    } finally {
      setDownloading(prev => ({ ...prev, [table]: false }));
    }
  };

  const handleDownloadAll = async () => {
    setDownloading(prev => ({ ...prev, all: true }));
    try {
      await downloadReportAll(fromDate, toDate);
      showToast('ZIP downloaded with all 8 data files');
    } catch (err) {
      showToast(`ZIP download failed: ${err.message}`, 'error');
    } finally {
      setDownloading(prev => ({ ...prev, all: false }));
    }
  };

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      {/* Header */}
      <motion.div variants={fadeInUp} style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Daily Data Report</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0', fontSize: 14 }}>
          Verify data correctness — bill numbers, row counts, total sales, and preview half the data before downloading.
        </p>
      </motion.div>

      {/* Date Range Picker + Presets */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={18} style={{ color: 'var(--text-secondary)' }} />
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }} />
          </div>
          <button className="btn btn-primary" onClick={loadCounts} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <BarChart3 size={16} />}
            {loading ? 'Loading...' : 'Load Summary'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600, lineHeight: '28px' }}>Quick:</span>
          {[
            { label: 'Today', from: getToday(), to: getToday() },
            { label: 'Yesterday', from: getYesterday(), to: getYesterday() },
            { label: 'Last 7 days', from: getDaysAgo(7), to: getToday() },
            { label: 'Last 30 days', from: getDaysAgo(30), to: getToday() },
            { label: 'This month', from: new Date().toISOString().slice(0, 8) + '01', to: getToday() },
          ].map(p => (
            <button key={p.label} className="btn btn-ghost btn-sm"
              onClick={() => handlePreset(p.from, p.to)}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-color)',
                background: (fromDate === p.from && toDate === p.to) ? 'var(--brand-primary)' : 'transparent',
                color: (fromDate === p.from && toDate === p.to) ? '#fff' : 'var(--text-secondary)' }}>
              {p.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Error */}
      {error && (
        <motion.div variants={fadeInUp} className="card" style={{ padding: 16, marginBottom: 24, borderLeft: '4px solid var(--red)' }}>
          <span style={{ color: 'var(--red)', fontSize: 14 }}>{error}</span>
        </motion.div>
      )}

      {data && (
        <>
          {/* Top KPI Strip */}
          <motion.div variants={fadeInUp} className="card" style={{ padding: 20, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
                {[
                  { icon: FileSpreadsheet, label: 'Total Rows', value: formatNum(data.totalRows), bg: 'rgba(14,165,233,0.1)', color: 'var(--brand-primary)' },
                  { icon: Receipt, label: 'Total Bills', value: formatNum(data.totalBills), bg: 'rgba(168,85,247,0.1)', color: 'var(--purple)' },
                  { icon: DollarSign, label: 'Total Sales', value: formatAED(data.totalSales), bg: 'rgba(34,197,94,0.1)', color: 'var(--green)' },
                  { icon: Calendar, label: 'Date Range', value: `${data.from}  to  ${data.to}`, bg: 'rgba(249,115,22,0.1)', color: 'var(--orange)' },
                ].map(kpi => (
                  <div key={kpi.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 10, background: kpi.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <kpi.icon size={20} style={{ color: kpi.color }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: 0.5 }}>{kpi.label}</div>
                      <div style={{ fontSize: kpi.label === 'Date Range' ? 14 : 22, fontWeight: 700, color: kpi.label === 'Total Sales' ? 'var(--green)' : 'var(--text-primary)' }}>{kpi.value}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" onClick={handleDownloadAll} disabled={downloading.all || data.totalRows === 0}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 28px', fontSize: 15 }}>
                {downloading.all ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Archive size={18} />}
                {downloading.all ? 'Preparing ZIP...' : 'Download All as ZIP'}
              </button>
            </div>
          </motion.div>

          {/* Grouped Table Cards */}
          {GROUPS.map(group => {
            const groupTables = TABLE_CONFIG.filter(t => t.group === group.key);
            const groupRows = groupTables.reduce((s, t) => s + (data.tables[t.key]?.totalRows || 0), 0);
            const groupBills = groupTables.reduce((s, t) => s + (data.tables[t.key]?.totalBills || 0), 0);
            const groupSales = groupTables.reduce((s, t) => s + (data.tables[t.key]?.totalSales || 0), 0);
            const GroupIcon = group.icon;

            return (
              <motion.div key={group.key} variants={fadeInUp} style={{ marginBottom: 28 }}>
                {/* Group Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <GroupIcon size={18} style={{ color: group.color }} />
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{group.label}</h3>
                    <span className="badge-blue" style={{ padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                      {formatNum(groupRows)} rows
                    </span>
                    {groupBills > 0 && (
                      <span className="badge-purple" style={{ padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                        {formatNum(groupBills)} bills
                      </span>
                    )}
                  </div>
                  {groupSales > 0 && (
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>
                      <TrendingUp size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                      {formatAED(groupSales)}
                    </span>
                  )}
                </div>

                {/* Table Cards */}
                <div className="card-grid-4">
                  {groupTables.map(({ key, label, icon: Icon, color }) => {
                    const info = data.tables[key] || {};
                    const isDownloading = downloading[key];
                    const isLoadingPreview = previewLoading === key;
                    const syncTime = info.sync?.lastSyncedAt;
                    const syncOk = info.sync?.syncStatus === 'success';
                    const hasBills = info.totalBills != null;

                    return (
                      <motion.div key={key} variants={fadeInUp} className="card"
                        style={{ padding: 20, opacity: info.totalRows === 0 ? 0.45 : 1, transition: 'opacity 0.3s' }}>

                        {/* Card Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 36, height: 36, borderRadius: 10, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Icon size={18} style={{ color }} />
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
                          </div>
                          {syncTime && (
                            <span title={`Last sync: ${formatSyncTime(syncTime)}`}>
                              {syncOk
                                ? <CheckCircle2 size={14} style={{ color: 'var(--green)' }} />
                                : <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />}
                            </span>
                          )}
                        </div>

                        {/* Stats */}
                        <div style={{ borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', padding: '8px 0', marginBottom: 10 }}>
                          <StatRow icon={FileText} label="Total Rows" value={formatNum(info.totalRows)} />
                          {hasBills && (
                            <>
                              <StatRow icon={Receipt} label="Total Bills" value={formatNum(info.totalBills)} color="var(--purple)" />
                              <StatRow icon={DollarSign} label="Total Sales" value={formatAED(info.totalSales)} color="var(--green)" />
                            </>
                          )}
                        </div>

                        {/* Bill Number Range */}
                        {hasBills && info.firstBill && (
                          <div style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-secondary)', fontSize: 11 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 4 }}>
                              <Hash size={11} /> BILL NO. RANGE
                            </div>
                            <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                              {info.firstBill}{info.firstBill !== info.lastBill ? ` → ${info.lastBill}` : ''}
                            </div>
                          </div>
                        )}

                        {/* Sync time */}
                        {syncTime && (
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 10 }}>
                            Synced: {formatSyncTime(syncTime)}
                          </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-secondary" onClick={() => handleDownloadCSV(key, label)}
                            disabled={isDownloading || info.totalRows === 0}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 12, padding: '7px 0' }}>
                            {isDownloading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
                            CSV
                          </button>
                          <button className="btn btn-ghost" onClick={() => handlePreview(key)}
                            disabled={info.totalRows === 0 || isLoadingPreview}
                            title="Preview 50% of data for cross-checking"
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 12, padding: '7px 12px',
                              border: '1px solid var(--border-color)', borderRadius: 8,
                              background: preview?.table === key ? 'var(--brand-primary)' : 'transparent',
                              color: preview?.table === key ? '#fff' : 'var(--text-secondary)',
                            }}>
                            {isLoadingPreview ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Eye size={13} />}
                            50%
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}

          {/* Preview Panel */}
          <AnimatePresence>
            {preview && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="card" style={{ padding: 24, marginBottom: 28, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Eye size={18} style={{ color: 'var(--brand-primary)' }} />
                    <h3 style={{ margin: 0, fontSize: 16 }}>
                      Preview: {TABLE_CONFIG.find(t => t.key === preview.table)?.label}
                    </h3>
                    <span className="badge-blue" style={{ padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                      {formatNum(preview.previewRows)} of {formatNum(preview.totalRows)} rows (50%)
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                      onClick={() => handleDownloadCSV(preview.table, TABLE_CONFIG.find(t => t.key === preview.table)?.label)}>
                      <Download size={12} /> Download Full CSV
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)} style={{ padding: 4 }}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
                {preview.rows.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)', fontSize: 14 }}>
                    No data for the selected date range.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-color)', maxHeight: 520 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{
                            padding: '8px 12px', textAlign: 'center', fontWeight: 600, fontSize: 11,
                            background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)',
                            color: 'var(--text-tertiary)', position: 'sticky', top: 0, zIndex: 1, width: 44,
                          }}>#</th>
                          {preview.columns.map(col => (
                            <th key={col} style={{
                              padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11,
                              textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
                              background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)',
                              color: 'var(--text-secondary)', position: 'sticky', top: 0, zIndex: 1,
                            }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border-color)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                            <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500 }}>{i + 1}</td>
                            {preview.columns.map(col => (
                              <td key={col} style={{
                                padding: '5px 12px', whiteSpace: 'nowrap', maxWidth: 240,
                                overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)',
                              }}
                                title={row[col] != null ? String(row[col]) : ''}>
                                {row[col] != null ? String(row[col]) : <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <motion.div variants={fadeInUp} className="card" style={{ padding: 48, textAlign: 'center' }}>
          <FileSpreadsheet size={48} style={{ color: 'var(--text-tertiary)', marginBottom: 16 }} />
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Select a date range to get started</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
            Choose your from and to dates above, then click "Load Summary" to see bill numbers, row counts, and total sales across all data sources.
          </p>
        </motion.div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
            style={{
              position: 'fixed', bottom: 24, right: 24, zIndex: 999,
              padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 500, maxWidth: 360,
              background: toast.type === 'error' ? 'var(--red)' : 'var(--green)', color: '#fff',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 8,
            }}>
            {toast.type === 'error' ? <X size={16} /> : <CheckCircle2 size={16} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  );
}
