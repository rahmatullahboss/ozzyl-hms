import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINANCIAL_ROUTE_COVERAGE } from '../../../src/lib/canonical/financial-route-coverage';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function admissionDepositFlow(): string {
  const reception = source('src/routes/tenant/reception.ts');
  const start = reception.indexOf("receptionRoutes.post('/admit-with-deposit'");
  const end = reception.indexOf('// 3. ADD A SERVICE TO A VISIT', start);
  if (start < 0 || end < 0) throw new Error('Admission deposit route could not be located');
  return reception.slice(start, end);
}

describe('reception admission deposit canonical atomic integration', () => {
  it('registers the boundary as integrated with recordDeposit', () => {
    expect(FINANCIAL_ROUTE_COVERAGE['reception.admission.deposit.collect']).toMatchObject({
      status: 'integrated',
      routeFile: 'src/routes/tenant/reception.ts',
      canonicalCommand: 'recordDeposit',
    });
  });

  it('uses guarded legacy statements as the authoritative canonical command batch', () => {
    const flow = admissionDepositFlow();

    expect(flow).toContain('prepareFinancialBatchAssertion');
    expect(flow).toContain('prepareClearFinancialBatchAssertions');
    expect(flow).toContain("boundary: 'reception.admission.deposit.collect'");
    expect(flow).toContain('legacyStatements: statements');
    expect(flow).toMatch(/executeStrictFinancialMutation[\s\S]*recordDeposit/);
    expect(flow).not.toContain('legacyStatements: []');
  });

  it('guards bed assignment and all dependent financial rows before clearing assertions', () => {
    const flow = admissionDepositFlow();

    expect(flow).toContain("AND status = 'available'");
    for (const stepKey of [
      'admission_insert',
      'bed_update',
      'bed_history_insert',
      'deposit_insert',
      'cash_transaction_insert',
      'accounting_event_insert',
      'admission_fee_insert',
    ]) {
      expect(flow).toContain(`stepKey: '${stepKey}'`);
    }
    expect(flow.indexOf('prepareClearFinancialBatchAssertions')).toBeGreaterThan(
      flow.indexOf("stepKey: 'accounting_event_insert'"),
    );
  });

  it('finishes idempotency before best-effort post-commit shadow work', () => {
    const flow = admissionDepositFlow();
    const strictMutation = flow.indexOf('executeStrictFinancialMutation');
    const idempotencyCompletion = flow.indexOf('completeMutationIdempotencyKey');
    const cashShadow = flow.indexOf('shadowCreateCashLedgerEntry');

    expect(flow).toContain('let coreCommitted = false');
    expect(flow).toContain('if (!coreCommitted && data.idempotencyKey && idempotencyReserved)');
    expect(strictMutation).toBeGreaterThan(-1);
    expect(idempotencyCompletion).toBeGreaterThan(strictMutation);
    expect(cashShadow).toBeGreaterThan(idempotencyCompletion);
    expect(flow).toContain("Failed to write admission deposit cash-ledger shadow:");
    expect(flow).not.toMatch(/shadowCreateCashLedgerEntry\([\s\S]*?\);\s*\n\s*}\s*\n\s*\/\/ Add admission fee/);
  });

  it('moves the admission fee into the core batch before financial execution', () => {
    const flow = admissionDepositFlow();
    const feeInsert = flow.indexOf('INSERT INTO billing_provisional_items');
    const strictMutation = flow.indexOf('executeStrictFinancialMutation');

    expect(feeInsert).toBeGreaterThan(-1);
    expect(strictMutation).toBeGreaterThan(feeInsert);
    expect(flow.match(/INSERT INTO billing_provisional_items/g)).toHaveLength(1);
  });

  it('writes an explicit Dhaka wall-clock admission time and reuses it for canonical continuity', () => {
    const flow = admissionDepositFlow();

    expect(flow).toContain("const admissionDate = new Date(Date.now() + 6 * 3600_000).toISOString().replace('T', ' ').substring(0, 19)");
    expect(flow).toMatch(/admission_fee, billing_mode, package_id, admission_date/);
    expect(flow).toContain('data.packageId ?? null,\n        admissionDate,');
    expect(flow).toContain('startedAtUtc: normalizeLegacyAdmissionStartedAtUtc(admissionDate)');
  });
});
