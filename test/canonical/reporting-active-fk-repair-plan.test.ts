import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  type ReportingCutoverAuthorization,
} from '../../scripts/canonical/production-cutover-contract';
import {
  buildReportingActiveFkRepairPlan,
  parseReportingActiveFkRepairPlanArgs,
  prepareReportingActiveFkRepairPlan,
  type ReportingActiveFkDiagnosis,
} from '../../scripts/canonical/reporting-active-fk-repair-plan';
import {
  createReadySingleOperatorReportingAuthorization,
  createReadyTwoPersonReportingAuthorization,
} from './fixtures/reporting-authorization-fixture';

function createPlanningAuthorization(): ReportingCutoverAuthorization {
  const authorization = createReadyTwoPersonReportingAuthorization();
  return {
    ...authorization,
    productionExecutionAuthorized: false,
    deployment: { ...authorization.deployment, authorized: false },
    migrations: { ...authorization.migrations, authorized: false },
    productionImport: {
      ...authorization.productionImport,
      authorized: false,
      commandApproved: false,
    },
    featureFlagPlan: { ...authorization.featureFlagPlan, authorized: false },
    foreignKeyDisposition: {
      ...authorization.foreignKeyDisposition,
      evidenceId: null,
      evidenceSha256: null,
      groups: authorization.foreignKeyDisposition.groups.map((group) => (
        group.childTable === 'billing_deposits' || group.childTable === 'income'
          ? {
              ...group,
              remainingViolationCount: 4,
              repairedViolationCount: 0,
              waivedViolationCount: 0,
              ownerId: null,
              evidenceId: null,
            }
          : group
      )),
    },
  };
}

function createSingleOperatorPlanningAuthorization(): ReportingCutoverAuthorization {
  const authorization = createReadySingleOperatorReportingAuthorization();
  return {
    ...createPlanningAuthorization(),
    schemaVersion: 4,
    ownerModel: authorization.ownerModel,
    singleOperatorRiskAcceptance: authorization.singleOperatorRiskAcceptance,
    twoPersonRiskAcceptance: undefined,
    rollbackOwner: authorization.rollbackOwner,
    observationOwner: authorization.observationOwner,
  };
}

function createDiagnosis(): ReportingActiveFkDiagnosis {
  return {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    sourceQueryId: 'cdb101_active_fk_diagnosis_v1',
    capturedAtUtc: '2026-07-14T16:00:00.000Z',
    productionDatabase: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    groups: [
      {
        childTable: 'billing_deposits',
        parentTable: 'bills',
        childColumn: 'reference_bill_id',
        violationCount: 4,
        nullable: true,
        deterministicReplacementCandidateCount: 0,
      },
      {
        childTable: 'income',
        parentTable: 'bills',
        childColumn: 'bill_id',
        violationCount: 4,
        nullable: true,
        deterministicReplacementCandidateCount: 0,
      },
    ],
    totalActiveViolationCount: 8,
    preserveFinancialRowsRequired: true,
    hardDeleteAllowed: false,
    guessedRelinkAllowed: false,
    recommendedStrategyId: 'clear_invalid_optional_bill_reference_v1',
    changedDb: false,
    rowsWritten: 0,
    productionMutationPerformed: false,
  };
}

describe('CDB-101 active FK repair plan', () => {
  it('builds an aggregate-only review plan that preserves financial rows', () => {
    const plan = buildReportingActiveFkRepairPlan({
      authorization: createPlanningAuthorization(),
      diagnosis: createDiagnosis(),
      generatedAtUtc: '2026-07-14T16:01:00.000Z',
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      program: 'CDB-101',
      domain: 'reporting',
      stage: 'active_fk_repair_preparation',
      status: 'review_required',
      strategyId: 'clear_invalid_optional_bill_reference_v1',
      expectedTotalActiveViolationCount: 8,
      repairOwnerId: 'rahmatullah-zisan',
      observationOwnerId: 'staff-monitoring-owner',
      communicationChannelId: 'hms-cdb101-cutover-20260717',
      mutationConstraints: {
        preserveFinancialRows: true,
        hardDeleteProhibited: true,
        guessedRelinkProhibited: true,
        amountMutationProhibited: true,
        statusMutationProhibited: true,
        businessDateMutationProhibited: true,
        tenantMutationProhibited: true,
        onlyInvalidOptionalReferenceMayChange: true,
      },
      executionCommandIncluded: false,
      executionAuthorized: false,
      decision: 'no_go_until_separately_authorized_and_verified',
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    });
    expect(plan.expectedGroups).toEqual([
      {
        childTable: 'billing_deposits',
        parentTable: 'bills',
        childColumn: 'reference_bill_id',
        expectedViolationCount: 4,
        expectedReplacementCandidateCount: 0,
        nullableReference: true,
      },
      {
        childTable: 'income',
        parentTable: 'bills',
        childColumn: 'bill_id',
        expectedViolationCount: 4,
        expectedReplacementCandidateCount: 0,
        nullableReference: true,
      },
    ]);
    expect(plan.requiredBeforeChecks).toContain('protected_export_bound');
    expect(plan.requiredAfterChecks).toContain('total_fk_violation_count_41');
  });

  it('builds the non-executing repair plan for the schema-v4 single operator', () => {
    const plan = buildReportingActiveFkRepairPlan({
      authorization: createSingleOperatorPlanningAuthorization(),
      diagnosis: createDiagnosis(),
      generatedAtUtc: '2026-07-14T16:01:00.000Z',
    });

    expect(plan).toMatchObject({
      repairOwnerId: 'rahmatullah-zisan',
      observationOwnerId: 'rahmatullah-zisan',
      communicationChannelId: 'single-operator-cdb101-rahmatullah-zisan',
      executionAuthorized: false,
      decision: 'no_go_until_separately_authorized_and_verified',
    });
  });

  it('rejects replacement guesses, unsafe ownership, and diagnosis time inversion', () => {
    const authorization = createPlanningAuthorization();
    const diagnosis = createDiagnosis();

    expect(() => buildReportingActiveFkRepairPlan({
      authorization,
      diagnosis: {
        ...diagnosis,
        groups: diagnosis.groups.map((group, index) => (
          index === 0 ? { ...group, deterministicReplacementCandidateCount: 1 as never } : group
        )),
      },
    })).toThrow(/exact two reviewed active fk groups|diagnosis/i);

    expect(() => buildReportingActiveFkRepairPlan({
      authorization: {
        ...authorization,
        observationOwner: {
          ...authorization.observationOwner,
          ownerId: authorization.rollbackOwner.ownerId,
        },
      },
      diagnosis,
    })).toThrow(/distinct/i);

    expect(() => buildReportingActiveFkRepairPlan({
      authorization: { ...authorization, productionExecutionAuthorized: true },
      diagnosis,
    })).toThrow(/non-executing/i);

    expect(() => buildReportingActiveFkRepairPlan({
      authorization: {
        ...authorization,
        foreignKeyDisposition: {
          ...authorization.foreignKeyDisposition,
          groups: authorization.foreignKeyDisposition.groups.map((group) => (
            group.childTable === 'billing_deposits'
              ? {
                  ...group,
                  remainingViolationCount: 0,
                  repairedViolationCount: 4,
                }
              : group
          )),
        },
      },
      diagnosis,
    })).toThrow(/repair scope/i);

    expect(() => buildReportingActiveFkRepairPlan({
      authorization,
      diagnosis,
      generatedAtUtc: '2026-07-14T15:59:59.000Z',
    })).toThrow(/before diagnosis/i);
  });

  it('writes a protected plan outside the repository and refuses execution arguments', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb101-active-fk-plan-'));
    chmodSync(root, 0o700);
    const authorizationPath = join(root, 'authorization.json');
    const diagnosisPath = join(root, 'diagnosis.json');
    const outputPath = join(root, 'repair-plan.json');
    writeFileSync(
      authorizationPath,
      `${JSON.stringify(createPlanningAuthorization())}\n`,
      { mode: 0o600 },
    );
    writeFileSync(diagnosisPath, `${JSON.stringify(createDiagnosis())}\n`, { mode: 0o600 });
    chmodSync(authorizationPath, 0o600);
    chmodSync(diagnosisPath, 0o600);

    const receipt = prepareReportingActiveFkRepairPlan({
      authorizationPath,
      diagnosisPath,
      outputPath,
      generatedAtUtc: '2026-07-14T16:01:00.000Z',
      repositoryRoot: process.cwd(),
    });

    expect(receipt).toEqual({
      schemaVersion: 1,
      planReady: true,
      strategyId: 'clear_invalid_optional_bill_reference_v1',
      expectedGroupCount: 2,
      expectedTotalActiveViolationCount: 8,
      deterministicReplacementCandidateCount: 0,
      preserveFinancialRows: true,
      hardDeleteProhibited: true,
      guessedRelinkProhibited: true,
      executionCommandIncluded: false,
      executionAuthorized: false,
      decision: 'no_go_until_separately_authorized_and_verified',
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    });
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    const plan = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(plan.expectedGroups).toHaveLength(2);
    expect(plan.executionCommandIncluded).toBe(false);
    expect(() => parseReportingActiveFkRepairPlanArgs(['--execute'])).toThrow(/unknown argument/i);
  });
});
