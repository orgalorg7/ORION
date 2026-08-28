import {
  ArrowLeft,
  ArrowRight,
  ArrowUpLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  type LucideProps,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function BackIcon(props: LucideProps) {
  const { i18n } = useTranslation();
  const Icon = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  return <Icon aria-hidden="true" {...props} />;
}

export function PreviousIcon(props: LucideProps) {
  const { i18n } = useTranslation();
  const Icon = i18n.dir() === 'rtl' ? ChevronRight : ChevronLeft;
  return <Icon aria-hidden="true" {...props} />;
}

export function NextIcon(props: LucideProps) {
  const { i18n } = useTranslation();
  const Icon = i18n.dir() === 'rtl' ? ChevronLeft : ChevronRight;
  return <Icon aria-hidden="true" {...props} />;
}

export function ForwardUpIcon(props: LucideProps) {
  const { i18n } = useTranslation();
  const Icon = i18n.dir() === 'rtl' ? ArrowUpLeft : ArrowUpRight;
  return <Icon aria-hidden="true" {...props} />;
}
