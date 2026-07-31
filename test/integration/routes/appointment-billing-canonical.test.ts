import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function appointmentFinalizationFlow(): string {
  const source = readFileSync('src/routes/tenant/appointments.ts', 'utf8');
  const start = source.indexOf('async function finalizeAppointmentConsultationInvoice(');
  const end = source.indexOf('async function checkAppointmentConflict(', start);
  if (start < 0 || end < 0) throw new Error('Appointment billing finalization flow could not be located');
  return source.slice(start, end);
}

function guardedLegacyAdapter(): string {
  return readFileSync('src/lib/canonical/appointment-billing-finalization.ts', 'utf8');
}

describe('appointment billing canonical integration', () => {
  it('routes credit and pay-now through the strict financial coordinator', () => {
    const flow = appointmentFinalizationFlow();
    expect(flow).toContain('executeStrictFinancialMutation');
    expect(flow).toContain("boundary: 'appointment.billing.finalize'");
    expect(flow).toContain('issueInvoiceWithFullPayment');
    expect(flow).toContain('issueInvoice');
    expect(flow).toMatch(/mode === 'paid'[\s\S]*issueInvoiceWithFullPayment/);
    expect(flow).toMatch(/buildAppointmentInvoiceProjection[\s\S]*issueInvoice/);
  });

  it('guards every critical legacy financial transition', () => {
    const flow = `${appointmentFinalizationFlow()}\n${guardedLegacyAdapter()}`;
    expect(flow).toContain('prepareFinancialBatchAssertion');
    expect(flow).toContain('prepareClearFinancialBatchAssertions');
    expect(flow).toContain('legacyStatements');
    for (const stepKey of [
      'bill_insert',
      'appointment_status',
      'bill_created_accounting_event',
    ]) {
      expect(flow).toContain(`'${stepKey}'`);
    }
    expect(flow).toContain("`invoice_item_${item.id}`");
    expect(flow).toContain("`provisional_item_${item.id}`");
    expect(flow).toContain("'payment_insert'");
    expect(flow).toContain("'cash_transaction'");
    expect(flow).toContain("'payment_accounting_event'");
  });

  it('keeps queue, audit, commission, scheme, and cash-ledger work after the financial commit', () => {
    const flow = appointmentFinalizationFlow();
    const execution = flow.indexOf('executeStrictFinancialMutation');
    expect(execution).toBeGreaterThan(-1);
    for (const marker of [
      'ensureDoctorQueueEntryForAppointment',
      'recordBillFinalizationSideEffects',
      'createAuditLog',
      'recordBillingSchemeUsage',
      'shadowWriteAppointmentPaymentCollection',
    ]) {
      expect(flow.indexOf(marker)).toBeGreaterThan(execution);
    }
  });

  it('does not duplicate bill-created or payment-received legacy accounting events post-commit', () => {
    const flow = appointmentFinalizationFlow();
    const postCommitStart = flow.indexOf('const postCommitSideEffects');
    expect(postCommitStart).toBeGreaterThan(-1);
    const postCommit = flow.slice(postCommitStart);
    expect(postCommit).not.toContain('ACCOUNTING_EVENT_TYPES.paymentReceived');
    expect(postCommit).toContain('skipBillAccountingEvent: true');
  });
});
