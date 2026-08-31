import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  emptyState,
  selectedKeys,
  onSelectionChange,
  rowLabel,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyState?: ReactNode;
  selectedKeys?: Set<string | number>;
  onSelectionChange?: (keys: Set<string | number>) => void;
  rowLabel?: (row: T) => string;
}) {
  const { t } = useTranslation('common');
  const selectable = Boolean(selectedKeys && onSelectionChange);
  const visibleKeys = rows.map(rowKey);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys?.has(key));

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-auto [contain:layout_paint]">
      <table className="w-full min-w-max text-start text-sm">
        <thead className="bg-surface/70 dark:bg-transparent">
          <tr className="border-b border-line dark:border-gray-800">
            {selectable && (
              <th scope="col" className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  aria-label={t('customerCore.selectAll')}
                  onChange={(event) => {
                    const next = new Set(selectedKeys);
                    visibleKeys.forEach((key) => event.target.checked ? next.add(key) : next.delete(key));
                    onSelectionChange?.(next);
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-900"
                />
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/55 dark:divide-gray-800/70">
          {loading
            ? Array.from({ length: 5 }).map((_, index) => (
                <tr key={index}>
                  {selectable && <td className="px-4 py-3.5"><div className="h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td>}
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3.5">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(
                    'transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-primary-50/45 dark:hover:bg-gray-800/50',
                  )}
                >
                  {selectable && (
                    <td className="w-12 px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedKeys?.has(rowKey(row)) ?? false}
                        aria-label={t('customerCore.selectRow', { name: rowLabel?.(row) ?? rowKey(row) })}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const key = rowKey(row);
                          const next = new Set(selectedKeys);
                          if (event.target.checked) next.add(key); else next.delete(key);
                          onSelectionChange?.(next);
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-900"
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      dir="auto"
                      className={cn('px-4 py-3.5 text-gray-700 dark:text-gray-300', column.className)}
                    >
                      {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {emptyState ?? t('state.empty')}
        </div>
      )}
    </div>
  );
}
