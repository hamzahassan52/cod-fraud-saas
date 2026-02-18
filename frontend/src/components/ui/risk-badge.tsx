'use client';

import React from 'react';
import clsx from 'clsx';

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface RiskBadgeProps {
  level: RiskLevel;
  score?: number;
}

const levelClasses: Record<RiskLevel, string> = {
  LOW: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  MEDIUM: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  HIGH: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  CRITICAL: 'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-300',
};

const dotClasses: Record<RiskLevel, string> = {
  LOW: 'bg-green-500',
  MEDIUM: 'bg-yellow-500',
  HIGH: 'bg-red-500',
  CRITICAL: 'bg-red-700',
};

export function RiskBadge({ level, score }: RiskBadgeProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', levelClasses[level])}>
        <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', dotClasses[level])} />
        {level}
      </span>
      {score !== undefined && (
        <span className="text-sm font-medium text-gray-600 dark:text-slate-400">{score}</span>
      )}
    </span>
  );
}
