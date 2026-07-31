import { describe, expect, it } from 'vitest';
import { createD1LeaveRepository } from '../../../src/modules/workforce-management/infrastructure/d1-leave-repository';

function createCapturingDb() {
  const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const captured = { sql, bindings: [] as unknown[] };
      prepared.push(captured);
      const statement = {
        bind(...values: unknown[]) {
          captured.bindings = values;
          return statement;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, prepared };
}

describe('D1 leave repository approval guards', () => {
  it('requires the immediately preceding balance deduction to affect one row', () => {
    const { db, prepared } = createCapturingDb();
    const repository = createD1LeaveRepository(db);

    repository.prepareReviewRequest({
      tenantId: '100',
      leaveRequestId: 50,
      expectedStatus: 'pending',
      status: 'approved',
      actorUserId: '44',
      rejectionReason: null,
      reviewedAtUtc: '2026-07-27T03:00:00.000Z',
      approvedBalanceGuard: {
        staffId: 1,
        leaveCategoryId: 2,
        year: 2026,
        expectedBalanceAfterDeduction: 8,
        expectedUsedAfterDeduction: 2,
      },
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0].sql).toMatch(/changes\(\)\s*=\s*1/i);
  });
});
