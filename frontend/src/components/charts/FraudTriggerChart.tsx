'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DataPoint {
  signal_name: string;
  count: number;
}

interface Props {
  data: DataPoint[];
}

export function FraudTriggerChart({ data }: Props) {
  if (!data || data.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-gray-400 dark:text-slate-500">No data</div>;
  }

  const formatted = data.slice(0, 8).map((d) => ({
    name: d.signal_name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    count: parseInt(String(d.count)),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={formatted} layout="vertical" margin={{ top: 5, right: 20, left: 100, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-slate-700" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={90} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--tooltip-bg, #fff)',
            border: '1px solid var(--tooltip-border, #e5e7eb)',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
