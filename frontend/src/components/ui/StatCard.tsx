import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Card } from './Card';

export function StatCard({
  label,
  value,
  icon,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden p-5 [container-type:inline-size]', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium leading-snug text-muted dark:text-gray-400">{label}</p>
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-100/80 text-primary-700 shadow-[inset_0_0_0_1px_rgba(213,169,40,0.2)] dark:bg-primary-400 dark:text-gray-950 dark:shadow-sm">
            {icon}
          </div>
        )}
      </div>
      <p
        dir="auto"
        className="mt-3 max-w-full text-start text-[clamp(1.125rem,12cqi,1.5rem)] font-bold leading-tight tabular-nums tracking-tight text-ink [overflow-wrap:anywhere] [unicode-bidi:isolate] dark:text-gray-50"
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs leading-snug text-muted dark:text-gray-400">{hint}</p>}
    </Card>
  );
}
