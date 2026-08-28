import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, ...props },
  ref,
) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="h-4 w-4 rounded border-line-strong bg-surface-raised text-primary-600 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
        {...props}
      />
      {label}
    </label>
  );
});
