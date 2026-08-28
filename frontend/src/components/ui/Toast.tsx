import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

import { cn } from '@/lib/utils';

export interface Toast {
  id: number;
  type: 'success' | 'error';
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (type: Toast['type'], message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (type, message) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, 4000);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Imperative toast helpers — usable inside and outside components. */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
};

export function Toaster() {
  const { t, i18n } = useTranslation('common');
  const { toasts, dismiss } = useToastStore();
  return (
    <div
      className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
      dir={i18n.dir()}
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-lg border p-3.5 text-sm shadow-lg',
            item.type === 'success'
              ? 'border-emerald-200 bg-surface-raised text-emerald-800 dark:border-emerald-500/30 dark:bg-gray-900 dark:text-emerald-300'
              : 'border-red-200 bg-surface-raised text-red-800 dark:border-red-500/30 dark:bg-gray-900 dark:text-red-300',
          )}
        >
          {item.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="flex-1">{item.message}</p>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            aria-label={t('actions.close')}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
