import { Building2, CreditCard, Tags, UserRound, Users, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

import { PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useIsAdmin } from '@/stores/auth';

const navItems = [
  { to: '', end: true, key: 'profile', icon: UserRound, admin: false },
  { to: 'organization', end: false, key: 'organization', icon: Building2, admin: true },
  { to: 'team', end: false, key: 'team', icon: Users, admin: true },
  { to: 'pipelines', end: false, key: 'pipelines', icon: Workflow, admin: false },
  { to: 'tags', end: false, key: 'tags', icon: Tags, admin: false },
  { to: 'billing', end: false, key: 'billing', icon: CreditCard, admin: true },
];

export function SettingsLayout() {
  const { t } = useTranslation(['settings', 'common']);
  const isAdmin = useIsAdmin();
  const items = navItems.filter((item) => !item.admin || isAdmin);

  return (
    <div>
      <PageHeader title={t('common:nav.settings')} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav className="-mb-1 flex w-full min-w-0 max-w-full shrink-0 gap-1 overflow-x-auto pb-1 [contain:layout_paint] lg:mb-0 lg:w-52 lg:flex-col lg:overflow-visible lg:pb-0 lg:[contain:none]">
          {items.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-100/65 text-primary-800 ring-1 ring-inset ring-primary-200/60 dark:bg-primary-500/10 dark:text-primary-300 dark:ring-0'
                    : 'text-gray-600 hover:bg-surface-muted hover:text-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100',
                )
              }
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {t(`settings:nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
