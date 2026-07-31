import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readScript(): string {
  try {
    return readFileSync(resolve(process.cwd(), 'scripts/migrate-staff-passwords-to-pbkdf2.ts'), 'utf8');
  } catch {
    return '';
  }
}

describe('staff password migration script safety contract', () => {
  it('defaults to dry-run and requires explicit production confirmation before writes', () => {
    const source = readScript();
    expect(source).toContain("'--apply'");
    expect(source).toContain('HMS_CONFIRM_BCRYPT_TO_PBKDF2');
    expect(source).toContain("=== 'YES'");
    expect(source).toMatch(/dry[- ]run/i);
  });

  it('verifies the existing value and uses an atomic old-hash update', () => {
    const source = readScript();
    expect(source).toContain('verifyPassword');
    expect(source).toContain('hashPassword');
    expect(source).toContain('buildAtomicPasswordUpdateSql');
    expect(source).toContain('isLegacyBcryptHash');
  });

  it('reads secrets from an input file rather than command-line password arguments', () => {
    const source = readScript();
    expect(source).toContain("'--input'");
    expect(source).toContain('readFileSync');
    expect(source).not.toMatch(/--password/i);
  });
});
