import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { organizationsApi } from '@/api/organizations';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  Modal,
  Select,
  Spinner,
  Table,
  toast,
  type Column,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatDate, fullName } from '@/lib/utils';
import { useAuthStore, useIsAdmin } from '@/stores/auth';
import type { Invitation, Membership, Role } from '@/types';

const ASSIGNABLE_ROLES: Role[] = ['admin', 'manager', 'member'];

export function TeamSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('member');
  const [deactivating, setDeactivating] = useState<Membership | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['memberships'],
    queryFn: () => organizationsApi.members({ page_size: 100 }),
    enabled: isAdmin,
  });

  const { data: invitations, isLoading: invitationsLoading } = useQuery({
    queryKey: ['invitations'],
    queryFn: () => organizationsApi.invitations(),
    enabled: isAdmin,
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { role?: Role; is_active?: boolean } }) =>
      organizationsApi.updateMember(id, payload),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      queryClient.invalidateQueries({ queryKey: ['memberships'] });
      setDeactivating(null);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const inviteMutation = useMutation({
    mutationFn: () => organizationsApi.invite({ email: inviteEmail.trim(), role: inviteRole }),
    onSuccess: (result) => {
      const added = Boolean((result as { added?: boolean } | null)?.added);
      toast.success(added ? t('settings:team.toast.memberAdded') : t('settings:team.toast.invitationSent'));
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      queryClient.invalidateQueries({ queryKey: ['memberships'] });
      setInviteOpen(false);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => organizationsApi.revokeInvitation(id),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      setRevoking(null);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (!isAdmin) {
    return <EmptyState title={t('common:state.notFound')} />;
  }

  const isSelf = (member: Membership) => member.user.id === currentUser?.id;

  const columns: Column<Membership>[] = [
    {
      key: 'member',
      header: t('settings:team.members.title'),
      render: (member) => (
        <div className="flex items-center gap-3">
          <Avatar name={fullName(member.user)} size="sm" />
          <div>
            <p className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
              {fullName(member.user)}
              {isSelf(member) && <Badge color="blue">{t('settings:team.you')}</Badge>}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <span dir="ltr">{member.user.email}</span>
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('common:labels.role'),
      render: (member) => (
        <Select
          value={member.role}
          disabled={member.role === 'owner' || isSelf(member) || updateMemberMutation.isPending}
          onChange={(event) =>
            updateMemberMutation.mutate({ id: member.id, payload: { role: event.target.value as Role } })
          }
          aria-label={t('common:labels.role')}
          className="h-9 w-36 py-1.5"
        >
          {member.role === 'owner' ? (
            <option value="owner">{t('common:roles.owner')}</option>
          ) : (
            ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`common:roles.${role}`)}
              </option>
            ))
          )}
        </Select>
      ),
    },
    {
      key: 'status',
      header: t('common:labels.status'),
      render: (member) =>
        member.is_active ? (
          <Badge color="green">{t('settings:team.status.active')}</Badge>
        ) : (
          <Badge color="gray">{t('settings:team.status.inactive')}</Badge>
        ),
    },
    {
      key: 'created_at',
      header: t('common:labels.createdAt'),
      render: (member) => (
        <span className="text-gray-500 dark:text-gray-400">{formatDate(member.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common:labels.actions')}</span>,
      className: 'text-end',
      render: (member) => {
        if (member.role === 'owner' || isSelf(member)) return null;
        return member.is_active ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
            onClick={() => setDeactivating(member)}
          >
            {t('settings:team.deactivate')}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            loading={updateMemberMutation.isPending}
            onClick={() => updateMemberMutation.mutate({ id: member.id, payload: { is_active: true } })}
          >
            {t('settings:team.reactivate')}
          </Button>
        );
      },
    },
  ];

  const pendingInvitations = (invitations?.results ?? []).filter((invitation) => !invitation.accepted_at);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('settings:team.members.title')} subtitle={t('settings:team.members.subtitle')} />
        <Table
          columns={columns}
          rows={members?.results ?? []}
          rowKey={(member) => member.id}
          loading={membersLoading}
          emptyState={
            <EmptyState icon={<Users className="h-5 w-5" />} title={t('common:state.empty')} />
          }
        />
      </Card>

      <Card>
        <CardHeader
          title={t('settings:team.invitations.title')}
          subtitle={t('settings:team.invitations.subtitle')}
          actions={
            <Button
              size="sm"
              onClick={() => {
                setInviteEmail('');
                setInviteRole('member');
                setInviteOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              {t('settings:team.invite')}
            </Button>
          }
        />
        {invitationsLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6 text-primary-600" />
          </div>
        ) : pendingInvitations.length === 0 ? (
          <EmptyState icon={<Mail className="h-5 w-5" />} title={t('settings:team.invitations.empty')} />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800/70">
            {pendingInvitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    <span dir="ltr">{invitation.email}</span>
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('settings:team.invitations.invitedOn', { date: formatDate(invitation.created_at) })}
                  </p>
                </div>
                <Badge color="indigo">{t(`common:roles.${invitation.role}`)}</Badge>
                <button
                  type="button"
                  onClick={() => setRevoking(invitation)}
                  title={t('settings:team.invitations.revoke')}
                  aria-label={t('settings:team.invitations.revoke')}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('settings:team.inviteTitle')}
        footer={
          <>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => inviteMutation.mutate()}
              loading={inviteMutation.isPending}
              disabled={!inviteEmail.trim()}
            >
              {t('settings:team.invite')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label={t('common:labels.email')} required>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              dir="ltr"
              autoFocus
            />
          </FormField>
          <FormField label={t('common:labels.role')}>
            <Select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)}>
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`common:roles.${role}`)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={() =>
          deactivating &&
          updateMemberMutation.mutate({ id: deactivating.id, payload: { is_active: false } })
        }
        title={t('settings:team.deactivateTitle', { name: deactivating ? fullName(deactivating.user) : '' })}
        message={t('settings:team.deactivateMessage')}
        confirmLabel={t('settings:team.deactivate')}
        loading={updateMemberMutation.isPending}
      />

      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revokeMutation.mutate(revoking.id)}
        title={t('settings:team.invitations.revokeTitle')}
        confirmLabel={t('settings:team.invitations.revoke')}
        loading={revokeMutation.isPending}
      />
    </div>
  );
}
