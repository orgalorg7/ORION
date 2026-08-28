import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface TabItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-line dark:border-gray-800', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            value === item.value
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
              : 'border-transparent text-muted hover:border-line-strong hover:bg-surface/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-transparent dark:hover:text-gray-200',
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
