import { describe, expect, it } from 'vitest';
import { buildProtectedCoreWriterCommandCoverage } from '../../scripts/canonical/protected-core-writer-command-coverage';

const EXPECTED_BOUNDARIES = [
  {
    path: 'src/lib/billing-create-batch.ts',
    table: 'bills',
    boundary: 'invoice-document.billing-create-batch',
  },
  {
    path: 'src/lib/billing-create-batch.ts',
    table: 'invoice_items',
    boundary: 'invoice-document.billing-create-batch',
  },
  {
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'bills',
    boundary: 'invoice-document.appointment-finalization',
  },
  {
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'invoice_items',
    boundary: 'invoice-document.appointment-finalization',
  },
  {
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'billing_deposits',
    boundary: 'invoice-deposit.gateway-verification',
  },
  {
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'bills',
    boundary: 'invoice-deposit.gateway-verification',
  },
  {
    path: 'src/lib/executed-refund.ts',
    table: 'bills',
    boundary: 'invoice-document.executed-refund',
  },
  {
    path: 'src/lib/payment-void-execution.ts',
    table: 'bills',
    boundary: 'invoice-document.payment-void',
  },
] as const;

const TARGET_CONCEPTS = new Set([
  'invoice_document',
  'patient_deposit_liability',
  'reporting_metric_read_promotion',
]);

describe('invoice, deposit and reporting governance coverage', () => {
  it('removes the unused direct bill updater and classifies eight live writer pairs as atomic compatibility', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(process.cwd());
    expect(coverage.writers.find((candidate) => (
      candidate.path === 'src/lib/billing-payment-state.ts' && candidate.table === 'bills'
    ))).toBeUndefined();

    for (const expected of EXPECTED_BOUNDARIES) {
      const writer = coverage.writers.find((candidate) => (
        candidate.path === expected.path && candidate.table === expected.table
      ));
      expect(writer, `${expected.path}:${expected.table}`).toBeDefined();
      expect(writer?.classification, `${expected.path}:${expected.table}`).toBe('atomic_compatibility');
      expect(writer?.strictBoundaryIds, `${expected.path}:${expected.table}`).toContain(expected.boundary);
    }
  });

  it('keeps invoice, deposit and reporting writers complete after final outbox integration', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(process.cwd());
    const remainingTargetWriters = coverage.writers.filter((writer) => (
      writer.classification === 'command_required'
      && writer.protectedConceptIds.some((conceptId) => TARGET_CONCEPTS.has(conceptId))
    ));

    expect(remainingTargetWriters).toEqual([]);
    expect(coverage.summary.commandRequiredWriterCount).toBe(0);
    expect(coverage.implementationGroups).toEqual([]);
  });
});
