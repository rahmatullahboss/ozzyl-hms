import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateTenantSecondPassNewRows,
  evaluateTargetAggregateResolution,
} from '../../scripts/canonical/rehearse-tenant-compensation-backfill';

describe('tenant compensation backfill rehearsal', () => {
  it('does not require unrelated deposit lifecycle reconstruction', () => {
    const source = readFileSync('scripts/canonical/rehearse-tenant-compensation-backfill.ts', 'utf8');

    expect(source).not.toContain("from './backfill-deposit-lifecycle'");
    expect(source).not.toContain('backfillDepositLifecycle(');
    expect(source).toContain('backfillAdjustments(');
    expect(source).toContain('backfillCompensation(');
  });

  it('accepts the exact deterministic non-importable aggregate resolution', () => {
    expect(evaluateTargetAggregateResolution({
      sourceId: '2216',
      mappingStatus: 'rejected',
      canonicalPublicIdPresent: false,
      issueCode: 'COMPENSATION_AGGREGATE_ACCRUAL_NOT_LINE_IMPORTABLE',
      issueSeverity: 'warning',
      issueStatus: 'waived',
      resolutionCode: 'DETERMINISTIC_NONIMPORTABLE_LEGACY_AGGREGATE',
    })).toEqual({ ready: true, issues: [] });
  });

  it('fails closed when the aggregate is linked to a canonical line', () => {
    const result = evaluateTargetAggregateResolution({
      sourceId: '2216',
      mappingStatus: 'mapped',
      canonicalPublicIdPresent: true,
      issueCode: null,
      issueSeverity: null,
      issueStatus: null,
      resolutionCode: null,
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'COMPENSATION_TARGET_MAPPING_NOT_REJECTED',
      'COMPENSATION_TARGET_UNSAFE_CANONICAL_LINK',
      'COMPENSATION_TARGET_ISSUE_CODE_INVALID',
      'COMPENSATION_TARGET_RESOLUTION_CODE_INVALID',
    ]));
  });

  it('counts only positive business-row growth on the second pass', () => {
    expect(calculateTenantSecondPassNewRows(
      { canonical_invoices: 10, canonical_compensation_accruals: 8 },
      { canonical_invoices: 10, canonical_compensation_accruals: 9 },
    )).toBe(1);
  });
});
