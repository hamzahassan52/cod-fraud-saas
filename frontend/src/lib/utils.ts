import { type ClassValue, clsx } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(amount: number, currency = 'PKR') {
  return `${currency} ${amount.toLocaleString()}`;
}

export function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function getRiskColor(score: number): string {
  if (score >= 70) return 'text-red-600 dark:text-red-400';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}

export function getRiskBg(score: number): string {
  if (score >= 70) return 'bg-red-100 dark:bg-red-900/30';
  if (score >= 40) return 'bg-amber-100 dark:bg-amber-900/30';
  return 'bg-green-100 dark:bg-green-900/30';
}
