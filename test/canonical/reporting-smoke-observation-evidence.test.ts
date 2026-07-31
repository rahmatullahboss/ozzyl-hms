import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateProtectedReportingSmokeObservationEvidence,
  parseReportingSmokeObservationEvidenceArgs,
  parseReportingSmokeObservationEvidenceJson,
  prepareReportingSmokeObservationEvidence,
} from '../../scripts/canonical/reporting-smoke-observation-evidence';
import { CDB101_REQUIRED_SMOKE_SCENARIOS } from '../../scripts/canonical/production-cutover-contract';
import {
  createReadyReportingAuthorization,
  createReadySingleOperatorReportingAuthorization,
  createReadyTwoPersonReportingAuthorization,
} from './fixtures/reporting-authorization-fixture';
import {
  SMOKE_OBSERVATION_EVIDENCE_NOW,
  createReadyReportingSmokeObservationEvidence,
  createReadySingleOperatorReportingSmokeObservationEvidence,
  createReadyTwoPersonReportingSmokeObservationEvidence,
} from './fixtures/reporting-smoke-observation-evidence-fixture';

const temporaryRoots: string[] = [];

function protectedFile(value: unknown, filename = 'evidence.json'): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-smoke-observation-'));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  const path = join(root, filename);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  chmodSync(path, 0o600);
  return { root, path };
}

function readyPair() {
  return {
    evidence: createReadyReportingSmokeObservationEvidence(),
    authorization: createReadyReportingAuthorization(),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-101 reporting smoke/observation evidence', () => {
  it('accepts a complete authorization-bound aggregate-only tenant-100 shadow observation pack', () => {
    const { evidence, authorization } = readyPair();
    const prepared = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    );

    expect(prepared.receipt).toMatchObject({
      schemaVersion: 1,
      documentReady: true,
      evidenceReady: true,
      authorizationBound: true,
      promotionReady: true,
      issueCount: 0,
      scenarioCount: 12,
      passedScenarioCount: 12,
      parityComparisonCount: 128,
      observedMaxAbsoluteDeltaMinor: 0,
      observedP95LatencyMs: 420,
      observedErrorRate: 0,
      rollbackMeasuredMs: 45000,
      reopenMeasuredMs: 90000,
      decision: 'go',
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    });
  });

  it('accepts a schema-v3 observation from the single monitoring owner', () => {
    const evidence = createReadyTwoPersonReportingSmokeObservationEvidence();
    const authorization = createReadyTwoPersonReportingAuthorization();
    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;

    expect(receipt).toMatchObject({
      evidenceReady: true,
      authorizationBound: true,
      promotionReady: false,
      decision: 'go',
      issueCount: 0,
    });
  });

  it('accepts schema-v4 observation by the risk-accepting operator without authorizing promotion', () => {
    const evidence = createReadySingleOperatorReportingSmokeObservationEvidence();
    const authorization = createReadySingleOperatorReportingAuthorization();
    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;

    expect(receipt).toMatchObject({
      evidenceReady: true,
      authorizationBound: true,
      promotionReady: false,
      decision: 'go',
      issueCount: 0,
    });
  });

  it('rejects schema-v3 observation backup identity and owner-model mismatch', () => {
    const authorization = createReadyTwoPersonReportingAuthorization();
    const withBackup = createReadyTwoPersonReportingSmokeObservationEvidence();
    withBackup.observationDecision.backupObserverId = 'unexpected-backup-observer';
    withBackup.observationDecision.backupConfirmed = true;

    const backupReceipt = prepareReportingSmokeObservationEvidence(
      withBackup,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(backupReceipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_DECISION_INVALID');
    expect(backupReceipt.promotionReady).toBe(false);

    const wrongModel = createReadyTwoPersonReportingSmokeObservationEvidence();
    wrongModel.ownerModel = 'four_person_strict';
    const modelReceipt = prepareReportingSmokeObservationEvidence(
      wrongModel,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(modelReceipt.issueCodes).toEqual(expect.arrayContaining([
      'CDB101_SMOKE_OBSERVATION_SCOPE_INVALID',
      'CDB101_SMOKE_OBSERVATION_AUTHORIZATION_SCOPE_MISMATCH',
    ]));
    expect(modelReceipt.promotionReady).toBe(false);
  });

  it('rejects an evidence authorization ID mismatch', () => {
    const { evidence, authorization } = readyPair();
    evidence.authorizationId = 'cdb101-reporting-different-window';

    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(receipt.evidenceReady).toBe(true);
    expect(receipt.authorizationBound).toBe(false);
    expect(receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_ID_MISMATCH');
  });

  it('rejects a smoke plan mismatch against the protected authorization', () => {
    const { evidence, authorization } = readyPair();
    evidence.scope.smokePlanId = 'reporting-canary-smoke-v3';

    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(receipt.evidenceReady).toBe(true);
    expect(receipt.authorizationBound).toBe(false);
    expect(receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_PLAN_MISMATCH');
  });

  it('rejects authorized performance threshold mismatches', () => {
    const { evidence, authorization } = readyPair();
    evidence.performance.maxP95LatencyMs = 1499;
    evidence.performance.maxErrorRate = 0.001;

    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(receipt.evidenceReady).toBe(true);
    expect(receipt.authorizationBound).toBe(false);
    expect(receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_THRESHOLD_MISMATCH');
  });

  it('rejects observer identity mismatches against the protected authorization', () => {
    const { evidence, authorization } = readyPair();
    evidence.observationDecision.primaryObserverId = 'different-primary-observer';
    evidence.observationDecision.backupObserverId = 'different-backup-observer';

    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(receipt.evidenceReady).toBe(true);
    expect(receipt.authorizationBound).toBe(false);
    expect(receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_OBSERVER_MISMATCH');
  });

  it('rejects rollback and reopen policy mismatches against the protected authorization', () => {
    const { evidence, authorization } = readyPair();
    evidence.recoveryTiming.maxRollbackDurationMs = 61000;
    evidence.recoveryTiming.maxReopenDurationMs = 121000;

    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(receipt.evidenceReady).toBe(true);
    expect(receipt.authorizationBound).toBe(false);
    expect(receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_RECOVERY_POLICY_MISMATCH');
  });

  it('rejects observation that starts before the authorized shadow effective time', () => {
    const { evidence, authorization } = readyPair();
    evidence.scope.observationStartedAtUtc = '2026-07-14T16:29:59.000Z';

    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(receipt.evidenceReady).toBe(true);
    expect(receipt.authorizationBound).toBe(false);
    expect(receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_TIMING_INVALID');
  });

  it('rejects an expired protected authorization', () => {
    const { evidence, authorization } = readyPair();

    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      '2026-07-14T18:31:00.000Z',
    ).receipt;
    expect(receipt.evidenceReady).toBe(true);
    expect(receipt.authorizationBound).toBe(false);
    expect(receipt.promotionReady).toBe(false);
    expect(receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_INVALID');
  });

  it('rejects missing or duplicate recovery timing evidence', () => {
    const missing = readyPair();
    missing.evidence.recoveryTiming.timingEvidenceId = null;
    missing.evidence.recoveryTiming.timingEvidenceSha256 = null;
    expect(prepareReportingSmokeObservationEvidence(
      missing.evidence,
      missing.authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_RECOVERY_TIMING_INVALID');

    const duplicate = readyPair();
    duplicate.evidence.recoveryTiming.timingEvidenceId = duplicate.evidence.recoveryTiming.policyEvidenceId;
    duplicate.evidence.recoveryTiming.timingEvidenceSha256 = duplicate.evidence.recoveryTiming.policyEvidenceSha256;
    expect(prepareReportingSmokeObservationEvidence(
      duplicate.evidence,
      duplicate.authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_BINDING_INVALID');
  });

  it('rejects invalid policy-measurement-shadow-observation-decision chronology', () => {
    const { evidence, authorization } = readyPair();
    evidence.recoveryTiming.measuredAtUtc = '2026-07-14T16:05:00.000Z';

    expect(prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_CHRONOLOGY_INVALID');
  });

  it('rejects tenant, domain, mode, or smoke plan drift', () => {
    const { evidence, authorization } = readyPair();
    evidence.scope.tenantId = '101';
    evidence.scope.domain = 'finance';
    evidence.scope.mode = 'canonical';
    evidence.scope.smokePlanId = '';

    expect(prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_SCOPE_INVALID');
  });

  it('requires the exact twelve scenarios, all passed with evidence', () => {
    const { evidence, authorization } = readyPair();
    evidence.scenarios.pop();
    evidence.scenarios[0]!.status = 'failed';
    evidence.scenarios[1]!.evidenceSha256 = 'not-a-hash';

    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(receipt.issueCodes).toEqual(expect.arrayContaining([
      'CDB101_SMOKE_OBSERVATION_SCENARIO_SCOPE_INVALID',
      'CDB101_SMOKE_OBSERVATION_SCENARIO_RESULT_INVALID',
    ]));
  });

  it('rejects parity and performance results outside their declared thresholds', () => {
    const { evidence, authorization } = readyPair();
    evidence.parity.observedMaxAbsoluteDeltaMinor = 2;
    evidence.parity.observedMaxRelativeDelta = 0.01;
    evidence.parity.allWithinThreshold = false;
    evidence.performance.observedP95LatencyMs = 1501;
    evidence.performance.observedErrorRate = 0.02;
    evidence.performance.thresholdsMet = false;

    expect(prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt.issueCodes).toEqual(expect.arrayContaining([
      'CDB101_SMOKE_OBSERVATION_PARITY_INVALID',
      'CDB101_SMOKE_OBSERVATION_PERFORMANCE_INVALID',
    ]));
  });

  it('rejects tenant isolation, role denial, or read-only proof failures', () => {
    const { evidence, authorization } = readyPair();
    evidence.tenantIsolation.crossTenantRowsObserved = 1;
    evidence.roleDenial.unexpectedAllowedCount = 1;
    evidence.readOnlyProof.writeStatementCount = 1;
    evidence.readOnlyProof.mutationCount = 1;

    expect(prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt.issueCodes).toEqual(expect.arrayContaining([
      'CDB101_SMOKE_OBSERVATION_TENANT_ISOLATION_INVALID',
      'CDB101_SMOKE_OBSERVATION_ROLE_DENIAL_INVALID',
      'CDB101_SMOKE_OBSERVATION_READ_ONLY_PROOF_INVALID',
    ]));
  });

  it('rejects unconfirmed decisions and unsafe rollback/reopen timing', () => {
    const { evidence, authorization } = readyPair();
    evidence.observationDecision.backupConfirmed = false;
    evidence.observationDecision.backupObserverId = evidence.observationDecision.primaryObserverId;
    evidence.recoveryTiming.rollbackMeasuredMs = 60001;
    evidence.recoveryTiming.rollbackWithinThreshold = false;
    evidence.recoveryTiming.reopenMeasuredMs = 120001;
    evidence.recoveryTiming.reopenWithinThreshold = false;

    expect(prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt.issueCodes).toEqual(expect.arrayContaining([
      'CDB101_SMOKE_OBSERVATION_DECISION_INVALID',
      'CDB101_SMOKE_OBSERVATION_RECOVERY_TIMING_INVALID',
    ]));
  });

  it('rejects impossible scenario chronology and duplicate evidence bindings', () => {
    const { evidence, authorization } = readyPair();
    evidence.scenarios[0]!.completedAtUtc = '2026-07-14T16:34:00.000Z';
    evidence.parity.evidenceId = evidence.performance.evidenceId;
    evidence.parity.evidenceSha256 = evidence.performance.evidenceSha256;

    expect(prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt.issueCodes).toEqual(expect.arrayContaining([
      'CDB101_SMOKE_OBSERVATION_CHRONOLOGY_INVALID',
      'CDB101_SMOKE_OBSERVATION_BINDING_INVALID',
    ]));
  });

  it('rejects duplicate, unknown, sensitive, unsafe, oversized, and deep JSON documents', () => {
    const ready = createReadyReportingSmokeObservationEvidence();
    const duplicate = JSON.stringify(ready).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
    expect(parseReportingSmokeObservationEvidenceJson(duplicate).issues[0]?.code)
      .toBe('CDB101_SMOKE_OBSERVATION_DOCUMENT_DUPLICATE_KEY');

    expect(parseReportingSmokeObservationEvidenceJson(JSON.stringify({ ...ready, unknownField: true })).issues[0]?.code)
      .toBe('CDB101_SMOKE_OBSERVATION_DOCUMENT_UNKNOWN_FIELD');
    expect(parseReportingSmokeObservationEvidenceJson(JSON.stringify({ ...ready, token: 'secret' })).issues[0]?.code)
      .toBe('CDB101_SMOKE_OBSERVATION_DOCUMENT_SENSITIVE_FIELD');
    expect(parseReportingSmokeObservationEvidenceJson('{"__proto__":{}}').issues[0]?.code)
      .toBe('CDB101_SMOKE_OBSERVATION_DOCUMENT_UNSAFE_KEY');
    expect(parseReportingSmokeObservationEvidenceJson(`{"padding":"${'x'.repeat(300_000)}"}`).issues[0]?.code)
      .toBe('CDB101_SMOKE_OBSERVATION_DOCUMENT_TOO_LARGE');
    expect(parseReportingSmokeObservationEvidenceJson(`${'['.repeat(70)}0${']'.repeat(70)}`).issues[0]?.code)
      .toBe('CDB101_SMOKE_OBSERVATION_DOCUMENT_TOO_DEEP');
  });

  it('enforces protected evidence and authorization file rules', () => {
    const { evidence, authorization } = readyPair();
    const evidenceFile = protectedFile(evidence, 'evidence.json');
    const authorizationFile = protectedFile(authorization, 'authorization.json');
    expect(evaluateProtectedReportingSmokeObservationEvidence(
      evidenceFile.path,
      authorizationFile.path,
      resolve('.'),
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).promotionReady).toBe(true);

    chmodSync(authorizationFile.path, 0o644);
    const insecureAuthorization = evaluateProtectedReportingSmokeObservationEvidence(
      evidenceFile.path,
      authorizationFile.path,
      resolve('.'),
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    );
    expect(insecureAuthorization.authorizationBound).toBe(false);
    expect(insecureAuthorization.issueCodes).toContain('CDB101_SMOKE_OBSERVATION_AUTHORIZATION_INVALID');

    const links = protectedFile(evidence, 'source.json');
    const symlinkPath = join(links.root, 'symlink.json');
    symlinkSync(links.path, symlinkPath);
    expect(evaluateProtectedReportingSmokeObservationEvidence(
      symlinkPath,
      protectedFile(authorization, 'auth-for-symlink.json').path,
      resolve('.'),
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_SMOKE_OBSERVATION_FILE_PROTECTION_INVALID');

    const hardRoot = mkdtempSync(join(tmpdir(), 'cdb101-smoke-hardlink-'));
    temporaryRoots.push(hardRoot);
    chmodSync(hardRoot, 0o700);
    const hardPath = join(hardRoot, 'hard.json');
    linkSync(links.path, hardPath);
    expect(evaluateProtectedReportingSmokeObservationEvidence(
      hardPath,
      protectedFile(authorization, 'auth-for-hardlink.json').path,
      resolve('.'),
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).issueCodes).toContain('CDB101_SMOKE_OBSERVATION_FILE_PROTECTION_INVALID');

    const inside = join(resolve('.'), '.tmp-smoke-evidence-test');
    mkdirSync(inside, { recursive: true });
    const insideFile = join(inside, 'evidence.json');
    writeFileSync(insideFile, JSON.stringify(evidence), { mode: 0o600 });
    try {
      expect(evaluateProtectedReportingSmokeObservationEvidence(
        insideFile,
        protectedFile(authorization, 'auth-for-inside.json').path,
        resolve('.'),
        SMOKE_OBSERVATION_EVIDENCE_NOW,
      ).issueCodes).toContain('CDB101_SMOKE_OBSERVATION_FILE_INSIDE_REPOSITORY');
    } finally {
      rmSync(inside, { recursive: true, force: true });
    }
  });

  it('requires both offline evidence and protected authorization CLI arguments', () => {
    expect(parseReportingSmokeObservationEvidenceArgs([
      '--evidence',
      '/tmp/evidence.json',
      '--authorization',
      '/tmp/authorization.json',
      '--at-utc',
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ])).toEqual({
      evidencePath: '/tmp/evidence.json',
      authorizationPath: '/tmp/authorization.json',
      atUtc: SMOKE_OBSERVATION_EVIDENCE_NOW,
    });
    expect(() => parseReportingSmokeObservationEvidenceArgs(['--evidence', '/tmp/evidence.json']))
      .toThrow('--authorization is required.');
    expect(() => parseReportingSmokeObservationEvidenceArgs(['--execute'])).toThrow('Unknown argument.');
    expect(() => parseReportingSmokeObservationEvidenceArgs(['--evidence', 'a', '--evidence', 'b']))
      .toThrow('Duplicate argument.');
  });

  it('CLI emits a successful aggregate receipt for protected authorization-bound evidence', () => {
    const { evidence, authorization } = readyPair();
    const evidenceFile = protectedFile(evidence, 'evidence.json');
    const authorizationFile = protectedFile(authorization, 'authorization.json');
    const success = spawnSync('pnpm', [
      'canonical:validate-reporting-smoke-observation-evidence',
      '--',
      '--evidence',
      evidenceFile.path,
      '--authorization',
      authorizationFile.path,
      '--at-utc',
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    expect(success.status).toBe(0);
    expect(success.stdout).toContain('"evidenceReady": true');
    expect(success.stdout).toContain('"authorizationBound": true');
    expect(success.stdout).toContain('"promotionReady": true');
  }, 10_000);

  it('does not leak authorization IDs, owner IDs, evidence IDs, or hashes in the receipt', () => {
    const { evidence, authorization } = readyPair();
    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    const serialized = JSON.stringify(receipt);

    expect(serialized).not.toContain(authorization.authorizationId!);
    expect(serialized).not.toContain(authorization.authorizationApproval.evidenceSha256!);
    expect(serialized).not.toContain(authorization.observationOwner.ownerId!);
    expect(serialized).not.toContain(authorization.observationOwner.backupOwnerId!);
    expect(serialized).not.toContain(evidence.evidenceId!);
    expect(serialized).not.toContain(evidence.recoveryTiming.policyEvidenceId!);
    expect(serialized).not.toContain(evidence.recoveryTiming.timingEvidenceId!);
    expect(serialized).not.toContain(evidence.recoveryTiming.timingEvidenceSha256!);
    expect(serialized).not.toMatch(/[0-9a-f]{64}/);
  });

  it('keeps a valid no_go decision audit-ready without making it promotion-ready', () => {
    const { evidence, authorization } = readyPair();
    evidence.observationDecision.decision = 'no_go';
    const receipt = prepareReportingSmokeObservationEvidence(
      evidence,
      authorization,
      SMOKE_OBSERVATION_EVIDENCE_NOW,
    ).receipt;
    expect(receipt.evidenceReady).toBe(true);
    expect(receipt.authorizationBound).toBe(true);
    expect(receipt.promotionReady).toBe(false);
    expect(receipt.decision).toBe('no_go');
  });

  it('contains no network or external-command implementation path', () => {
    const source = readFileSync(resolve('scripts/canonical/reporting-smoke-observation-evidence.ts'), 'utf8');
    expect(source).not.toContain('node:child_process');
    expect(source).not.toContain('spawnSync');
    expect(source).not.toContain('execSync');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('wrangler');
    expect(source).not.toContain('cloudflare');
  });

  it('keeps the canonical scenario registry exact and stable', () => {
    expect(CDB101_REQUIRED_SMOKE_SCENARIOS).toEqual([
      'canonical_reporting_status',
      'doctor_performing_card_detail',
      'doctor_referring_card_detail',
      'diagnostic_volume_billed_card_detail',
      'collections_receipt_allocation_card_detail',
      'deposit_credit_refund_reversal_contributions',
      'ipd_finance_card_detail',
      'tenant_isolation',
      'role_denial',
      'legacy_routes_unchanged',
      'canary_read_only_sql',
      'latency_and_error_rate',
    ]);
  });
});
