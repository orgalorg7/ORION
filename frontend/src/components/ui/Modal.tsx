import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: keyof typeof sizes;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t, i18n } = useTranslation('common');
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="fixed inset-0 bg-gray-950/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={i18n.dir()}
        className={cn(
          'relative z-10 my-8 w-full overflow-hidden rounded-[10px] bg-surface-raised shadow-[0_28px_80px_-24px_rgba(38,27,14,0.45)] ring-1 ring-line dark:bg-gray-900 dark:ring-gray-800',
          sizes[size],
        )}
      >
        <div className="flex items-center justify-between border-b border-line bg-surface/60 px-5 py-4 dark:border-gray-800 dark:bg-transparent">
          <h2 id={titleId} className="font-display text-base font-semibold tracking-[-0.015em] text-gray-900 dark:text-gray-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('actions.close')}
            className="rounded-lg p-1 text-gray-400 hover:bg-surface-muted hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 border-t border-line bg-surface/45 px-5 py-4 dark:border-gray-800 dark:bg-transparent">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
