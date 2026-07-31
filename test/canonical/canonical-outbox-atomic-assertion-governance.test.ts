import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProtectedCoreWriterCommandCoverage } from '../../scripts/canonical/protected-core-writer-command-coverage';

const EXPECTED_BOUNDARIES = [
  {
    path: 'src/lib/billing-refund-commission.ts',
    table: 'accounting_posting_events',
    boundary: 'canonical-outbox.refund-commission',
  },
  {
    path: 'src/lib/billing-refund-dispute.ts',
    table: 'accounting_posting_events',
    boundary: 'canonical-outbox.refund-dispute',
  },
  {
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'accounting_posting_events',
    boundary: 'canonical-outbox.appointment-finalization',
  },
  {
    path: 'src/lib/canonical/compensation-accrual-route-integration.ts',
    table: 'accounting_posting_events',
    boundary: 'canonical-outbox.compensation-accrual',
  },
  {
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'accounting_posting_events',
    boundary: 'canonical-outbox.gateway-verification',
  },
  {
    path: 'src/lib/executed-refund.ts',
    table: 'accounting_posting_events',
    boundary: 'canonical-outbox.executed-refund',
  },
] as const;

describe('Canonical outbox and atomic assertion governance coverage', () => {
  it('classifies all six remaining accounting event writers as atomic compatibility', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(process.cwd());

    for (const expected of EXPECTED_BOUNDARIES) {
      const writer = coverage.writers.find((candidate) => (
        candidate.path === expected.path && candidate.table === expected.table
      ));
      expect(writer, `${expected.path}:${expected.table}`).toBeDefined();
      expect(writer?.classification, `${expected.path}:${expected.table}`).toBe('atomic_compatibility');
      expect(writer?.strictBoundaryIds, `${expected.path}:${expected.table}`).toContain(expected.boundary);
    }
  });

  it('routes the refund commission replay executor through one Canonical command batch', () => {
    const source = readFileSync('src/lib/billing-refund-commission.ts', 'utf8');

    expect(source).toContain('export async function applyRefundCommissionImpact');
    expect(source).toContain("commandName = 'canonical.refund_commission.impact'");
    expect(source).toContain('readCanonicalCommandReplay');
    expect(source).toContain('runCanonicalBatch');
    expect(source).toContain('prepareFinancialBatchAssertion');
    expect(source).toContain('prepareClearFinancialBatchAssertions');
    expect(source).not.toContain('await db.batch(statements)');
  });

  it('closes the final Canonical Core V1 implementation group', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(process.cwd());
    const remaining = coverage.writers
      .filter((writer) => writer.classification === 'command_required')
      .map((writer) => ({ path: writer.path, table: writer.table, concepts: writer.protectedConceptIds }));

    expect(remaining).toEqual([]);
    expect(coverage.summary.commandRequiredWriterCount).toBe(0);
    expect(coverage.implementationGroups).toEqual([]);
    expect(coverage.unclassifiedWriters).toEqual([]);
  });
});
