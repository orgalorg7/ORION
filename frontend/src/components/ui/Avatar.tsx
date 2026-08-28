import { cn } from '@/lib/utils';

const palette = [
  'bg-primary-600',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-stone-600',
  'bg-orange-600',
  'bg-lime-700',
  'bg-yellow-700',
  'bg-neutral-600',
];

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  const sizeClasses = {
    sm: 'h-7 w-7 text-[10px]',
    md: 'h-9 w-9 text-xs',
    lg: 'h-14 w-14 text-lg',
  };

  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-lg font-semibold text-white shadow-sm',
        palette[hashCode(name || '?') % palette.length],
        sizeClasses[size],
        className,
      )}
    >
      {initials || '?'}
    </span>
  );
}
