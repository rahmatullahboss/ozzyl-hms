import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('manager dashboard permission contract', () => {
  it('uses the dedicated manager dashboard permission on defaults and API route', () => {
    const authz = readFileSync('packages/shared/src/authz.ts', 'utf8');
    const route = readFileSync('src/routes/tenant/managerDashboard.ts', 'utf8');

    expect(authz).toContain('manager.dashboard.read');
    expect(authz).toContain('operations.overview.read');
    expect(authz).toContain('operations.alerts.read');
    expect(authz).toContain('operations.tasks.read');
    expect(authz).toContain('operations.department_status.read');
    expect(authz).not.toContain("'operations.tasks.write',\n    'tests:read'");
    expect(route).toContain("requirePermission('manager.dashboard.read')");
  });
});
