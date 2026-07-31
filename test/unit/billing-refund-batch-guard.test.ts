import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';
import {
  prepareClearRefundBatchAssertions,
  prepareRefundBatchAssertion,
} from '../../src/lib/billing-refund-batch-guard';

function setup() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE financial_target (
      id INTEGER PRIMARY KEY,
      value INTEGER NOT NULL
    );
    CREATE TABLE billing_refund_batch_guard (
      tenant_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      step_key TEXT NOT NULL,
      assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
      PRIMARY KEY (tenant_id, operation_key, step_key)
    );
    INSERT INTO financial_target (id, value) VALUES (1, 0);
  `);
  return harness;
}

describe('refund financial batch assertions', () => {
  it('rolls back the whole D1 batch when a critical statement changes zero rows', async () => {
    const harness = setup();

    await expect(harness.db.batch([
      harness.db.prepare('UPDATE financial_target SET value = 1 WHERE id = 999'),
      prepareRefundBatchAssertion(harness.db, {
        tenantId: 'tenant-1',
        operationKey: 'refund-approval:55',
        stepKey: 'commission-transition',
        expectedChanges: 1,
      }),
      harness.db.prepare('UPDATE financial_target SET value = 2 WHERE id = 1'),
      prepareClearRefundBatchAssertions(harness.db, 'tenant-1', 'refund-approval:55'),
    ])).rejects.toThrow(/billing_refund_batch_guard|assertion_value/i);

    expect(harness.sqlite.prepare('SELECT value FROM financial_target WHERE id = 1').get()).toEqual({ value: 0 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM billing_refund_batch_guard').get()).toEqual({ count: 0 });
  });

  it('allows the batch and removes guard rows when the expected row count matches', async () => {
    const harness = setup();

    await harness.db.batch([
      harness.db.prepare('UPDATE financial_target SET value = 1 WHERE id = 1'),
      prepareRefundBatchAssertion(harness.db, {
        tenantId: 'tenant-1',
        operationKey: 'refund-approval:55',
        stepKey: 'commission-transition',
        expectedChanges: 1,
      }),
      prepareClearRefundBatchAssertions(harness.db, 'tenant-1', 'refund-approval:55'),
    ]);

    expect(harness.sqlite.prepare('SELECT value FROM financial_target WHERE id = 1').get()).toEqual({ value: 1 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM billing_refund_batch_guard').get()).toEqual({ count: 0 });
  });
});
