import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Isolate mixed-direction user data from the surrounding interface. */
export function BidiText({
  children,
  direction = 'auto',
  className,
  ...props
}: {
  children: ReactNode;
  direction?: 'auto' | 'ltr' | 'rtl';
} & Omit<HTMLAttributes<HTMLElement>, 'dir' | 'children'>) {
  return (
    <bdi dir={direction} className={cn('unicode-isolate', className)} {...props}>
      {children}
    </bdi>
  );
}
