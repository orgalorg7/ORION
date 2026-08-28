import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright-core';

const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5190';
const screenshotDirectory = process.env.QA_SCREENSHOT_DIR;
const executablePath = process.env.QA_CHROME_PATH ?? '/usr/bin/google-chrome';
const widths = [320, 375, 768, 1024, 1440];
const errors = [];

function reportError(message) {
  errors.push(message);
  process.stderr.write(`ERROR: ${message}\n`);
}

function routeSlug(route) {
  return route.replace(/^\/app\/?/, 'dashboard-').replaceAll('/', '-').replace(/-$/, '') || 'dashboard';
}

const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (error) => reportError(`Browser exception: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') reportError(`Console error: ${message.text()}`);
});

await page.goto(`${baseUrl}/#/login`, { waitUntil: 'networkidle' });
await page.locator('header select').selectOption('ar');
await page.waitForFunction(() => document.documentElement.dir === 'rtl');
await page.locator('input[type="email"]').fill('demo@crm.com');
await page.locator('input[type="password"]').fill('demo1234');
await page.locator('form button[type="submit"]').click();
await page.waitForURL(/#\/app/);

const database = await page.evaluate(() => JSON.parse(localStorage.getItem('hammerload-demo-db-v1') ?? '{}'));
const firstId = (collection) => database[collection]?.[0]?.id;
const routes = [
  '/login',
  '/register',
  '/app',
  '/app/contacts',
  `/app/contacts/${firstId('contacts')}`,
  '/app/companies',
  `/app/companies/${firstId('companies')}`,
  '/app/leads',
  `/app/leads/${firstId('leads')}`,
  '/app/deals',
  `/app/deals/${firstId('deals')}`,
  '/app/activities',
  '/app/tickets',
  `/app/tickets/${firstId('tickets')}`,
  '/app/employees',
  `/app/employees/${firstId('employees')}`,
  '/app/settings',
  '/app/settings/organization',
  '/app/settings/team',
  '/app/settings/pipelines',
  '/app/settings/tags',
  '/app/settings/billing',
];

if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });

async function auditRoute(route, locale, width, screenshot = false) {
  await page.setViewportSize({ width, height: width < 768 ? 850 : 1000 });
  await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    (expected) => document.documentElement.dir === expected,
    locale === 'ar' ? 'rtl' : 'ltr',
  );

  const findings = await page.evaluate(({ expectedDir, viewportWidth }) => {
    const root = document.documentElement;
    const bodyText = document.body.innerText;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const untranslatedControls = expectedDir === 'rtl'
      ? [...document.querySelectorAll('button, [role="button"], label')]
          .filter(visible)
          .map((element) => element.textContent?.trim())
          .filter((text) => /^(Save|Cancel|Delete|Edit|Close|Back|Next|Previous|Search|Filter|View|Import|Export)$/i.test(text ?? ''))
      : [];
    const aside = document.querySelector('aside');
    const asideRect = aside && visible(aside) ? aside.getBoundingClientRect() : null;
    return {
      dir: root.dir,
      lang: root.lang,
      overflow: root.scrollWidth - viewportWidth,
      rawKey: /\b(?:common|auth|dashboard|contacts|companies|leads|deals|activities|tickets|employees|settings):[\w.]+\b/.exec(bodyText)?.[0],
      untranslatedControls,
      sidebarEdge: asideRect
        ? expectedDir === 'rtl'
          ? Math.abs(innerWidth - asideRect.right)
          : Math.abs(asideRect.left)
        : 0,
    };
  }, { expectedDir: locale === 'ar' ? 'rtl' : 'ltr', viewportWidth: width });

  if (findings.overflow > 1) reportError(`${locale} ${width}px ${route}: document overflow ${findings.overflow}px`);
  if (findings.rawKey) reportError(`${locale} ${width}px ${route}: raw translation key ${findings.rawKey}`);
  if (findings.untranslatedControls.length) {
    reportError(`${locale} ${width}px ${route}: untranslated controls ${findings.untranslatedControls.join(', ')}`);
  }
  if (width >= 1024 && findings.sidebarEdge > 2) {
    reportError(`${locale} ${width}px ${route}: sidebar is ${findings.sidebarEdge}px from the logical start edge`);
  }

  if (locale === 'ar') {
    const invalidValueDirections = await page.locator('input[type="email"], input[type="tel"], input[type="url"]').evaluateAll(
      (elements) => elements.filter((element) => element.getAttribute('dir') !== 'ltr').length,
    );
    if (invalidValueDirections) reportError(`ar ${width}px ${route}: ${invalidValueDirections} LTR data inputs lack dir=ltr`);

    if (route === '/app') {
      const contentDirections = await page.evaluate(() => {
        const directionOf = (text) => {
          const element = document.createElement('bdi');
          element.dir = 'auto';
          element.textContent = text;
          document.body.append(element);
          const direction = getComputedStyle(element).direction;
          element.remove();
          return direction;
        };
        return [directionOf('رسالة عربية'), directionOf('English message')];
      });
      if (contentDirections[0] !== 'rtl' || contentDirections[1] !== 'ltr') {
        reportError(`ar ${width}px ${route}: dir=auto did not resolve Arabic/English message direction`);
      }

      if (width < 1024) {
        await page.locator('header button').first().click();
        const mobileSidebarEdge = await page.locator('aside:visible').evaluate(
          (aside) => Math.abs(innerWidth - aside.getBoundingClientRect().right),
        );
        if (mobileSidebarEdge > 2) {
          reportError(`ar ${width}px ${route}: mobile sidebar opened ${mobileSidebarEdge}px from the right edge`);
        }
        await page.locator('aside:visible button').click();
      }
    }
  }

  if (screenshot && screenshotDirectory) {
    await page.screenshot({
      path: path.join(screenshotDirectory, `${locale}-${width}-${routeSlug(route)}.png`),
      fullPage: true,
    });
  }
}

for (const width of widths) {
  for (const route of routes) await auditRoute(route, 'ar', width, width === 375 || width === 1440);
}

await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${baseUrl}/#/app`, { waitUntil: 'networkidle' });
await page.locator('header select').selectOption('en');
await page.waitForFunction(() => document.documentElement.dir === 'ltr');
for (const route of routes) await auditRoute(route, 'en', 1440, true);

await browser.close();
if (errors.length) {
  throw new Error(`RTL visual QA failed with ${errors.length} issue(s).`);
}
process.stdout.write(`RTL visual QA passed: ${routes.length} routes, ${widths.length} Arabic widths, and English regression checks.\n`);
