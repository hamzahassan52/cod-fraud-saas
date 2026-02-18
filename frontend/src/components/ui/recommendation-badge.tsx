'use client';

import React from 'react';
import clsx from 'clsx';

type Recommendation = 'APPROVE' | 'VERIFY' | 'BLOCK';

interface RecommendationBadgeProps {
  recommendation: Recommendation;
}

const config: Record<Recommendation, { bg: string; icon: React.ReactNode }> = {
  APPROVE: {
    bg: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    ),
  },
  VERIFY: {
    bg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
    ),
  },
  BLOCK: {
    bg: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
  },
};

export function RecommendationBadge({ recommendation }: RecommendationBadgeProps) {
  const { bg, icon } = config[recommendation];
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', bg)}>
      {icon}
      {recommendation}
    </span>
  );
}
