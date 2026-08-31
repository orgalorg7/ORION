import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarClock,
  Contact2,
  Filter,
  Handshake,
  Inbox,
  Mail,
  Phone,
  RefreshCw,
  Target,
  Ticket,
  Trophy,
  Users,
  UserPlus,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { analyticsApi } from '@/api/analytics';
import { Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, StatCard } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { activeLocale, formatCurrency, formatDateTime, formatMonth, formatNumber } from '@/lib/utils';
import { useActiveMembership, useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import type { ActivityType, DashboardData } from '@/types';

// --- Theming tokens (dataviz standard) ----------------------------------------

const INK = {
  light: { grid: '#ded4c3', tick: '#71695f', surface: '#fffdf8' },
  dark: { grid: '#3f3d39', tick: '#9b968c', surface: '#191918' },
} as const;

const BRAND_GOLD = { light: '#bf8e18', dark: '#e6c650' } as const;

// Fixed status→color assignment: color follows the entity, never its rank.
const STATUS_ORDER = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const;
const STATUS_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
} as const;
const STATUS_FALLBACK = { light: '#6b7280', dark: '#9ca3af' } as const;

type Mode = 'light' | 'dark';

function statusColor(status: string, mode: Mode): string {
  const index = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
  return index === -1 ? STATUS_FALLBACK[mode] : STATUS_COLORS[mode][index];
}

function statusOrderIndex(status: string): number {
  const index = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
  return index === -1 ? STATUS_ORDER.length : index;
}

function tooltipStyle(mode: Mode, direction: 'ltr' | 'rtl') {
  return {
    backgroundColor: INK[mode].surface,
    border: `1px solid ${INK[mode].grid}`,
    borderRadius: 8,
    color: INK[mode].tick,
    direction,
    textAlign: direction === 'rtl' ? ('right' as const) : ('left' as const),
  };
}

const ACTIVITY_ICONS: Record<ActivityType, ReactNode> = {
  call: <Phone className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  meeting: <Users className="h-4 w-4" />,
  task: <CalendarCheck className="h-4 w-4" />,
  follow_up: <CalendarCheck className="h-4 w-4" />,
  reminder: <CalendarCheck className="h-4 w-4" />,
};

// --- Page ----------------------------------------------------------------------

export function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'common']);
  const user = useAuthStore((state) => state.user);
  const currency = useActiveMembership()?.organization.currency ?? 'USD';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: () => analyticsApi.dashboard(),
  });

  const firstName = user?.first_name?.trim();
  const header = (
    <PageHeader
      title={t('dashboard:title')}
      subtitle={firstName ? t('dashboard:welcome', { name: firstName }) : t('dashboard:welcomeGeneric')}
    />
  );

  if (isLoading) {
    return (
      <div>
        {header}
        <div className="flex items-center justify-center py-24">
          <Spinner className="h-8 w-8 text-primary-600 dark:text-primary-400" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        {header}
        <Card>
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title={t('dashboard:error.title')}
            description={error ? apiErrorMessage(error) : t('dashboard:error.description')}
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
                {t('common:actions.retry')}
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const { totals } = data;

  return (
    <div>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={t('dashboard:stats.contacts')}
          value={formatNumber(totals.contacts)}
          icon={<Contact2 className="h-5 w-5" />}
        />
        <StatCard
          label={t('dashboard:stats.companies')}
          value={formatNumber(totals.companies)}
          icon={<Building2 className="h-5 w-5" />}
        />
        <StatCard
          label={t('dashboard:stats.openDealsValue')}
          value={formatCurrency(totals.open_deals_value, currency)}
          hint={t('dashboard:stats.openDealsCount', { total: formatNumber(totals.open_deals) })}
          icon={<Handshake className="h-5 w-5" />}
        />
        <StatCard
          label={t('dashboard:stats.wonThisMonth')}
          value={formatCurrency(totals.won_value_this_month, currency)}
          hint={t('dashboard:stats.wonDealsCount', { total: formatNumber(totals.won_deals_this_month) })}
          icon={<Trophy className="h-5 w-5" />}
        />
        <StatCard
          label={t('dashboard:stats.newLeadsThisMonth')}
          value={formatNumber(totals.new_leads_this_month)}
          icon={<UserPlus className="h-5 w-5" />}
        />
        <StatCard
          label={t('dashboard:stats.openTickets')}
          value={formatNumber(totals.open_tickets)}
          icon={<Ticket className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RevenueCard data={data} currency={currency} />
        <PipelineCard data={data} currency={currency} />
        <LeadsByStatusCard data={data} />
        <LeadsBySourceCard data={data} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <UpcomingActivitiesCard data={data} />
        <TopDealsCard data={data} currency={currency} />
      </div>
    </div>
  );
}

// --- (1) Revenue: won value by month (recharts bar, single hue) -----------------

function RevenueCard({ data, currency }: { data: DashboardData; currency: string }) {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const theme = useUiStore((state) => state.theme);
  const ink = INK[theme];

  const compact = (value: number) =>
    new Intl.NumberFormat(activeLocale(), {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);

  return (
    <Card>
      <CardHeader title={t('dashboard:charts.revenue')} subtitle={t('dashboard:charts.revenueSubtitle')} />
      <CardBody>
        {data.revenue_by_month.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title={t('dashboard:empty.revenue')}
            className="py-10"
          />
        ) : (
          <div
            dir="ltr"
            role="img"
            aria-label={t('dashboard:charts.revenue')}
            className="h-[260px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.revenue_by_month} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={ink.grid} />
                <XAxis
                  dataKey="month"
                  tickFormatter={formatMonth}
                  tick={{ fill: ink.tick, fontSize: 12 }}
                  axisLine={{ stroke: ink.grid }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: ink.tick, fontSize: 12 }}
                  tickFormatter={(value: number) => compact(value)}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  contentStyle={tooltipStyle(theme, i18n.dir())}
                  cursor={{ fill: ink.grid, fillOpacity: 0.35 }}
                  formatter={(value) => [formatCurrency(Number(value), currency), t('dashboard:charts.revenue')]}
                  labelFormatter={(label) => formatMonth(String(label))}
                />
                <Bar dataKey="value" fill={BRAND_GOLD[theme]} barSize={28} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// --- (2) Pipeline by stage (div bar list, entity-owned stage colors) -------------

function PipelineCard({ data, currency }: { data: DashboardData; currency: string }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const stages = data.deals_by_stage;
  const max = Math.max(...stages.map((stage) => stage.value), 1);

  return (
    <Card>
      <CardHeader title={t('dashboard:charts.pipeline')} />
      <CardBody>
        {stages.length === 0 ? (
          <EmptyState
            icon={<Filter className="h-5 w-5" />}
            title={t('dashboard:empty.pipeline')}
            className="py-10"
          />
        ) : (
          <ul className="space-y-4">
            {stages.map((stage) => (
              <li key={stage.stage_id}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-gray-700 dark:text-gray-300">
                    {stage.stage_name}
                  </span>
                  <span className="shrink-0 text-gray-500 dark:text-gray-400">
                    {formatNumber(stage.count)} · {formatCurrency(stage.value, currency)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(stage.value / max) * 100}%`, backgroundColor: stage.color }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// --- (3) Leads by status (donut, fixed status→color mapping) --------------------

function LeadsByStatusCard({ data }: { data: DashboardData }) {
  const { t, i18n } = useTranslation(['dashboard', 'common', 'leads']);
  const theme = useUiStore((state) => state.theme);

  const rows = [...data.leads_by_status].sort(
    (a, b) => statusOrderIndex(a.status) - statusOrderIndex(b.status),
  );
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const statusLabel = (status: string) => t(`leads:statuses.${status}`, { defaultValue: status });
  const chartRows = rows.map((row) => ({ ...row, label: statusLabel(row.status) }));

  return (
    <Card>
      <CardHeader title={t('dashboard:charts.leadsByStatus')} />
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Target className="h-5 w-5" />}
            title={t('dashboard:empty.leads')}
            className="py-10"
          />
        ) : (
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
            <div
              dir="ltr"
              role="img"
              aria-label={t('dashboard:charts.leadsByStatus')}
              className="relative h-[200px] w-full max-w-[220px] shrink-0"
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    contentStyle={tooltipStyle(theme, i18n.dir())}
                    formatter={(value, name) => [formatNumber(Number(value)), String(name)]}
                  />
                  <Pie
                    data={chartRows}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke={INK[theme].surface}
                  >
                    {chartRows.map((row) => (
                      <Cell key={row.status} fill={statusColor(row.status, theme)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                  {formatNumber(total)}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{t('common:labels.total')}</span>
              </div>
            </div>
            <ul className="w-full space-y-2.5 sm:w-auto sm:min-w-[170px]">
              {rows.map((row) => (
                <li key={row.status} className="flex items-center justify-between gap-4 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: statusColor(row.status, theme) }}
                    />
                    <span className="truncate text-gray-700 dark:text-gray-300">{statusLabel(row.status)}</span>
                  </span>
                  <span className="shrink-0 font-medium text-gray-900 dark:text-gray-100">
                    {formatNumber(row.count)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// --- (4) Leads by source (div bar list, single hue) ------------------------------

function LeadsBySourceCard({ data }: { data: DashboardData }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const theme = useUiStore((state) => state.theme);
  const sources = data.leads_by_source;
  const max = Math.max(...sources.map((row) => row.count), 1);

  return (
    <Card>
      <CardHeader title={t('dashboard:charts.leadsBySource')} />
      <CardBody>
        {sources.length === 0 ? (
          <EmptyState
            icon={<Target className="h-5 w-5" />}
            title={t('dashboard:empty.leads')}
            className="py-10"
          />
        ) : (
          <ul className="space-y-4">
            {sources.map((row) => (
              <li key={row.source}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-gray-700 dark:text-gray-300">
                    {t(`common:sources.${row.source}`, { defaultValue: row.source })}
                  </span>
                  <span className="shrink-0 text-gray-500 dark:text-gray-400">{formatNumber(row.count)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(row.count / max) * 100}%`, backgroundColor: BRAND_GOLD[theme] }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// --- Upcoming activities ----------------------------------------------------------

function UpcomingActivitiesCard({ data }: { data: DashboardData }) {
  const { t } = useTranslation(['dashboard', 'common']);

  return (
    <Card>
      <CardHeader title={t('dashboard:lists.upcomingActivities')} />
      {data.upcoming_activities.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title={t('dashboard:empty.activities')}
          description={t('dashboard:empty.activitiesHint')}
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {data.upcoming_activities.map((activity) => (
            <li key={activity.id} className="flex items-center gap-3 px-5 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400">
                {ACTIVITY_ICONS[activity.type]}
              </span>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate text-start text-sm font-medium text-gray-900 dark:text-gray-100">
                  {activity.title}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(activity.due_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Top open deals -----------------------------------------------------------------

function TopDealsCard({ data, currency }: { data: DashboardData; currency: string }) {
  const { t } = useTranslation(['dashboard', 'common']);

  return (
    <Card>
      <CardHeader title={t('dashboard:lists.topDeals')} />
      {data.top_deals.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title={t('dashboard:empty.deals')}
          description={t('dashboard:empty.dealsHint')}
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {data.top_deals.map((deal) => (
            <li key={deal.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p
                  dir="auto"
                  className="truncate text-start text-sm font-medium text-gray-900 dark:text-gray-100"
                >
                  {deal.title}
                </p>
                <p dir="auto" className="truncate text-start text-xs text-gray-500 dark:text-gray-400">
                  {deal.company_name || '—'}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(deal.value, deal.currency || currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
