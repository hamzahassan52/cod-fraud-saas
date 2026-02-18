'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DataPoint {
  date: string;
  high: number;
  medium: number;
  low: number;
}

interface Props {
  data: DataPoint[];
}

export function RiskTrendChart({ data }: Props) {
  if (!data || data.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-gray-400 dark:text-slate-500">No data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-slate-700" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--tooltip-bg, #fff)',
            border: '1px solid var(--tooltip-border, #e5e7eb)',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Area type="monotone" dataKey="high" stackId="1" stroke="#ef4444" fill="#fecaca" fillOpacity={0.6} />
        <Area type="monotone" dataKey="medium" stackId="1" stroke="#f59e0b" fill="#fef3c7" fillOpacity={0.6} />
        <Area type="monotone" dataKey="low" stackId="1" stroke="#22c55e" fill="#dcfce7" fillOpacity={0.6} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
