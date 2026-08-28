import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

import { Spinner } from './Spinner';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
}

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-primary-500 text-gray-950 shadow-[0_1px_0_rgba(255,255,255,0.24),0_8px_18px_-12px_rgba(87,56,23,0.75)] hover:bg-primary-400 focus-visible:outline-primary-600 disabled:hover:bg-primary-500',
  secondary:
    'border border-primary-200/80 bg-primary-100/65 text-primary-800 hover:bg-primary-100 dark:border-transparent dark:bg-primary-400/10 dark:text-primary-300 dark:hover:bg-primary-400/20',
  outline:
    'border border-line-strong bg-surface-raised text-gray-700 shadow-[0_1px_0_rgba(255,255,255,0.8)] hover:border-primary-300 hover:bg-primary-50/60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800',
  ghost:
    'text-gray-600 hover:bg-surface-muted hover:text-ink dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600',
};

const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-md font-semibold transition-[background-color,color,border-color,box-shadow,transform] duration-200 active:translate-y-px',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});
