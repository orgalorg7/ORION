import { useMutation, useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { customerCoreApi } from '@/api/customerCore';
import { Button, FormField, Input, Modal, Select, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { ImportJob } from '@/types';

const fieldOptions: Record<ImportJob['target_object'], string[]> = {
  lead: ['display_name', 'first_name', 'last_name', 'email', 'phone', 'company_name', 'job_title', 'source', 'status', 'estimated_value', 'country', 'city', 'description'],
  contact: ['display_name', 'first_name', 'last_name', 'email', 'phone', 'job_title', 'department', 'company_name', 'source', 'lifecycle_stage', 'country', 'city', 'description'],
  company: ['name', 'legal_name', 'domain', 'website', 'email', 'phone', 'industry', 'size', 'employee_count', 'annual_revenue', 'country', 'city', 'description'],
  deal: ['title', 'description', 'value', 'currency', 'probability_override', 'priority', 'source', 'deal_type', 'forecast_category', 'expected_close_date', 'pipeline_name', 'stage_name', 'company_name', 'contact_email', 'owner_email'],
  activity: ['type', 'title', 'description', 'priority', 'due_at', 'due_date', 'all_day', 'starts_at', 'ends_at', 'scheduled_timezone', 'call_direction', 'phone_number', 'location', 'meeting_url', 'contact_email', 'company_name', 'deal_title', 'owner_email'],
};

export function CustomerImportModal({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: ImportJob['target_object'];
}) {
  const { t } = useTranslation('common');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'create'>('skip');

  useEffect(() => {
    if (!open) {
      setJob(null);
      setMapping({});
      setDuplicatePolicy('skip');
    }
  }, [open]);

  const { data: customFields } = useQuery({
    queryKey: ['custom-fields', target],
    queryFn: () => customerCoreApi.customFields(target),
    enabled: open,
  });

  const options = useMemo(
    () => [
      ...fieldOptions[target].map((value) => ({ value, label: value.replace(/_/g, ' ') })),
      ...(customFields?.results ?? []).map((field) => ({ value: `custom.${field.key}`, label: field.label })),
    ],
    [customFields, target],
  );

  const upload = useMutation({
    mutationFn: (file: File) => customerCoreApi.uploadImport(target, file),
    onSuccess: (created) => {
      setJob(created);
      const suggested: Record<string, string> = {};
      created.detected_columns.forEach((column) => {
        const normalized = column.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const match = options.find((option) => option.value === normalized);
        if (match) suggested[column] = match.value;
      });
      setMapping(suggested);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const process = useMutation({
    mutationFn: () => customerCoreApi.processImport(job!.id, mapping, duplicatePolicy),
    onSuccess: setJob,
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const complete = job?.status === 'completed';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('customerCore.importTitle')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('actions.close')}</Button>
          {job && !complete && (
            <Button onClick={() => process.mutate()} loading={process.isPending} disabled={Object.keys(mapping).length === 0}>
              {t('customerCore.processImport')}
            </Button>
          )}
        </>
      }
    >
      {!job ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <FileSpreadsheet className="mx-auto h-9 w-9 text-primary-600 dark:text-primary-400" />
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{t('customerCore.csvHint')}</p>
          <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 active:translate-y-px dark:bg-primary-500 dark:text-gray-950">
            <Upload className="h-4 w-4" />
            {upload.isPending ? t('state.loading') : t('customerCore.uploadCsv')}
            <Input
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              disabled={upload.isPending}
              onChange={(event) => event.target.files?.[0] && upload.mutate(event.target.files[0])}
            />
          </label>
        </div>
      ) : complete ? (
        <div className="space-y-5">
          <div className="rounded-xl bg-green-50 p-5 text-green-900 dark:bg-green-500/10 dark:text-green-200">
            <p className="font-semibold">{t('customerCore.importComplete')}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['successful', 'failed', 'skipped', 'duplicate_candidates'] as const).map((key) => (
              <div key={key} className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <dt className="text-xs text-gray-500 dark:text-gray-400">{t(`customerCore.${key === 'duplicate_candidates' ? 'duplicates' : key}`)}</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{job.report[key] ?? 0}</dd>
              </div>
            ))}
          </dl>
          {(job.report.errors?.length ?? 0) > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="min-w-full text-xs">
                <thead><tr><th className="px-3 py-2 text-start">{t('customerCore.rowNumber')}</th><th className="px-3 py-2 text-start">{t('customerCore.field')}</th><th className="px-3 py-2 text-start">{t('customerCore.reason')}</th></tr></thead>
                <tbody>{job.report.errors!.slice(0, 100).map((error, index) => (
                  <tr key={`${error.row_number}-${index}`} className="border-t border-gray-200 dark:border-gray-800">
                    <td className="px-3 py-2">{error.row_number}</td><td className="px-3 py-2">{error.field ?? '—'}</td><td className="max-w-lg px-3 py-2">{typeof error.reason === 'string' ? error.reason : JSON.stringify(error.reason)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('customerCore.mapColumns')}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {job.detected_columns.map((column) => (
              <FormField key={column} label={column}>
                <Select
                  value={mapping[column] ?? ''}
                  onChange={(event) => setMapping((current) => {
                    const next = { ...current };
                    if (event.target.value) next[column] = event.target.value;
                    else delete next[column];
                    return next;
                  })}
                >
                  <option value="">{t('customerCore.skipColumn')}</option>
                  {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </FormField>
            ))}
          </div>
          <FormField label={t('customerCore.duplicatePolicy')}>
            <Select value={duplicatePolicy} onChange={(event) => setDuplicatePolicy(event.target.value as 'skip' | 'create')}>
              <option value="skip">{t('customerCore.skipDuplicates')}</option>
              <option value="create">{t('customerCore.createDuplicates')}</option>
            </Select>
          </FormField>
          {job.preview_rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="min-w-full text-xs">
                <thead><tr>{job.detected_columns.map((column) => <th key={column} className="px-3 py-2 text-start">{column}</th>)}</tr></thead>
                <tbody>{job.preview_rows.slice(0, 3).map((row, index) => (
                  <tr key={index} className="border-t border-gray-200 dark:border-gray-800">{job.detected_columns.map((column) => <td key={column} className="max-w-48 truncate px-3 py-2">{row[column]}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
