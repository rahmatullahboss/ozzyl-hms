import { chmodSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  type ReportingCutoverAuthorization,
} from './production-cutover-contract';
import { loadProtectedJsonDocument } from './protected-json-document';
import { prepareProtectedReportingCutoverAuthorization } from './reporting-cutover-authorization-document';

const ACTIVE_REPAIR_STRATEGY_ID = 'clear_invalid_optional_bill_reference_v1' as const;
const ACTIVE_FK_DIAGNOSIS_QUERY_ID = 'cdb101_active_fk_diagnosis_v1' as const;

const activeGroupSchema = z.object({
  childTable: z.enum(['billing_deposits', 'income']),
  parentTable: z.literal('bills'),
  childColumn: z.enum(['reference_bill_id', 'bill_id']),
  violationCount: z.literal(4),
  nullable: z.literal(true),
  deterministicReplacementCandidateCount: z.literal(0),
}).strict();

const activeFkDiagnosisSchema = z.object({
  schemaVersion: z.literal(1),
  program: z.literal('CDB-101'),
  domain: z.literal('reporting'),
  sourceQueryId: z.literal(ACTIVE_FK_DIAGNOSIS_QUERY_ID),
  capturedAtUtc: z.string().min(1),
  productionDatabase: z.object({
    name: z.literal(CDB101_PRODUCTION_DATABASE_NAME),
    id: z.literal(CDB101_PRODUCTION_DATABASE_ID),
  }).strict(),
  groups: z.array(activeGroupSchema).length(2),
  totalActiveViolationCount: z.literal(8),
  preserveFinancialRowsRequired: z.literal(true),
  hardDeleteAllowed: z.literal(false),
  guessedRelinkAllowed: z.literal(false),
  recommendedStrategyId: z.literal(ACTIVE_REPAIR_STRATEGY_ID),
  changedDb: z.literal(false),
  rowsWritten: z.literal(0),
  productionMutationPerformed: z.literal(false),
}).strict();

export type ReportingActiveFkDiagnosis = z.infer<typeof activeFkDiagnosisSchema>;

export interface ReportingActiveFkRepairPlan {
  schemaVersion: 1;
  program: 'CDB-101';
  domain: 'reporting';
  stage: 'active_fk_repair_preparation';
  status: 'review_required';
  authorizationId: string;
  generatedAtUtc: string;
  diagnosisCapturedAtUtc: string;
  productionDatabase: {
    name: typeof CDB101_PRODUCTION_DATABASE_NAME;
    id: typeof CDB101_PRODUCTION_DATABASE_ID;
  };
  repairOwnerId: string;
  observationOwnerId: string;
  communicationChannelId: string;
  strategyId: typeof ACTIVE_REPAIR_STRATEGY_ID;
  expectedGroups: Array<{
    childTable: 'billing_deposits' | 'income';
    parentTable: 'bills';
    childColumn: 'reference_bill_id' | 'bill_id';
    expectedViolationCount: 4;
    expectedReplacementCandidateCount: 0;
    nullableReference: true;
  }>;
  expectedTotalActiveViolationCount: 8;
  mutationConstraints: {
    preserveFinancialRows: true;
    hardDeleteProhibited: true;
    guessedRelinkProhibited: true;
    amountMutationProhibited: true;
    statusMutationProhibited: true;
    businessDateMutationProhibited: true;
    tenantMutationProhibited: true;
    onlyInvalidOptionalReferenceMayChange: true;
  };
  requiredBeforeChecks: readonly [
    'exact_production_database_identity',
    'exact_two_active_fk_groups',
    'exact_total_active_violation_count_8',
    'zero_deterministic_replacement_candidates',
    'time_travel_bookmark_bound',
    'protected_export_bound',
    'explicit_active_fk_repair_authorization',
  ];
  requiredAfterChecks: readonly [
    'active_fk_groups_absent',
    'archival_fk_groups_only',
    'total_fk_violation_count_41',
    'financial_row_counts_unchanged',
    'financial_amount_totals_unchanged',
    'audit_evidence_bound',
    'changed_db_false_on_verification_query',
    'rows_written_zero_on_verification_query',
  ];
  executionCommandIncluded: false;
  executionAuthorized: false;
  decision: 'no_go_until_separately_authorized_and_verified';
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
}

export interface BuildReportingActiveFkRepairPlanInput {
  authorization: ReportingCutoverAuthorization;
  diagnosis: ReportingActiveFkDiagnosis;
  generatedAtUtc?: string;
}

export interface PrepareReportingActiveFkRepairPlanOptions {
  authorizationPath: string;
  diagnosisPath: string;
  outputPath: string;
  generatedAtUtc?: string;
  repositoryRoot?: string;
}

export interface ReportingActiveFkRepairPlanReceipt {
  schemaVersion: 1;
  planReady: true;
  strategyId: typeof ACTIVE_REPAIR_STRATEGY_ID;
  expectedGroupCount: 2;
  expectedTotalActiveViolationCount: 8;
  deterministicReplacementCandidateCount: 0;
  preserveFinancialRows: true;
  hardDeleteProhibited: true;
  guessedRelinkProhibited: true;
  executionCommandIncluded: false;
  executionAuthorized: false;
  decision: 'no_go_until_separately_authorized_and_verified';
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
}

export interface ReportingActiveFkRepairPlanCliOptions {
  authorizationPath: string;
  diagnosisPath: string;
  outputPath: string;
  generatedAtUtc?: string;
}

function parseAbsoluteUtc(value: string, label: string): number {
  if (!value.endsWith('Z')) throw new Error(`${label} must be an absolute UTC timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an absolute UTC timestamp`);
  return parsed;
}

function assertExactDiagnosisGroups(groups: ReportingActiveFkDiagnosis['groups']): void {
  const normalized = [...groups]
    .map((group) => `${group.childTable}|${group.parentTable}|${group.childColumn}`)
    .sort();
  const expected = [
    'billing_deposits|bills|reference_bill_id',
    'income|bills|bill_id',
  ];
  if (normalized.length !== expected.length || normalized.some((value, index) => value !== expected[index])) {
    throw new Error('Diagnosis does not contain the exact two reviewed active FK groups');
  }
}

function assertAuthorizationScope(authorization: ReportingCutoverAuthorization): void {
  if (!(
    (authorization.schemaVersion === 3 && authorization.ownerModel === 'two_person_constrained')
    || (authorization.schemaVersion === 4 && authorization.ownerModel === 'single_operator_risk_accepted')
  )) {
    throw new Error('Active FK repair planning requires a constrained or risk-accepted authorization');
  }
  if (!authorization.authorizationId) throw new Error('Authorization ID is required');
  if (authorization.productionExecutionAuthorized) {
    throw new Error('Active FK repair planning requires a non-executing authorization draft');
  }
  if (authorization.productionDatabase.name !== CDB101_PRODUCTION_DATABASE_NAME
    || authorization.productionDatabase.id !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Authorization production database identity is invalid');
  }
  if (!authorization.rollbackOwner.assigned || !authorization.rollbackOwner.ownerId) {
    throw new Error('A real technical repair owner is required');
  }
  if (!authorization.observationOwner.assigned || !authorization.observationOwner.ownerId) {
    throw new Error('A distinct observation owner is required');
  }
  if (
    authorization.schemaVersion === 3
    && authorization.rollbackOwner.ownerId === authorization.observationOwner.ownerId
  ) {
    throw new Error('Repair and observation owners must be distinct');
  }
  if (!authorization.rollbackOwner.communicationChannelId
    || authorization.rollbackOwner.communicationChannelId !== authorization.observationOwner.communicationChannelId) {
    throw new Error('Both owners must share the same incident communication channel');
  }

  const activeGroups = authorization.foreignKeyDisposition.groups
    .filter((group) => group.childTable === 'billing_deposits' || group.childTable === 'income')
    .sort((left, right) => left.childTable.localeCompare(right.childTable));
  if (activeGroups.length !== 2
    || activeGroups[0]?.childTable !== 'billing_deposits'
    || activeGroups[1]?.childTable !== 'income'
    || activeGroups.some((group) => group.parentTable !== 'bills'
      || group.violationCount !== 4
      || group.remainingViolationCount !== 4
      || group.repairedViolationCount !== 0
      || group.waivedViolationCount !== 0
      || group.disposition !== 'repair_required')) {
    throw new Error('Authorization does not contain the exact active FK repair scope');
  }
}

function loadDiagnosis(path: string, repositoryRoot: string): ReportingActiveFkDiagnosis {
  const loaded = loadProtectedJsonDocument(path, repositoryRoot, {
    maxBytes: 32 * 1024,
    maxDepth: 20,
  });
  if (!loaded.ready) {
    throw new Error(`Protected active FK diagnosis is unavailable: ${loaded.issues.map((issue) => issue.code).join(',')}`);
  }
  const parsed = activeFkDiagnosisSchema.safeParse(loaded.value);
  if (!parsed.success) throw new Error('Protected active FK diagnosis schema is invalid');
  assertExactDiagnosisGroups(parsed.data.groups);
  return parsed.data;
}

function writeProtectedPlan(
  outputPath: string,
  repositoryRoot: string,
  plan: ReportingActiveFkRepairPlan,
): void {
  const absolute = resolve(outputPath);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Active FK repair plan output must remain outside the repository');
  }
  const parent = lstatSync(dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error('Active FK repair plan parent directory must use mode 700');
  }
  writeFileSync(absolute, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(absolute, 0o600);
}

export function buildReportingActiveFkRepairPlan(
  input: BuildReportingActiveFkRepairPlanInput,
): ReportingActiveFkRepairPlan {
  assertAuthorizationScope(input.authorization);
  const parsedDiagnosis = activeFkDiagnosisSchema.safeParse(input.diagnosis);
  if (!parsedDiagnosis.success) throw new Error('Active FK diagnosis schema is invalid');
  const diagnosis = parsedDiagnosis.data;
  assertExactDiagnosisGroups(diagnosis.groups);
  if (diagnosis.productionDatabase.name !== CDB101_PRODUCTION_DATABASE_NAME
    || diagnosis.productionDatabase.id !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Diagnosis production database identity is invalid');
  }
  const diagnosisMs = parseAbsoluteUtc(diagnosis.capturedAtUtc, 'Diagnosis capture time');
  const generatedAtUtc = input.generatedAtUtc ?? new Date().toISOString();
  const generatedMs = parseAbsoluteUtc(generatedAtUtc, 'Generated time');
  if (generatedMs < diagnosisMs) throw new Error('Repair plan cannot be generated before diagnosis capture');

  return {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    stage: 'active_fk_repair_preparation',
    status: 'review_required',
    authorizationId: input.authorization.authorizationId!,
    generatedAtUtc,
    diagnosisCapturedAtUtc: diagnosis.capturedAtUtc,
    productionDatabase: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    repairOwnerId: input.authorization.rollbackOwner.ownerId!,
    observationOwnerId: input.authorization.observationOwner.ownerId!,
    communicationChannelId: input.authorization.rollbackOwner.communicationChannelId!,
    strategyId: ACTIVE_REPAIR_STRATEGY_ID,
    expectedGroups: [...diagnosis.groups]
      .sort((left, right) => left.childTable.localeCompare(right.childTable))
      .map((group) => ({
        childTable: group.childTable,
        parentTable: group.parentTable,
        childColumn: group.childColumn,
        expectedViolationCount: group.violationCount,
        expectedReplacementCandidateCount: group.deterministicReplacementCandidateCount,
        nullableReference: group.nullable,
      })),
    expectedTotalActiveViolationCount: 8,
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
    requiredBeforeChecks: [
      'exact_production_database_identity',
      'exact_two_active_fk_groups',
      'exact_total_active_violation_count_8',
      'zero_deterministic_replacement_candidates',
      'time_travel_bookmark_bound',
      'protected_export_bound',
      'explicit_active_fk_repair_authorization',
    ],
    requiredAfterChecks: [
      'active_fk_groups_absent',
      'archival_fk_groups_only',
      'total_fk_violation_count_41',
      'financial_row_counts_unchanged',
      'financial_amount_totals_unchanged',
      'audit_evidence_bound',
      'changed_db_false_on_verification_query',
      'rows_written_zero_on_verification_query',
    ],
    executionCommandIncluded: false,
    executionAuthorized: false,
    decision: 'no_go_until_separately_authorized_and_verified',
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  };
}

export function prepareReportingActiveFkRepairPlan(
  options: PrepareReportingActiveFkRepairPlanOptions,
): ReportingActiveFkRepairPlanReceipt {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const preparedAuthorization = prepareProtectedReportingCutoverAuthorization(
    options.authorizationPath,
    repositoryRoot,
    options.generatedAtUtc ?? new Date().toISOString(),
  );
  if (!preparedAuthorization.receipt.documentReady || !preparedAuthorization.authorization) {
    throw new Error('Protected reporting authorization document is unavailable');
  }
  const diagnosis = loadDiagnosis(options.diagnosisPath, repositoryRoot);
  const plan = buildReportingActiveFkRepairPlan({
    authorization: preparedAuthorization.authorization,
    diagnosis,
    generatedAtUtc: options.generatedAtUtc,
  });
  writeProtectedPlan(options.outputPath, repositoryRoot, plan);
  return {
    schemaVersion: 1,
    planReady: true,
    strategyId: ACTIVE_REPAIR_STRATEGY_ID,
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
  };
}

export function parseReportingActiveFkRepairPlanArgs(
  args: string[],
): ReportingActiveFkRepairPlanCliOptions {
  const allowed = new Set(['--authorization', '--diagnosis', '--output', '--generated-at-utc']);
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
  for (const required of ['--authorization', '--diagnosis', '--output']) {
    if (!values[required]) throw new Error(`${required} is required`);
  }
  return {
    authorizationPath: values['--authorization'],
    diagnosisPath: values['--diagnosis'],
    outputPath: values['--output'],
    generatedAtUtc: values['--generated-at-utc'],
  };
}

function main(): void {
  try {
    const options = parseReportingActiveFkRepairPlanArgs(process.argv.slice(2));
    const receipt = prepareReportingActiveFkRepairPlan(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 active FK repair planning failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
