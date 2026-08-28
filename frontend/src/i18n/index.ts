import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ar_activities from './locales/ar/activities.json';
import ar_auth from './locales/ar/auth.json';
import ar_common from './locales/ar/common.json';
import ar_companies from './locales/ar/companies.json';
import ar_contacts from './locales/ar/contacts.json';
import ar_dashboard from './locales/ar/dashboard.json';
import ar_deals from './locales/ar/deals.json';
import ar_employees from './locales/ar/employees.json';
import ar_leads from './locales/ar/leads.json';
import ar_settings from './locales/ar/settings.json';
import ar_tickets from './locales/ar/tickets.json';
import en_activities from './locales/en/activities.json';
import en_auth from './locales/en/auth.json';
import en_common from './locales/en/common.json';
import en_companies from './locales/en/companies.json';
import en_contacts from './locales/en/contacts.json';
import en_dashboard from './locales/en/dashboard.json';
import en_deals from './locales/en/deals.json';
import en_employees from './locales/en/employees.json';
import en_leads from './locales/en/leads.json';
import en_settings from './locales/en/settings.json';
import en_tickets from './locales/en/tickets.json';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
] as const;

function initialLanguage(): string {
  try {
    const stored = localStorage.getItem('crm-lang');
    if (stored === 'en' || stored === 'ar') return stored;
  } catch {
    // ignore
  }
  return 'en';
}

export function applyDir(lng: string) {
  const language = lng.toLowerCase().startsWith('ar') ? 'ar' : 'en';
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
}

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: en_common,
      auth: en_auth,
      dashboard: en_dashboard,
      contacts: en_contacts,
      companies: en_companies,
      leads: en_leads,
      deals: en_deals,
      activities: en_activities,
      tickets: en_tickets,
      employees: en_employees,
      settings: en_settings,
    },
    ar: {
      common: ar_common,
      auth: ar_auth,
      dashboard: ar_dashboard,
      contacts: ar_contacts,
      companies: ar_companies,
      leads: ar_leads,
      deals: ar_deals,
      activities: ar_activities,
      tickets: ar_tickets,
      employees: ar_employees,
      settings: ar_settings,
    },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'ar'],
  load: 'languageOnly',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('crm-lang', lng);
  } catch {
    // ignore
  }
  applyDir(lng);
});

applyDir(i18n.language);

export default i18n;
