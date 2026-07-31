import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('audit log immutability migrations', () => {
  it('blocks UPDATE and DELETE for application and accounting audit logs at the database layer', () => {
    const migrationsDir = join(process.cwd(), 'migrations');
    const migrationSql = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
      .join('\n');

    expect(migrationSql).toMatch(/BEFORE UPDATE ON audit_logs/i);
    expect(migrationSql).toMatch(/BEFORE DELETE ON audit_logs/i);
    expect(migrationSql).toMatch(/BEFORE UPDATE ON accounting_audit_logs/i);
    expect(migrationSql).toMatch(/BEFORE DELETE ON accounting_audit_logs/i);
  });
});
