// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(process.cwd(), 'src');

function filesUnder(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

function flatten(value: unknown, prefix = '', output: Record<string, string> = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, output);
    }
  } else {
    output[prefix] = String(value ?? '');
  }
  return output;
}

const pluralSuffix = /_(zero|one|two|few|many|other)$/;
const canonicalKey = (key: string) => key.replace(pluralSuffix, '');

describe('localization source audit', () => {
  it('keeps English and Arabic translation namespaces structurally aligned', () => {
    const enDirectory = path.join(sourceRoot, 'i18n/locales/en');
    const arDirectory = path.join(sourceRoot, 'i18n/locales/ar');
    const namespaces = fs.readdirSync(enDirectory).filter((file) => file.endsWith('.json'));

    for (const namespace of namespaces) {
      const en = flatten(JSON.parse(fs.readFileSync(path.join(enDirectory, namespace), 'utf8')));
      const ar = flatten(JSON.parse(fs.readFileSync(path.join(arDirectory, namespace), 'utf8')));
      const enKeys = new Set(Object.keys(en).map(canonicalKey));
      const arKeys = new Set(Object.keys(ar).map(canonicalKey));
      expect([...arKeys].sort(), `${namespace} key families`).toEqual([...enKeys].sort());
      expect(Object.values(ar).every((value) => value.trim().length > 0), `${namespace} empty value`).toBe(true);
    }
  });

  it('contains no physical-direction Tailwind utilities outside intentional chart geometry', () => {
    const files = filesUnder(sourceRoot).filter(
      (file) => /\.(ts|tsx|css)$/.test(file) && !file.includes(`${path.sep}demo${path.sep}`),
    );
    const violations = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const matches = source.match(/\b(?:ml|mr|pl|pr|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-[\w[\]./-]+/g);
      return (matches ?? []).map((match) => `${path.relative(sourceRoot, file)}: ${match}`);
    });
    expect(violations).toEqual([]);
  });

  it('centralizes directional icon decisions', () => {
    const files = filesUnder(sourceRoot).filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !file.endsWith('DirectionalIcon.tsx') &&
        !file.endsWith('source-audit.test.ts'),
    );
    const violations = files.filter((file) =>
      /\b(?:ArrowLeft|ArrowRight|ChevronLeft|ChevronRight)\b/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(violations.map((file) => path.relative(sourceRoot, file))).toEqual([]);
  });

  it('keeps conversation content direction-aware without changing sender semantics', () => {
    const ticket = fs.readFileSync(path.join(sourceRoot, 'features/tickets/TicketDetailPage.tsx'), 'utf8');
    expect(ticket).toContain('dir="auto"');
    expect(ticket).toContain('{comment.body}');
    expect(ticket).not.toMatch(/flex-row-reverse.*comment\.body/s);
  });
});
