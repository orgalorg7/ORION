import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[10px] border border-line/90 bg-surface-raised shadow-[0_1px_0_rgba(255,255,255,0.9),0_16px_38px_-30px_rgba(76,52,24,0.58)] dark:border-gray-800 dark:bg-gray-900 dark:shadow-black/20',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-line/80 bg-surface/55 px-5 py-4 dark:border-gray-800 dark:bg-transparent', className)}>
      <div className="min-w-0">
        <h3 className="text-balance font-display text-sm font-semibold tracking-[-0.01em] text-ink dark:text-gray-100">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted dark:text-gray-400">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}
