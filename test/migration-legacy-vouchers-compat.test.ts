import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0371_legacy_vouchers_compat.sql';

describe('legacy vouchers compatibility migration', () => {
  it('records the idempotent compatibility objects required by legacy foreign keys', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS vouchers');
    expect(sql).toContain('INSERT OR IGNORE INTO vouchers');
    expect(sql).toContain(
      'CREATE TRIGGER IF NOT EXISTS trg_accounting_vouchers_legacy_vouchers_insert',
    );
    expect(sql).toContain('AFTER INSERT ON accounting_vouchers');
  });
});
