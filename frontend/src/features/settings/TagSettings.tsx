import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tags, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tagsApi } from '@/api/contacts';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Input, Spinner, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { Tag } from '@/types';

const DEFAULT_TAG_COLOR = '#d5a928';

function TagRow({ tag }: { tag: Tag }) {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color || DEFAULT_TAG_COLOR);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const colorTimer = useRef<number | null>(null);

  useEffect(() => {
    setName(tag.name);
    setColor(tag.color || DEFAULT_TAG_COLOR);
  }, [tag.name, tag.color]);

  useEffect(() => {
    return () => {
      if (colorTimer.current) window.clearTimeout(colorTimer.current);
    };
  }, []);

  const updateMutation = useMutation({
    mutationFn: (payload: { name?: string; color?: string }) => tagsApi.update(tag.id, payload),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => tagsApi.remove(tag.id),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setDeleteOpen(false);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const handleColorChange = (value: string) => {
    setColor(value);
    if (colorTimer.current) window.clearTimeout(colorTimer.current);
    colorTimer.current = window.setTimeout(() => updateMutation.mutate({ color: value }), 600);
  };

  const saveName = () => {
    const value = name.trim();
    if (!value) {
      setName(tag.name);
      return;
    }
    if (value !== tag.name) updateMutation.mutate({ name: value });
  };

  return (
    <div className="flex items-center gap-2 py-2.5">
      <input
        type="color"
        value={color}
        onChange={(event) => handleColorChange(event.target.value)}
        aria-label={t('settings:tags.tagColor')}
        className="h-9 w-9 shrink-0 cursor-pointer rounded border border-gray-300 bg-transparent p-1 dark:border-gray-700"
      />
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={saveName}
        placeholder={t('settings:tags.tagName')}
        aria-label={t('settings:tags.tagName')}
        className="h-9 flex-1 sm:max-w-72"
      />
      <button
        type="button"
        onClick={() => setDeleteOpen(true)}
        title={t('common:actions.delete')}
        aria-label={t('common:actions.delete')}
        className="ms-auto rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={t('common:confirmDelete.title', { item: tag.name })}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.delete')}
      />
    </div>
  );
}

export function TagSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_TAG_COLOR);

  const { data: tagsPage, isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list({ page_size: 100 }),
  });
  const tags = tagsPage?.results ?? [];

  const createMutation = useMutation({
    mutationFn: () => tagsApi.create({ name: newName.trim(), color: newColor }),
    onSuccess: () => {
      toast.success(t('common:toast.created'));
      setNewName('');
      setNewColor(DEFAULT_TAG_COLOR);
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Card>
      <CardHeader title={t('settings:tags.title')} subtitle={t('settings:tags.subtitle')} />
      <CardBody className="py-3">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6 text-primary-600" />
          </div>
        ) : tags.length === 0 ? (
          <EmptyState
            icon={<Tags className="h-5 w-5" />}
            title={t('settings:tags.empty')}
            description={t('settings:tags.emptyHint')}
          />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800/70">
            {tags.map((tag) => (
              <TagRow key={tag.id} tag={tag} />
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
          <input
            type="color"
            value={newColor}
            onChange={(event) => setNewColor(event.target.value)}
            aria-label={t('settings:tags.tagColor')}
            className="h-9 w-9 shrink-0 cursor-pointer rounded border border-gray-300 bg-transparent p-1 dark:border-gray-700"
          />
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && newName.trim()) createMutation.mutate();
            }}
            placeholder={t('settings:tags.tagName')}
            className="h-9 flex-1 sm:max-w-72"
          />
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            loading={createMutation.isPending}
            disabled={!newName.trim()}
          >
            <Plus className="h-4 w-4" />
            {t('common:actions.add')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
