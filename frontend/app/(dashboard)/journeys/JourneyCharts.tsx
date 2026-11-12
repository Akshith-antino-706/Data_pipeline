'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

// Chart for the journey detail page ("People at each step", on the Advanced tab). Loaded lazily (next/dynamic) like the other
// Recharts charts so Recharts stays out of the initial bundle.

const fmt = (v: unknown) => (Number(v) || 0).toLocaleString('en-US');
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--ink)' };
const tick = { fill: 'var(--ink3)', fontSize: 12 };

/** One step: people on it now, and (when known) people who are done with it. */
export interface StepDatum { name: string; now: number; done: number | null }

export function JourneyStepChart({ data, onSelect, selectedIndex }: { data: StepDatum[]; onSelect: (index: number) => void; selectedIndex: number | null }) {
  const stacked = data.some(d => d.done !== null && d.done > 0);
  const rows = data.map(d => ({ ...d, done: d.done ?? 0 }));
  const pick = (_: unknown, index: number) => onSelect(index);
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 38 + (stacked ? 48 : 16))}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke="var(--line)" />
        <XAxis type="number" allowDecimals={false} tick={tick} tickFormatter={fmt} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
        <YAxis type="category" dataKey="name" width={140} tick={tick} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: 'var(--sunken)' }} formatter={(v, n) => [fmt(v), String(n)]} contentStyle={tooltipStyle} />
        {stacked && <Legend wrapperStyle={{ fontSize: 12 }} />}
        <Bar dataKey="now" name="On this step now" stackId="s" fill="var(--gold)" cursor="pointer" onClick={pick} isAnimationActive={false}>
          {rows.map((d, i) => <Cell key={d.name} fillOpacity={selectedIndex === null || selectedIndex === i ? 1 : 0.45} />)}
        </Bar>
        {stacked && (
          <Bar dataKey="done" name="Done" stackId="s" fill="var(--ok)" radius={[0, 6, 6, 0]} cursor="pointer" onClick={pick} isAnimationActive={false}>
            {rows.map((d, i) => <Cell key={d.name} fillOpacity={selectedIndex === null || selectedIndex === i ? 1 : 0.45} />)}
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
