import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-100/70 text-primary-700 ring-1 ring-inset ring-primary-200/60 dark:bg-primary-400/10 dark:text-primary-300 dark:ring-0">
          {icon}
        </div>
      )}
      <h3 className="font-display text-sm font-semibold text-ink dark:text-gray-100">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted dark:text-gray-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
