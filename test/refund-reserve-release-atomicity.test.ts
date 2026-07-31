import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  prepareCreditRefundReserveRelease,
  prepareReleaseRefundHold,
} from '../src/lib/billing-refund-cash-hold';
import { createSqliteD1Harness } from './helpers/sqlite-d1';

function createHarness(sessionStatus: 'active' | 'closed', approvalStatus: 'pending' | 'approved' = 'pending') {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE billing_counter_sessions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      variance_approval_status TEXT
    );
    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reviewed_by INTEGER,
      execution_status TEXT
    );
    CREATE TABLE billing_refund_cash_holds (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      employee_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      credit_note_id INTEGER,
      held_at TEXT,
      consumed_at TEXT,
      released_at TEXT,
      resolved_by INTEGER,
      resolution_reason TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE cash_drawer_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      counter_session_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      description TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      created_by INTEGER
    );

    INSERT INTO billing_counter_sessions VALUES (20, '100', 3, 9, '${sessionStatus}', NULL);
    INSERT INTO approval_requests VALUES (7, '100', '${approvalStatus}', NULL, 'pending');
    INSERT INTO billing_refund_cash_holds (
      id, tenant_id, approval_request_id, bill_id, patient_id, amount,
      employee_id, counter_id, counter_session_id, status, idempotency_key
    ) VALUES (5, '100', 7, 11, 13, 350, 4, 2, 10, 'held', 'hold-5');
  `);
  harness.sqlite.exec(readFileSync('migrations/0518_refund_reserve_custody_release.sql', 'utf8'));
  harness.sqlite.exec("UPDATE billing_refund_cash_holds SET custody_user_id = 9 WHERE id = 5");
  return harness;
}

async function rejectAndRelease(harness: ReturnType<typeof createSqliteD1Harness>) {
  return harness.db.batch([
    harness.db.prepare(`
      UPDATE approval_requests
      SET status = 'rejected', reviewed_by = 99
      WHERE id = 7 AND tenant_id = '100' AND status = 'pending'
    `),
    prepareCreditRefundReserveRelease(harness.db, {
      tenantId: '100',
      holdId: 5,
      approvalRequestId: 7,
      amount: 350,
      reviewerId: 99,
      destination: { counterSessionId: 20, counterId: 3, custodyUserId: 9 },
    }),
    prepareReleaseRefundHold(harness.db, {
      tenantId: '100',
      holdId: 5,
      approvalRequestId: 7,
      reviewerId: 99,
      reason: 'Rejected',
      destination: { counterSessionId: 20, counterId: 3, custodyUserId: 9 },
    }),
  ]);
}

describe('refund reserve release atomicity', () => {
  it('credits an active custody drawer and marks the hold credited', async () => {
    const harness = createHarness('active');
    await rejectAndRelease(harness);

    const movement = await harness.db.prepare(`
      SELECT counter_session_id, counter_id, employee_id, amount
      FROM cash_drawer_movements
      WHERE reference_type = 'refund_reserve_release' AND reference_id = 5
    `).first<Record<string, number>>();
    const hold = await harness.db.prepare(`
      SELECT status, release_status, release_counter_session_id, release_cash_movement_id
      FROM billing_refund_cash_holds WHERE id = 5
    `).first<Record<string, unknown>>();

    expect(movement).toMatchObject({ counter_session_id: 20, counter_id: 3, employee_id: 9, amount: 350 });
    expect(hold).toMatchObject({ status: 'released', release_status: 'credited', release_counter_session_id: 20 });
    expect(Number(hold?.release_cash_movement_id)).toBeGreaterThan(0);
  });

  it('does not credit a closed destination and leaves the released reserve pending', async () => {
    const harness = createHarness('closed');
    await rejectAndRelease(harness);

    const movementCount = await harness.db.prepare(`
      SELECT COUNT(*) AS count FROM cash_drawer_movements
      WHERE reference_type = 'refund_reserve_release' AND reference_id = 5
    `).first<{ count: number }>();
    const hold = await harness.db.prepare(`
      SELECT status, release_status, release_counter_session_id, release_cash_movement_id
      FROM billing_refund_cash_holds WHERE id = 5
    `).first<Record<string, unknown>>();

    expect(Number(movementCount?.count)).toBe(0);
    expect(hold).toMatchObject({
      status: 'released',
      release_status: 'pending',
      release_counter_session_id: null,
      release_cash_movement_id: null,
    });
  });

  it('does not create a cash credit when the approval was already reviewed', async () => {
    const harness = createHarness('active', 'approved');
    await rejectAndRelease(harness);

    const movementCount = await harness.db.prepare(`
      SELECT COUNT(*) AS count FROM cash_drawer_movements
      WHERE reference_type = 'refund_reserve_release' AND reference_id = 5
    `).first<{ count: number }>();
    const hold = await harness.db.prepare(`
      SELECT status, release_status FROM billing_refund_cash_holds WHERE id = 5
    `).first<Record<string, unknown>>();

    expect(Number(movementCount?.count)).toBe(0);
    expect(hold).toMatchObject({ status: 'held', release_status: 'not_applicable' });
  });
});
