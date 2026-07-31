import { describe, expect, it } from 'vitest';
import type { OvertimeReviewMutation } from '../../../src/modules/workforce-management/application/overtime-service';
import { createD1OvertimeRepository } from '../../../src/modules/workforce-management/infrastructure/d1-overtime-repository';

type CapturedStatement = {
  sql: string;
  bindings: unknown[];
  run: () => Promise<{ success: boolean; meta: { changes: number } }>;
};

function createCapturingDb() {
  const prepared: CapturedStatement[] = [];
  const batches: CapturedStatement[][] = [];

  const db = {
    prepare(sql: string) {
      const captured: CapturedStatement = {
        sql,
        bindings: [],
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
      };
      const statement = {
        bind(...values: unknown[]) {
          captured.bindings = values;
          return statement;
        },
        run: captured.run,
      };
      prepared.push(captured);
      return statement;
    },
    async batch(statements: CapturedStatement[]) {
      batches.push(statements);
      return statements.map((_statement, index) => ({
        success: true,
        meta: { changes: index === 0 ? 1 : 1 },
      }));
    },
  } as unknown as D1Database;

  return { db, prepared, batches };
}

function approvedMutation(): OvertimeReviewMutation {
  return {
    tenantId: '100',
    overtimeLogId: 10,
    expectedStatus: 'pending',
    status: 'approved',
    actorUserId: '44',
    reviewedAtUtc: '2026-07-27T04:00:00.000Z',
    ruleId: 2,
    approvedHours: 3,
    multiplierSnapshot: 1.5,
  };
}

describe('D1 overtime repository review evidence', () => {
  it('updates the guarded overtime row and appends immutable audit evidence in one batch', async () => {
    const { db, prepared, batches } = createCapturingDb();
    const repository = createD1OvertimeRepository(db);

    await expect(repository.review(approvedMutation())).resolves.toBe(true);

    expect(batches).toHaveLength(1);
    expect(prepared).toHaveLength(2);
    expect(prepared[0].sql).toMatch(/UPDATE hr_overtime_log/i);
    expect(prepared[0].sql).toMatch(/status\s*=\s*\?/i);
    expect(prepared[1].sql).toMatch(/INSERT INTO audit_logs/i);
    expect(prepared[1].sql).toMatch(/WHERE changes\(\) = 1/i);
    expect(prepared[1].bindings).toEqual([
      '100',
      '44',
      'APPROVE',
      'hr_overtime_log',
      10,
      expect.stringContaining('"approvedHours":3'),
      '2026-07-27T04:00:00.000Z',
    ]);
  });

  it('reports a transition conflict when the guarded update changes no row', async () => {
    const { db } = createCapturingDb();
    db.batch = async () => [
      { success: true, meta: { changes: 0 } },
      { success: true, meta: { changes: 0 } },
    ] as unknown as D1Result<unknown>[];
    const repository = createD1OvertimeRepository(db);

    await expect(repository.review(approvedMutation())).resolves.toBe(false);
  });
});
