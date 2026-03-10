import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, CartesianGrid,
} from 'recharts'

const API = 'http://localhost:3001/api'

function useFetch(url) {
  const [data, setData] = useState(null)
  useEffect(() => {
    fetch(url).then(r => r.json()).then(setData).catch(console.error)
  }, [url])
  return data
}

const C = {
  green: '#10b981', blue: '#3b82f6', purple: '#8b5cf6',
  indigo: '#6366f1', yellow: '#f59e0b', orange: '#f97316',
  red: '#ef4444', pink: '#ec4899', teal: '#14b8a6', gray: '#94a3b8',
  cyan: '#06b6d4', lime: '#84cc16',
}

const GRADE_COLOR = {
  'A - Excellent': C.green, 'B - Good': C.blue,
  'C - Average': C.yellow, 'D - Below Average': C.orange, 'F - Poor': C.red,
}
const GRADE_BADGE = {
  'A - Excellent': 'badge-green', 'B - Good': 'badge-blue',
  'C - Average': 'badge-yellow', 'D - Below Average': 'badge-orange', 'F - Poor': 'badge-red',
}
const SEG_COLORS = {
  'High Value': C.green, 'B2B Partner': C.indigo, 'Converted': C.blue,
  'Engaged': C.purple, 'New Lead': C.yellow, 'At Risk': C.orange,
  'Dormant': C.red, 'Prospect': C.gray, 'Invalid - Bounced': '#475569',
}
const TT = { background: '#1a1d2e', border: '1px solid #2d3155', color: '#e2e8f0', borderRadius: 8 }

const PALETTE = [C.indigo, C.teal, C.blue, C.green, C.yellow, C.orange, C.pink, C.purple, C.cyan, C.red, C.lime, C.gray]

function GradeBar({ pct }) {
  const color = pct >= 80 ? C.green : pct >= 60 ? C.blue : pct >= 40 ? C.yellow : pct >= 20 ? C.orange : C.red
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="progress" style={{ flex: 1 }}>
        <div className="progress-fill" style={{ width: `${Math.min(pct || 0, 100)}%`, background: color }} />
      </div>
      <span style={{ fontSize: 12, color, minWidth: 36, fontWeight: 600 }}>{pct ?? 0}%</span>
    </div>
  )
}

function Stat({ label, value, sub, color, icon }) {
  return (
    <div className="kpi-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="kpi-label">{label}</div>
        {icon && <span style={{ fontSize: 18, opacity: 0.7 }}>{icon}</span>}
      </div>
      <div className="kpi-value" style={{ color: color || '#fff' }}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

function SectionTitle({ title, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>{title}</h2>
      {sub && <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{sub}</p>}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────
function Overview() {
  const kpis    = useFetch(`${API}/kpis`)
  const hourly  = useFetch(`${API}/chat-hourly`)
  const daily   = useFetch(`${API}/chat-daily`)
  const scorecard = useFetch(`${API}/scorecard`)

  const gradeData = scorecard
    ? Object.entries(scorecard.reduce((acc, r) => {
        acc[r.performance_grade] = (acc[r.performance_grade] || 0) + 1; return acc
      }, {})).map(([name, value]) => ({ name: name.split(' - ')[1] || name, value, color: GRADE_COLOR[name] }))
    : []

  const channelVol = scorecard
    ? ['WhatsApp', 'Email'].map(ch => ({
        name: ch,
        closed: scorecard.filter(r => r.channel === ch).reduce((a, r) => a + Number(r.closed_count), 0),
        open:   scorecard.filter(r => r.channel === ch).reduce((a, r) => a + Number(r.open_count), 0),
      }))
    : []

  return (
    <>
      <div className="page-header">
        <h1>Executive Overview</h1>
        <p>Rayna Tours · Live performance dashboard across all channels</p>
      </div>

      {/* Row 1 KPIs */}
      <div className="kpi-grid">
        <Stat icon="💬" label="WhatsApp Chats"   value={Number(kpis?.total_chats || 0).toLocaleString()}    sub={`${kpis?.wa_close_rate || 0}% close rate`} />
        <Stat icon="📧" label="Email Tickets"    value={Number(kpis?.total_tickets || 0).toLocaleString()}   sub={`${kpis?.email_close_rate || 0}% close rate`} />
        <Stat icon="✈️" label="Bookings"         value={Number(kpis?.total_bookings || 0).toLocaleString()}  sub="Travel orders" />
        <Stat icon="💰" label="Revenue (AED)"    value={`AED ${Number(kpis?.total_revenue || 0).toLocaleString()}`} color={C.green} sub="From paid tickets" />
        <Stat icon="👥" label="Total Profiles"   value={Number(kpis?.total_customers || 0).toLocaleString()} sub={`${kpis?.email_profiles || 0} email · ${kpis?.wa_profiles || 0} WA`} />
        <Stat icon="📲" label="Reachable (WA)"   value={Number(kpis?.can_whatsapp || 0).toLocaleString()}    sub="Can receive WhatsApp" color={C.green} />
        <Stat icon="📩" label="Reachable (Email)" value={Number(kpis?.can_email || 0).toLocaleString()}      sub="Can receive email" color={C.blue} />
        <Stat icon="🤝" label="Active Agents"    value={`${kpis?.wa_agents || 0} WA · ${kpis?.email_agents || 0} Email`} sub="Handling inquiries" />
      </div>

      {/* Row 2: channel bar + grade pie */}
      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <SectionTitle title="Volume by Channel" sub="Open vs closed across WhatsApp and Email" />
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={channelVol} barSize={64}>
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 13 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
              <Bar dataKey="closed" stackId="a" fill={C.green}  name="Closed" />
              <Bar dataKey="open"   stackId="a" fill={C.yellow} name="Open" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <SectionTitle title="Department Grade Distribution" sub="Performance grades across all departments" />
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={gradeData} dataKey="value" cx="50%" cy="50%" outerRadius={75} innerRadius={35}
                   label={({ name, value }) => `${name}(${value})`} labelLine={false}>
                {gradeData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={TT} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 3: hourly + daily */}
      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <SectionTitle title="Chat Activity by Hour" sub="When customers are most active (UTC+4)" />
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={hourly || []} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.indigo} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={C.indigo} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3155" />
              <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false}
                     tickFormatter={h => `${h}:00`} interval={3} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT} formatter={(v) => [v, 'Chats']} labelFormatter={h => `${h}:00`} />
              <Area type="monotone" dataKey="count" stroke={C.indigo} fill="url(#areaGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <SectionTitle title="Chat Volume by Day of Week" sub="Total vs closed chats per weekday" />
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={daily || []} barGap={2} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3155" />
              <XAxis dataKey="day_name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
              <Bar dataKey="count"  fill={C.indigo} name="Total"  radius={[3, 3, 0, 0]} />
              <Bar dataKey="closed" fill={C.green}  name="Closed" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Full scorecard */}
      <div className="card">
        <SectionTitle title="Full Department Scorecard" sub="Combined view of all WhatsApp and Email departments" />
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Channel</th><th>Department</th><th>Volume</th>
              <th>Open</th><th>Closed</th><th>Close Rate</th>
              <th>Agents</th><th>Spam</th><th>Grade</th>
            </tr></thead>
            <tbody>
              {scorecard?.slice(0, 30).map((r, i) => (
                <tr key={i}>
                  <td><span className={`badge ${r.channel === 'WhatsApp' ? 'badge-green' : 'badge-blue'}`}>{r.channel}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.department_ref}</td>
                  <td><strong>{Number(r.total_volume).toLocaleString()}</strong></td>
                  <td style={{ color: C.yellow }}>{r.open_count}</td>
                  <td style={{ color: C.green }}>{r.closed_count}</td>
                  <td style={{ minWidth: 140 }}><GradeBar pct={parseFloat(r.close_rate_pct)} /></td>
                  <td>{r.active_agents}</td>
                  <td style={{ color: C.red }}>{r.spam_count}</td>
                  <td><span className={`badge ${GRADE_BADGE[r.performance_grade] || 'badge-gray'}`}>{r.performance_grade}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── WhatsApp Departments ──────────────────────────────────────
function WhatsAppDepts() {
  const data    = useFetch(`${API}/whatsapp-depts`)
  const hourly  = useFetch(`${API}/chat-hourly`)
  const kpis    = useFetch(`${API}/kpis`)

  const chartData = data?.slice(0, 12).map(r => ({
    name: `…${r.department_phone?.slice(-6)}`,
    closed: Number(r.closed_chats),
    open: Number(r.open_chats),
  }))

  const peakHour = hourly ? hourly.reduce((a, b) => Number(b.count) > Number(a.count) ? b : a, { hour: 0, count: 0 }) : null

  return (
    <>
      <div className="page-header">
        <h1>WhatsApp Departments</h1>
        <p>Performance breakdown by receiver number</p>
      </div>

      <div className="kpi-grid">
        <Stat icon="📱" label="Total Chats"   value={Number(kpis?.total_chats || 0).toLocaleString()} sub="All WhatsApp conversations" />
        <Stat icon="✅" label="Closed Chats"  value={Number(kpis?.closed_chats || 0).toLocaleString()} color={C.green} sub={`${kpis?.wa_close_rate || 0}% close rate`} />
        <Stat icon="🔓" label="Open Chats"    value={Number(kpis?.open_chats || 0).toLocaleString()} color={C.yellow} sub="Awaiting response" />
        <Stat icon="🚫" label="Spam Flagged"  value={Number(kpis?.wa_spam || 0).toLocaleString()} color={C.red} sub="Filtered conversations" />
        <Stat icon="👤" label="Active Agents" value={kpis?.wa_agents || 0} sub="Handling WA chats" />
        <Stat icon="⏰" label="Peak Hour"     value={peakHour ? `${peakHour.hour}:00` : '—'} sub={peakHour ? `${peakHour.count} chats` : ''} color={C.indigo} />
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <SectionTitle title="Chat Volume — Top 12 Numbers" sub="Stacked open vs closed chats per department" />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barCategoryGap="30%" margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3155" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
              <Bar dataKey="closed" stackId="a" fill={C.green}  name="Closed" />
              <Bar dataKey="open"   stackId="a" fill={C.yellow} name="Open" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <SectionTitle title="Hourly Chat Volume" sub="Incoming chat distribution throughout the day" />
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={hourly || []} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="waGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.green} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={C.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3155" />
              <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false}
                     tickFormatter={h => `${h}h`} interval={3} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT} formatter={(v) => [v, 'Chats']} labelFormatter={h => `${h}:00`} />
              <Area type="monotone" dataKey="count" stroke={C.green} fill="url(#waGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <SectionTitle title="Department Detail" sub={`${data?.length || 0} active WhatsApp numbers`} />
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Receiver Number</th><th>Total</th>
              <th>Open</th><th>Closed</th><th>Close Rate</th>
              <th>Agents</th><th>High Priority</th><th>Spam</th><th>Last Active</th>
            </tr></thead>
            <tbody>
              {data?.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: i < 3 ? C.yellow : '#94a3b8', fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>+{r.department_phone}</td>
                  <td><strong>{r.total_chats}</strong></td>
                  <td style={{ color: C.yellow }}>{r.open_chats}</td>
                  <td style={{ color: C.green }}>{r.closed_chats}</td>
                  <td style={{ minWidth: 150 }}><GradeBar pct={parseFloat(r.close_rate_pct)} /></td>
                  <td>{r.active_agents}</td>
                  <td><span className={r.high_priority > 0 ? 'badge badge-orange' : ''}>{r.high_priority || 0}</span></td>
                  <td style={{ color: C.red }}>{r.spam_count}</td>
                  <td style={{ color: '#94a3b8', fontSize: 12 }}>
                    {r.last_activity ? new Date(r.last_activity).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Email Departments ─────────────────────────────────────────
function EmailDepts() {
  const data     = useFetch(`${API}/email-depts`)
  const products = useFetch(`${API}/ticket-products`)
  const kpis     = useFetch(`${API}/kpis`)

  const top12 = data?.slice(0, 12) || []
  const chartData = top12.map(r => ({
    name: r.department_name || '—',
    closed: Number(r.closed_tickets),
    open: Number(r.open_tickets),
  }))

  return (
    <>
      <div className="page-header">
        <h1>Email Departments</h1>
        <p>Ticket performance by department email address</p>
      </div>

      <div className="kpi-grid">
        <Stat icon="🎫" label="Total Tickets"    value={Number(kpis?.total_tickets || 0).toLocaleString()} sub="All email tickets" />
        <Stat icon="✅" label="Closed Tickets"   value={Number(kpis?.closed_tickets || 0).toLocaleString()} color={C.green} sub={`${kpis?.email_close_rate || 0}% close rate`} />
        <Stat icon="🔓" label="Open Tickets"     value={Number(kpis?.open_tickets || 0).toLocaleString()} color={C.yellow} sub="Awaiting resolution" />
        <Stat icon="🚫" label="Spam Tickets"     value={Number(kpis?.email_spam || 0).toLocaleString()} color={C.red} sub="Filtered out" />
        <Stat icon="👤" label="Email Agents"     value={kpis?.email_agents || 0} sub="Active assignees" />
        <Stat icon="🏢" label="Departments"      value={data?.length || 0} sub="Unique email addresses" />
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <SectionTitle title="Top 12 Departments — Ticket Volume" sub="Closed (indigo) vs open (yellow)" />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barCategoryGap="30%" layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3155" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
              <Bar dataKey="closed" stackId="a" fill={C.indigo} name="Closed" />
              <Bar dataKey="open"   stackId="a" fill={C.yellow} name="Open" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <SectionTitle title="Ticket Products / Topics" sub="What customers are enquiring about" />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={products || []} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3155" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="product" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={110} />
              <Tooltip contentStyle={TT} />
              <Bar dataKey="count" fill={C.teal} name="Tickets" radius={[0, 4, 4, 0]}>
                {(products || []).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <SectionTitle title="Department Detail" sub={`${data?.length || 0} email departments`} />
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Department</th><th>Email Address</th><th>Total</th>
              <th>Open</th><th>Closed</th><th>Close Rate</th>
              <th>Agents</th><th>High Priority</th><th>Attachments</th><th>Top Product</th>
            </tr></thead>
            <tbody>
              {data?.map((r, i) => (
                <tr key={i}>
                  <td><span className="badge badge-indigo">{r.department_name || '—'}</span></td>
                  <td style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{r.department_email}</td>
                  <td><strong>{r.total_tickets}</strong></td>
                  <td style={{ color: C.yellow }}>{r.open_tickets}</td>
                  <td style={{ color: C.green }}>{r.closed_tickets}</td>
                  <td style={{ minWidth: 150 }}><GradeBar pct={parseFloat(r.close_rate_pct)} /></td>
                  <td>{r.active_agents}</td>
                  <td><span className={r.high_priority > 0 ? 'badge badge-orange' : ''}>{r.high_priority || 0}</span></td>
                  <td>{r.tickets_with_attachments}</td>
                  <td style={{ color: '#94a3b8', fontSize: 11 }}>{r.top_product || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Travel & Bookings ─────────────────────────────────────────
function Travel() {
  const kpis          = useFetch(`${API}/kpis`)
  const services      = useFetch(`${API}/travel-services`)
  const nationalities = useFetch(`${API}/travel-nationalities`)
  const types         = useFetch(`${API}/travel-types`)

  const typeMap = { tours: C.indigo, onlinetour: C.blue, hotel: C.teal, visa: C.green, package: C.purple, intlvisa: C.orange, ticket: C.yellow }

  return (
    <>
      <div className="page-header">
        <h1>Travel & Bookings</h1>
        <p>Tours, hotels, visas and booking analytics</p>
      </div>

      <div className="kpi-grid">
        <Stat icon="✈️" label="Total Bookings" value={Number(kpis?.total_bookings || 0).toLocaleString()} sub="All travel orders" />
        <Stat icon="💰" label="Total Revenue"  value={`AED ${Number(kpis?.total_revenue || 0).toLocaleString()}`} color={C.green} sub="From paid tickets" />
        <Stat icon="🌍" label="Top Origin"     value="India" sub="515 bookings · 33%" color={C.orange} />
        <Stat icon="🏆" label="Top Service"    value="Tours" sub="1,036 bookings · 66%" color={C.indigo} />
        <Stat icon="🏨" label="Hotels"         value={(types?.find(t => t.bill_type === 'hotel')?.count || 0)} sub="Hotel bookings" />
        <Stat icon="🛂" label="Visas"          value={(types?.find(t => t.bill_type === 'visa')?.count || 0) + (types?.find(t => t.bill_type === 'intlvisa')?.count || 0)} sub="Visa services" />
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <SectionTitle title="Top Services Booked" sub="Most popular travel services and experiences" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={services || []} layout="vertical" margin={{ left: 10, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3155" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="service_name" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={180} />
              <Tooltip contentStyle={TT} />
              <Bar dataKey="count" name="Bookings" radius={[0, 4, 4, 0]}>
                {(services || []).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <SectionTitle title="Booking Type Breakdown" sub="Distribution by service category" />
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={types || []} dataKey="count" nameKey="bill_type"
                   cx="50%" cy="50%" outerRadius={100} innerRadius={45}
                   label={({ bill_type, percent }) => `${bill_type} ${(percent * 100).toFixed(0)}%`}
                   labelLine={false}>
                {(types || []).map((t, i) => <Cell key={i} fill={typeMap[t.bill_type] || PALETTE[i]} />)}
              </Pie>
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <SectionTitle title="Guest Nationalities" sub="Top 12 nationalities of travel guests" />
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={nationalities || []} barCategoryGap="30%" margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3155" vertical={false} />
            <XAxis dataKey="nationality" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TT} />
            <Bar dataKey="count" name="Guests" radius={[4, 4, 0, 0]}>
              {(nationalities || []).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// ── Agents ────────────────────────────────────────────────────
function Agents() {
  const [tab, setTab] = useState('whatsapp')
  const waAgents    = useFetch(`${API}/top-agents/whatsapp`)
  const emailAgents = useFetch(`${API}/top-agents/email`)
  const data = tab === 'whatsapp' ? waAgents : emailAgents

  const topChartData = (data || []).slice(0, 10).map(r => ({
    name: `#${r.agent_id}`,
    volume: tab === 'whatsapp' ? Number(r.total_chats) : Number(r.total_tickets),
    closed: tab === 'whatsapp' ? Number(r.closed_chats) : Number(r.closed_tickets),
  }))

  return (
    <>
      <div className="page-header">
        <h1>Agent Performance</h1>
        <p>Individual agent productivity across all channels</p>
      </div>
      <div className="tabs">
        <div className={`tab ${tab === 'whatsapp' ? 'active' : ''}`} onClick={() => setTab('whatsapp')}>💬 WhatsApp Agents</div>
        <div className={`tab ${tab === 'email' ? 'active' : ''}`} onClick={() => setTab('email')}>📧 Email Agents</div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <SectionTitle title={`Top 10 Agents — ${tab === 'whatsapp' ? 'WhatsApp' : 'Email'}`} sub="Volume handled vs closed" />
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={topChartData} barGap={2} margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3155" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TT} />
            <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
            <Bar dataKey="volume" fill={tab === 'whatsapp' ? C.indigo : C.blue} name="Total" radius={[3, 3, 0, 0]} />
            <Bar dataKey="closed" fill={C.green} name="Closed" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <SectionTitle title="Agent Leaderboard" sub="Ranked by volume handled" />
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Rank</th><th>Agent ID</th><th>Department</th>
              <th>{tab === 'whatsapp' ? 'Chats' : 'Tickets'}</th>
              <th>Closed</th><th>Close Rate</th>
              {tab === 'whatsapp' && <th>Avg Resp (min)</th>}
              {tab === 'email'    && <th>Thread Depth</th>}
              <th>Performance</th>
            </tr></thead>
            <tbody>
              {data?.map((r, i) => {
                const volume = tab === 'whatsapp' ? r.total_chats : r.total_tickets
                const closed = tab === 'whatsapp' ? r.closed_chats : r.closed_tickets
                const pct    = parseFloat(r.close_rate_pct)
                const extra  = tab === 'whatsapp' ? r.avg_response_min : r.avg_thread_depth
                return (
                  <tr key={i}>
                    <td style={{ color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#f97316' : '#64748b', fontWeight: i < 3 ? 700 : 400 }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </td>
                    <td><span className="badge badge-gray">{r.agent_id}</span></td>
                    <td style={{ fontSize: 12, color: '#94a3b8' }}>
                      {tab === 'whatsapp'
                        ? <span style={{ fontFamily: 'monospace' }}>…{r.department_phone?.slice(-6)}</span>
                        : <span className="badge badge-indigo">{r.department_name || '—'}</span>}
                    </td>
                    <td><strong>{volume}</strong></td>
                    <td style={{ color: C.green }}>{closed}</td>
                    <td style={{ minWidth: 150 }}><GradeBar pct={pct} /></td>
                    <td style={{ color: '#94a3b8' }}>{extra ?? '—'}</td>
                    <td>
                      <span className={`badge ${pct >= 80 ? 'badge-green' : pct >= 60 ? 'badge-blue' : pct >= 40 ? 'badge-yellow' : 'badge-red'}`}>
                        {pct >= 80 ? 'Excellent' : pct >= 60 ? 'Good' : pct >= 40 ? 'Average' : 'Poor'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Customer Segments ─────────────────────────────────────────
function Segments() {
  const segments = useFetch(`${API}/segments`)
  const stats    = useFetch(`${API}/segment-stats`)
  const kpis     = useFetch(`${API}/kpis`)

  const emailSegs = segments?.filter(s => s.identifier_type === 'email') || []
  const waSegs    = segments?.filter(s => s.identifier_type === 'whatsapp') || []

  const toPie = (arr) => Object.entries(
    arr.reduce((a, r) => { a[r.segment_label] = (a[r.segment_label] || 0) + Number(r.count); return a }, {})
  ).map(([name, value]) => ({ name, value }))

  const emailPie = toPie(emailSegs)
  const waPie    = toPie(waSegs)
  const totalEmail = emailPie.reduce((a, r) => a + r.value, 0)
  const totalWa    = waPie.reduce((a, r) => a + r.value, 0)

  const reachabilityData = [
    { name: 'WA Only', value: Number(kpis?.wa_profiles || 0) - Number(kpis?.email_profiles || 0), fill: C.green },
    { name: 'Email Only', value: Number(kpis?.email_profiles || 0), fill: C.blue },
  ].filter(d => d.value > 0)

  return (
    <>
      <div className="page-header">
        <h1>Customer Segments</h1>
        <p>360° customer view — {(totalEmail + totalWa).toLocaleString()} total profiles</p>
      </div>

      <div className="kpi-grid">
        <Stat icon="👥" label="Total Profiles"    value={(totalEmail + totalWa).toLocaleString()} sub="Unified customer base" />
        <Stat icon="📧" label="Email Profiles"    value={totalEmail.toLocaleString()} color={C.blue} sub="Email-based identities" />
        <Stat icon="📲" label="WhatsApp Only"     value={totalWa.toLocaleString()} color={C.green} sub="WA-only contacts" />
        <Stat icon="📩" label="Can Email"         value={Number(kpis?.can_email || 0).toLocaleString()} color={C.blue} sub="Email reachable" />
        <Stat icon="💬" label="Can WhatsApp"      value={Number(kpis?.can_whatsapp || 0).toLocaleString()} color={C.green} sub="WA reachable" />
        <Stat icon="⭐" label="High Value"        value={emailSegs.filter(s => s.segment_label === 'High Value').reduce((a, s) => a + Number(s.count), 0)} color={C.green} sub="3+ bookings" />
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <SectionTitle title="Email Customer Segments" sub={`${totalEmail.toLocaleString()} email profiles`} />
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={emailPie} dataKey="value" cx="50%" cy="50%" outerRadius={90} innerRadius={40}
                   label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                   labelLine={false}>
                {emailPie.map((e, i) => <Cell key={i} fill={SEG_COLORS[e.name] || C.indigo} />)}
              </Pie>
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <SectionTitle title="WhatsApp-Only Segments" sub={`${totalWa.toLocaleString()} WA-only profiles`} />
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={waPie} dataKey="value" cx="50%" cy="50%" outerRadius={90} innerRadius={40}
                   label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                   labelLine={false}>
                {waPie.map((e, i) => <Cell key={i} fill={SEG_COLORS[e.name] || C.green} />)}
              </Pie>
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <SectionTitle title="Segment Breakdown" sub="Count and share by segment" />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Segment</th><th>Channel</th><th>Count</th><th>Share</th></tr></thead>
              <tbody>
                {segments?.map((r, i) => {
                  const total = r.identifier_type === 'email' ? totalEmail : totalWa
                  const pct = ((r.count / total) * 100).toFixed(1)
                  return (
                    <tr key={i}>
                      <td>
                        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: SEG_COLORS[r.segment_label] || C.indigo, marginRight: 8 }} />
                        {r.segment_label}
                      </td>
                      <td><span className={`badge ${r.identifier_type === 'email' ? 'badge-blue' : 'badge-green'}`}>{r.identifier_type}</span></td>
                      <td><strong>{Number(r.count).toLocaleString()}</strong></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="progress" style={{ width: 80 }}>
                            <div className="progress-fill" style={{ width: `${pct}%`, background: SEG_COLORS[r.segment_label] || C.indigo }} />
                          </div>
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {stats && (
          <div className="card">
            <SectionTitle title="B2B vs B2C Analysis" sub="Customer type comparison" />
            <div className="table-wrap">
              <table>
                <thead><tr><th>Type</th><th>Total</th><th>Can Email</th><th>Can WA</th><th>Avg Bookings</th><th>Avg Interactions</th></tr></thead>
                <tbody>
                  {stats.map((r, i) => (
                    <tr key={i}>
                      <td><span className={`badge ${r.customer_type === 'B2B' ? 'badge-purple' : 'badge-blue'}`}>{r.customer_type}</span></td>
                      <td><strong>{Number(r.total).toLocaleString()}</strong></td>
                      <td>{Number(r.can_email).toLocaleString()}</td>
                      <td>{Number(r.can_whatsapp).toLocaleString()}</td>
                      <td><span style={{ color: C.green }}>{r.avg_bookings}</span></td>
                      <td>{r.avg_frequency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── App shell ─────────────────────────────────────────────────
const PAGES = [
  { id: 'overview', label: 'Overview',       icon: '📊' },
  { id: 'whatsapp', label: 'WhatsApp',        icon: '💬' },
  { id: 'email',    label: 'Email Tickets',   icon: '📧' },
  { id: 'travel',   label: 'Travel',          icon: '✈️' },
  { id: 'agents',   label: 'Agents',          icon: '👥' },
  { id: 'segments', label: 'Segments',        icon: '🎯' },
]

export default function App() {
  const [page, setPage] = useState('overview')
  const views = {
    overview: <Overview />, whatsapp: <WhatsAppDepts />,
    email: <EmailDepts />, travel: <Travel />,
    agents: <Agents />, segments: <Segments />,
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-logo">Rayna <span>Analytics</span></div>
        <div className="nav-items">
          {PAGES.map(p => (
            <div key={p.id} className={`nav-item ${page === p.id ? 'active' : ''}`} onClick={() => setPage(p.id)}>
              <span>{p.icon}</span><span>{p.label}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '16px 20px', fontSize: 11, color: '#475569', borderTop: '1px solid #2d3155' }}>
          Rayna Tours Analytics<br />Data last synced: Feb 2026
        </div>
      </nav>
      <main className="main">{views[page]}</main>
    </div>
  )
}
