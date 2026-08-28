import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export const inputClasses = cn(
  'block w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-sm text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_2px_rgba(76,52,24,0.04)] transition-[border-color,box-shadow,background-color]',
  'placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/25',
  'disabled:cursor-not-allowed disabled:bg-surface-muted/70 disabled:text-gray-500',
  'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500',
  'dark:disabled:bg-gray-800 dark:disabled:text-gray-400',
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, dir, type = 'text', ...props }, ref) {
    const ltrTypes = ['email', 'tel', 'url', 'number', 'date', 'datetime-local', 'time', 'password'];
    return (
      <input
        ref={ref}
        type={type}
        dir={dir ?? (ltrTypes.includes(type) ? 'ltr' : 'auto')}
        className={cn(inputClasses, className)}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, dir = 'auto', ...props }, ref) {
    return <textarea ref={ref} rows={rows} dir={dir} className={cn(inputClasses, className)} {...props} />;
  },
);
