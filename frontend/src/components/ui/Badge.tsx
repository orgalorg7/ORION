import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type BadgeColor =
  | 'gray'
  | 'blue'
  | 'green'
  | 'red'
  | 'amber'
  | 'purple'
  | 'indigo'
  | 'cyan'
  | 'pink';

const colors: Record<BadgeColor, string> = {
  gray: 'bg-surface-muted text-gray-700 ring-1 ring-inset ring-line/70 dark:bg-gray-800 dark:text-gray-300 dark:ring-0',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
};

export function Badge({
  color = 'gray',
  className,
  children,
}: {
  color?: BadgeColor;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold',
        colors[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
