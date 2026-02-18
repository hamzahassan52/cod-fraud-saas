'use client';

import React from 'react';
import clsx from 'clsx';

interface CardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export function Card({ title, subtitle, children, className, action }: CardProps) {
  return (
    <div className={clsx('rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4 dark:border-slate-700">
          <div>
            {title && <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h3>}
            {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {action && <div className="ml-4 flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className="px-6 py-4">{children}</div>
    </div>
  );
}
