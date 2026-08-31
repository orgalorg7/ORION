import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StickyNote, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { notesApi } from '@/api/activities';
import { Avatar, BidiText, Button, Card, CardHeader, EmptyState, Spinner, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatDateTime, fullName } from '@/lib/utils';

export interface RelatedFilter {
  contact?: number;
  company?: number;
  deal?: number;
  lead?: number;
}

export function NotesPanel({ related, readOnly = false }: { related: RelatedFilter; readOnly?: boolean }) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const queryKey = ['notes', related];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => notesApi.list({ ...related, page_size: 50 }),
  });

  const createMutation = useMutation({
    mutationFn: () => notesApi.create({ body, ...related }),
    onSuccess: () => {
      setBody('');
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      const [type, id] = Object.entries(related)[0] ?? [];
      if (type && id) queryClient.invalidateQueries({ queryKey: ['timeline', type, id] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => notesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const notes = data?.results ?? [];

  return (
    <Card>
      <CardHeader title={t('notes.title')} />
      <div className="space-y-4 p-5">
        {!readOnly && <form
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim()) createMutation.mutate();
          }}
          className="space-y-2"
        >
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('notes.placeholder')}
            rows={2}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={createMutation.isPending} disabled={!body.trim()}>
              {t('notes.add')}
            </Button>
          </div>
        </form>}

        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="text-primary-600" />
          </div>
        ) : notes.length === 0 ? (
          <EmptyState icon={<StickyNote className="h-5 w-5" />} title={t('notes.empty')} className="py-6" />
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="group flex gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
                <Avatar name={fullName(note.author_detail) === '—' ? '?' : fullName(note.author_detail)} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                      <BidiText className="truncate">{fullName(note.author_detail)}</BidiText>
                      <span className="shrink-0 font-normal text-gray-400 dark:text-gray-500">
                        {formatDateTime(note.created_at)}
                      </span>
                    </p>
                    {!readOnly && <button
                      type="button"
                      onClick={() => deleteMutation.mutate(note.id)}
                      className="text-gray-400 opacity-100 transition-opacity hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 dark:text-gray-500"
                      title={t('notes.deleteNote')}
                      aria-label={t('notes.deleteNote')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>}
                  </div>
                  <p dir="auto" className="mt-1 whitespace-pre-wrap text-start text-sm text-gray-800 dark:text-gray-200">
                    {note.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
