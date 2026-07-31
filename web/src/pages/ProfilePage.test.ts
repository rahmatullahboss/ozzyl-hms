import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'ProfilePage.tsx');

describe('ProfilePage', () => {
  it('marks password fields with password-manager-safe autocomplete hints', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain('autoComplete="current-password"');
    expect(source.match(/autoComplete="new-password"/g)).toHaveLength(2);
  });

  it('explains the full password strength rule instead of only mentioning 8 characters', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain('passwordStrengthHint');
    expect(source).toContain('uppercase, lowercase, and number');
  });
});
