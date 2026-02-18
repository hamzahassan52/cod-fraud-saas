'use client';

import React from 'react';
import clsx from 'clsx';

interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;
  changeType?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
  highlight?: boolean;
}

export function StatCard({ label, value, change, changeType = 'neutral', icon, highlight }: StatCardProps) {
  return (
    <div className={clsx(
      'rounded-xl border px-6 py-5 shadow-sm',
      highlight
        ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
        : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800'
    )}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-500 dark:text-slate-400">{label}</p>
          <p className={clsx('mt-2 text-3xl font-bold', highlight ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-slate-100')}>{value}</p>
          {change !== undefined && (
            <div className="mt-2 flex items-center gap-1">
              <span className={clsx('text-sm font-medium', {
                'text-green-600 dark:text-green-400': changeType === 'up',
                'text-red-600 dark:text-red-400': changeType === 'down',
                'text-gray-500 dark:text-slate-400': changeType === 'neutral',
              })}>
                {changeType === 'up' && (
                  <svg className="mr-0.5 inline h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
                  </svg>
                )}
                {changeType === 'down' && (
                  <svg className="mr-0.5 inline h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5l15 15m0 0V8.25m0 11.25H8.25" />
                  </svg>
                )}
                {change > 0 ? '+' : ''}{change}%
              </span>
              <span className="text-xs text-gray-400 dark:text-slate-500">vs last period</span>
            </div>
          )}
        </div>
        {icon && (
          <div className="ml-4 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
