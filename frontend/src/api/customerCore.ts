import { api } from '@/lib/api';
import type { CustomFieldDefinition, ImportJob, LeadSourceConfig, Paginated, TeamBrief } from '@/types';
import type { ListParams } from './contacts';

export const customerCoreApi = {
  sources: (params?: ListParams) =>
    api.get<Paginated<LeadSourceConfig>>('/lead-sources/', { params }).then((response) => response.data),
  teams: (params?: ListParams) =>
    api.get<Paginated<TeamBrief>>('/teams/', { params }).then((response) => response.data),
  customFields: (target_object: ImportJob['target_object']) =>
    api.get<Paginated<CustomFieldDefinition>>('/custom-fields/', { params: { target_object, active: true, page_size: 100 } })
      .then((response) => response.data),
  uploadImport: (target: ImportJob['target_object'], file: File) => {
    const body = new FormData();
    body.append('target_object', target);
    body.append('source_file', file);
    return api.post<ImportJob>('/imports/', body).then((response) => response.data);
  },
  processImport: (id: number, mapping: Record<string, string>, duplicatePolicy: 'skip' | 'create') =>
    api.post<ImportJob>(`/imports/${id}/process/`, { mapping, duplicate_policy: duplicatePolicy }).then((response) => response.data),
  exportCsv: async (target_object: ImportJob['target_object'], filters: Record<string, unknown>, sort?: string) => {
    const response = await api.post<Blob>('/exports/', { target_object, filters, sort }, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `orion-${target_object}s.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  },
};
