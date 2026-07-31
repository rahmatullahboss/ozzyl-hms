import type { D1PreparedStatement } from '@cloudflare/workers-types';

export type RefundBatchAssertionInput = {
  tenantId: string;
  operationKey: string;
  stepKey: string;
  expectedChanges: number;
};

export function prepareRefundBatchAssertion(
  db: D1Database,
  input: RefundBatchAssertionInput,
): D1PreparedStatement {
  const expectedChanges = Number(input.expectedChanges);
  if (!Number.isInteger(expectedChanges) || expectedChanges < 0) {
    throw new Error('Refund batch assertion requires a non-negative integer expectedChanges value');
  }
  return db.prepare(`
    INSERT INTO billing_refund_batch_guard (
      tenant_id, operation_key, step_key, assertion_value
    ) VALUES (?, ?, ?, CASE WHEN changes() = ? THEN 1 ELSE 0 END)
  `).bind(
    input.tenantId,
    input.operationKey,
    input.stepKey,
    expectedChanges,
  ) as unknown as D1PreparedStatement;
}

export function prepareClearRefundBatchAssertions(
  db: D1Database,
  tenantId: string,
  operationKey: string,
): D1PreparedStatement {
  return db.prepare(`
    DELETE FROM billing_refund_batch_guard
    WHERE tenant_id = ? AND operation_key = ?
  `).bind(tenantId, operationKey) as unknown as D1PreparedStatement;
}

export function isRefundBatchAssertionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current ?? '');
    if (/billing_refund_batch_guard|assertion_value/i.test(message)) return true;
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
