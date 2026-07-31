import { CDB101_REQUIRED_SMOKE_SCENARIOS } from '../../../scripts/canonical/production-cutover-contract';
import type { ReportingSmokeObservationEvidence } from '../../../scripts/canonical/reporting-smoke-observation-evidence';

export const SMOKE_OBSERVATION_EVIDENCE_NOW = '2026-07-14T17:10:00.000Z';

function hashFor(index: number): string {
  return index.toString(16).padStart(2, '0').repeat(32);
}

export function createReadyReportingSmokeObservationEvidence(): ReportingSmokeObservationEvidence {
  return {
    schemaVersion: 1,
    authorizationSchemaVersion: 2,
    ownerModel: 'four_person_strict',
    authorizationId: 'cdb101-reporting-20260714-window-01',
    evidenceId: 'cdb101-smoke-observation-20260714-01',
    generatedAtUtc: '2026-07-14T17:05:00.000Z',
    scope: {
      tenantId: '100',
      domain: 'reporting',
      mode: 'shadow',
      smokePlanId: 'reporting-canary-smoke-v2',
      observationStartedAtUtc: '2026-07-14T16:35:00.000Z',
      observationEndedAtUtc: '2026-07-14T16:55:00.000Z',
    },
    scenarios: CDB101_REQUIRED_SMOKE_SCENARIOS.map((scenarioId, index) => ({
      scenarioId,
      status: 'passed' as const,
      completedAtUtc: `2026-07-14T16:${String(index + 36).padStart(2, '0')}:00.000Z`,
      assertionCount: index + 2,
      evidenceId: `smoke-scenario-${String(index + 1).padStart(2, '0')}`,
      evidenceSha256: hashFor(index + 1),
    })),
    parity: {
      maxAbsoluteDeltaMinor: 1,
      maxRelativeDelta: 0.001,
      observedMaxAbsoluteDeltaMinor: 0,
      observedMaxRelativeDelta: 0,
      comparisonCount: 128,
      allWithinThreshold: true,
      evidenceId: 'smoke-parity-20260714-01',
      evidenceSha256: hashFor(20),
    },
    performance: {
      maxP95LatencyMs: 1500,
      maxErrorRate: 0,
      observedP95LatencyMs: 420,
      observedErrorRate: 0,
      sampleCount: 240,
      thresholdsMet: true,
      evidenceId: 'smoke-performance-20260714-01',
      evidenceSha256: hashFor(21),
    },
    tenantIsolation: {
      passed: true,
      crossTenantRowsObserved: 0,
      evidenceId: 'smoke-tenant-isolation-20260714-01',
      evidenceSha256: hashFor(22),
    },
    roleDenial: {
      passed: true,
      deniedAttemptCount: 8,
      unexpectedAllowedCount: 0,
      evidenceId: 'smoke-role-denial-20260714-01',
      evidenceSha256: hashFor(23),
    },
    readOnlyProof: {
      passed: true,
      projectionOnlyConfirmed: true,
      writeStatementCount: 0,
      mutationCount: 0,
      evidenceId: 'smoke-read-only-20260714-01',
      evidenceSha256: hashFor(24),
    },
    observationDecision: {
      primaryObserverId: 'ops-observer-primary',
      backupObserverId: 'ops-observer-backup',
      primaryConfirmed: true,
      backupConfirmed: true,
      decision: 'go',
      decidedAtUtc: '2026-07-14T17:00:00.000Z',
      evidenceId: 'smoke-decision-20260714-01',
      evidenceSha256: hashFor(25),
    },
    recoveryTiming: {
      policyReviewedAtUtc: '2026-07-14T16:10:00.000Z',
      measurementKind: 'rehearsal',
      measuredAtUtc: '2026-07-14T16:20:00.000Z',
      maxRollbackDurationMs: 60000,
      maxReopenDurationMs: 120000,
      rollbackMeasuredMs: 45000,
      reopenMeasuredMs: 90000,
      rollbackWithinThreshold: true,
      reopenWithinThreshold: true,
      policyEvidenceId: 'smoke-recovery-policy-20260714-01',
      policyEvidenceSha256: hashFor(26),
      timingEvidenceId: 'smoke-recovery-timing-20260714-01',
      timingEvidenceSha256: hashFor(27),
    },
  };
}

export function createReadyTwoPersonReportingSmokeObservationEvidence(): ReportingSmokeObservationEvidence {
  const input = createReadyReportingSmokeObservationEvidence();
  input.authorizationSchemaVersion = 3;
  input.ownerModel = 'two_person_constrained';
  input.observationDecision.primaryObserverId = 'staff-monitoring-owner';
  input.observationDecision.backupObserverId = null;
  input.observationDecision.primaryConfirmed = true;
  input.observationDecision.backupConfirmed = false;
  return input;
}

export function createReadySingleOperatorReportingSmokeObservationEvidence(): ReportingSmokeObservationEvidence {
  const input = createReadyReportingSmokeObservationEvidence();
  input.authorizationSchemaVersion = 4;
  input.ownerModel = 'single_operator_risk_accepted';
  input.observationDecision.primaryObserverId = 'rahmatullah-zisan';
  input.observationDecision.backupObserverId = null;
  input.observationDecision.primaryConfirmed = true;
  input.observationDecision.backupConfirmed = false;
  return input;
}
