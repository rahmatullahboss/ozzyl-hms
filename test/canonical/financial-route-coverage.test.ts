import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FINANCIAL_ROUTE_COVERAGE,
  type FinancialRouteCoverage,
} from '../../src/lib/canonical/financial-route-coverage';
import { STRICT_FINANCIAL_BOUNDARIES } from '../../src/lib/canonical/strict-financial-boundaries';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const legacyFinancialInsertPattern = /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:bills|payments|billing_deposits)\b/i;

function discoverDirectFinancialWriterFiles(): string[] {
  const tenantRoutesRoot = path.join(root, 'src/routes/tenant');
  const discovered: string[] = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const source = fs.readFileSync(absolutePath, 'utf8');
      if (!legacyFinancialInsertPattern.test(source)) continue;
      discovered.push(path.relative(root, absolutePath).split(path.sep).join('/'));
    }
  }

  visit(tenantRoutesRoot);
  return discovered.sort();
}

const alternateWriterCoverage = {} as const;

function countBoundaryGuards(source: string, boundary: string): number {
  const escapedBoundary = boundary.replace(/\./g, '\\.');
  return source.match(new RegExp(
    `assertStrictFinancialBoundaryDisabledOrSupported\\([\\s\\S]{0,240}?['\"]${escapedBoundary}['\"]\\s*\\)`,
    'g',
  ))?.length ?? 0;
}

const expectedBoundaries = [
  'billing.create',
  'billing-counter.invoice.create',
  'billing.payment.collect',
  'doctor-compensation.accrue',
  'doctor-compensation.adjust',
  'doctor-compensation.settle',
  'doctor-compensation.reverse',
  'doctor-compensation.refund-reserve',
  'doctor-compensation.refund-release',
  'deposit.collect',
  'reception.admission.deposit.collect',
  'deposit.refund',
  'deposit.apply',
  'credit-note.approve',
  'credit-note.cash-refund',
  'credit-note.cash-refund.reverse',
  'cash-custody.movement',
  'payment.reverse',
  'bill.cancel.unpaid',
  'appointment.billing.finalize',
  'billing-provisional.finalize',
  'ipd-discharge.billing.finalize',
  'lab.billing.create',
  'payment-gateway.verify',
  'patient-chart.lab-billing.create',
  'patient-chart.radiology-billing.create',
  'pharmacy.billing.finalize',
  'radiology.billing.create',
  'reception.visit-billing.create',
  'settlement.finalize',
  'settlement.cancel',
] as const;

describe('canonical financial route coverage', () => {
  it('registers every strict financial boundary exactly once', () => {
    expect(STRICT_FINANCIAL_BOUNDARIES).toEqual(expectedBoundaries);
    expect(Object.keys(FINANCIAL_ROUTE_COVERAGE).sort()).toEqual([...expectedBoundaries].sort());
  });

  it('never leaves a declared boundary unenforced', () => {
    const records = Object.values(FINANCIAL_ROUTE_COVERAGE) as FinancialRouteCoverage[];
    expect(records).toHaveLength(expectedBoundaries.length);
    for (const record of records) {
      expect(['integrated', 'blocked_in_strict']).toContain(record.status);
      expect(record.routeFile).toMatch(/^src\/routes\/tenant\//);
      expect(record.reason.length).toBeGreaterThan(10);
    }
  });

  it('registers every tenant route that directly writes legacy financial authority', () => {
    const discoveredWriters = discoverDirectFinancialWriterFiles();
    const registeredRouteFiles = new Set(
      Object.values(FINANCIAL_ROUTE_COVERAGE).map((record) => record.routeFile),
    );

    expect(discoveredWriters.filter((routeFile) => !registeredRouteFiles.has(routeFile))).toEqual([]);
  });

  it('fails closed for every alternate writer until an atomic canonical adapter exists', () => {
    const coverage = FINANCIAL_ROUTE_COVERAGE as Record<string, FinancialRouteCoverage>;

    for (const [boundary, routeFile] of Object.entries(alternateWriterCoverage)) {
      expect(coverage[boundary], boundary).toMatchObject({
        boundary,
        status: 'blocked_in_strict',
        routeFile,
        canonicalCommand: null,
      });

      expect(countBoundaryGuards(read(routeFile), boundary), boundary).toBeGreaterThanOrEqual(1);
    }
  });

  it('recognizes the integrated canonical write paths', () => {
    expect(FINANCIAL_ROUTE_COVERAGE['billing.create']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'issueInvoice',
      routeFile: 'src/routes/tenant/billing.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['billing-counter.invoice.create']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'issueInvoice',
      routeFile: 'src/routes/tenant/billingCounter.legacy.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['billing.payment.collect']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'collectPayment',
      routeFile: 'src/routes/tenant/billing.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['doctor-compensation.settle']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'executeLiveCompensationSettlement',
      routeFile: 'src/routes/tenant/receptionDoctorPayouts.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['doctor-compensation.reverse']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'executeLiveCancelledCompensationSettlementReversal',
      routeFile: 'src/routes/tenant/receptionDoctorPayouts.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['appointment.billing.finalize']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'issueInvoice / issueInvoiceWithFullPayment',
      routeFile: 'src/routes/tenant/appointments.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['billing-provisional.finalize']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'issueInvoiceWithSettlement',
      routeFile: 'src/routes/tenant/billingProvisional.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['ipd-discharge.billing.finalize']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'finalizeIpdDischargeBilling',
      routeFile: 'src/routes/tenant/ipBilling.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['lab.billing.create']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'createLabOrderBilling',
      routeFile: 'src/routes/tenant/lab.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['payment-gateway.verify']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'settleGatewayPayment',
      routeFile: 'src/routes/tenant/payments.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['patient-chart.lab-billing.create']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'createLabOrderBilling',
      routeFile: 'src/routes/tenant/patients.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['pharmacy.billing.finalize']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'settlePharmacySale',
      routeFile: 'src/routes/tenant/pharmacy/advanced.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['radiology.billing.create']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'createRadiologyRequisitionBilling',
      routeFile: 'src/routes/tenant/radiology/orders.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['reception.visit-billing.create']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'createReceptionVisitBilling',
      routeFile: 'src/routes/tenant/reception.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['settlement.finalize']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'finalizeSettlement',
      routeFile: 'src/routes/tenant/settlements.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['settlement.cancel']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'cancelSettlement',
      routeFile: 'src/routes/tenant/settlements.ts',
    });
  });

  it('marks deposit collection/refund/application integrated and keeps later hardening boundaries fail-closed', () => {
    expect(FINANCIAL_ROUTE_COVERAGE['deposit.collect']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'recordDeposit',
      routeFile: 'src/routes/tenant/deposits.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['reception.admission.deposit.collect']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'recordDeposit',
      routeFile: 'src/routes/tenant/reception.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['deposit.refund']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'refundAvailableDeposits',
      routeFile: 'src/routes/tenant/deposits.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['deposit.apply']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'applyAvailableDeposits',
      routeFile: 'src/routes/tenant/deposits.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['payment.reverse']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'reversePayment',
      routeFile: 'src/routes/tenant/approvals.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['credit-note.approve']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'issueCreditNote',
      routeFile: 'src/routes/tenant/creditNotes.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['bill.cancel.unpaid']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'cancelUnpaidInvoice',
      routeFile: 'src/routes/tenant/approvals.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['credit-note.cash-refund']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'issueCreditNoteWithCashRefund',
      routeFile: 'src/routes/tenant/approvals.ts',
    });
    expect(FINANCIAL_ROUTE_COVERAGE['credit-note.cash-refund.reverse']).toMatchObject({
      status: 'integrated',
      canonicalCommand: 'reverseCreditNoteCashRefund',
      routeFile: 'src/routes/tenant/approvals.ts',
    });
  });

  it('guards the currently unsupported routes before any strict-mode legacy-only mutation', () => {
    const deposits = read('src/routes/tenant/deposits.ts');
    for (const boundary of ['deposit.collect', 'deposit.refund', 'deposit.apply']) {
      expect(deposits).toContain(`assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), '${boundary}')`);
    }

    const approvals = read('src/routes/tenant/approvals.ts');
    for (const boundary of ['payment.reverse', 'credit-note.cash-refund', 'bill.cancel.unpaid']) {
      expect(approvals).toContain(`assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), '${boundary}')`);
    }
    const creditNotes = read('src/routes/tenant/creditNotes.ts');
    expect(creditNotes).toContain("const financialBoundary = cashRefund > 0 ? 'credit-note.cash-refund' : 'credit-note.approve'");
    expect(creditNotes).toMatch(/assertStrictFinancialBoundaryDisabledOrSupported\([\s\S]*financialBoundary/);
  });

  it('binds deposit collection, refund and application to canonical commands', () => {
    const deposits = read('src/routes/tenant/deposits.ts');
    expect(deposits).toContain("boundary: 'deposit.collect'");
    expect(deposits).toContain("boundary: 'deposit.refund'");
    expect(deposits).toContain("boundary: 'deposit.apply'");
    expect(deposits).toContain('executeStrictFinancialMutation');
    expect(deposits).toContain('buildLiveDepositProjection');
    expect(deposits).toContain('recordDeposit');
    expect(deposits).toContain('refundAvailableDeposits');
    expect(deposits).toContain('applyAvailableDeposits');
  });

  it('binds approved payment reversal to the mapped canonical reversal command', () => {
    const approvals = read('src/routes/tenant/approvals.ts');
    const paymentVoidExecution = read('src/lib/payment-void-execution.ts');
    expect(approvals).toContain('executePaymentVoidReversal');
    expect(paymentVoidExecution).toContain("boundary: 'payment.reverse'");
    expect(paymentVoidExecution).toContain('resolveLivePaymentReversalProjection');
    expect(paymentVoidExecution).toContain('reversePayment');
    expect(paymentVoidExecution).toContain('executeStrictFinancialMutation');
  });

  it('binds credit-note approval to the receivable-only and cash-refund canonical commands', () => {
    const creditNotes = read('src/routes/tenant/creditNotes.ts');
    expect(creditNotes).toContain("boundary: cashRefund > 0 ? 'credit-note.cash-refund' : 'credit-note.approve'");
    expect(creditNotes).toContain('resolveLiveCreditNoteProjection');
    expect(creditNotes).toContain('issueCreditNote');
    expect(creditNotes).toContain('resolveLiveCreditNoteCashRefundFunding');
    expect(creditNotes).toContain('issueCreditNoteWithCashRefund');
    expect(creditNotes).toContain('executeStrictFinancialMutation');
    expect(creditNotes).toContain('prepareFinancialBatchAssertion');
    expect(creditNotes).toContain("stepKey: 'credit_note_status'");
    expect(creditNotes).toContain("stepKey: 'bill_update'");
    expect(creditNotes.indexOf("UPDATE billing_credit_notes\n      SET status = 'approved'")).toBeLessThan(
      creditNotes.indexOf("stepKey: 'credit_note_status'"),
    );
    expect(creditNotes.indexOf("stepKey: 'credit_note_status'")).toBeLessThan(
      creditNotes.indexOf('UPDATE bills SET total = ?, paid = ?'),
    );
    expect(creditNotes).not.toContain("status = 'approved' AND approved_by = ?");
    expect(creditNotes).not.toContain('Rollback status change if batch fails');
  });

  it('keeps integrated route evidence bound to executeStrictFinancialMutation', () => {
    const billing = read('src/routes/tenant/billing.ts');
    expect(billing).toContain("boundary: 'billing.create'");
    expect(billing).toContain("boundary: 'billing.payment.collect'");
    expect(billing).toContain('executeStrictFinancialMutation');

    const billingCounter = read('src/routes/tenant/billingCounter.legacy.ts');
    expect(billingCounter).toContain("boundary: 'billing-counter.invoice.create'");
    expect(billingCounter).toContain('executeStrictFinancialMutation');
  });
});
