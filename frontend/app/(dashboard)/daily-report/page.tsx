'use client';

import { useState } from 'react';
import { getReportCounts, getReportPreview, downloadReportCSV, downloadReportAll } from '@/lib/api';
import { Archive, BarChart3, CheckCircle2, Download, Eye, FileSpreadsheet, Loader2, X } from 'lucide-react';
import { Button, Card, Chip, EmptyState, Input, PageHeader, StatusChip } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import s from './report.module.css';

const TABLE_CONFIG = [
  { key: 'rayna_tours', label: 'Rayna Tours', group: 'rayna' },
  { key: 'rayna_hotels', label: 'Rayna Hotels', group: 'rayna' },
  { key: 'rayna_visas', label: 'Rayna Visas', group: 'rayna' },
  { key: 'rayna_flights', label: 'Rayna Flights', group: 'rayna' },
  { key: 'users', label: 'Users', group: 'crm' },
  { key: 'chats', label: 'WhatsApp Chats', group: 'crm' },
  { key: 'tickets', label: 'Email Tickets', group: 'crm' },
  { key: 'travel_bookings', label: 'Travel Bookings', group: 'crm' },
  { key: 'ga4_events', label: 'GA4 Events', group: 'ga4' },
];

const GROUPS = [
  { key: 'rayna', label: 'Rayna API Bookings' },
  { key: 'crm', label: 'CRM Data' },
  { key: 'ga4', label: 'Google Analytics 4' },
];

interface ReportTableInfo {
  totalRows?: number; totalBills?: number | null; totalSales?: number;
  firstBill?: string | number; lastBill?: string | number;
  sync?: { lastSyncedAt?: string; syncStatus?: string };
}
interface ReportCounts {
  totalRows?: number; totalBills?: number; totalSales?: number; from?: string; to?: string;
  tables: Record<string, ReportTableInfo | undefined>;
}
interface ReportPreview {
  table: string; columns: string[]; rows: Record<string, unknown>[]; totalRows?: number; previewRows?: number;
}
interface ReportToast { msg: string; type: 'success' | 'error' }

function formatNum(n: number | null | undefined) { return (Number.isFinite(n) ? Number(n) : 0).toLocaleString(); }
function formatAED(n: number | null | undefined) {
  return `AED ${(Number.isFinite(n) ? Number(n) : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatSyncTime(d: string | null | undefined) {
  if (!d) return 'Never';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'Unknown';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function getToday() { return new Date().toISOString().split('T')[0]; }
function getYesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }
function getDaysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

function syncChip(info: ReportTableInfo): { tone: ChipTone; text: string } {
  const st = info.sync?.syncStatus;
  if (!info.sync?.lastSyncedAt && !st) return { tone: 'mute', text: 'No sync info' };
  if (st === 'success') return { tone: 'ok', text: 'Synced' };
  if (st === 'failed' || st === 'error') return { tone: 'bad', text: 'Sync failed' };
  return { tone: 'warn', text: st ? st.charAt(0).toUpperCase() + st.slice(1) : 'Pending' };
}

export default function DailyReport() {
  const [fromDate, setFromDate] = useState(getToday());
  const [toDate, setToDate] = useState(getToday());
  const [data, setData] = useState<ReportCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ReportToast | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);

  const showToast = (msg: string, type: ReportToast['type'] = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadCounts = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setPreview(null);
    try {
      const result = await getReportCounts(fromDate, toDate) as ReportCounts;
      setData({ ...result, tables: result?.tables ?? {} });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handlePreset = (from: string, to: string) => {
    setFromDate(from);
    setToDate(to);
    setData(null);
    setPreview(null);
  };

  const handlePreview = async (table: string) => {
    if (preview?.table === table) { setPreview(null); return; }
    setPreviewLoading(table);
    try {
      const result = await getReportPreview(table, fromDate, toDate) as Omit<ReportPreview, 'table'>;
      setPreview({ table, columns: result.columns ?? [], rows: result.rows ?? [], totalRows: result.totalRows, previewRows: result.previewRows });
    } catch (err) {
      showToast(`Preview failed: ${(err as Error).message}`, 'error');
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleDownloadCSV = async (table: string, label: string | undefined) => {
    setDownloading(prev => ({ ...prev, [table]: true }));
    try {
      await downloadReportCSV(table, fromDate, toDate);
      showToast(`${label ?? table} CSV downloaded`);
    } catch (err) {
      showToast(`Download failed: ${(err as Error).message}`, 'error');
    } finally {
      setDownloading(prev => ({ ...prev, [table]: false }));
    }
  };

  const handleDownloadAll = async () => {
    setDownloading(prev => ({ ...prev, all: true }));
    try {
      await downloadReportAll(fromDate, toDate);
      showToast('ZIP downloaded with all data files');
    } catch (err) {
      showToast(`ZIP download failed: ${(err as Error).message}`, 'error');
    } finally {
      setDownloading(prev => ({ ...prev, all: false }));
    }
  };

  const presets = [
    { label: 'Today', from: getToday(), to: getToday() },
    { label: 'Yesterday', from: getYesterday(), to: getYesterday() },
    { label: 'Last 7 days', from: getDaysAgo(7), to: getToday() },
    { label: 'Last 30 days', from: getDaysAgo(30), to: getToday() },
    { label: 'This month', from: new Date().toISOString().slice(0, 8) + '01', to: getToday() },
  ];

  const previewLabel = preview ? TABLE_CONFIG.find(t => t.key === preview.table)?.label ?? preview.table : '';

  return (
    <div className={s.page}>
      <PageHeader
        title="Reports & exports"
        breadcrumbs={[{ label: 'Insights' }, { label: 'Reports' }]}
        description="Check that each day's data arrived — bill numbers, row counts and total sales — preview the newest rows, then download."
        actions={data ? (
          <Button variant="primary" onClick={handleDownloadAll} disabled={downloading.all || !data.totalRows}>
            {downloading.all ? <Loader2 size={16} className={s.spin} /> : <Archive size={16} />}
            {downloading.all ? 'Preparing ZIP...' : 'Download All as ZIP'}
          </Button>
        ) : undefined}
      />

      <Card className={s.filter}>
        <div className={s.seg} role="group" aria-label="Period">
          {presets.map(p => {
            const on = fromDate === p.from && toDate === p.to;
            return (
              <Button key={p.label} size="sm" variant={on ? 'secondary' : 'ghost'} className={s.segBtn}
                aria-pressed={on} onClick={() => handlePreset(p.from, p.to)}>
                {p.label}
              </Button>
            );
          })}
        </div>
        <div className={s.dates}>
          <label className={s.dateLabel} htmlFor="report-from">From</label>
          <Input id="report-from" type="date" className={s.dateInput} value={fromDate} onChange={e => setFromDate(e.target.value)} />
          <label className={s.dateLabel} htmlFor="report-to">To</label>
          <Input id="report-to" type="date" className={s.dateInput} value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <Button variant="primary" size="sm" onClick={loadCounts} disabled={loading}>
          {loading ? <Loader2 size={14} className={s.spin} /> : <BarChart3 size={14} />}
          {loading ? 'Loading...' : 'Load Summary'}
        </Button>
      </Card>

      {error && (
        <Card className={s.errorCard} role="alert">
          <b>Couldn&apos;t load report totals</b>
          <span className={s.errorText}>{error}</span>
          <Button size="sm" variant="primary" onClick={loadCounts} disabled={loading}>Try again</Button>
        </Card>
      )}

      {data && (
        <>
          <div className={s.kpis}>
            <Card className={s.kpiCard}><span className={s.note}>Total rows</span><div className={s.kpi}>{formatNum(data.totalRows)}</div><span className={s.help}>All sources in range</span></Card>
            <Card className={s.kpiCard}><span className={s.note}>Total bills</span><div className={s.kpi}>{formatNum(data.totalBills)}</div><span className={s.help}>Rayna API bookings</span></Card>
            <Card className={s.kpiCard}><span className={s.note}>Total sales</span><div className={s.kpi}>{formatAED(data.totalSales)}</div><span className={s.help}>Sum of billed amounts</span></Card>
            <Card className={s.kpiCard}><span className={s.note}>Date range</span><div className={s.kpiSmall}>{`${data.from ?? fromDate}  to  ${data.to ?? toDate}`}</div></Card>
          </div>

          {GROUPS.map(group => {
            const groupTables = TABLE_CONFIG.filter(t => t.group === group.key);
            const groupRows = groupTables.reduce((sum, t) => sum + (data.tables[t.key]?.totalRows || 0), 0);
            const groupBills = groupTables.reduce((sum, t) => sum + (data.tables[t.key]?.totalBills || 0), 0);
            const groupSales = groupTables.reduce((sum, t) => sum + (data.tables[t.key]?.totalSales || 0), 0);
            return (
              <section key={group.key} className={s.group} aria-label={group.label}>
                <div className={s.groupHead}>
                  <div className={s.groupTitle}>
                    <h2>{group.label}</h2>
                    <Chip tone="info">{formatNum(groupRows)} rows</Chip>
                    {groupBills > 0 && <Chip tone="gold">{formatNum(groupBills)} bills</Chip>}
                  </div>
                  {groupSales > 0 && <span className={s.groupSales}>{formatAED(groupSales)}</span>}
                </div>
                <div className={s.sources}>
                  {groupTables.map(({ key, label }) => {
                    const info: ReportTableInfo = data.tables[key] || {};
                    const empty = !info.totalRows;
                    const syncTime = info.sync?.lastSyncedAt;
                    const hasBills = info.totalBills != null;
                    const chip = syncChip(info);
                    const isOpen = preview?.table === key;
                    return (
                      <Card key={key} className={[s.source, empty ? s.sourceEmpty : ''].join(' ')}>
                        <div className={s.row}>
                          <b>{label}</b>
                          <StatusChip tone={chip.tone} title={syncTime ? `Last sync: ${formatSyncTime(syncTime)}` : undefined}>{chip.text}</StatusChip>
                        </div>
                        <span className={s.rowsNum}>{formatNum(info.totalRows)}</span>
                        {hasBills && (
                          <div className={s.stats}>
                            <span>Bills<b>{formatNum(info.totalBills)}</b></span>
                            <span>Sales<b>{formatAED(info.totalSales)}</b></span>
                          </div>
                        )}
                        {hasBills && info.firstBill != null && info.firstBill !== '' && (
                          <span className={s.help}>Bill no. range <span className={s.mono}>{`${info.firstBill}${info.firstBill !== info.lastBill && info.lastBill != null ? ` → ${info.lastBill}` : ''}`}</span></span>
                        )}
                        {syncTime && <span className={s.help}>Synced: {formatSyncTime(syncTime)}</span>}
                        <div className={s.actions}>
                          <Button size="sm" className={isOpen ? s.active : undefined} aria-pressed={isOpen}
                            onClick={() => handlePreview(key)} disabled={empty || previewLoading === key}
                            title="Preview the newest rows for cross-checking">
                            {previewLoading === key ? <Loader2 size={13} className={s.spin} /> : <Eye size={13} />}
                            Preview
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDownloadCSV(key, label)} disabled={downloading[key] || empty}>
                            {downloading[key] ? <Loader2 size={13} className={s.spin} /> : <Download size={13} />}
                            Download CSV
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {preview && (
            <Card className={s.preview} aria-label="Preview">
              <div className={s.previewHead}>
                <div className={s.groupTitle}>
                  <h2>Preview: {previewLabel}</h2>
                  <Chip tone="info">Newest {formatNum(preview.previewRows)} of {formatNum(preview.totalRows)} rows</Chip>
                </div>
                <div className={s.groupTitle}>
                  <Button size="sm" variant="primary" onClick={() => handleDownloadCSV(preview.table, previewLabel)}>
                    <Download size={13} /> Download Full CSV
                  </Button>
                  <Button size="sm" variant="ghost" icon aria-label="Close preview" onClick={() => setPreview(null)}>
                    <X size={16} />
                  </Button>
                </div>
              </div>
              {preview.rows.length === 0 ? (
                <p className={s.note}>No data for the selected date range.</p>
              ) : (
                <div className={s.tableWrap} role="region" aria-label={`${previewLabel} preview rows`} tabIndex={0}>
                  <table className={s.tbl}>
                    <thead>
                      <tr><th className={s.idx}>#</th>{preview.columns.map(col => <th key={col}>{col}</th>)}</tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i}>
                          <td className={s.idx}>{i + 1}</td>
                          {preview.columns.map(col => (
                            <td key={col} title={row[col] != null ? String(row[col]) : ''}>
                              {row[col] != null ? String(row[col]) : <span className={s.nil}>—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {!data && !loading && !error && (
        <EmptyState
          icon={<FileSpreadsheet size={20} />}
          title="Select a date range to get started"
          description='Pick a period or type dates above, then click "Load Summary" to see bill numbers, row counts and total sales across all data sources.'
        />
      )}

      {toast && (
        <div role="status" className={[s.toast, toast.type === 'error' ? s.toastBad : s.toastOk].join(' ')}>
          {toast.type === 'error' ? <X size={16} /> : <CheckCircle2 size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
