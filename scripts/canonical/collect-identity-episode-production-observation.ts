import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadIdentityEpisodeObservationAuthorization,
  type IdentityEpisodeObservationAuthorization,
} from './identity-episode-production-observation-authorization';
import {
  IDENTITY_EPISODE_PRODUCTION_OBSERVATION_SQL,
  evaluateIdentityEpisodeProductionObservation,
  type IdentityEpisodeObservationAggregateRow,
  type IdentityEpisodeObservationIteration,
  type IdentityEpisodeProductionObservationResult,
} from './identity-episode-production-observation';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';
import { containsNormalizedKey } from './protected-json-document';

export interface IdentityEpisodeObservationCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type IdentityEpisodeObservationRunner = (
  args: string[],
) => IdentityEpisodeObservationCommandResult;

export type IdentityEpisodeObservationCommitVerifier = (
  commits: IdentityEpisodeObservationAuthorization['commits'],
  repositoryRoot: string,
) => boolean;

export interface CollectIdentityEpisodeProductionObservationOptions {
  authorizationPath: string;
  outputPath: string;
  repositoryRoot?: string;
  nowUtc?: string;
  runner?: IdentityEpisodeObservationRunner;
  commitVerifier?: IdentityEpisodeObservationCommitVerifier;
}

export interface IdentityEpisodeProductionObservationReceipt {
  schemaVersion: 1;
  schemaReady: boolean;
  schemaBlockerCount: number;
  evidenceReady: boolean;
  observationReady: boolean;
  promotionReady: false;
  providerCount: number;
  measuredIterationCount: number;
  issueCount: number;
  mappingBlockerCount: number;
  totalMissingMappingCount: number;
  p95DurationMs: number;
  maxDurationMs: number;
  aggregateOnly: true;
  networkRequestPerformed: true;
  productionMutationPerformed: false;
  rowsWritten: number;
}

export interface CollectIdentityEpisodeProductionObservationResult {
  receipt: IdentityEpisodeProductionObservationReceipt;
}

interface D1Envelope {
  success?: unknown;
  results?: unknown;
  meta?: {
    changed_db?: unknown;
    rows_written?: unknown;
    duration?: unknown;
  };
}

export const IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES = [
  'patients',
  'global_patient_identity',
  'canonical_tenant_patient_links',
  'doctors',
  'external_referring_doctors',
  'canonical_practitioners',
  'appointments',
  'consultations',
  'canonical_appointments',
  'encounters',
  'visits',
  'canonical_encounters',
  'admissions',
  'beds',
  'patient_bed_infos',
  'canonical_admissions',
  'canonical_beds',
  'canonical_bed_stays',
  'canonical_source_mappings',
  'canonical_processing_issues',
  'canonical_feature_flags',
] as const;

export const IDENTITY_EPISODE_PRODUCTION_SCHEMA_SQL = `SELECT name AS table_name FROM sqlite_schema WHERE type='table' AND name IN (${IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES.map((table) => `'${table}'`).join(',')}) ORDER BY name`;

const ROW_KEYS = new Set([
  'provider',
  'source_count',
  'mapped_source_count',
  'missing_mapping_count',
  'duplicate_active_mapping_count',
  'invalid_canonical_target_count',
  'cross_tenant_relationship_count',
  'unresolved_critical_issue_count',
  'enabled_flag_count',
  'canonical_mode_flag_count',
]);
const PROVIDERS = new Set([
  'patient_identity',
  'practitioner',
  'appointment',
  'encounter',
  'admission_bed',
]);
const EVIDENCE_SENSITIVE_KEYS = new Set([
  'header',
  'headers',
  'cookie',
  'cookies',
  'token',
  'password',
  'secret',
  'credential',
  'credentials',
  'rawoutput',
  'stderr',
  'stdout',
  'sql',
  'command',
  'path',
  'uuid',
  'sourceid',
  'canonicalid',
  'patientid',
  'practitionerid',
  'appointmentid',
  'encounterid',
  'admissionid',
  'bedid',
  'mobile',
  'phone',
  'email',
  'address',
  'diagnosis',
  'notes',
  'amount',
  'price',
]);

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: unknown, expected: ReadonlySet<string>): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validAggregateRows(value: unknown): value is IdentityEpisodeObservationAggregateRow[] {
  if (!Array.isArray(value) || value.length !== PROVIDERS.size) return false;
  const seen = new Set<string>();
  for (const row of value) {
    if (!exactKeys(row, ROW_KEYS) || typeof row.provider !== 'string' || !PROVIDERS.has(row.provider)) return false;
    if (seen.has(row.provider)) return false;
    seen.add(row.provider);
    if ([...ROW_KEYS].filter((key) => key !== 'provider').some((key) => !nonNegativeInteger(row[key]))) {
      return false;
    }
  }
  return seen.size === PROVIDERS.size;
}

function extractJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('production observation output is invalid');
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const starts = [trimmed.indexOf('['), trimmed.indexOf('{')].filter((index) => index >= 0).sort((a, b) => a - b);
    for (const start of starts) {
      try {
        return JSON.parse(trimmed.slice(start)) as unknown;
      } catch {
        // Continue to the next possible JSON document.
      }
    }
    throw new Error('production observation output is invalid');
  }
}

function defaultRunner(repositoryRoot: string): IdentityEpisodeObservationRunner {
  return (args) => {
    const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.status ?? 1,
    };
  };
}

function defaultCommitVerifier(
  commits: IdentityEpisodeObservationAuthorization['commits'],
  repositoryRoot: string,
): boolean {
  return Object.values(commits).every((commit) => {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    return result.status === 0;
  });
}

function relationInside(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

function validateEvidenceOutput(outputPath: string, repositoryRoot: string): string {
  const absolute = resolve(outputPath);
  const repository = realpathSync(repositoryRoot);
  if (relationInside(repository, absolute)) {
    throw new Error('observation evidence output is not protected');
  }
  if (existsSync(absolute)) throw new Error('observation evidence output already exists');

  try {
    const parent = dirname(absolute);
    const parentInfo = lstatSync(parent);
    realpathSync(parent);
    if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory() || (parentInfo.mode & 0o777) !== 0o700) {
      throw new Error('unsafe');
    }
  } catch {
    throw new Error('observation evidence output is not protected');
  }
  return absolute;
}

function assertReadOnlyCommand(args: string[]): void {
  const sql = args.at(-1);
  if (sql !== IDENTITY_EPISODE_PRODUCTION_SCHEMA_SQL
    && sql !== IDENTITY_EPISODE_PRODUCTION_OBSERVATION_SQL) {
    throw new Error('production observation command is not allowlisted');
  }
  const expected = [
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json',
    '--command', sql,
  ];
  if (args.length !== expected.length || args.some((value, index) => value !== expected[index])) {
    throw new Error('production observation command is not allowlisted');
  }
  if (args.includes('--yes') || args.includes('--file')) {
    throw new Error('production observation command is not allowlisted');
  }
  const normalized = sql.toLowerCase();
  if (!(normalized.trimStart().startsWith('with') || normalized.trimStart().startsWith('select'))
    || /\b(insert|update|delete|replace|alter|drop|create|pragma|attach|detach|vacuum)\b/.test(normalized)) {
    throw new Error('production observation command is not allowlisted');
  }
}

function runCommand(
  runner: IdentityEpisodeObservationRunner,
  args: string[],
): IdentityEpisodeObservationCommandResult {
  const result = runner(args);
  if (result.exitCode !== 0) throw new Error('production observation command failed');
  return result;
}

function parseSchemaEnvelope(stdout: string): string[] {
  const parsed = extractJson(stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
    throw new Error('production observation output is invalid');
  }
  const envelope = parsed[0] as D1Envelope;
  if (envelope.success !== true || !Array.isArray(envelope.results) || !isRecord(envelope.meta)) {
    throw new Error('production observation schema inventory is invalid');
  }
  if (envelope.meta.changed_db !== false
    || !nonNegativeInteger(envelope.meta.rows_written)
    || envelope.meta.rows_written !== 0) {
    throw new Error('production observation violated read-only boundary');
  }
  const tables: string[] = [];
  for (const row of envelope.results) {
    if (!exactKeys(row, new Set(['table_name']))
      || typeof row.table_name !== 'string'
      || !IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES.includes(
        row.table_name as typeof IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES[number],
      )
      || tables.includes(row.table_name)) {
      throw new Error('production observation schema inventory is invalid');
    }
    tables.push(row.table_name);
  }
  return tables;
}

function parseD1Envelope(stdout: string): IdentityEpisodeObservationIteration {
  const parsed = extractJson(stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
    throw new Error('production observation output is invalid');
  }
  const envelope = parsed[0] as D1Envelope;
  if (envelope.success !== true || !validAggregateRows(envelope.results) || !isRecord(envelope.meta)) {
    throw new Error('production observation aggregate is invalid');
  }
  const changedDb = envelope.meta.changed_db;
  const rowsWritten = envelope.meta.rows_written;
  const duration = envelope.meta.duration;
  if (changedDb !== false || !nonNegativeInteger(rowsWritten) || rowsWritten !== 0) {
    throw new Error('production observation violated read-only boundary');
  }
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    throw new Error('production observation output is invalid');
  }
  return {
    rows: envelope.results.map((row) => ({ ...row })),
    durationMs: duration,
    changedDb: false,
    rowsWritten: 0,
  };
}

interface IdentityEpisodeProductionSchemaEvidence {
  requiredTableCount: number;
  presentTableCount: number;
  missingTables: string[];
}

function writeProtectedEvidence(
  outputPath: string,
  authorization: IdentityEpisodeObservationAuthorization,
  observedAtUtc: string,
  schema: IdentityEpisodeProductionSchemaEvidence,
  iterations: IdentityEpisodeObservationIteration[],
  result: IdentityEpisodeProductionObservationResult | null,
  receipt: IdentityEpisodeProductionObservationReceipt,
): void {
  const finalRows = iterations.at(-1)?.rows ?? [];
  const evidenceBody = {
    schemaVersion: 1,
    authorizationSha256: sha256(authorization),
    databaseIdentitySha256: sha256({
      name: CDB101_PRODUCTION_DATABASE_NAME,
      uuid: CDB101_PRODUCTION_DATABASE_ID,
    }),
    commitBindings: { ...authorization.commits },
    observedAtUtc,
    schema,
    providerAggregates: finalRows.map((row) => ({ ...row })),
    measuredDurationsMs: iterations.map((iteration) => iteration.durationMs),
    result,
    receipt,
    aggregateOnly: true,
    productionMutationPerformed: false,
    safety: {
      providerFlagChanged: false,
      routeChanged: false,
      trafficChanged: false,
      deploymentPerformed: false,
      migrationApplied: false,
      backfillApplied: false,
      localSyncActivated: false,
      legacyReaderRetired: false,
      legacyWriterRetired: false,
    },
  };
  if (containsNormalizedKey(evidenceBody, EVIDENCE_SENSITIVE_KEYS)) {
    throw new Error('production observation evidence contains forbidden fields');
  }
  const evidence = {
    ...evidenceBody,
    evidenceSha256: sha256(evidenceBody),
  };
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(outputPath, 0o600);
}

function buildReceipt(
  result: IdentityEpisodeProductionObservationResult,
): IdentityEpisodeProductionObservationReceipt {
  return {
    schemaVersion: 1,
    schemaReady: true,
    schemaBlockerCount: 0,
    evidenceReady: result.evidenceReady,
    observationReady: result.observationReady,
    promotionReady: false,
    providerCount: result.providerCount,
    measuredIterationCount: result.measuredIterationCount,
    issueCount: result.issues.length,
    mappingBlockerCount: result.mappingBlockerCount,
    totalMissingMappingCount: result.totalMissingMappingCount,
    p95DurationMs: result.p95DurationMs,
    maxDurationMs: result.maxDurationMs,
    aggregateOnly: true,
    networkRequestPerformed: true,
    productionMutationPerformed: false,
    rowsWritten: result.rowsWritten,
  };
}

function buildSchemaBlockedReceipt(
  schemaBlockerCount: number,
): IdentityEpisodeProductionObservationReceipt {
  return {
    schemaVersion: 1,
    schemaReady: false,
    schemaBlockerCount,
    evidenceReady: true,
    observationReady: false,
    promotionReady: false,
    providerCount: 0,
    measuredIterationCount: 0,
    issueCount: 1,
    mappingBlockerCount: 0,
    totalMissingMappingCount: 0,
    p95DurationMs: 0,
    maxDurationMs: 0,
    aggregateOnly: true,
    networkRequestPerformed: true,
    productionMutationPerformed: false,
    rowsWritten: 0,
  };
}

export function collectIdentityEpisodeProductionObservation(
  options: CollectIdentityEpisodeProductionObservationOptions,
): CollectIdentityEpisodeProductionObservationResult {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const nowUtc = options.nowUtc ?? new Date().toISOString();
  const loaded = loadIdentityEpisodeObservationAuthorization(
    options.authorizationPath,
    repositoryRoot,
    nowUtc,
  );
  if (!loaded.executionReady || !loaded.authorization) {
    throw new Error('observation authorization is not execution-ready');
  }
  const output = validateEvidenceOutput(options.outputPath, repositoryRoot);
  const commitVerifier = options.commitVerifier ?? defaultCommitVerifier;
  if (!commitVerifier(loaded.authorization.commits, repositoryRoot)) {
    throw new Error('observation commit binding is not present');
  }

  const runner = options.runner ?? defaultRunner(repositoryRoot);
  const identityResult = runCommand(runner, [
    'd1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json',
  ]);
  const identity = extractJson(identityResult.stdout);
  if (!isRecord(identity)
    || identity.name !== CDB101_PRODUCTION_DATABASE_NAME
    || identity.uuid !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('production D1 identity mismatch');
  }

  const schemaArgs = [
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json',
    '--command', IDENTITY_EPISODE_PRODUCTION_SCHEMA_SQL,
  ];
  assertReadOnlyCommand(schemaArgs);
  const presentTables = parseSchemaEnvelope(runCommand(runner, schemaArgs).stdout);
  const missingTables = IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES
    .filter((table) => !presentTables.includes(table));
  const schema = {
    requiredTableCount: IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES.length,
    presentTableCount: presentTables.length,
    missingTables,
  };
  if (missingTables.length > 0) {
    const receipt = buildSchemaBlockedReceipt(missingTables.length);
    writeProtectedEvidence(
      output,
      loaded.authorization,
      nowUtc,
      schema,
      [],
      null,
      receipt,
    );
    return { receipt };
  }

  const executeArgs = [
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json',
    '--command', IDENTITY_EPISODE_PRODUCTION_OBSERVATION_SQL,
  ];
  assertReadOnlyCommand(executeArgs);

  parseD1Envelope(runCommand(runner, executeArgs).stdout);
  const iterations: IdentityEpisodeObservationIteration[] = [];
  for (let index = 0; index < loaded.authorization.thresholds.measuredIterations; index += 1) {
    iterations.push(parseD1Envelope(runCommand(runner, executeArgs).stdout));
  }

  const result = evaluateIdentityEpisodeProductionObservation({
    authorization: loaded.authorization,
    observedAtUtc: nowUtc,
    iterations,
  });
  const receipt = buildReceipt(result);
  writeProtectedEvidence(
    output,
    loaded.authorization,
    nowUtc,
    schema,
    iterations,
    result,
    receipt,
  );
  return { receipt };
}

export function parseIdentityEpisodeProductionObservationArgs(args: string[]): {
  authorizationPath: string;
  outputPath: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--') continue;
    if (key !== '--authorization' && key !== '--output') {
      throw new Error('unsupported CLI argument');
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('required CLI arguments are missing');
    if (values.has(key)) throw new Error('unsupported CLI argument');
    values.set(key, value);
    index += 1;
  }
  const authorizationPath = values.get('--authorization');
  const outputPath = values.get('--output');
  if (!authorizationPath || !outputPath) throw new Error('required CLI arguments are missing');
  return { authorizationPath, outputPath };
}

function main(): void {
  try {
    const args = parseIdentityEpisodeProductionObservationArgs(process.argv.slice(2));
    const result = collectIdentityEpisodeProductionObservation(args);
    process.stdout.write(`${JSON.stringify(result.receipt, null, 2)}\n`);
    if (!result.receipt.evidenceReady) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'production observation failed'}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
