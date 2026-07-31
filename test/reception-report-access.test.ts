import { describe, expect, it } from 'vitest';
import expenseRoutes from '../src/routes/tenant/expenses';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

describe('reception report access', () => {
  it('allows receptionist alias to read daily expense rows used by reception reports', async () => {
    const { app } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'receptionist',
      tenantId: 'tenant-1',
      mockDB: createMockDB({
        tables: {
          expenses: [
            {
              id: 1,
              tenant_id: 'tenant-1',
              date: '2026-05-18',
              category: 'MISC',
              amount: 120,
              status: 'approved',
            },
          ],
        },
      }),
    });

    const res = await app.request('/expenses?startDate=2026-05-18&endDate=2026-05-18');
    expect(res.status).toBe(200);
    const body = await res.json() as { expenses: Array<{ id: number }> };
    expect(body.expenses).toHaveLength(1);
  });
});
