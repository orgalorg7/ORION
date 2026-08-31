import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { customerCoreApi } from '@/api/customerCore';
import { Button, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { ImportJob } from '@/types';

import { CustomerImportModal } from './CustomerImportModal';

export function CustomerListActions({ target, filters, sort }: {
  target: ImportJob['target_object'];
  filters: Record<string, unknown>;
  sort?: string;
}) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try { await customerCoreApi.exportCsv(target, filters, sort); }
    catch (error) { toast.error(apiErrorMessage(error)); }
    finally { setExporting(false); }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />{t('actions.import')}
      </Button>
      <Button variant="outline" onClick={exportCsv} loading={exporting}>
        <Download className="h-4 w-4" />{t('actions.export')}
      </Button>
      <CustomerImportModal open={open} onClose={() => setOpen(false)} target={target} />
    </>
  );
}
