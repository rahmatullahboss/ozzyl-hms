import { chmodSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  CDB101_REQUIRED_SMOKE_SCENARIOS,
  type ReportingCutoverAuthorization,
} from './production-cutover-contract';
import { loadProtectedJsonDocument } from './protected-json-document';
import { prepareProtectedReportingCutoverAuthorization } from './reporting-cutover-authorization-document';
import type { ReportingShadowActivationReceipt } from './set-production-canonical-flag';

export interface ReportingShadowObservationPlan {
  schemaVersion: 1;
  program: 'CDB-101';
  domain: 'reporting';
  status: 'planned';
  authorizationId: string;
  tenantId: '100';
  mode: 'shadow';
  generatedAtUtc: string;
  dualRunStartedAtUtc: string;
  observationWindowStartUtc: string;
  observationWindowEndUtc: string;
  observationDurationHours: number;
  monitoringOwnerId: string;
  communicationChannelId: string;
  legacyRoutesActive: true;
  canonicalShadowActive: true;
  canonicalReadsServingUsers: false;
  monitoringShouldStart: true;
  trafficChangeProhibited: true;
  canonicalPromotionProhibited: true;
  scenarioIds: string[];
  performanceThresholds: {
    maxP95LatencyMs: number;
    maxErrorRate: number;
  };
  requiredMeasurements: readonly [
    'legacy_canonical_parity',
    'latency_and_error_rate',
    'tenant_isolation',
    'role_denial',
    'read_only_proof',
  ];
  checkpointsUtc: string[];
  decision: 'no_go_until_observation_complete';
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
}

export interface BuildReportingShadowObservationPlanInput {
  authorization: ReportingCutoverAuthorization;
  activationReceipt: ReportingShadowActivationReceipt;
  observationDurationHours: number;
  generatedAtUtc?: string;
}

export interface PrepareReportingShadowObservationPlanOptions {
  authorizationPath: string;
  activationReceiptPath: string;
  outputPath: string;
  observationDurationHours: number;
  generatedAtUtc?: string;
  repositoryRoot?: string;
}

export interface ReportingShadowObservationPlanReceipt {
  schemaVersion: 1;
  planReady: true;
  tenantId: '100';
  mode: 'shadow';
  dualRunStartedAtUtc: string;
  observationWindowEndUtc: string;
  scenarioCount: number;
  checkpointCount: number;
  monitoringOwnerAssigned: true;
  canonicalReadsServingUsers: false;
  decision: 'no_go_until_observation_complete';
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
}

export interface ReportingShadowObservationPlanCliOptions {
  authorizationPath: string;
  activationReceiptPath: string;
  outputPath: string;
  observationDurationHours: number;
  generatedAtUtc?: string;
}

const activationReceiptSchema = z.object({
  allowed: z.literal(true),
  commandId: z.string().min(1),
  tenantId: z.literal('100'),
  mode: z.literal('shadow'),
  dualRunStartedAtUtc: z.string().min(1),
  legacyRoutesActive: z.literal(true),
  canonicalShadowActive: z.literal(true),
  canonicalReadsServingUsers: z.literal(false),
  monitoringShouldStart: z.literal(true),
  productionMutationPerformed: z.literal(true),
}).strict();

function parseAbsoluteUtc(value: string, label: string): number {
  if (!value.endsWith('Z')) throw new Error(`${label} must be an absolute UTC timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an absolute UTC timestamp`);
  return parsed;
}

function exactStringArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function iso(atMs: number): string {
  return new Date(atMs).toISOString();
}

function buildCheckpoints(startMs: number, endMs: number): string[] {
  const durationMs = endMs - startMs;
  const candidates = [
    startMs,
    startMs + 15 * 60_000,
    startMs + 60 * 60_000,
    startMs + Math.floor(durationMs / 2),
    endMs,
  ].filter((value) => value >= startMs && value <= endMs);
  return [...new Set(candidates)].sort((left, right) => left - right).map(iso);
}

function writeProtectedPlan(outputPath: string, repositoryRoot: string, plan: ReportingShadowObservationPlan): void {
  const absolute = resolve(outputPath);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Shadow observation plan output must remain outside the repository');
  }
  const parent = lstatSync(dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error('Shadow observation plan parent directory must use mode 700');
  }
  writeFileSync(absolute, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(absolute, 0o600);
}

function loadActivationReceipt(
  activationReceiptPath: string,
  repositoryRoot: string,
): ReportingShadowActivationReceipt {
  const loaded = loadProtectedJsonDocument(activationReceiptPath, repositoryRoot, {
    maxBytes: 16 * 1024,
    maxDepth: 16,
  });
  if (!loaded.ready) {
    throw new Error(`Protected activation receipt is unavailable: ${loaded.issues.map((issue) => issue.code).join(',')}`);
  }
  const parsed = activationReceiptSchema.safeParse(loaded.value);
  if (!parsed.success) throw new Error('Protected activation receipt schema is invalid');
  return parsed.data;
}

export function buildReportingShadowObservationPlan(
  input: BuildReportingShadowObservationPlanInput,
): ReportingShadowObservationPlan {
  const { authorization, activationReceipt } = input;
  if (!Number.isSafeInteger(input.observationDurationHours)
    || input.observationDurationHours < 1
    || input.observationDurationHours > 72) {
    throw new Error('Observation duration must be a safe integer between 1 and 72 hours');
  }
  if (!(
    (authorization.schemaVersion === 3 && authorization.ownerModel === 'two_person_constrained')
    || (authorization.schemaVersion === 4 && authorization.ownerModel === 'single_operator_risk_accepted')
  )) {
    throw new Error('Shadow observation requires a constrained or risk-accepted authorization');
  }
  if (!authorization.authorizationId) throw new Error('Authorization ID is required');
  if (!authorization.observationOwner.assigned || !authorization.observationOwner.ownerId) {
    throw new Error('A real monitoring owner is required');
  }
  if (!authorization.observationOwner.communicationChannelId) {
    throw new Error('A shared incident communication channel is required');
  }
  if (authorization.rollbackOwner.communicationChannelId
    !== authorization.observationOwner.communicationChannelId) {
    throw new Error('Both owners must use the same shared incident communication channel');
  }
  if (
    authorization.schemaVersion === 3
    && authorization.rollbackOwner.ownerId === authorization.observationOwner.ownerId
  ) {
    throw new Error('Monitoring owner must be distinct from rollback authority');
  }
  if (authorization.featureFlagPlan.tenantId !== '100'
    || authorization.featureFlagPlan.flagKey !== 'canonical_reporting_v1'
    || authorization.featureFlagPlan.domain !== 'reporting'
    || authorization.featureFlagPlan.initialMode !== 'shadow'
    || authorization.featureFlagPlan.canonicalModeAuthorized !== false) {
    throw new Error('Authorization is not restricted to tenant-100 reporting shadow mode');
  }
  if (!authorization.featureFlagPlan.commandId
    || activationReceipt.commandId !== authorization.featureFlagPlan.commandId) {
    throw new Error('Activation receipt command ID does not match authorization');
  }
  if (activationReceipt.tenantId !== '100' || activationReceipt.mode !== 'shadow') {
    throw new Error('Activation receipt scope is not tenant-100 shadow mode');
  }
  if (activationReceipt.legacyRoutesActive !== true
    || activationReceipt.canonicalShadowActive !== true
    || activationReceipt.monitoringShouldStart !== true) {
    throw new Error('Activation receipt does not confirm safe dual-run state');
  }
  if (activationReceipt.canonicalReadsServingUsers !== false) {
    throw new Error('Canonical reads must not serve users during shadow observation');
  }
  if (!exactStringArray(authorization.smoke.requiredScenarios, CDB101_REQUIRED_SMOKE_SCENARIOS)) {
    throw new Error('Authorization does not contain the complete reporting smoke scenario registry');
  }
  if (!Number.isSafeInteger(authorization.smoke.maxP95LatencyMs)
    || (authorization.smoke.maxP95LatencyMs ?? -1) < 0
    || !Number.isFinite(authorization.smoke.maxErrorRate)
    || (authorization.smoke.maxErrorRate ?? -1) < 0) {
    throw new Error('Authorization performance thresholds are invalid');
  }

  const startMs = parseAbsoluteUtc(activationReceipt.dualRunStartedAtUtc, 'Dual-run start time');
  const generatedAtUtc = input.generatedAtUtc ?? new Date().toISOString();
  const generatedMs = parseAbsoluteUtc(generatedAtUtc, 'Generated time');
  if (generatedMs < startMs) throw new Error('Observation plan cannot be generated before dual-run starts');
  const endMs = startMs + input.observationDurationHours * 60 * 60_000;

  return {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    status: 'planned',
    authorizationId: authorization.authorizationId,
    tenantId: '100',
    mode: 'shadow',
    generatedAtUtc,
    dualRunStartedAtUtc: activationReceipt.dualRunStartedAtUtc,
    observationWindowStartUtc: activationReceipt.dualRunStartedAtUtc,
    observationWindowEndUtc: iso(endMs),
    observationDurationHours: input.observationDurationHours,
    monitoringOwnerId: authorization.observationOwner.ownerId,
    communicationChannelId: authorization.observationOwner.communicationChannelId,
    legacyRoutesActive: true,
    canonicalShadowActive: true,
    canonicalReadsServingUsers: false,
    monitoringShouldStart: true,
    trafficChangeProhibited: true,
    canonicalPromotionProhibited: true,
    scenarioIds: [...authorization.smoke.requiredScenarios],
    performanceThresholds: {
      maxP95LatencyMs: authorization.smoke.maxP95LatencyMs!,
      maxErrorRate: authorization.smoke.maxErrorRate!,
    },
    requiredMeasurements: [
      'legacy_canonical_parity',
      'latency_and_error_rate',
      'tenant_isolation',
      'role_denial',
      'read_only_proof',
    ],
    checkpointsUtc: buildCheckpoints(startMs, endMs),
    decision: 'no_go_until_observation_complete',
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  };
}

export function prepareReportingShadowObservationPlan(
  options: PrepareReportingShadowObservationPlanOptions,
): ReportingShadowObservationPlanReceipt {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const generatedAtUtc = options.generatedAtUtc ?? new Date().toISOString();
  const preparedAuthorization = prepareProtectedReportingCutoverAuthorization(
    options.authorizationPath,
    repositoryRoot,
    generatedAtUtc,
  );
  if (!preparedAuthorization.authorization || !preparedAuthorization.receipt.executionReady) {
    throw new Error(`Protected authorization is not execution ready: ${preparedAuthorization.receipt.issues.map((issue) => issue.code).join(',')}`);
  }
  const activationReceipt = loadActivationReceipt(options.activationReceiptPath, repositoryRoot);
  const plan = buildReportingShadowObservationPlan({
    authorization: preparedAuthorization.authorization,
    activationReceipt,
    observationDurationHours: options.observationDurationHours,
    generatedAtUtc,
  });
  writeProtectedPlan(options.outputPath, repositoryRoot, plan);
  return {
    schemaVersion: 1,
    planReady: true,
    tenantId: '100',
    mode: 'shadow',
    dualRunStartedAtUtc: plan.dualRunStartedAtUtc,
    observationWindowEndUtc: plan.observationWindowEndUtc,
    scenarioCount: plan.scenarioIds.length,
    checkpointCount: plan.checkpointsUtc.length,
    monitoringOwnerAssigned: true,
    canonicalReadsServingUsers: false,
    decision: 'no_go_until_observation_complete',
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  };
}

export function parseReportingShadowObservationPlanArgs(
  args: string[],
): ReportingShadowObservationPlanCliOptions {
  const allowed = new Set([
    '--authorization',
    '--activation-receipt',
    '--output',
    '--observation-hours',
    '--generated-at-utc',
  ]);
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (arg in values) throw new Error(`Duplicate argument: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values[arg] = value;
    index += 1;
  }
  for (const required of ['--authorization', '--activation-receipt', '--output', '--observation-hours']) {
    if (!values[required]) throw new Error(`${required} is required`);
  }
  const observationDurationHours = Number(values['--observation-hours']);
  if (!Number.isSafeInteger(observationDurationHours)) {
    throw new Error('--observation-hours must be a safe integer');
  }
  return {
    authorizationPath: values['--authorization'],
    activationReceiptPath: values['--activation-receipt'],
    outputPath: values['--output'],
    observationDurationHours,
    generatedAtUtc: values['--generated-at-utc'],
  };
}

function main(): void {
  try {
    const options = parseReportingShadowObservationPlanArgs(process.argv.slice(2));
    const receipt = prepareReportingShadowObservationPlan(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 shadow observation plan preparation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
