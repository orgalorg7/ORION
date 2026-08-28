import {
  Briefcase,
  Building2,
  CalendarCheck,
  ChevronDown,
  Contact2,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  Target,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { authApi } from '@/api/auth';
import { Avatar, BidiText, BrandLogo, Dropdown, toast } from '@/components/ui';
import { LANGUAGES } from '@/i18n';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useActiveMembership, useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

const navItems = [
  { to: '/app', end: true, icon: LayoutDashboard, key: 'dashboard' },
  { to: '/app/leads', icon: Target, key: 'leads' },
  { to: '/app/contacts', icon: Contact2, key: 'contacts' },
  { to: '/app/companies', icon: Building2, key: 'companies' },
  { to: '/app/deals', icon: Briefcase, key: 'deals' },
  { to: '/app/activities', icon: CalendarCheck, key: 'activities' },
  { to: '/app/tickets', icon: LifeBuoy, key: 'tickets' },
  { to: '/app/employees', icon: Users, key: 'employees' },
  { to: '/app/settings', icon: Settings, key: 'settings' },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-white/5 px-5">
        <BrandLogo className="h-9 w-44" />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label={t('nav.workspace')}>
        {navItems.map((item) => (
          <NavLink
            key={item.key}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg border-s-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary-400 bg-primary-400/10 text-primary-300'
                  : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-100',
              )
            }
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
            {t(`nav.${item.key}`)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function DashboardLayout() {
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const { theme, toggleTheme, sidebarOpen, setSidebarOpen } = useUiStore();
  const { user, memberships, orgId, setOrg, setUser, logout } = useAuthStore();
  const membership = useActiveMembership();

  const displayName = user ? `${user.first_name} ${user.last_name}`.trim() || user.email : '';

  const changeLanguage = async (language: 'en' | 'ar') => {
    await i18n.changeLanguage(language);
    if (user && user.language !== language) {
      try {
        setUser(await authApi.updateProfile({ language }));
      } catch (error) {
        toast.error(apiErrorMessage(error));
      }
    }
  };

  return (
    <div className="app-canvas flex min-h-screen dark:bg-gray-950">
      <a
        href="#main-content"
        className="fixed start-4 top-3 z-[70] -translate-y-20 rounded-md bg-primary-400 px-4 py-2 text-sm font-semibold text-gray-950 shadow-lg transition-transform focus:translate-y-0"
      >
        {t('accessibility.mainContent')}
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 border-e border-gray-800 bg-gray-950 lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-gray-950/50" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 start-0 z-50 w-64 bg-gray-950 shadow-2xl shadow-black/40">
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label={t('accessibility.closeNavigation')}
              className="absolute end-3 top-4 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col lg:ms-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-line/80 bg-surface/90 px-4 shadow-[0_8px_24px_-22px_rgba(76,52,24,0.55)] backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/80 dark:shadow-none sm:gap-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label={t('accessibility.openNavigation')}
              className="rounded-lg p-2 text-muted hover:bg-surface-muted dark:text-gray-400 dark:hover:bg-gray-800 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            {memberships.length > 1 ? (
              <select
                value={orgId ?? ''}
                onChange={(event) => setOrg(Number(event.target.value))}
                className="hidden max-w-44 truncate rounded-lg border border-line-strong bg-surface-raised px-2 py-1.5 text-sm font-medium text-gray-800 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 min-[360px]:block"
              >
                {memberships.map((m) => (
                  <option key={m.organization.id} value={m.organization.id}>
                    {m.organization.name}
                  </option>
                ))}
              </select>
            ) : (
              <BidiText className="hidden truncate text-sm font-semibold text-gray-800 dark:text-gray-100 min-[360px]:inline">
                {membership?.organization.name}
              </BidiText>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <select
              value={i18n.language}
              onChange={(event) => void changeLanguage(event.target.value as 'en' | 'ar')}
              className="rounded-lg border border-line-strong bg-surface-raised px-2 py-1.5 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              aria-label={t('labels.language')}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg p-2 text-muted hover:bg-surface-muted dark:text-gray-400 dark:hover:bg-gray-800"
              title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
              aria-label={theme === 'dark' ? t('theme.light') : t('theme.dark')}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <Dropdown
              trigger={
                <button
                  type="button"
                  aria-label={t('accessibility.userMenu')}
                  className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-surface-muted dark:hover:bg-gray-800"
                >
                  <Avatar name={displayName || '?'} size="sm" />
                  <BidiText className="hidden max-w-32 truncate text-sm font-medium text-gray-700 dark:text-gray-200 sm:block">
                    {displayName}
                  </BidiText>
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                </button>
              }
              items={[
                {
                  label: t('nav.settings'),
                  icon: <UserRound className="h-4 w-4" />,
                  onClick: () => navigate('/app/settings'),
                },
                {
                  label: t('actions.logout'),
                  icon: <LogOut className="h-4 w-4" />,
                  danger: true,
                  onClick: () => {
                    logout();
                    navigate('/login');
                  },
                },
              ]}
            />
          </div>
        </header>

        <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
