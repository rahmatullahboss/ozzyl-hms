import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  allocateDiscountAcrossGrossAmounts,
  requireUniquePositiveIds,
} from '../src/lib/reception-billing-integrity';

const receptionSource = readFileSync('src/routes/tenant/reception.ts', 'utf8');
const paymentsSource = readFileSync('src/routes/tenant/payments.ts', 'utf8');
const billingSource = readFileSync('src/routes/tenant/billing.ts', 'utf8');
const billingCounterSource = readFileSync('src/routes/tenant/billingCounter.legacy.ts', 'utf8');
const depositsSource = readFileSync('src/routes/tenant/deposits.ts', 'utf8');
const appointmentsSource = readFileSync('src/routes/tenant/appointments.ts', 'utf8');
const appointmentFinalizationSource = readFileSync('src/lib/canonical/appointment-billing-finalization.ts', 'utf8');
const appointmentSchemaSource = readFileSync('src/schemas/appointment.ts', 'utf8');
const gatewayMigrationPath = 'migrations/0414_payment_gateway_verifying_status.sql';

describe('reception billing money integrity', () => {
  it('allocates the full discount without exceeding a low-value final line', () => {
    expect(allocateDiscountAcrossGrossAmounts([100, 1], 101)).toEqual([100, 1]);
  });

  it('preserves cent-level discount totals without dropping a remainder', () => {
    const allocations = allocateDiscountAcrossGrossAmounts([100, 100, 100], 1);
    expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(allocations.every((value, index) => value <= [100, 100, 100][index])).toBe(true);
  });

  it('rejects a discount greater than the gross amount', () => {
    expect(() => allocateDiscountAcrossGrossAmounts([100, 100], 200.01)).toThrow(/exceeds/i);
  });

  it('rejects duplicate service identifiers instead of double-ordering them', () => {
    expect(() => requireUniquePositiveIds([4, 4, 8], 'service item')).toThrow(/duplicate/i);
  });
});

describe('reception mutation hardening contracts', () => {
  it('uses the provided quick-admit idempotency key through reserve and completion', () => {
    const section = receptionSource.slice(
      receptionSource.indexOf("receptionRoutes.post('/quick-admit'"),
      receptionSource.indexOf('// 2E. ADMISSION + OPTIONAL DEPOSIT ORCHESTRATION'),
    );
    expect(section).toContain("const mutationType = 'reception_quick_admit'");
    expect(section).toContain('reserveMutationIdempotencyKey');
    expect(section).toContain('completeMutationIdempotencyKey');
  });

  it('rejects a procedure when its service item does not exist', () => {
    const section = receptionSource.slice(
      receptionSource.indexOf("receptionRoutes.post('/visits/:visitId/services/procedure'"),
      receptionSource.indexOf('// 6. LIST SERVICES FOR A VISIT'),
    );
    expect(section).toMatch(/if \(!serviceItem\).*Service item not found/s);
  });

  it('rejects bill-level discounts above the pending service subtotal', () => {
    const section = receptionSource.slice(
      receptionSource.indexOf("receptionRoutes.post('/visits/:visitId/generate-bill'"),
      receptionSource.indexOf('// 8. RECEPTIONIST DAILY REPORT'),
    );
    expect(section).toMatch(/discount > subtotal/);
    expect(section).toMatch(/discount cannot exceed/i);
  });

  it('uses Bangladesh-local bill dates for every daily report bill breakdown', () => {
    const section = receptionSource.slice(
      receptionSource.indexOf("receptionRoutes.get('/daily-report'"),
      receptionSource.indexOf('// ═══════════════════════════════════════════════════════════════════\n\nfunction parseReceptionSnapshotPendingLabItems'),
    );
    expect(section).not.toContain('date(b.created_at) = ?');
    expect(section.match(/localReportDate\('b\.created_at'\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('requires a finance or reception role for gateway verification', () => {
    const routeDeclaration = paymentsSource.match(/paymentRoutes\.post\('\/verify',[\s\S]{0,220}/)?.[0] ?? '';
    expect(routeDeclaration).toContain('requireRole');
  });

  it('completes deposit idempotency before best-effort shadow ledger writes', () => {
    const collectSection = depositsSource.slice(
      depositsSource.indexOf("deposits.post('/',"),
      depositsSource.indexOf('// ─── POST /refund'),
    );
    expect(collectSection.indexOf('completeMutationIdempotencyKey')).toBeGreaterThan(-1);
    expect(collectSection.indexOf('shadowWriteDepositCollection')).toBeGreaterThan(-1);
    expect(collectSection.indexOf('completeMutationIdempotencyKey')).toBeLessThan(
      collectSection.indexOf('shadowWriteDepositCollection'),
    );
  });

  it('completes refund idempotency before best-effort shadow ledger writes', () => {
    const refundSection = depositsSource.slice(
      depositsSource.indexOf("deposits.post('/refund'"),
      depositsSource.indexOf('// ─── POST /adjust'),
    );
    expect(refundSection.indexOf('completeMutationIdempotencyKey')).toBeGreaterThan(-1);
    expect(refundSection.indexOf('shadowWriteDepositRefund')).toBeGreaterThan(-1);
    expect(refundSection.indexOf('completeMutationIdempotencyKey')).toBeLessThan(
      refundSection.indexOf('shadowWriteDepositRefund'),
    );
  });

  it('validates that a deposit adjustment bill belongs to the same patient', () => {
    const adjustSection = depositsSource.slice(
      depositsSource.indexOf("deposits.post('/adjust'"),
      depositsSource.indexOf('export default deposits'),
    );
    expect(adjustSection).toMatch(/bill\.patient_id\s*!==\s*data\.patient_id/);
  });

  it('accepts an idempotency key when creating appointments', () => {
    const schemaSection = appointmentSchemaSource.slice(
      appointmentSchemaSource.indexOf('export const createAppointmentSchema'),
      appointmentSchemaSource.indexOf('export const updateAppointmentSchema'),
    );
    expect(schemaSection).toContain('idempotencyKey');
  });

  it('reserves and completes appointment creation idempotency', () => {
    const createSection = appointmentsSource.slice(
      appointmentsSource.indexOf("appointmentRoutes.post('/',"),
      appointmentsSource.indexOf('// ─── PUT /api/appointments/:id'),
    );
    expect(createSection).toContain("const mutationType = 'appointment_create'");
    expect(createSection).toContain('reserveMutationIdempotencyKey');
    expect(createSection).toContain('completeMutationIdempotencyKey');
  });

  it('removes a newly inserted appointment when provisional billing setup fails', () => {
    const createSection = appointmentsSource.slice(
      appointmentsSource.indexOf("appointmentRoutes.post('/',"),
      appointmentsSource.indexOf('// ─── PUT /api/appointments/:id'),
    );
    expect(createSection).toMatch(/ensureAppointmentConsultationProvisionalCharge[\s\S]*catch[\s\S]*DELETE FROM appointments/);
  });

  it('adds verifying to the payment gateway status constraint', () => {
    expect(existsSync(gatewayMigrationPath)).toBe(true);
    const migration = existsSync(gatewayMigrationPath) ? readFileSync(gatewayMigrationPath, 'utf8') : '';
    expect(migration).toMatch(/status[\s\S]*verifying/i);
  });

  it('releases a gateway verification lock when the accounting batch fails', () => {
    const verifySection = paymentsSource.slice(
      paymentsSource.indexOf("paymentRoutes.post('/verify'"),
      paymentsSource.indexOf('// ─── GET /api/payments/logs'),
    );
    expect(verifySection).toMatch(/catch[\s\S]*status = 'pending'[\s\S]*status = 'verifying'/);
  });

  it('posts bill payment, bill balance, income, and cashier cash in one atomic batch', () => {
    const paySection = billingSource.slice(
      billingSource.indexOf("billingRoutes.post('/pay'"),
      billingSource.indexOf('// ─── PUT /api/billing/:id'),
    );
    expect(paySection).not.toContain('applyConditionalPaymentUpdate');
    expect(paySection).toContain('INSERT INTO payments');
    expect(paySection).toContain('UPDATE bills');
    expect(paySection).toContain('INSERT INTO emp_cash_transactions');
    expect(paySection).toContain('executeStrictFinancialMutation');
    expect(paySection).toContain('legacyStatements: paymentBatch');
  });

  it('creates appointment bill, items, payment, and appointment status in one core batch', () => {
    const finalizeSection = appointmentsSource.slice(
      appointmentsSource.indexOf('async function finalizeAppointmentConsultationInvoice'),
      appointmentsSource.indexOf('async function checkAppointmentConflict'),
    );
    expect(finalizeSection).toContain('prepareAppointmentBillingLegacyStatements');
    expect(finalizeSection).toContain('executeStrictFinancialMutation');
    expect(finalizeSection).toContain('legacyStatements');
    expect(appointmentFinalizationSource).toContain('const billIdLookup');
    expect(appointmentFinalizationSource).toContain('INSERT INTO bills');
    expect(appointmentFinalizationSource).toContain('INSERT INTO invoice_items');
    expect(appointmentFinalizationSource).toContain('UPDATE appointments');
    expect(appointmentFinalizationSource).toContain('prepareFinancialBatchAssertion');
  });

  it('does not block appointment payment response on accounting and shadow side effects', () => {
    const finalizeSection = appointmentsSource.slice(
      appointmentsSource.indexOf('async function finalizeAppointmentConsultationInvoice'),
      appointmentsSource.indexOf('async function checkAppointmentConflict'),
    );
    expect(finalizeSection).toContain('postCommitTask');
    expect(finalizeSection).toContain('waitUntil');
  });

  it('does not mark a committed billing-counter invoice idempotency key as failed', () => {
    const invoiceSection = billingCounterSource.slice(
      billingCounterSource.indexOf("billingCounterRoutes.post('/invoices'"),
      billingCounterSource.indexOf('// ADMIN: Counter Cash Collection Dashboard'),
    );
    expect(invoiceSection).toContain('coreCommitted = true');
    expect(invoiceSection).toContain('if (!coreCommitted && idempotencyReserved');
    expect(invoiceSection.indexOf("SET status = 'completed'")).toBeLessThan(
      invoiceSection.indexOf('const postCommitSideEffects'),
    );
    expect(invoiceSection).toContain('waitUntil(postCommitTask)');
  });
});
