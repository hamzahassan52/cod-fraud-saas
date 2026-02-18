'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DataPoint {
  date: string;
  revenue_saved: number;
}

interface Props {
  data: DataPoint[];
}

export function RevenueSavedChart({ data }: Props) {
  if (!data || data.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-gray-400 dark:text-slate-500">No data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-slate-700" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          className="text-gray-500 dark:text-slate-400"
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
          className="text-gray-500 dark:text-slate-400"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--tooltip-bg, #fff)',
            border: '1px solid var(--tooltip-border, #e5e7eb)',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          formatter={(value: number) => [`PKR ${value.toLocaleString()}`, 'Revenue Saved']}
        />
        <Line
          type="monotone"
          dataKey="revenue_saved"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
