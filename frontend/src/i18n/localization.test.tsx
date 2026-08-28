import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  BidiText,
  Dropdown,
  Input,
  Modal,
  Pagination,
  Textarea,
} from '@/components/ui';
import i18n, { applyDir } from '@/i18n';
import { formatCurrency, formatDate, formatNumber, formatRelativeTime } from '@/lib/utils';

describe('Arabic localization architecture', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('switches the document language and direction dynamically', async () => {
    await i18n.changeLanguage('ar');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');

    await i18n.changeLanguage('en');
    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
  });

  it('normalizes regional Arabic locale codes', () => {
    applyDir('ar-EG');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('loads Arabic translations and Arabic plural forms without showing raw keys', async () => {
    await i18n.changeLanguage('ar');
    expect(i18n.t('common:actions.save')).toBe('حفظ');
    expect(i18n.t('contacts:subtitle', { count: 0 })).toContain('لا توجد');
    expect(i18n.t('contacts:subtitle', { count: 1 })).toContain('واحدة');
    expect(i18n.t('contacts:subtitle', { count: 2 })).toContain('جهتا اتصال');
    expect(i18n.t('contacts:subtitle', { count: 5 })).toContain('جهات اتصال');
    expect(i18n.t('contacts:subtitle', { count: 11 })).toContain('جهة اتصال');
    expect(i18n.t('common:actions.save')).not.toContain('common:');
  });

  it('keeps emails and phone-like data LTR while free text remains content-aware', async () => {
    await i18n.changeLanguage('ar');
    render(
      <>
        <Input aria-label="email" type="email" value="sales@example.com" readOnly />
        <Input aria-label="phone" type="tel" value="+20 100 123 4567" readOnly />
        <Textarea aria-label="message" defaultValue="رسالة عربية" />
        <BidiText direction="ltr">INV-2026-00124</BidiText>
      </>,
    );

    expect(screen.getByLabelText('email')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('phone')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('message')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('INV-2026-00124')).toHaveAttribute('dir', 'ltr');
  });

  it('passes RTL direction into portals and dropdown surfaces', async () => {
    await i18n.changeLanguage('ar');
    const user = userEvent.setup();
    render(
      <>
        <Modal open onClose={() => undefined} title="عنوان النافذة">
          محتوى
        </Modal>
        <Dropdown
          trigger={<button type="button">القائمة</button>}
          items={[{ label: 'تعديل', onClick: () => undefined }]}
        />
      </>,
    );

    expect(screen.getByRole('dialog')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: 'القائمة' }));
    expect(screen.getByRole('menu')).toHaveAttribute('dir', 'rtl');
  });

  it('mirrors pagination icons but preserves page-number order', async () => {
    const { container, rerender } = render(
      <Pagination page={2} pageSize={20} count={100} onPageChange={() => undefined} />,
    );
    const englishPreviousPath = container.querySelector('button svg path')?.getAttribute('d');

    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    rerender(<Pagination page={2} pageSize={20} count={100} onPageChange={() => undefined} />);
    const arabicPreviousPath = container.querySelector('button svg path')?.getAttribute('d');

    expect(arabicPreviousPath).not.toBe(englishPreviousPath);
    expect(screen.getByText('2 / 5')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('button', { name: /السابق/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /التالي/ })).toBeInTheDocument();
  });

  it('formats Arabic dates, numbers, currencies, and relative time consistently', async () => {
    await i18n.changeLanguage('ar');
    expect(formatDate('2026-08-28')).toContain('أغسطس');
    expect(formatNumber(1234)).toContain('1');
    expect(formatNumber(1234)).not.toMatch(/[٠-٩]/);
    const currency = formatCurrency(50000, 'EGP');
    expect(currency).toContain('50');
    expect(currency).toContain('EGP');
    expect(currency.indexOf('50')).toBeLessThan(currency.indexOf('EGP'));
    expect(formatRelativeTime('2026-08-27T12:00:00Z', new Date('2026-08-28T12:00:00Z'))).toBe('أمس');
  });
});
