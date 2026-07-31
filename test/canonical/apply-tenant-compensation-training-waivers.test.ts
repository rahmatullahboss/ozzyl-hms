import { describe, expect, it } from 'vitest';
import {
  EXPECTED_TENANT_102_TRAINING_ISSUES,
  evaluateTrainingPeriodWaiverReadiness,
} from '../../scripts/canonical/apply-tenant-compensation-training-waivers';

describe('tenant compensation training-period waiver readiness', () => {
  it('clears the review queue while retaining legacy financial authority', () => {
    expect(evaluateTrainingPeriodWaiverReadiness({
      tenantId: '102',
      issueCounts: { ...EXPECTED_TENANT_102_TRAINING_ISSUES },
      issueCount: 120,
      distinctMappingCount: 120,
      ambiguousMappingCount: 120,
      canonicalIdCount: 0,
      waivedIssueCount: 120,
      rejectedMappingCount: 155,
      dependentSettlementAllocationCount: 35,
      remainingOpenIssueCount: 0,
      remainingAmbiguousCompensationMappingCount: 0,
      legacyRowsBefore: 2400,
      legacyRowsAfter: 2400,
      canonicalRowsBefore: 337,
      canonicalRowsAfter: 337,
      integrityOk: true,
    })).toEqual({
      queueCleared: true,
      canonicalCompensationAuthorityReady: false,
      issues: [],
    });
  });

  it('fails closed when counts drift or a canonical ID already exists', () => {
    const result = evaluateTrainingPeriodWaiverReadiness({
      tenantId: '102',
      issueCounts: {
        ...EXPECTED_TENANT_102_TRAINING_ISSUES,
        COMPENSATION_RULE_UNRESOLVED: 42,
      },
      issueCount: 119,
      distinctMappingCount: 119,
      ambiguousMappingCount: 118,
      canonicalIdCount: 1,
      waivedIssueCount: 0,
      rejectedMappingCount: 0,
      dependentSettlementAllocationCount: 34,
      remainingOpenIssueCount: 119,
      remainingAmbiguousCompensationMappingCount: 155,
      legacyRowsBefore: 2400,
      legacyRowsAfter: 2399,
      canonicalRowsBefore: 337,
      canonicalRowsAfter: 338,
      integrityOk: false,
    });

    expect(result.queueCleared).toBe(false);
    expect(result.canonicalCompensationAuthorityReady).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'TRAINING_WAIVER_ISSUE_COUNTS_MISMATCH',
      'TRAINING_WAIVER_CANONICAL_ID_PRESENT',
      'TRAINING_WAIVER_LEGACY_MUTATED',
      'TRAINING_WAIVER_CANONICAL_ROWS_MUTATED',
      'TRAINING_WAIVER_INTEGRITY_FAILED',
    ]));
  });

  it('refuses every tenant except the explicitly approved Tenant 102 scope', () => {
    const result = evaluateTrainingPeriodWaiverReadiness({
      tenantId: '100',
      issueCounts: { ...EXPECTED_TENANT_102_TRAINING_ISSUES },
      issueCount: 120,
      distinctMappingCount: 120,
      ambiguousMappingCount: 120,
      canonicalIdCount: 0,
      waivedIssueCount: 120,
      rejectedMappingCount: 155,
      dependentSettlementAllocationCount: 35,
      remainingOpenIssueCount: 0,
      remainingAmbiguousCompensationMappingCount: 0,
      legacyRowsBefore: 1,
      legacyRowsAfter: 1,
      canonicalRowsBefore: 1,
      canonicalRowsAfter: 1,
      integrityOk: true,
    });

    expect(result.queueCleared).toBe(false);
    expect(result.issues).toContain('TRAINING_WAIVER_TENANT_SCOPE_INVALID');
  });
});
