import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { customerCoreApi } from '@/api/customerCore';
import { Checkbox, FormField, Input, Select, Textarea } from '@/components/ui';
import type { CustomFieldValues, ImportJob } from '@/types';

function optionValue(option: string | { value: string; label?: string }) { return typeof option === 'string' ? option : option.value; }
function optionLabel(option: string | { value: string; label?: string }) { return typeof option === 'string' ? option : option.label || option.value; }

export function CustomFieldsEditor({ target, values, onChange }: {
  target: ImportJob['target_object'];
  values: CustomFieldValues;
  onChange: (values: CustomFieldValues) => void;
}) {
  const { data } = useQuery({ queryKey: ['custom-fields', target], queryFn: () => customerCoreApi.customFields(target) });
  if (!data?.results.length) return null;
  return <div className="sm:col-span-2 grid grid-cols-1 gap-4 border-t border-gray-200 pt-4 sm:grid-cols-2 dark:border-gray-800">{data.results.map((field) => {
    const value = values[field.key];
    const set = (next: unknown) => onChange({ ...values, [field.key]: next });
    if (field.data_type === 'boolean') return <Checkbox key={field.id} checked={Boolean(value)} onChange={(event) => set(event.target.checked)} label={field.label} />;
    if (field.data_type === 'select') return <FormField key={field.id} label={field.label} required={field.required}><Select value={String(value ?? '')} onChange={(event) => set(event.target.value)}><option value=""></option>{field.options.map((option) => <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>)}</Select></FormField>;
    if (field.data_type === 'multi_select') return <FormField key={field.id} label={field.label} required={field.required}><Select multiple value={Array.isArray(value) ? value.map(String) : []} onChange={(event) => set(Array.from(event.target.selectedOptions, (option) => option.value))}>{field.options.map((option) => <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>)}</Select></FormField>;
    if (field.data_type === 'textarea') return <FormField key={field.id} label={field.label} required={field.required}><Textarea value={String(value ?? '')} onChange={(event) => set(event.target.value)} /></FormField>;
    const type = field.data_type === 'date' ? 'date' : field.data_type === 'datetime' ? 'datetime-local' : field.data_type === 'email' ? 'email' : field.data_type === 'url' ? 'url' : field.data_type === 'phone' ? 'tel' : ['integer', 'decimal', 'currency'].includes(field.data_type) ? 'number' : 'text';
    return <FormField key={field.id} label={field.label} required={field.required}><Input type={type} step={field.data_type === 'integer' ? '1' : undefined} value={String(value ?? '')} onChange={(event) => set(event.target.value)} dir={['email', 'phone', 'url'].includes(field.data_type) ? 'ltr' : undefined} /></FormField>;
  })}</div>;
}

export function CustomFieldsSummary({ values }: { values: CustomFieldValues }) {
  const { t } = useTranslation('common');
  const entries = Object.entries(values);
  return <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"><h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('customerCore.customFields')}</h3>{entries.length === 0 ? <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t('customerCore.customFieldsEmpty')}</p> : <dl className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">{entries.map(([key, value]) => <div key={key} className="grid grid-cols-2 gap-3 py-2 text-sm"><dt className="text-gray-500 dark:text-gray-400">{key.replace(/_/g, ' ')}</dt><dd className="text-end font-medium text-gray-900 dark:text-gray-100">{Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd></div>)}</dl>}</div>;
}
