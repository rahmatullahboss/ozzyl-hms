import type { CanonicalPreparedStatement } from './command-batch';

export interface FinancialBatchAssertionInput {
  tenantId: string;
  operationKey: string;
  stepKey: string;
  expectedChanges: number;
}

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

type PreparedStatementFactory<TStatement extends CanonicalPreparedStatement> = {
  prepare(sql: string): TStatement;
};

export function prepareFinancialBatchAssertion<TStatement extends CanonicalPreparedStatement>(
  db: PreparedStatementFactory<TStatement>,
  input: FinancialBatchAssertionInput,
): TStatement {
  const tenantId = exact(input.tenantId, 'tenantId');
  const operationKey = exact(input.operationKey, 'operationKey');
  const stepKey = exact(input.stepKey, 'stepKey');
  const expectedChanges = nonNegativeInteger(input.expectedChanges, 'expectedChanges');

  return db.prepare(`
    INSERT INTO canonical_financial_batch_assertions (
      tenant_id, operation_key, step_key, assertion_value
    ) VALUES (?, ?, ?, CASE WHEN changes() = ? THEN 1 ELSE 0 END)
  `).bind(tenantId, operationKey, stepKey, expectedChanges) as TStatement;
}

export function prepareClearFinancialBatchAssertions<TStatement extends CanonicalPreparedStatement>(
  db: PreparedStatementFactory<TStatement>,
  tenantId: string,
  operationKey: string,
): TStatement {
  return db.prepare(`
    DELETE FROM canonical_financial_batch_assertions
    WHERE tenant_id = ? AND operation_key = ?
  `).bind(
    exact(tenantId, 'tenantId'),
    exact(operationKey, 'operationKey'),
  ) as TStatement;
}

export function isFinancialBatchAssertionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/canonical_financial_batch_assertions|assertion_value/i.test(message)) return true;
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
