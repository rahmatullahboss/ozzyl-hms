import { describe, it, expect } from 'vitest';
import leave from '../../../src/routes/tenant/hr/leave';
import { createTestApp, jsonRequest } from '../helpers/test-app';

// ─── Leave Request: requested_to (Danphe parity) ──────────────────────────────
// DanpheEMR has a `RequestedTo` field on leave requests that names the specific
// approver the requester is submitting the request to. Our current model only
// records `approved_by` (who approved), not who was asked to approve. This TDD
// cycle adds the missing field end-to-end:
//   RED  → write failing tests below
//   GREEN → migration + schema + API
//   REFACTOR → cleanup

const TENANT = 'hospital-abc';

function setupHrLeave(opts: {
  leaveCategoryId?: number;
  balanceDays?: number;
  staffId?: number;
} = {}) {
  const staffId = opts.staffId ?? 100;
  return createTestApp({
    route: leave,
    routePath: '/api/hr/leave',
    role: 'hospital_admin',
    tenantId: TENANT,
    queryOverride: (sql, params) => {
      if (sql.includes('FROM staff s') && sql.includes('canonical_practitioner_employee_links')) {
        return Number(params[1]) === staffId
          ? {
              first: {
                id: staffId,
                tenant_id: TENANT,
                name: 'Nurse Fatima',
                position: 'Nurse',
                department: 'ICU',
                status: 'active',
                user_id: null,
                practitioner_public_id: null,
              },
            }
          : { first: null };
      }
      if (sql.includes('FROM hr_leave_categories') && sql.includes('LIMIT 1')) {
        return Number(params[1]) === 1
          ? {
              first: {
                id: 1,
                tenant_id: TENANT,
                leave_name: 'Casual',
                is_active: 1,
              },
            }
          : { first: null };
      }
      if (sql.includes('FROM hr_employee_leave_balances') && sql.includes('LIMIT 1')) {
        return Number(params[1]) === staffId && Number(params[2]) === 1
          ? {
              first: {
                tenant_id: TENANT,
                staff_id: staffId,
                leave_category_id: 1,
                year: Number(params[3]),
                balance: opts.balanceDays ?? 10,
                used: 0,
              },
            }
          : { first: null };
      }
      if (sql.includes('FROM hr_weekend_policies')) return { results: [] };
      if (sql.includes('FROM hr_holidays')) return { first: null };
      return null;
    },
    tables: {
      staff: [
        {
          id: opts.staffId ?? 100,
          tenant_id: TENANT,
          name: 'Nurse Fatima',
          position: 'Nurse',
          department: 'ICU',
          status: 'active',
          user_id: null,
        },
      ],
      hr_weekend_policies: [],
      hr_holidays: [],
      hr_leave_categories: opts.leaveCategoryId !== undefined
        ? [{ id: opts.leaveCategoryId, tenant_id: TENANT, leave_name: 'Casual', max_days_per_year: 10, is_active: 1 }]
        : [{ id: 1, tenant_id: TENANT, leave_name: 'Casual', max_days_per_year: 10, is_active: 1 }],
      hr_employee_leave_balances: [
        {
          tenant_id: TENANT,
          staff_id: opts.staffId ?? 100,
          leave_category_id: 1,
          year: new Date().getFullYear(),
          entitled_days: 10,
          used_days: 0,
          remaining_days: opts.balanceDays ?? 10,
          balance: opts.balanceDays ?? 10,
        },
      ],
    },
  });
}

describe('Leave API: requested_to (Danphe parity)', () => {
  it('POST /api/hr/leave/request accepts a requestedTo staff id and persists it', async () => {
    const { app, mockDB } = setupHrLeave({ leaveCategoryId: 1, balanceDays: 10, staffId: 100 });

    const year = new Date().getFullYear();
    const res = await jsonRequest(app, '/api/hr/leave/request', {
      method: 'POST',
      body: {
        staffId: 100,
        leaveCategoryId: 1,
        startDate: `${year}-06-01`,
        endDate: `${year}-06-03`,
        reason: 'Family event',
        requestedTo: 200,
      },
    });

    expect(res.status).toBe(201);

    const insert = mockDB.queries.find(
      (q) => q.method === 'run' && /INSERT INTO hr_leave_requests/i.test(q.sql),
    );
    expect(insert, 'expected an INSERT INTO hr_leave_requests statement').toBeDefined();
    expect(insert!.sql).toMatch(/requested_to/i);
    expect(insert!.params).toContain(200);
  });
});
