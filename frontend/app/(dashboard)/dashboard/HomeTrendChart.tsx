'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';

// 14-day "messages sent" chart for the Home screen, stacked by channel. Loaded lazily
// (next/dynamic) like SegmentBarChart so Recharts stays out of the initial bundle.
export interface HomeTrendDatum { name: string; email: number; whatsapp: number; sms: number }
interface HomeTrendChartProps { data: HomeTrendDatum[] }

const fmt = (v: number) => Number(v || 0).toLocaleString();

export default function HomeTrendChart({ data }: HomeTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="name" tick={{ fill: 'var(--ink3)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: 'var(--ink3)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmt} width={48} />
        <Tooltip
          formatter={(v) => fmt(Number(v))}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--ink)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="email" name="Email" stackId="s" fill="var(--info)" />
        <Bar dataKey="whatsapp" name="WhatsApp" stackId="s" fill="var(--ok)" />
        <Bar dataKey="sms" name="SMS" stackId="s" fill="var(--gold)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
