import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';

import { inputClasses } from './Input';

export function SearchInput({
  onSearch,
  placeholder,
  className,
  initialValue = '',
}: {
  onSearch: (term: string) => void;
  placeholder?: string;
  className?: string;
  initialValue?: string;
}) {
  const { t } = useTranslation('common');
  const [value, setValue] = useState(initialValue);
  const debounced = useDebounce(value, 300);

  useEffect(() => {
    onSearch(debounced.trim().replace(/\s+/g, ' '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder ?? t('actions.search')}
        aria-label={placeholder ?? t('actions.search')}
        className={cn(inputClasses, 'ps-9')}
      />
    </div>
  );
}
