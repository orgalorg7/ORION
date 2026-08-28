import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { organizationsApi } from '@/api/organizations';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Spinner,
  toast,
  type BadgeColor,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { useIsAdmin } from '@/stores/auth';
import type { Plan, Subscription } from '@/types';

const STATUS_COLORS: Record<Subscription['status'], BadgeColor> = {
  trialing: 'amber',
  active: 'green',
  past_due: 'red',
  canceled: 'gray',
};

export function BillingSettings() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [planToChoose, setPlanToChoose] = useState<Plan | null>(null);

  const { data: subscription, isLoading: subscriptionLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => organizationsApi.subscription(),
    enabled: isAdmin,
  });

  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => organizationsApi.plans(),
    enabled: isAdmin,
  });

  const changePlanMutation = useMutation({
    mutationFn: (planId: number) => organizationsApi.changePlan(planId),
    onSuccess: () => {
      toast.success(t('settings:billing.planChanged'));
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      setPlanToChoose(null);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (!isAdmin) {
    return <EmptyState title={t('common:state.notFound')} />;
  }

  const planName = (plan: Plan) => (i18n.language === 'ar' && plan.name_ar ? plan.name_ar : plan.name);

  const sortedPlans = [...(plans ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('settings:billing.subscription')} />
        <CardBody>
          {subscriptionLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6 text-primary-600" />
            </div>
          ) : subscription ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {planName(subscription.plan)}
                </p>
                <Badge color={STATUS_COLORS[subscription.status]}>
                  {t(`settings:billing.status.${subscription.status}`)}
                </Badge>
              </div>
              {subscription.status === 'trialing' && subscription.trial_end && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {t('settings:billing.trialEndsOn', { date: formatDate(subscription.trial_end) })}
                </p>
              )}
              {subscription.current_period_end && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('settings:billing.currentPeriodEnd', {
                    date: formatDate(subscription.current_period_end),
                  })}
                </p>
              )}
              <p className="pt-1 text-xs text-gray-400 dark:text-gray-500">
                {t('settings:billing.demoNote')}
              </p>
            </div>
          ) : (
            <EmptyState title={t('common:state.notFound')} />
          )}
        </CardBody>
      </Card>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('settings:billing.plans')}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:billing.plansSubtitle')}</p>
      </div>

      {plansLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8 text-primary-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {sortedPlans.map((plan) => {
            const isCurrent = subscription?.plan.id === plan.id;
            return (
              <Card
                key={plan.id}
                className={cn(
                  'flex flex-col p-6',
                  isCurrent && 'border-primary-500 ring-1 ring-primary-500/40 dark:border-primary-500',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {planName(plan)}
                  </h3>
                  {isCurrent && <Badge color="indigo">{t('settings:billing.currentPlan')}</Badge>}
                </div>
                <p className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                    {formatCurrency(plan.price_monthly)}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {t('settings:billing.perMonth')}
                  </span>
                </p>
                <div className="mt-4 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                  <p>
                    {t('settings:billing.maxUsers', {
                      count: plan.max_users,
                      value: formatNumber(plan.max_users),
                    })}
                  </p>
                  <p>
                    {t('settings:billing.maxContacts', {
                      count: plan.max_contacts,
                      value: formatNumber(plan.max_contacts),
                    })}
                  </p>
                </div>
                <ul className="mt-4 flex-1 space-y-2">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
                      <span>{t(`settings:billing.features.${feature}`, { defaultValue: feature })}</span>
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <Button variant="outline" disabled className="mt-6 w-full">
                    {t('settings:billing.currentPlan')}
                  </Button>
                ) : (
                  <Button className="mt-6 w-full" onClick={() => setPlanToChoose(plan)}>
                    {t('settings:billing.choosePlan')}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!planToChoose}
        onClose={() => setPlanToChoose(null)}
        onConfirm={() => planToChoose && changePlanMutation.mutate(planToChoose.id)}
        title={t('settings:billing.changeTitle', { plan: planToChoose ? planName(planToChoose) : '' })}
        message={t('settings:billing.changeMessage')}
        confirmLabel={t('common:actions.confirm')}
        loading={changePlanMutation.isPending}
        danger={false}
      />
    </div>
  );
}
