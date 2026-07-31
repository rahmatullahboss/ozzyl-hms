import type { CanonicalBatchDatabase } from './command-batch';
import { getFinancialRouteCoverage } from './financial-route-coverage';
import {
  CanonicalStrictFinancialError,
  resolveStrictFinancialPolicy,
} from './strict-financial-policy';

export const STRICT_FINANCIAL_BOUNDARIES = [
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

export type StrictFinancialBoundary = typeof STRICT_FINANCIAL_BOUNDARIES[number];

export async function assertStrictFinancialBoundaryDisabledOrSupported(
  db: CanonicalBatchDatabase,
  tenantId: string,
  boundary: string,
): Promise<void> {
  const policy = await resolveStrictFinancialPolicy(db, tenantId);
  if (!policy.enabled || policy.writePolicy === 'shadow') return;

  const coverage = getFinancialRouteCoverage(boundary);
  if (coverage?.status === 'integrated') return;

  throw new CanonicalStrictFinancialError(
    'CANONICAL_STRICT_BOUNDARY_UNSUPPORTED',
    coverage?.reason ?? `Strict canonical financial boundary is not registered: ${boundary}`,
  );
}
