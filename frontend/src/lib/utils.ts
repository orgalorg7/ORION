import { clsx, type ClassValue } from 'clsx';

import i18n from '@/i18n';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function isRtl(): boolean {
  return i18n.dir() === 'rtl';
}

/** Arabic UI uses Latin business digits consistently while retaining Arabic labels/months. */
export function activeLocale(): string {
  return isRtl() ? 'ar-EG-u-nu-latn' : 'en-US';
}

function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Date-only values are business dates, not UTC timestamps. Parsing at noon
  // prevents the browser timezone from moving them to the previous day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00`);
  return new Date(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(activeLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(activeLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatCurrency(
  value: number | string | null | undefined,
  currency = 'USD',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(amount)) return '—';
  const formatted = new Intl.NumberFormat(activeLocale(), {
    style: 'currency',
    currency,
    // Currency codes are more stable than mirrored symbols in mixed RTL/LTR
    // content (for example, "50,000 USD" cannot become a visual "$US").
    currencyDisplay: isRtl() ? 'code' : 'narrowSymbol',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
  if (!isRtl()) return formatted;

  // Intl adds an RTL mark for Arabic currency output. Isolate the resulting
  // business value as LTR so its visual order stays "50,000 USD" everywhere.
  const withoutDirectionalMarks = formatted.replace(/[\u061c\u200e\u200f]/g, '').trim();
  return `\u2066${withoutDirectionalMarks}\u2069`;
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat(activeLocale()).format(amount);
}

export function fullName(entity: { first_name?: string; last_name?: string } | null | undefined): string {
  if (!entity) return '—';
  return `${entity.first_name ?? ''} ${entity.last_name ?? ''}`.trim() || '—';
}

/** Format an ISO month key like "2026-08" as a localized short month label. */
export function formatMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  if (!year || !m) return month;
  return new Intl.DateTimeFormat(activeLocale(), { month: 'short', year: '2-digit' }).format(
    new Date(year, m - 1, 1),
  );
}

export function formatRelativeTime(value: string | Date, now = new Date()): string {
  const date = parseDate(value);
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(activeLocale(), { numeric: 'auto' });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size || unit === 'minute') {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(seconds, 'second');
}
