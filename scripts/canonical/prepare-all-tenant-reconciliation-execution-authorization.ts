import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildAllTenantReconciliationConfirmationTokens,
  buildAllTenantReconciliationRepositoryBinding,
  parseAllTenantReconciliationAuthorizationJson,
  type AllTenantReconciliationAuthorization,
  type AllTenantReconciliationAuthorizationResult,
} from './all-tenant-reconciliation-authorization';
import { reconciliationEvidenceSha256 } from './all-tenant-reconciliation-executor';
import {
  CDB_V1_070C_ARCHIVAL_FK_GROUPS,
  CDB_V1_070C_PACKAGE_PATH,
  CDB_V1_070C_RECONCILIATION_MIGRATIONS,
  type AllTenantReconciliationPackage,
} from './all-tenant-reconciliation-package';
import {
  requireProtectedDirectory,
  requireProtectedRegularFile,
  type AllTenantReconciliationPreauthorizationManifest,
} from './collect-all-tenant-reconciliation-evidence';

const APPROVAL_SOURCE = 'user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization';

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function exactUtc(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error('atUtc must be an exact UTC timestamp');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('atUtc is invalid');
  return parsed;
}

function utc(value: number): string {
  return new Date(value).toISOString();
}

function compactUtc(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function validateCdbV1070cOwnerApprovalText(text: string): void {
  const required = [
    'Rahmatullah Zisan',
    'CDB-V1-070C',
    'e2f6365130946d9ce0cbf4ab1bf3af2ec71e4170',
    'hms-super-admin-production-apac',
    'c68a5360-a2c1-44cc-9e71-f21057bea102',
    '1, 100, 101, 102',
    'Aggregate-only non-PHI',
    '0549_approval_revision_policy.sql',
    '0551_workforce_roster_integrity.sql',
    '0552_attendance_projection_integrity.sql',
    '0570_doctor_commission_rule_version_snapshot.sql',
    '29',
    '25',
    'Migration SQL execution 0',
    'DDL execution 0',
    'business-table row write 0',
    'doctor_commission_accruals_old_0391',
    '26',
    '15',
    '41',
    'Legacy final response authority',
    'automatic abort',
    APPROVAL_SOURCE,
  ];
  if (required.some((fragment) => !text.includes(fragment))) {
    throw new Error('Exact owner authorization evidence is incomplete');
  }
  const prohibitedBoundary = [
    'backfill',
    'provider flag change',
    'traffic assignment',
    'route change',
    'local-sync activation',
    'Legacy retirement',
    'archival-table mutation',
    'database deletion',
    'CDB-to-main integration',
  ];
  if (prohibitedBoundary.some((fragment) => !text.includes(fragment))) {
    throw new Error('Exact owner authorization prohibition boundary is incomplete');
  }
}

function readProtectedJson<T>(path: string, repositoryRoot: string): { value: T; bytes: Buffer; path: string } {
  const protectedPath = requireProtectedRegularFile(path, repositoryRoot);
  const bytes = readFileSync(protectedPath);
  return { value: JSON.parse(bytes.toString('utf8')) as T, bytes, path: protectedPath };
}

function verifyEvidenceManifest(
  manifest: AllTenantReconciliationPreauthorizationManifest,
  repositoryRoot: string,
  candidateCommit: string,
): void {
  if (manifest.schemaVersion !== 1
    || manifest.checkpoint !== 'CDB-V1-070C-PREAUTHORIZATION-AGGREGATE-EVIDENCE-CAPTURE'
    || manifest.candidateCommit !== candidateCommit
    || manifest.database.name !== 'hms-super-admin-production-apac'
    || manifest.database.uuid !== 'c68a5360-a2c1-44cc-9e71-f21057bea102'
    || manifest.aggregateOnly !== true
    || manifest.productionReadPerformed !== true
    || manifest.productionMutationPerformed !== false
    || manifest.migrationLedgerRowsWritten !== 0
    || manifest.trafficChanged !== false
    || manifest.entries.length !== 4) {
    throw new Error('Protected preauthorization evidence manifest is invalid');
  }
  for (let index = 0; index < CDB_V1_070C_RECONCILIATION_MIGRATIONS.length; index += 1) {
    const expected = CDB_V1_070C_RECONCILIATION_MIGRATIONS[index];
    const entry = manifest.entries[index];
    if (!entry || entry.name !== expected.name) throw new Error('Evidence migration order mismatch');
    const schema = readProtectedJson<Record<string, unknown>>(entry.schemaEvidenceFile, repositoryRoot);
    const ledger = readProtectedJson<Record<string, unknown>>(entry.ledgerEvidenceFile, repositoryRoot);
    if (schema.value.evidenceId !== entry.schemaEvidenceId
      || reconciliationEvidenceSha256(schema.value) !== entry.schemaEvidenceSha256
      || schema.value.postSchemaExact !== true
      || ledger.value.evidenceId !== entry.ledgerEvidenceId
      || reconciliationEvidenceSha256(ledger.value) !== entry.ledgerEvidenceSha256
      || ledger.value.ledgerEntryInitiallyAbsent !== true
      || ledger.value.pendingMigrationCount !== 29
      || ledger.value.exactExpectedPendingSet !== true) {
      throw new Error(`Protected evidence mismatch: ${entry.name}`);
    }
  }
  const fk = readProtectedJson<Record<string, unknown>>(
    manifest.foreignKeyDisposition.evidenceFile,
    repositoryRoot,
  );
  if (fk.value.evidenceId !== manifest.foreignKeyDisposition.evidenceId
    || reconciliationEvidenceSha256(fk.value) !== manifest.foreignKeyDisposition.evidenceSha256
    || manifest.foreignKeyDisposition.rawArchivalViolationCount !== 41
    || manifest.foreignKeyDisposition.formallyWaivedViolationCount !== 41
    || manifest.foreignKeyDisposition.effectiveUnwaivedViolationCount !== 0
    || manifest.foreignKeyDisposition.activeViolationCount !== 0
    || manifest.foreignKeyDisposition.unknownViolationCount !== 0
    || manifest.foreignKeyDisposition.archivalRowCount <= 0
    || manifest.foreignKeyDisposition.activeRowCount <= 0
    || !Number.isFinite(Date.parse(manifest.foreignKeyDisposition.archivalLatestUpdatedAtUtc))
    || !Number.isFinite(Date.parse(manifest.foreignKeyDisposition.activeLatestCreatedAtUtc))
    || Date.parse(manifest.foreignKeyDisposition.archivalLatestUpdatedAtUtc)
      >= Date.parse(manifest.foreignKeyDisposition.activeLatestCreatedAtUtc)
    || manifest.foreignKeyDisposition.triggerCount !== 0
    || manifest.foreignKeyDisposition.dependentObjectCount !== 0
    || manifest.foreignKeyDisposition.runtimeSourceReferenceCount !== 0
    || manifest.foreignKeyDisposition.activeWriterDisabledConfirmed !== true
    || manifest.foreignKeyDisposition.excludedFromCanonicalImportConfirmed !== true
    || manifest.foreignKeyDisposition.excludedFromReportingConfirmed !== true
    || fk.value.activeWriterDisabledConfirmed !== true
    || fk.value.excludedFromCanonicalImportConfirmed !== true
    || fk.value.excludedFromReportingConfirmed !== true) {
    throw new Error('Protected archival FK evidence mismatch');
  }
}

export interface PrepareAllTenantReconciliationAuthorizationResult {
  authorization: AllTenantReconciliationAuthorization;
  validation: AllTenantReconciliationAuthorizationResult;
  outputPath: string;
}

export function prepareAllTenantReconciliationExecutionAuthorization(input: {
  repositoryRoot: string;
  packageDocument: AllTenantReconciliationPackage;
  evidenceManifestPath: string;
  gateAReceiptPath: string;
  gateBReceiptPath: string;
  ownerApprovalEvidencePath: string;
  outputPath: string;
  candidateCommit: string;
  atUtc?: string;
}): PrepareAllTenantReconciliationAuthorizationResult {
  const root = resolve(input.repositoryRoot);
  const atUtc = input.atUtc ?? new Date().toISOString();
  const now = exactUtc(atUtc);
  const approvalPath = requireProtectedRegularFile(input.ownerApprovalEvidencePath, root);
  const approvalBytes = readFileSync(approvalPath);
  validateCdbV1070cOwnerApprovalText(approvalBytes.toString('utf8'));
  const manifestFile = readProtectedJson<AllTenantReconciliationPreauthorizationManifest>(
    input.evidenceManifestPath,
    root,
  );
  const capturedAt = Date.parse(manifestFile.value.capturedAtUtc);
  if (!Number.isFinite(capturedAt) || capturedAt > now || now - capturedAt > 5 * 60_000) {
    throw new Error('Fresh aggregate evidence must be captured within five minutes');
  }
  verifyEvidenceManifest(manifestFile.value, root, input.candidateCommit);
  const gateA = readProtectedJson<Record<string, unknown>>(input.gateAReceiptPath, root);
  const gateB = readProtectedJson<Record<string, unknown>>(input.gateBReceiptPath, root);
  const gateAEvidenceOutput = gateA.value.evidenceOutput as Record<string, unknown> | undefined;
  const gateAReceiptId = String(gateAEvidenceOutput?.receiptId ?? '');
  if (!/^[a-z0-9][a-z0-9_.:-]{2,191}$/i.test(gateAReceiptId)) {
    throw new Error('Gate A receipt identity is invalid');
  }
  const gateBCandidate = gateB.value.candidate as Record<string, unknown> | undefined;
  const gateBCandidateCommit = String(gateBCandidate?.commit ?? '');
  if (gateB.value.checkpoint !== 'CDB-V1-070-GATE-B-AUTHORIZATION-PACKAGE-PREPARATION'
    || !/^[0-9a-f]{40}$/.test(gateBCandidateCommit)) {
    throw new Error('Gate B receipt identity is invalid');
  }
  const gateBReceiptId = `cdb-v1-070b-gate-b-preparation-${gateBCandidateCommit.slice(0, 9)}`;
  const repository = buildAllTenantReconciliationRepositoryBinding(
    root,
    input.packageDocument,
    input.candidateCommit,
    input.candidateCommit,
    gateAReceiptId,
    sha256(gateA.bytes),
    gateBReceiptId,
    sha256(gateB.bytes),
  );
  const stamp = compactUtc(atUtc);
  const manifest = manifestFile.value;
  const authorization: AllTenantReconciliationAuthorization = {
    schemaVersion: 1,
    authorizationId: `cdb-v1-070c-reconciliation-${input.candidateCommit.slice(0, 12)}-${stamp}`,
    operation: 'all_tenant_schema_ledger_archival_fk_reconciliation',
    target: {
      platform: 'cloudflare_d1',
      databaseName: 'hms-super-admin-production-apac',
      databaseUuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      environment: 'production',
      remote: true,
    },
    timing: {
      issuedAtUtc: utc(now - 60_000),
      windowStartUtc: utc(now - 30_000),
      windowEndUtc: utc(now + 45 * 60_000),
      expiresAtUtc: utc(now + 60 * 60_000),
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: APPROVAL_SOURCE,
      ownerModel: 'single_operator_risk_accepted',
      executionOwnerId: 'rahmatullah-zisan',
      rollbackOwnerId: 'rahmatullah-zisan',
      evidenceCustodianId: 'rahmatullah-zisan',
      riskAcceptanceEvidenceId: `risk-cdb-v1-070c-${input.candidateCommit.slice(0, 12)}`,
      riskAcceptanceEvidenceSha256: sha256(approvalBytes),
      automaticAbortOnOperatorUnavailable: true,
    },
    repository,
    scope: {
      tenantIds: ['1', '100', '101', '102'],
      phiReadAllowed: false,
      rowLevelPatientReadAllowed: false,
    },
    reconciliation: {
      expectedPendingMigrationCountBefore: 29,
      expectedPendingMigrationCountAfter: 25,
      expectedLedgerRowsWritten: 4,
      atomic: true,
      entries: CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((migration, index) => {
        const evidence = manifest.entries[index];
        return {
          ...migration,
          schemaEvidenceId: evidence.schemaEvidenceId,
          schemaEvidenceSha256: evidence.schemaEvidenceSha256,
          ledgerEvidenceId: evidence.ledgerEvidenceId,
          ledgerEvidenceSha256: evidence.ledgerEvidenceSha256,
          ledgerEntryInitiallyAbsent: true,
          postSchemaExact: true,
          maximumLedgerRowsWritten: 1,
        };
      }),
    },
    foreignKeyDisposition: {
      evidenceId: manifest.foreignKeyDisposition.evidenceId,
      evidenceSha256: manifest.foreignKeyDisposition.evidenceSha256,
      rawArchivalViolationCount: 41,
      formallyWaivedViolationCount: 41,
      effectiveUnwaivedViolationCount: 0,
      activeViolationCount: 0,
      unknownViolationCount: 0,
      groups: CDB_V1_070C_ARCHIVAL_FK_GROUPS.map((group) => ({ ...group })),
      archivalTableConfirmed: true,
      activeWriterDisabledConfirmed: true,
      excludedFromCanonicalImportConfirmed: true,
      excludedFromReportingConfirmed: true,
      removalPhase: 'legacy_retirement_p11',
      archivalTableMutationAllowed: false,
      archivalTableDeletionAllowed: false,
    },
    evidenceOutput: {
      receiptId: `cdb-v1-070c-reconciliation-receipt-${input.candidateCommit.slice(0, 12)}-${stamp}`,
      protectedDirectoryEvidenceId: `protected-cdb-v1-070c-${input.candidateCommit.slice(0, 12)}-${stamp}`,
      retentionDays: 30,
    },
    procedure: {
      verifyCandidateAndPackage: true,
      captureFreshAggregateSchemaEvidence: true,
      captureFreshMigrationLedgerEvidence: true,
      stopIfAnyLedgerEntryExists: true,
      verifyExactPostSchemaBeforeWrite: true,
      reconcileExactlyFourLedgerRowsAtomically: true,
      executeNoMigrationSqlOrDdl: true,
      writeNoBusinessRows: true,
      refreshProtectedArchivalFkDispositionEvidence: true,
      verifyZeroActiveAndUnknownFkViolations: true,
      preserveRawArchivalRows: true,
      preserveLegacyAuthority: true,
      verifyTrafficUnchanged: true,
      stopOnFirstFailure: true,
    },
    permissions: {
      productionRead: true,
      migrationLedgerReconciliation: true,
      archivalFkDispositionEvidenceRefresh: true,
      migrationSqlExecution: false,
      productionDdl: false,
      businessTableWrite: false,
      productionBackfill: false,
      providerFlagChange: false,
      workerVersionUpload: false,
      deployment: false,
      trafficChange: false,
      routeChange: false,
      canonicalReadPromotion: false,
      canonicalWritePromotion: false,
      localSyncActivation: false,
      legacyRetirement: false,
      archivalTableMutation: false,
      archivalTableDeletion: false,
      destructiveAction: false,
      remoteDatabaseDeletion: false,
      push: false,
      cdbToMainIntegration: false,
    },
    confirmation: {
      readToken: '',
      ledgerReconciliationToken: '',
      archivalDispositionToken: '',
      abortToken: '',
    },
  };
  authorization.confirmation = buildAllTenantReconciliationConfirmationTokens(authorization);
  const validation = parseAllTenantReconciliationAuthorizationJson(
    JSON.stringify(authorization), root, input.packageDocument, atUtc,
  );
  if (!validation.authorizationReady) {
    throw new Error(`Generated authorization failed validation: ${validation.issues.map((issue) => issue.code).join(', ')}`);
  }
  const outputDirectory = requireProtectedDirectory(dirname(input.outputPath), root);
  const outputPath = resolve(input.outputPath);
  if (dirname(outputPath) !== outputDirectory) throw new Error('Authorization output path is invalid');
  if (existsSync(outputPath)) throw new Error('Authorization output already exists');
  writeFileSync(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(outputPath, 0o600);
  return { authorization, validation, outputPath };
}

function parseArgs(args: string[]): Record<string, string> {
  const clean = args.filter((arg) => arg !== '--');
  const result: Record<string, string> = {};
  for (let index = 0; index < clean.length; index += 2) {
    const key = clean[index];
    const value = clean[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }
    result[key] = value;
  }
  return result;
}

function main(): void {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const required = [
    '--manifest', '--gate-a-receipt', '--gate-b-receipt', '--owner-approval', '--output', '--candidate',
  ];
  if (required.some((name) => !args[name])) throw new Error(`${required.join(', ')} are required`);
  const packageDocument = JSON.parse(
    readFileSync(CDB_V1_070C_PACKAGE_PATH, 'utf8'),
  ) as AllTenantReconciliationPackage;
  const result = prepareAllTenantReconciliationExecutionAuthorization({
    repositoryRoot: root,
    packageDocument,
    evidenceManifestPath: args['--manifest'],
    gateAReceiptPath: args['--gate-a-receipt'],
    gateBReceiptPath: args['--gate-b-receipt'],
    ownerApprovalEvidencePath: args['--owner-approval'],
    outputPath: args['--output'],
    candidateCommit: args['--candidate'],
    atUtc: args['--at-utc'],
  });
  process.stdout.write(`${JSON.stringify({
    outputPath: result.outputPath,
    authorizationId: result.authorization.authorizationId,
    authorizationReady: result.validation.authorizationReady,
    issueCount: result.validation.issues.length,
    migrationLedgerEntryCount: result.authorization.reconciliation.entries.length,
    rawArchivalViolationCount: result.authorization.foreignKeyDisposition.rawArchivalViolationCount,
    effectiveUnwaivedViolationCount: result.authorization.foreignKeyDisposition.effectiveUnwaivedViolationCount,
    productionMutationPerformed: false,
    migrationLedgerRowsWritten: 0,
    trafficChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
