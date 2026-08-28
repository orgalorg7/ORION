import { cn } from '@/lib/utils';

export function BrandLogo({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <img
        src="/brand/korzah-app-icon-256.png"
        alt="Korzah"
        dir="ltr"
        className={cn('block aspect-square object-cover', className)}
      />
    );
  }

  return (
    <span
      dir="ltr"
      className={cn('block overflow-hidden bg-black', className)}
      aria-label="Korzah"
      role="img"
    >
      <img
        src="/brand/korzah-wordmark-master.png"
        alt=""
        className="h-full w-full scale-[1.04] object-cover object-center"
      />
    </span>
  );
}
