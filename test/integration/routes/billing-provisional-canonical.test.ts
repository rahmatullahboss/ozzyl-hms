import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('billing provisional canonical finalization contract', () => {
  it('routes every provisional settlement mode through one strict financial coordinator', () => {
    const source = readFileSync('src/routes/tenant/billingProvisional.ts', 'utf8');
    expect(source).toContain("boundary: 'billing-provisional.finalize'");
    expect(source).toContain('executeStrictFinancialMutation({');
    expect(source).toContain('buildProvisionalSettlementProjection({');
    expect(source).toContain('prepareProvisionalBillingLegacyStatements(c.env.DB');
    expect(source).toContain('issueInvoiceWithSettlement(c.env.DB, projection, execution)');
    expect(source).not.toContain('await db.$client.batch(batchStmts)');
  });

  it('builds strict-only projection inside the canonical callback so shadow legacy remains compatible', () => {
    const source = readFileSync('src/routes/tenant/billingProvisional.ts', 'utf8');
    const strictIndex = source.indexOf('await executeStrictFinancialMutation({');
    const projectionIndex = source.indexOf('const projection = await buildProvisionalSettlementProjection({ ...projectionInput });');
    expect(strictIndex).toBeGreaterThan(0);
    expect(projectionIndex).toBeGreaterThan(strictIndex);
  });

  it('keeps non-financial side effects after the strict financial commit', () => {
    const source = readFileSync('src/routes/tenant/billingProvisional.ts', 'utf8');
    const strictIndex = source.indexOf('await executeStrictFinancialMutation({');
    const doctorPayableIndex = source.indexOf('createDoctorPayableAccrualsForProvisionalItems({');
    const schemeUsageIndex = source.indexOf('recordBillingSchemeUsage(c.env.DB');
    const finalizationIndex = source.indexOf('recordBillFinalizationSideEffects(c.env.DB');
    const auditIndex = source.indexOf("createAuditLog(c.env, tenantId, userId, 'CREATE', 'bills'");
    expect(strictIndex).toBeGreaterThan(0);
    expect(doctorPayableIndex).toBeGreaterThan(strictIndex);
    expect(schemeUsageIndex).toBeGreaterThan(strictIndex);
    expect(finalizationIndex).toBeGreaterThan(strictIndex);
    expect(auditIndex).toBeGreaterThan(strictIndex);
    expect(source).toContain('skipBillAccountingEvent: true');
  });

  it('maps nested strict canonical conflicts without exposing internal causes', () => {
    const source = readFileSync('src/routes/tenant/billingProvisional.ts', 'utf8');
    expect(source).toContain('function isProvisionalCanonicalConflict(error: unknown): boolean');
    expect(source).toContain("current = (current as { cause?: unknown }).cause");
    expect(source).toContain('isProvisionalCanonicalConflict(error)');
  });

  it('does not create bill, payment, or deposit accounting events after the financial commit', () => {
    const source = readFileSync('src/routes/tenant/billingProvisional.ts', 'utf8');
    expect(source).not.toContain('recordAccountingPostingEvent(c.env.DB');
    expect(source).not.toContain('ACCOUNTING_EVENT_TYPES.paymentReceived');
    expect(source).not.toContain('ACCOUNTING_EVENT_TYPES.patientDepositAdjusted');
  });

  it('accepts optional non-cash transaction authority aliases', () => {
    const source = readFileSync('src/routes/tenant/billingProvisional.ts', 'utf8');
    expect(source).toContain('external_transaction_id: z.string().trim().min(3).max(128).optional()');
    expect(source).toContain('externalTransactionId: z.string().trim().min(3).max(128).optional()');
    expect(source).toContain('data.external_transaction_id ?? data.externalTransactionId ?? null');
  });
});
