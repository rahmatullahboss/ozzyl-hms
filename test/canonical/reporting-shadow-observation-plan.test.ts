import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createReadySingleOperatorReportingAuthorization,
  createReadyTwoPersonReportingAuthorization,
} from './fixtures/reporting-authorization-fixture';
import { buildReportingShadowActivationReceipt } from '../../scripts/canonical/set-production-canonical-flag';
import {
  buildReportingShadowObservationPlan,
  parseReportingShadowObservationPlanArgs,
  prepareReportingShadowObservationPlan,
} from '../../scripts/canonical/reporting-shadow-observation-plan';

describe('CDB-101 reporting shadow observation plan', () => {
  it('creates a fail-closed daytime observation plan from the verified shadow activation receipt', () => {
    const authorization = createReadyTwoPersonReportingAuthorization();
    const activation = buildReportingShadowActivationReceipt({
      commandId: authorization.featureFlagPlan.commandId!,
      activatedAtUtc: '2026-07-18T02:00:00.000Z',
    });

    const plan = buildReportingShadowObservationPlan({
      authorization,
      activationReceipt: activation,
      observationDurationHours: 10,
      generatedAtUtc: '2026-07-18T02:00:01.000Z',
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      program: 'CDB-101',
      domain: 'reporting',
      status: 'planned',
      tenantId: '100',
      mode: 'shadow',
      dualRunStartedAtUtc: '2026-07-18T02:00:00.000Z',
      observationWindowStartUtc: '2026-07-18T02:00:00.000Z',
      observationWindowEndUtc: '2026-07-18T12:00:00.000Z',
      monitoringOwnerId: 'staff-monitoring-owner',
      communicationChannelId: 'hms-cdb101-cutover-20260717',
      legacyRoutesActive: true,
      canonicalShadowActive: true,
      canonicalReadsServingUsers: false,
      trafficChangeProhibited: true,
      canonicalPromotionProhibited: true,
      monitoringShouldStart: true,
      decision: 'no_go_until_observation_complete',
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    });
    expect(plan.scenarioIds).toEqual(authorization.smoke.requiredScenarios);
    expect(plan.performanceThresholds).toEqual({
      maxP95LatencyMs: 1500,
      maxErrorRate: 0,
    });
    expect(plan.checkpointsUtc).toEqual([
      '2026-07-18T02:00:00.000Z',
      '2026-07-18T02:15:00.000Z',
      '2026-07-18T03:00:00.000Z',
      '2026-07-18T07:00:00.000Z',
      '2026-07-18T12:00:00.000Z',
    ]);
  });

  it('creates the same fail-closed observation plan for a schema-v4 single operator', () => {
    const authorization = createReadySingleOperatorReportingAuthorization();
    const activation = buildReportingShadowActivationReceipt({
      commandId: authorization.featureFlagPlan.commandId!,
      activatedAtUtc: '2026-07-18T02:00:00.000Z',
    });

    const plan = buildReportingShadowObservationPlan({
      authorization,
      activationReceipt: activation,
      observationDurationHours: 10,
      generatedAtUtc: '2026-07-18T02:00:01.000Z',
    });

    expect(plan).toMatchObject({
      monitoringOwnerId: 'rahmatullah-zisan',
      communicationChannelId: 'single-operator-cdb101-rahmatullah-zisan',
      legacyRoutesActive: true,
      canonicalShadowActive: true,
      canonicalReadsServingUsers: false,
      trafficChangeProhibited: true,
      canonicalPromotionProhibited: true,
      decision: 'no_go_until_observation_complete',
    });
  });

  it('rejects unsafe receipts, mismatched commands, and invalid observation durations', () => {
    const authorization = createReadyTwoPersonReportingAuthorization();
    const activation = buildReportingShadowActivationReceipt({
      commandId: authorization.featureFlagPlan.commandId!,
      activatedAtUtc: '2026-07-18T02:00:00.000Z',
    });

    expect(() => buildReportingShadowObservationPlan({
      authorization,
      activationReceipt: { ...activation, canonicalReadsServingUsers: true } as never,
      observationDurationHours: 10,
    })).toThrow(/canonical reads must not serve users/i);

    expect(() => buildReportingShadowObservationPlan({
      authorization,
      activationReceipt: { ...activation, commandId: 'different-command' },
      observationDurationHours: 10,
    })).toThrow(/command id/i);

    expect(() => buildReportingShadowObservationPlan({
      authorization,
      activationReceipt: activation,
      observationDurationHours: 0,
    })).toThrow(/observation duration/i);
  });

  it('writes a protected plan outside the repository and exposes an aggregate-only CLI receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb101-shadow-observation-'));
    chmodSync(root, 0o700);
    const authorization = createReadyTwoPersonReportingAuthorization();
    const activation = buildReportingShadowActivationReceipt({
      commandId: authorization.featureFlagPlan.commandId!,
      activatedAtUtc: '2026-07-14T16:30:00.000Z',
    });
    const authorizationPath = join(root, 'authorization.json');
    const activationPath = join(root, 'activation.json');
    const outputPath = join(root, 'observation-plan.json');
    writeFileSync(authorizationPath, `${JSON.stringify(authorization)}\n`, { mode: 0o600 });
    writeFileSync(activationPath, `${JSON.stringify(activation)}\n`, { mode: 0o600 });
    chmodSync(authorizationPath, 0o600);
    chmodSync(activationPath, 0o600);

    const receipt = prepareReportingShadowObservationPlan({
      authorizationPath,
      activationReceiptPath: activationPath,
      outputPath,
      observationDurationHours: 1,
      generatedAtUtc: '2026-07-14T16:30:01.000Z',
      repositoryRoot: process.cwd(),
    });

    expect(receipt).toMatchObject({
      planReady: true,
      scenarioCount: 12,
      checkpointCount: 4,
      canonicalReadsServingUsers: false,
      decision: 'no_go_until_observation_complete',
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    });
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    const plan = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(plan.observationWindowEndUtc).toBe('2026-07-14T17:30:00.000Z');
    expect(plan.checkpointsUtc).toEqual([
      '2026-07-14T16:30:00.000Z',
      '2026-07-14T16:45:00.000Z',
      '2026-07-14T17:00:00.000Z',
      '2026-07-14T17:30:00.000Z',
    ]);
    expect(() => parseReportingShadowObservationPlanArgs(['--execute'])).toThrow(/unknown argument/i);
  });
});
