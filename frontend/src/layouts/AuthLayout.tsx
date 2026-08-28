import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';

import { BrandLogo } from '@/components/ui';
import { LANGUAGES } from '@/i18n';
import { useUiStore } from '@/stores/ui';

export function AuthLayout() {
  const { t, i18n } = useTranslation('common');
  const { theme, toggleTheme } = useUiStore();

  return (
    <div className="grid min-h-dvh bg-canvas dark:bg-gray-950 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="brand-blueprint brand-grid relative hidden min-h-dvh overflow-hidden bg-gray-950 p-12 text-gray-100 lg:flex lg:flex-col lg:justify-between xl:p-16">
        <BrandLogo className="h-16 w-64" />
        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.22em] text-primary-400">
            {t('brand.eyebrow')}
          </p>
          <h1 className="font-display text-5xl font-semibold leading-[1.16] tracking-[-0.04em] text-white xl:text-6xl">
            {t('brand.tagline')}
          </h1>
          <p className="mt-7 max-w-lg text-base leading-8 text-gray-400">{t('brand.statement')}</p>
        </div>
        <div className="relative z-10 flex items-center gap-4 text-xs text-gray-500">
          <span className="h-px w-12 bg-primary-400" />
          <span dir="ltr">KORZAH / CRM</span>
        </div>
      </section>

      <section className="app-canvas flex min-h-dvh min-w-0 flex-col dark:bg-gray-950">
        <header className="flex items-center justify-between px-5 py-4 sm:px-8">
          <BrandLogo compact className="h-10 rounded-lg lg:hidden" />
          <div className="ms-auto flex items-center gap-2">
          <select
            value={i18n.language}
            onChange={(event) => i18n.changeLanguage(event.target.value)}
            aria-label={t('labels.language')}
            className="rounded-md border border-line-strong bg-surface-raised px-2.5 py-2 text-sm text-gray-700 shadow-sm outline-none transition-colors focus:border-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
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
            className="rounded-md p-2 text-muted transition-colors hover:bg-surface-muted hover:text-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
            aria-label={theme === 'dark' ? t('theme.light') : t('theme.dark')}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <Outlet />
        </main>
        <footer className="px-5 py-5 text-center text-xs text-gray-400 sm:px-8">
          <span dir="ltr">© 2026 KORZAH</span>
        </footer>
      </section>
    </div>
  );
}
