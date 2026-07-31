import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';
import { loadProtectedJsonDocument } from './protected-json-document';

const ARCHIVAL_TABLE = 'doctor_commission_accruals_old_0391' as const;
const REMOVAL_PHASE = 'legacy_retirement_p11' as const;

interface ArchivalGroup {
  childTable: typeof ARCHIVAL_TABLE;
  parentTable: 'bills' | 'visits';
  violationCount: 26 | 15;
}

interface ApprovalDocument {
  schemaVersion: 1;
  approvalId: string;
  approved: true;
  ownerId: string;
  approvedAtUtc: string;
  program: 'CDB-101';
  domain: 'reporting';
  scope: 'archival_fk_only';
  prerequisiteCandidateSha256: string;
  groups: ArchivalGroup[];
  removalPhase: typeof REMOVAL_PHASE;
  source: 'user_explicit_production_authorization';
}

interface CandidateDocument {
  schemaVersion: 1;
  program: 'CDB-101';
  domain: 'reporting';
  capturedAtUtc: string;
  productionDatabase: {
    name: typeof CDB101_PRODUCTION_DATABASE_NAME;
    id: typeof CDB101_PRODUCTION_DATABASE_ID;
  };
  archivalTable: typeof ARCHIVAL_TABLE;
  productionEvidence: {
    billsViolationCount: 26;
    visitsViolationCount: 15;
    totalArchivalViolationCount: 41;
    triggerCount: 0;
    dependentObjectCount: 0;
    changedDb: false;
    rowsWritten: 0;
  };
  repositoryEvidence: {
    runtimeSourceReferenceCount: 0;
    excludedFromCanonicalImport: true;
    excludedFromReporting: true;
  };
  attestations: {
    archivalTableConfirmed: true;
    activeWriterDisabledConfirmed: true;
    excludedFromCanonicalImportConfirmed: true;
    excludedFromReportingConfirmed: true;
    removalPhase: typeof REMOVAL_PHASE;
  };
  formalApproval: {
    approved: false;
    ownerId: null;
    approvedAtUtc: null;
    evidenceId: null;
    evidenceSha256: null;
  };
  aggregateOnly: true;
  productionMutationPerformed: false;
}

export interface PreparedArchivalWaiverRecord {
  childTable: typeof ARCHIVAL_TABLE;
  parentTable: 'bills' | 'visits';
  initialViolationCount: 26 | 15;
  disposition: 'formal_waiver';
  approved: true;
  ownerId: string;
  approvedAtUtc: string;
  evidenceId: string;
  evidenceSha256: string;
  waiverScope: 'archival_fk_only';
  archivalTableConfirmed: true;
  activeWriterDisabledConfirmed: true;
  excludedFromCanonicalImportConfirmed: true;
  excludedFromReportingConfirmed: true;
  removalPhase: typeof REMOVAL_PHASE;
  remainingViolationCount: 26 | 15;
  repairedViolationCount: 0;
  waivedViolationCount: 26 | 15;
}

export interface ReportingArchivalFkWaiverPackage {
  schemaVersion: 1;
  program: 'CDB-101';
  domain: 'reporting';
  preparedAtUtc: string;
  productionDatabase: {
    name: typeof CDB101_PRODUCTION_DATABASE_NAME;
    id: typeof CDB101_PRODUCTION_DATABASE_ID;
  };
  candidateSha256: string;
  approvalId: string;
  approvalSha256: string;
  ownerId: string;
  approvedAtUtc: string;
  waivers: PreparedArchivalWaiverRecord[];
  totalWaivedViolationCount: 41;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
}

export interface ReportingArchivalFkWaiverReceipt {
  schemaVersion: 1;
  waiverPackageReady: true;
  waiverCount: 2;
  waivedViolationCount: 41;
  ownerId: string;
  formalApprovalRecorded: true;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
}

export interface PrepareReportingArchivalFkWaiversOptions {
  candidatePath: string;
  approvalPath: string;
  outputPath: string;
  repositoryRoot?: string;
  preparedAtUtc?: string;
}

export interface ReportingArchivalFkWaiverCliOptions {
  candidatePath: string;
  approvalPath: string;
  outputPath: string;
  preparedAtUtc?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function absoluteUtc(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an absolute UTC timestamp`);
  }
  return new Date(value).toISOString();
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_:\-]{2,127}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sha256Value(value: unknown): string {
  return sha256Text(JSON.stringify(stableValue(value)));
}

function exactGroups(value: unknown): ArchivalGroup[] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('Owner approval must contain the exact two archival FK groups');
  }
  const normalized = value.map((item) => {
    if (!isRecord(item) || item.childTable !== ARCHIVAL_TABLE) {
      throw new Error('Owner approval must contain the exact two archival FK groups');
    }
    if (item.parentTable === 'bills' && item.violationCount === 26) {
      return { childTable: ARCHIVAL_TABLE, parentTable: 'bills', violationCount: 26 } as const;
    }
    if (item.parentTable === 'visits' && item.violationCount === 15) {
      return { childTable: ARCHIVAL_TABLE, parentTable: 'visits', violationCount: 15 } as const;
    }
    throw new Error('Owner approval must contain the exact two archival FK groups');
  }).sort((left, right) => left.parentTable.localeCompare(right.parentTable));
  if (normalized[0]?.parentTable !== 'bills' || normalized[1]?.parentTable !== 'visits') {
    throw new Error('Owner approval must contain the exact two archival FK groups');
  }
  return normalized;
}

function parseCandidate(value: unknown): CandidateDocument {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.program !== 'CDB-101'
    || value.domain !== 'reporting'
    || value.archivalTable !== ARCHIVAL_TABLE
    || value.aggregateOnly !== true
    || value.productionMutationPerformed !== false
    || !isRecord(value.productionDatabase)
    || value.productionDatabase.name !== CDB101_PRODUCTION_DATABASE_NAME
    || value.productionDatabase.id !== CDB101_PRODUCTION_DATABASE_ID
    || !isRecord(value.productionEvidence)
    || value.productionEvidence.billsViolationCount !== 26
    || value.productionEvidence.visitsViolationCount !== 15
    || value.productionEvidence.totalArchivalViolationCount !== 41
    || value.productionEvidence.triggerCount !== 0
    || value.productionEvidence.dependentObjectCount !== 0
    || value.productionEvidence.changedDb !== false
    || value.productionEvidence.rowsWritten !== 0
    || !isRecord(value.repositoryEvidence)
    || value.repositoryEvidence.runtimeSourceReferenceCount !== 0
    || value.repositoryEvidence.excludedFromCanonicalImport !== true
    || value.repositoryEvidence.excludedFromReporting !== true
    || !isRecord(value.attestations)
    || value.attestations.archivalTableConfirmed !== true
    || value.attestations.activeWriterDisabledConfirmed !== true
    || value.attestations.excludedFromCanonicalImportConfirmed !== true
    || value.attestations.excludedFromReportingConfirmed !== true
    || value.attestations.removalPhase !== REMOVAL_PHASE
    || !isRecord(value.formalApproval)
    || value.formalApproval.approved !== false) {
    throw new Error('Protected archival prerequisite candidate is invalid');
  }
  absoluteUtc(value.capturedAtUtc, 'Prerequisite capture time');
  return value as unknown as CandidateDocument;
}

function parseApproval(value: unknown): ApprovalDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.program !== 'CDB-101' || value.domain !== 'reporting') {
    throw new Error('Owner approval document is invalid');
  }
  if (value.approved !== true) throw new Error('Owner approval is required');
  if (value.scope !== 'archival_fk_only') throw new Error('Owner approval must use archival-only scope');
  if (!isSha256(value.prerequisiteCandidateSha256)) {
    throw new Error('Owner approval prerequisite candidate SHA-256 is invalid');
  }
  if (value.removalPhase !== REMOVAL_PHASE) throw new Error('Owner approval removal phase is invalid');
  if (value.source !== 'user_explicit_production_authorization') {
    throw new Error('Owner approval source is invalid');
  }
  safeIdentifier(value.approvalId, 'Approval ID');
  safeIdentifier(value.ownerId, 'Owner ID');
  absoluteUtc(value.approvedAtUtc, 'Approval time');
  exactGroups(value.groups);
  return value as unknown as ApprovalDocument;
}

function loadProtected(path: string, repositoryRoot: string, label: string): {
  value: unknown;
  raw: string;
} {
  const loaded = loadProtectedJsonDocument(path, repositoryRoot, {
    maxBytes: 64 * 1024,
    maxDepth: 32,
  });
  if (!loaded.ready) {
    throw new Error(`${label} is unavailable: ${loaded.issues.map((issue) => issue.code).join(',')}`);
  }
  return { value: loaded.value, raw: readFileSync(resolve(path), 'utf8') };
}

function prepareOutputPath(outputPath: string, repositoryRoot: string): string {
  const absolute = resolve(outputPath);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Archival FK waiver output must remain outside the repository');
  }
  const parent = lstatSync(dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error('Archival FK waiver output parent directory must use mode 700');
  }
  return absolute;
}

export function prepareReportingArchivalFkWaivers(
  options: PrepareReportingArchivalFkWaiversOptions,
): { package: ReportingArchivalFkWaiverPackage; receipt: ReportingArchivalFkWaiverReceipt } {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const candidateDocument = loadProtected(options.candidatePath, repositoryRoot, 'Prerequisite candidate');
  const approvalDocument = loadProtected(options.approvalPath, repositoryRoot, 'Owner approval');
  const candidate = parseCandidate(candidateDocument.value);
  const approval = parseApproval(approvalDocument.value);

  const candidateCapturedAtUtc = absoluteUtc(candidate.capturedAtUtc, 'Prerequisite capture time');
  const approvedAtUtc = absoluteUtc(approval.approvedAtUtc, 'Approval time');
  const preparedAtUtc = absoluteUtc(
    options.preparedAtUtc ?? new Date().toISOString(),
    'Prepared time',
  );
  if (Date.parse(approvedAtUtc) < Date.parse(candidateCapturedAtUtc)) {
    throw new Error('Owner approval must occur after prerequisite capture');
  }
  if (Date.parse(preparedAtUtc) < Date.parse(approvedAtUtc)) {
    throw new Error('Waiver package cannot be prepared before owner approval');
  }

  const candidateSha256 = sha256Text(candidateDocument.raw);
  if (approval.prerequisiteCandidateSha256 !== candidateSha256) {
    throw new Error('Owner approval prerequisite candidate SHA-256 does not match the protected candidate');
  }
  const approvalSha256 = sha256Text(approvalDocument.raw);
  const groups = exactGroups(approval.groups);
  const waivers: PreparedArchivalWaiverRecord[] = groups.map((group) => {
    const evidenceSeed = {
      candidateSha256,
      approvalId: approval.approvalId,
      approvalSha256,
      ownerId: approval.ownerId,
      approvedAtUtc,
      group,
      removalPhase: REMOVAL_PHASE,
    };
    const evidenceSha256 = sha256Value(evidenceSeed);
    const evidenceId = `cdb101-archival-waiver-${group.parentTable}-${evidenceSha256.slice(0, 16)}`;
    return {
      childTable: ARCHIVAL_TABLE,
      parentTable: group.parentTable,
      initialViolationCount: group.violationCount,
      disposition: 'formal_waiver',
      approved: true,
      ownerId: approval.ownerId,
      approvedAtUtc,
      evidenceId,
      evidenceSha256,
      waiverScope: 'archival_fk_only',
      archivalTableConfirmed: true,
      activeWriterDisabledConfirmed: true,
      excludedFromCanonicalImportConfirmed: true,
      excludedFromReportingConfirmed: true,
      removalPhase: REMOVAL_PHASE,
      remainingViolationCount: group.violationCount,
      repairedViolationCount: 0,
      waivedViolationCount: group.violationCount,
    };
  });

  const waiverPackage: ReportingArchivalFkWaiverPackage = {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    preparedAtUtc,
    productionDatabase: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    candidateSha256,
    approvalId: approval.approvalId,
    approvalSha256,
    ownerId: approval.ownerId,
    approvedAtUtc,
    waivers,
    totalWaivedViolationCount: 41,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  };

  const output = prepareOutputPath(options.outputPath, repositoryRoot);
  writeFileSync(output, `${JSON.stringify(waiverPackage, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(output, 0o600);

  return {
    package: waiverPackage,
    receipt: {
      schemaVersion: 1,
      waiverPackageReady: true,
      waiverCount: 2,
      waivedViolationCount: 41,
      ownerId: approval.ownerId,
      formalApprovalRecorded: true,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
      externalCommandPerformed: false,
    },
  };
}

export function parseReportingArchivalFkWaiverArgs(
  args: string[],
): ReportingArchivalFkWaiverCliOptions {
  const allowed = new Set(['--candidate', '--approval', '--output', '--prepared-at-utc']);
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
  for (const required of ['--candidate', '--approval', '--output']) {
    if (!values[required]) throw new Error(`${required} is required`);
  }
  return {
    candidatePath: values['--candidate'],
    approvalPath: values['--approval'],
    outputPath: values['--output'],
    preparedAtUtc: values['--prepared-at-utc'],
  };
}

function main(): void {
  try {
    const options = parseReportingArchivalFkWaiverArgs(process.argv.slice(2));
    const { receipt } = prepareReportingArchivalFkWaivers(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 archival FK waiver preparation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
