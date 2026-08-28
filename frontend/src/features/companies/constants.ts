export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;

export function isKnownCompanySize(size: string): boolean {
  return (COMPANY_SIZES as readonly string[]).includes(size);
}
