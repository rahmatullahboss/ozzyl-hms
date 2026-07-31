import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const admissionsSource = readFileSync(
  join(process.cwd(), 'src/routes/tenant/admissions.ts'),
  'utf8',
);

describe('admission slip print API contract', () => {
  it('returns the admitting user name for the printable signature section', () => {
    const slipRoute = admissionsSource.slice(
      admissionsSource.indexOf("app.get('/:id/slip'"),
      admissionsSource.indexOf("app.get('/:id/wristband'"),
    );

    expect(slipRoute).toContain('FROM audit_logs al');
    expect(slipRoute).toContain("al.table_name = 'admissions'");
    expect(slipRoute).toContain("al.action = 'CREATE'");
    expect(slipRoute).toContain('al.record_id = a.id');
    expect(slipRoute).toContain('u.id = al.user_id AND u.tenant_id = al.tenant_id');
    expect(slipRoute).toContain('AS created_by_name');
    expect(slipRoute).not.toContain('a.created_by');
  });
});
