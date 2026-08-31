import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { companiesApi, contactsApi, tagsApi } from '@/api/contacts';
import { leadsApi } from '@/api/leads';
import { dealsApi } from '@/api/deals';
import { Badge, Button, Card, CardHeader, Select, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { Tag } from '@/types';

const changers = { lead: leadsApi.changeTags, contact: contactsApi.changeTags, company: companiesApi.changeTags, deal: dealsApi.changeTags };
const queryKeys = { lead: 'leads', contact: 'contacts', company: 'companies', deal: 'deals' };

export function TagManager({
  type,
  id,
  tags,
  readOnly = false,
}: {
  type: keyof typeof changers;
  id: number;
  tags: Tag[];
  readOnly?: boolean;
}) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [tagId, setTagId] = useState('');
  const { data } = useQuery({ queryKey: ['tags'], queryFn: () => tagsApi.list({ page_size: 100 }) });
  const mutation = useMutation({
    mutationFn: async ({ operation, selected }: { operation: 'attach' | 'detach'; selected: number }) => {
      await changers[type](id, operation, [selected]);
    },
    onSuccess: () => {
      setTagId('');
      queryClient.invalidateQueries({ queryKey: [queryKeys[type]] });
      queryClient.invalidateQueries({ queryKey: ['timeline', type, id] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const available = (data?.results ?? []).filter((tag) => !tags.some((current) => current.id === tag.id));

  return (
    <Card>
      <CardHeader title={t('labels.tags')} />
      <div className="p-5">
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag.id} color="indigo">
              <span>{tag.name}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="ms-1 rounded p-0.5 hover:bg-black/10"
                  aria-label={t('customerCore.removeTag', { name: tag.name })}
                  onClick={() => mutation.mutate({ operation: 'detach', selected: tag.id })}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
        {!readOnly && available.length > 0 && (
          <div className="mt-4 flex gap-2">
            <Select value={tagId} onChange={(event) => setTagId(event.target.value)}>
              <option value="">{t('customerCore.addTag')}</option>
              {available.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!tagId}
              onClick={() => mutation.mutate({ operation: 'attach', selected: Number(tagId) })}
            >
              <Plus className="h-4 w-4" />{t('actions.add')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
