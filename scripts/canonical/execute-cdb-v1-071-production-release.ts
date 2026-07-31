import { chmodSync, existsSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  backfillTenantPatientLinks,
  type PatientLinkBackfillDatabase,
  type TenantPatientLinkBackfillCounts,
  type TenantPatientLinkBackfillInput,
  type TenantPatientLinkBackfillResult,
} from './backfill-tenant-patient-links';
import {
  backfillPractitioners,
  type PractitionerBackfillDatabase,
  type PractitionerBackfillOptions,
  type PractitionerBackfillResult,
} from './backfill-practitioners';
import {
  backfillAppointments,
  type AppointmentBackfillDatabase,
  type AppointmentBackfillOptions,
  type AppointmentBackfillResult,
} from './backfill-appointments';
import {
  backfillEncounterAdmissionBedConvergence,
  type EncounterAdmissionBedBackfillDatabase,
  type EncounterAdmissionBedBackfillOptions,
  type EncounterAdmissionBedBackfillResult,
} from './backfill-encounter-admission-bed-convergence';
import {
  CDB_V1_071_CANDIDATE_SHA,
  CDB_V1_071_DATABASE_NAME,
  CDB_V1_071_DATABASE_UUID,
  CDB_V1_071_TENANT_IDS,
  prepareProtectedCdbV1071Authorization,
} from './cdb-v1-071-production-release-authorization';
import {
  createCdbV1071CloudflareD1Database,
} from './cdb-v1-071-cloudflare-d1-adapter';
import type {
  CdbV1071WranglerD1Database,
} from './cdb-v1-071-wrangler-d1-adapter';

export interface CdbV1071BackfillOperations {
  patientLinks(
    db: PatientLinkBackfillDatabase,
    input: TenantPatientLinkBackfillInput,
  ): Promise<TenantPatientLinkBackfillResult>;
  practitioners(
    db: PractitionerBackfillDatabase,
    input: PractitionerBackfillOptions,
  ): Promise<PractitionerBackfillResult>;
  appointments(
    db: AppointmentBackfillDatabase,
    input: AppointmentBackfillOptions,
  ): Promise<AppointmentBackfillResult>;
  encounterAdmissionBed(
    db: EncounterAdmissionBedBackfillDatabase,
    input: EncounterAdmissionBedBackfillOptions,
  ): Promise<EncounterAdmissionBedBackfillResult>;
}

const DEFAULT_OPERATIONS: CdbV1071BackfillOperations = {
  patientLinks: backfillTenantPatientLinks,
  practitioners: backfillPractitioners,
  appointments: backfillAppointments,
  encounterAdmissionBed: backfillEncounterAdmissionBedConvergence,
};

export interface CdbV1071PatientLinkResumeState {
  runStatus: 'succeeded';
  checkpointStatus: 'paused' | 'completed';
  cursorLegacyPatientId: number | null;
  counts: TenantPatientLinkBackfillCounts;
}

export interface CdbV1071BackfillResumeReader {
  patientLinkChunk(
    db: CdbV1071WranglerD1Database,
    tenantId: string,
    runPublicId: string,
  ): Promise<CdbV1071PatientLinkResumeState | null>;
}

interface PatientLinkResumeRow {
  run_status: unknown;
  result_summary_json: unknown;
  checkpoint_status: unknown;
  cursor_value: unknown;
}

const PATIENT_LINK_COUNT_KEYS = [
  'scanned',
  'created',
  'skipped',
  'verified',
  'candidate',
  'unlinked',
  'events',
  'mappings',
  'issues',
] as const;

function patientLinkCounts(value: unknown): TenantPatientLinkBackfillCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('patient-link resume summary is invalid');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...PATIENT_LINK_COUNT_KEYS].sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('patient-link resume summary fields are invalid');
  }
  for (const key of PATIENT_LINK_COUNT_KEYS) {
    if (!Number.isSafeInteger(record[key]) || Number(record[key]) < 0) {
      throw new Error(`patient-link resume count is invalid: ${key}`);
    }
  }
  return record as unknown as TenantPatientLinkBackfillCounts;
}

export async function readCdbV1071PatientLinkResumeState(
  db: CdbV1071WranglerD1Database,
  tenantId: string,
  runPublicId: string,
): Promise<CdbV1071PatientLinkResumeState | null> {
  const rows = (await db.prepare(`
    SELECT
      r.status AS run_status,
      r.result_summary_json,
      c.status AS checkpoint_status,
      c.cursor_value
    FROM canonical_migration_runs r
    LEFT JOIN canonical_backfill_checkpoints c
      ON c.tenant_id=r.tenant_id
     AND c.migration_run_id=r.id
     AND c.entity_type='patient_link'
     AND c.source_type='legacy_patient'
    WHERE r.tenant_id=? AND r.run_public_id=?
    ORDER BY c.id
    LIMIT 2
  `).bind(tenantId, runPublicId).all<PatientLinkResumeRow>()).results;
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error(`patient-link resume checkpoint is not exact for tenant ${tenantId}`);
  const row = rows[0];
  if (row.run_status !== 'succeeded') {
    throw new Error(`patient-link resume run is not succeeded for tenant ${tenantId}`);
  }
  if (row.checkpoint_status == null) {
    throw new Error(`patient-link resume checkpoint is missing for tenant ${tenantId}`);
  }
  if (row.checkpoint_status !== 'paused' && row.checkpoint_status !== 'completed') {
    throw new Error(`patient-link resume checkpoint status is invalid for tenant ${tenantId}`);
  }
  if (typeof row.result_summary_json !== 'string') {
    throw new Error(`patient-link resume summary is missing for tenant ${tenantId}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.result_summary_json) as unknown;
  } catch {
    throw new Error(`patient-link resume summary JSON is invalid for tenant ${tenantId}`);
  }
  const cursor = row.cursor_value == null ? null : Number(row.cursor_value);
  if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0)) {
    throw new Error(`patient-link resume cursor is invalid for tenant ${tenantId}`);
  }
  if (row.checkpoint_status === 'paused' && cursor === null) {
    throw new Error(`patient-link paused checkpoint has no cursor for tenant ${tenantId}`);
  }
  return {
    runStatus: 'succeeded',
    checkpointStatus: row.checkpoint_status,
    cursorLegacyPatientId: cursor,
    counts: patientLinkCounts(parsed),
  };
}

const DEFAULT_RESUME_READER: CdbV1071BackfillResumeReader = {
  patientLinkChunk: readCdbV1071PatientLinkResumeState,
};

export interface CdbV1071BackfillEntry {
  tenantId: string;
  pass: 'pass1' | 'pass2';
  kind: 'patient-links' | 'practitioners' | 'appointments' | 'encounter-admission-bed';
  iterations: number;
  scanned: number;
  created: number;
  issues: number;
}

export interface CdbV1071BackfillSummary {
  checkpoint: 'CDB-V1-071-PRODUCTION-BACKFILLS-COMPLETED';
  candidateCommit: typeof CDB_V1_071_CANDIDATE_SHA;
  productionDatabase: {
    name: typeof CDB_V1_071_DATABASE_NAME;
    uuid: typeof CDB_V1_071_DATABASE_UUID;
  };
  tenants: string[];
  partitionLimit: 100;
  secondPassRequired: true;
  secondPassNewBusinessRows: number;
  entries: CdbV1071BackfillEntry[];
  productionMutationPerformed: true;
}

const MAX_ITERATIONS = 10_000;

function runId(pass: 'pass1' | 'pass2', tenantId: string, kind: string, suffix = ''): string {
  return `cdbv1071-${pass}-${tenantId}-${kind}${suffix}`;
}

function addEntry(
  entries: CdbV1071BackfillEntry[],
  value: CdbV1071BackfillEntry,
): number {
  entries.push(value);
  return value.created;
}

async function runPatientLinks(
  db: CdbV1071WranglerD1Database,
  operations: CdbV1071BackfillOperations,
  resumeReader: CdbV1071BackfillResumeReader,
  tenantId: string,
  pass: 'pass1' | 'pass2',
  nowUtc: string,
  entries: CdbV1071BackfillEntry[],
): Promise<number> {
  let cursor = 0;
  let iterations = 0;
  let scanned = 0;
  let created = 0;
  let issues = 0;
  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    const runPublicId = runId(pass, tenantId, 'patient-links', `-${iterations}`);
    const existing = await resumeReader.patientLinkChunk(db, tenantId, runPublicId);
    const result = existing
      ? {
        completed: existing.checkpointStatus === 'completed',
        nextCursorLegacyPatientId: existing.cursorLegacyPatientId,
        counts: existing.counts,
      }
      : await operations.patientLinks(db, {
        tenantId,
        runPublicId,
        nowUtc,
        chunkSize: 100,
        afterLegacyPatientId: cursor,
      });
    scanned += result.counts.scanned;
    created += result.counts.created;
    issues += result.counts.issues;
    if (result.counts.candidate > 0 || result.counts.issues > 0) {
      throw new Error(`tenant ${tenantId} patient-link backfill reported ambiguity or issues`);
    }
    if (result.completed) {
      return addEntry(entries, {
        tenantId,
        pass,
        kind: 'patient-links',
        iterations,
        scanned,
        created,
        issues,
      });
    }
    const next = result.nextCursorLegacyPatientId;
    if (!Number.isSafeInteger(next) || next === null || next <= cursor) {
      throw new Error(`tenant ${tenantId} patient-link backfill cursor did not advance`);
    }
    cursor = next;
  }
  throw new Error(`tenant ${tenantId} patient-link backfill exceeded iteration limit`);
}

async function runPractitioners(
  db: CdbV1071WranglerD1Database,
  operations: CdbV1071BackfillOperations,
  tenantId: string,
  pass: 'pass1' | 'pass2',
  nowUtc: string,
  entries: CdbV1071BackfillEntry[],
): Promise<number> {
  let iterations = 0;
  let scanned = 0;
  let created = 0;
  let issues = 0;
  const runPublicId = runId(pass, tenantId, 'practitioners');
  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    const result = await operations.practitioners(db, {
      tenantId,
      runPublicId,
      nowUtc,
      maxSourceRecords: 100,
    });
    scanned += result.counts.scanned;
    created += result.counts.created;
    issues += result.counts.issues;
    if (result.counts.ambiguous > 0 || result.counts.issues > 0) {
      throw new Error(`tenant ${tenantId} practitioner backfill reported ambiguity or issues`);
    }
    if (result.completed) {
      return addEntry(entries, {
        tenantId,
        pass,
        kind: 'practitioners',
        iterations,
        scanned,
        created,
        issues,
      });
    }
  }
  throw new Error(`tenant ${tenantId} practitioner backfill exceeded iteration limit`);
}

async function runAppointments(
  db: CdbV1071WranglerD1Database,
  operations: CdbV1071BackfillOperations,
  tenantId: string,
  pass: 'pass1' | 'pass2',
  nowUtc: string,
  entries: CdbV1071BackfillEntry[],
): Promise<number> {
  let iterations = 0;
  let scanned = 0;
  let created = 0;
  let issues = 0;
  const runPublicId = runId(pass, tenantId, 'appointments');
  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    const result = await operations.appointments(db, {
      tenantId,
      runPublicId,
      timezone: 'Asia/Dhaka',
      nowUtc,
      maxSourceRecords: 100,
    });
    scanned += result.counts.scanned;
    created += result.counts.created;
    issues += result.counts.issues;
    if (result.counts.issues > 0) {
      throw new Error(`tenant ${tenantId} appointment backfill reported issues`);
    }
    if (result.completed) {
      return addEntry(entries, {
        tenantId,
        pass,
        kind: 'appointments',
        iterations,
        scanned,
        created,
        issues,
      });
    }
  }
  throw new Error(`tenant ${tenantId} appointment backfill exceeded iteration limit`);
}

async function runEncounterAdmissionBed(
  db: CdbV1071WranglerD1Database,
  operations: CdbV1071BackfillOperations,
  tenantId: string,
  pass: 'pass1' | 'pass2',
  nowUtc: string,
  entries: CdbV1071BackfillEntry[],
): Promise<number> {
  let iterations = 0;
  let scanned = 0;
  let created = 0;
  let issues = 0;
  const runPublicId = runId(pass, tenantId, 'encounter-admission-bed');
  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    const result = await operations.encounterAdmissionBed(db, {
      tenantId,
      runPublicId,
      timezone: 'Asia/Dhaka',
      nowUtc,
      maxSourceRecords: 100,
    });
    scanned += result.counts.scanned;
    created += result.counts.created;
    issues += result.counts.issues;
    if (result.counts.issues > 0 || result.counts.issuesCreated > 0) {
      throw new Error(`tenant ${tenantId} encounter/admission/bed backfill reported issues`);
    }
    if (result.completed) {
      return addEntry(entries, {
        tenantId,
        pass,
        kind: 'encounter-admission-bed',
        iterations,
        scanned,
        created,
        issues,
      });
    }
  }
  throw new Error(`tenant ${tenantId} encounter/admission/bed backfill exceeded iteration limit`);
}

export async function runCdbV1071AuthorizedBackfills(
  db: CdbV1071WranglerD1Database,
  nowUtc: string,
  operations: CdbV1071BackfillOperations = DEFAULT_OPERATIONS,
  resumeReader: CdbV1071BackfillResumeReader = DEFAULT_RESUME_READER,
): Promise<CdbV1071BackfillSummary> {
  if (new Date(nowUtc).toISOString() !== nowUtc) throw new Error('nowUtc must be normalized UTC');
  const entries: CdbV1071BackfillEntry[] = [];
  let secondPassNewBusinessRows = 0;
  for (const pass of ['pass1', 'pass2'] as const) {
    for (const tenantId of CDB_V1_071_TENANT_IDS) {
      const created = [
        await runPatientLinks(db, operations, resumeReader, tenantId, pass, nowUtc, entries),
        await runPractitioners(db, operations, tenantId, pass, nowUtc, entries),
        await runAppointments(db, operations, tenantId, pass, nowUtc, entries),
        await runEncounterAdmissionBed(db, operations, tenantId, pass, nowUtc, entries),
      ].reduce((sum, value) => sum + value, 0);
      if (pass === 'pass2') {
        secondPassNewBusinessRows += created;
        if (created !== 0) {
          throw new Error(`tenant ${tenantId} second pass created new business rows`);
        }
      }
    }
  }
  return {
    checkpoint: 'CDB-V1-071-PRODUCTION-BACKFILLS-COMPLETED',
    candidateCommit: CDB_V1_071_CANDIDATE_SHA,
    productionDatabase: {
      name: CDB_V1_071_DATABASE_NAME,
      uuid: CDB_V1_071_DATABASE_UUID,
    },
    tenants: [...CDB_V1_071_TENANT_IDS],
    partitionLimit: 100,
    secondPassRequired: true,
    secondPassNewBusinessRows,
    entries,
    productionMutationPerformed: true,
  };
}

function outsideRepository(path: string, root: string): string {
  const absolute = resolve(path);
  const repository = resolve(root);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Evidence path must remain outside the repository');
  }
  return absolute;
}

function requireProtectedDirectory(path: string, root: string): string {
  const absolute = outsideRepository(path, root);
  if (!existsSync(absolute)) throw new Error(`Protected evidence directory missing: ${absolute}`);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
    throw new Error('Protected evidence directory must be a non-symlink mode-700 directory');
  }
  return absolute;
}

interface CliOptions {
  authorizationPath: string;
  evidenceDir: string;
  phase: 'backfill';
  execute: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const filtered = args.filter((arg) => arg !== '--');
  let authorizationPath = '';
  let evidenceDir = '';
  let phase = '';
  let execute = false;
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index];
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--authorization' || arg === '--evidence-dir' || arg === '--phase') {
      const value = filtered[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--authorization') authorizationPath = value;
      else if (arg === '--evidence-dir') evidenceDir = value;
      else phase = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!authorizationPath || !evidenceDir || phase !== 'backfill') {
    throw new Error('--authorization, --evidence-dir, and --phase backfill are required');
  }
  return { authorizationPath, evidenceDir, phase: 'backfill', execute };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const checkedAtUtc = new Date().toISOString();
  const prepared = prepareProtectedCdbV1071Authorization(
    options.authorizationPath,
    process.cwd(),
    checkedAtUtc,
  );
  if (!prepared.receipt.executionReady || !prepared.authorization) {
    process.stdout.write(`${JSON.stringify(prepared.receipt, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  if (!options.execute) throw new Error('--execute is required for production backfills');
  if (process.env.CDB_V1_071_BACKFILL_PROOF !== prepared.authorization.confirmation.backfillProof) {
    throw new Error('CDB_V1_071_BACKFILL_PROOF does not match the protected authorization');
  }
  const evidenceDir = requireProtectedDirectory(options.evidenceDir, process.cwd());
  const output = resolve(evidenceDir, `cdb-v1-071-backfill-${checkedAtUtc.replaceAll(':', '').replaceAll('.', '')}.json`);
  if (existsSync(output)) throw new Error('Backfill evidence output already exists');

  const summary = await runCdbV1071AuthorizedBackfills(
    createCdbV1071CloudflareD1Database(),
    checkedAtUtc,
  );
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1,
    authorizationId: prepared.authorization.authorizationId,
    executedAtUtc: checkedAtUtc,
    summary,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(output, 0o600);
  if (dirname(output) !== evidenceDir) throw new Error('Evidence output escaped protected directory');
  process.stdout.write(`${JSON.stringify({ output, summary }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
