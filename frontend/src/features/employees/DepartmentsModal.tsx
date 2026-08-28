import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { departmentsApi } from '@/api/employees';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Spinner,
  toast,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { Department } from '@/types';

function DepartmentRow({ department, onDelete }: { department: Department; onDelete: () => void }) {
  const { t } = useTranslation(['employees', 'common']);
  const queryClient = useQueryClient();
  const [name, setName] = useState(department.name);

  useEffect(() => {
    setName(department.name);
  }, [department.name]);

  const updateMutation = useMutation({
    mutationFn: () => departmentsApi.update(department.id, { name: name.trim() }),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const dirty = name.trim().length > 0 && name.trim() !== department.name;
  const save = () => {
    if (dirty && !updateMutation.isPending) updateMutation.mutate();
  };

  return (
    <div className="flex items-center gap-2 py-2">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
        }}
        aria-label={t('employees:departmentsModal.namePlaceholder')}
        className="flex-1"
      />
      {dirty && (
        <button
          type="button"
          onClick={save}
          title={t('employees:departmentsModal.saveName')}
          aria-label={t('employees:departmentsModal.saveName')}
          className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
        >
          {updateMutation.isPending ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        </button>
      )}
      <Badge color="gray">
        {t('employees:departmentsModal.employeesCount', { count: department.employees_count })}
      </Badge>
      <button
        type="button"
        onClick={onDelete}
        title={t('employees:departmentsModal.deleteDepartment')}
        aria-label={t('employees:departmentsModal.deleteDepartment')}
        className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function DepartmentsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['employees', 'common']);
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  const { data: departments, isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.list(),
    enabled: open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['departments'] });
    queryClient.invalidateQueries({ queryKey: ['employees'] });
  };

  const createMutation = useMutation({
    mutationFn: () => departmentsApi.create({ name: newName.trim() }),
    onSuccess: () => {
      toast.success(t('common:toast.created'));
      setNewName('');
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => departmentsApi.remove(id),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Modal open={open} onClose={onClose} title={t('employees:departmentsModal.title')}>
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6 text-primary-600" />
        </div>
      ) : !departments || departments.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-5 w-5" />}
          title={t('employees:departmentsModal.empty')}
          description={t('employees:departmentsModal.emptyHint')}
          className="py-8"
        />
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {departments.map((department) => (
            <DepartmentRow
              key={department.id}
              department={department}
              onDelete={() => setDeleteTarget(department)}
            />
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (newName.trim() && !createMutation.isPending) createMutation.mutate();
        }}
        className="mt-4 flex items-center gap-2 border-t border-gray-200 pt-4 dark:border-gray-800"
      >
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder={t('employees:departmentsModal.namePlaceholder')}
          className="flex-1"
        />
        <Button type="submit" loading={createMutation.isPending} disabled={!newName.trim()}>
          <Plus className="h-4 w-4" />
          {t('common:actions.add')}
        </Button>
      </form>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        title={t('common:confirmDelete.title', { item: deleteTarget?.name ?? '' })}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.delete')}
      />
    </Modal>
  );
}
