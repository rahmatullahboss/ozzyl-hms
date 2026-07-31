import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LabResultSpecimenProviderCoverage {
  schemaVersion: number;
  domain: string;
  provider: {
    flagKey: string;
    enabledByDefault: boolean;
    defaultMode: string;
    rollbackMode: string;
    supportedModes: string[];
    providerPath: string;
    adapterPath: string;
    exactSourceMappingRequired: boolean;
    textTimeValueSimilarityForbidden: boolean;
    specimenCustodyHistoryVisible: boolean;
    resultVersionHistoryVisible: boolean;
    observationHistoryVisible: boolean;
    signatureHistoryVisible: boolean;
    analyzerProvenanceVisible: boolean;
    reportProjectionOnly: boolean;
    shadowEvidencePhiMinimised: boolean;
  };
  selectedAdapters: Array<{
    id: string;
    kind: string;
    function: string;
    routeActivated: boolean;
    rollbackMode: string;
  }>;
  knownWriters: Array<{ path: string; assignment: string }>;
  knownReaders: Array<{
    path: string;
    assignment: string;
    selectedAdapterId: string | null;
  }>;
  summary: {
    selectedAdapterCount: number;
    knownWriterCount: number;
    knownReaderCount: number;
    unknownWriterAssignments: number;
    unknownReaderAssignments: number;
    routeActivationCount: number;
  };
}

export interface LabResultSpecimenReadinessEvidence {
  schemaVersion: number;
  domain: string;
  checkpoint: string;
  claims: {
    localReady: boolean;
    productionReady: boolean;
    providerEnabled: boolean;
    routeCutoverPerformed: boolean;
    productionObservationPresent: boolean;
    rollbackExecutionEvidencePresent: boolean;
    ownerAuthorizationPresent: boolean;
    legacyRetirementApproved: boolean;
    productionMutationPerformed: boolean;
    productionQueryPerformed: boolean;
    localSyncActivated: boolean;
    pushPerformed: boolean;
    mainIntegrationPerformed: boolean;
  };
  verifiedContracts: {
    schema: boolean;
    commands: boolean;
    boundedBackfill: boolean;
    backfillPartitionCount: number;
    reconciliationCheckCount: number;
    providerDefaultLegacy: boolean;
    providerDisabledSafe: boolean;
    exactSourceMappingRequired: boolean;
    textTimeValueSimilarityForbidden: boolean;
    specimenCustodyHistoryVisible: boolean;
    resultVersionHistoryVisible: boolean;
    observationHistoryVisible: boolean;
    signatureHistoryVisible: boolean;
    analyzerProvenanceVisible: boolean;
    reportProjectionOnly: boolean;
    shadowEvidencePhiMinimised: boolean;
    rollbackMode: string;
    runtimeRoutesUnchanged: boolean;
  };
  requiredEvidence: Array<{ kind: string; path: string }>;
  blockedGates: Array<{ gate: string; status: string; reason: string }>;
}

export interface LabResultSpecimenReadinessResult {
  localReady: boolean;
  productionReady: boolean;
  issues: string[];
  issueCount: number;
  selectedAdapterCount: number;
  knownWriterCount: number;
  knownReaderCount: number;
  unknownWriterAssignments: number;
  unknownReaderAssignments: number;
  blockedGateCount: number;
}

const COVERAGE_PATH = 'docs/database/canonical-lab-result-specimen-provider-coverage.json';
const READINESS_PATH = 'docs/database/lab-result-specimen-readiness.json';
const PROVIDER_IMPORT_PATTERN = /lab-result-specimen-(?:provider|read-adapters)/;

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
}

function allUnique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function historyContracts(input: {
  specimenCustodyHistoryVisible: boolean;
  resultVersionHistoryVisible: boolean;
  observationHistoryVisible: boolean;
  signatureHistoryVisible: boolean;
  analyzerProvenanceVisible: boolean;
  reportProjectionOnly: boolean;
}): boolean {
  return input.specimenCustodyHistoryVisible
    && input.resultVersionHistoryVisible
    && input.observationHistoryVisible
    && input.signatureHistoryVisible
    && input.analyzerProvenanceVisible
    && input.reportProjectionOnly;
}

export function validateLabResultSpecimenReadiness(
  root: string,
  readiness: LabResultSpecimenReadinessEvidence,
  coverage: LabResultSpecimenProviderCoverage,
): string[] {
  const issues: string[] = [];
  if (coverage.schemaVersion !== 1 || readiness.schemaVersion !== 1) issues.push('schema version must be 1');
  if (coverage.domain !== 'lab_result_specimen' || readiness.domain !== 'lab_result_specimen') {
    issues.push('domain must be lab_result_specimen');
  }
  if (readiness.checkpoint !== 'CDB-125E') issues.push('checkpoint must be CDB-125E');
  if (coverage.provider.flagKey !== 'canonical_lab_result_specimen_provider_v1') {
    issues.push('provider flag key is invalid');
  }
  if (coverage.provider.enabledByDefault || coverage.provider.defaultMode !== 'legacy') {
    issues.push('provider must be disabled and default to legacy');
  }
  if (coverage.provider.rollbackMode !== 'legacy') issues.push('provider rollback mode must be legacy');
  if (JSON.stringify(coverage.provider.supportedModes) !== JSON.stringify(['legacy', 'shadow', 'canonical'])) {
    issues.push('provider modes must be legacy shadow canonical');
  }
  if (!coverage.provider.exactSourceMappingRequired || !coverage.provider.textTimeValueSimilarityForbidden) {
    issues.push('provider must require exact mapping and forbid text time value similarity');
  }
  if (!historyContracts(coverage.provider)) {
    issues.push('provider must expose custody version observation signature analyzer history and keep report as projection');
  }
  if (!coverage.provider.shadowEvidencePhiMinimised) issues.push('shadow evidence must be PHI-minimised');
  if (!existsSync(join(root, coverage.provider.providerPath))) issues.push(`provider file is missing: ${coverage.provider.providerPath}`);
  if (!existsSync(join(root, coverage.provider.adapterPath))) issues.push(`adapter file is missing: ${coverage.provider.adapterPath}`);

  const providerSource = existsSync(join(root, coverage.provider.providerPath))
    ? readFileSync(join(root, coverage.provider.providerPath), 'utf8')
    : '';
  if (!providerSource.includes('canonical_lab_result_specimen_provider_v1')) issues.push('provider implementation is missing the exact flag key');
  for (const mode of ["'legacy'", "'shadow'", "'canonical'"]) {
    if (!providerSource.includes(mode)) issues.push(`provider implementation is missing mode ${mode}`);
  }

  const adapterIds = coverage.selectedAdapters.map((item) => item.id);
  if (!allUnique(adapterIds)) issues.push('selected adapter IDs must be unique');
  if (coverage.selectedAdapters.length !== 3 || coverage.summary.selectedAdapterCount !== coverage.selectedAdapters.length) {
    issues.push('selected adapter count must be exactly three');
  }
  if (coverage.selectedAdapters.some((item) => item.kind !== 'library_adapter')) issues.push('selected adapters must remain library adapters');
  if (coverage.selectedAdapters.some((item) => item.routeActivated)) issues.push('selected adapters must not activate routes');
  if (coverage.selectedAdapters.some((item) => item.rollbackMode !== 'legacy')) issues.push('selected adapters must preserve legacy rollback');
  if (coverage.summary.routeActivationCount !== 0) issues.push('route activation count must remain zero');

  if (coverage.knownWriters.length !== 6 || coverage.summary.knownWriterCount !== coverage.knownWriters.length) {
    issues.push('known writer count must be exactly six');
  }
  if (coverage.summary.unknownWriterAssignments !== 0) issues.push('unknown writer assignments must be zero');
  for (const writer of coverage.knownWriters) {
    const path = join(root, writer.path);
    if (!existsSync(path)) {
      issues.push(`known writer is missing: ${writer.path}`);
      continue;
    }
    if (writer.assignment !== 'legacy_unchanged') issues.push(`known writer must remain legacy_unchanged: ${writer.path}`);
    if (PROVIDER_IMPORT_PATTERN.test(readFileSync(path, 'utf8'))) issues.push(`runtime writer activates lab provider: ${writer.path}`);
  }

  if (coverage.knownReaders.length !== 12 || coverage.summary.knownReaderCount !== coverage.knownReaders.length) {
    issues.push('known reader count must be exactly twelve');
  }
  if (coverage.summary.unknownReaderAssignments !== 0) issues.push('unknown reader assignments must be zero');
  for (const reader of coverage.knownReaders) {
    const path = join(root, reader.path);
    if (!existsSync(path)) {
      issues.push(`known reader is missing: ${reader.path}`);
      continue;
    }
    if (reader.assignment !== 'legacy_unchanged') issues.push(`known reader must remain legacy_unchanged: ${reader.path}`);
    if (reader.selectedAdapterId != null && !adapterIds.includes(reader.selectedAdapterId)) {
      issues.push(`known reader references unknown adapter: ${reader.path}`);
    }
    if (PROVIDER_IMPORT_PATTERN.test(readFileSync(path, 'utf8'))) issues.push(`runtime reader activates lab provider: ${reader.path}`);
  }

  for (const evidence of readiness.requiredEvidence) {
    if (!existsSync(join(root, evidence.path))) issues.push(`required evidence is missing: ${evidence.path}`);
  }
  const verified = readiness.verifiedContracts;
  if (!verified.schema || !verified.commands || !verified.boundedBackfill) {
    issues.push('schema commands and bounded backfill must be verified');
  }
  if (verified.backfillPartitionCount !== 10) issues.push('backfill partition count must be 10');
  if (verified.reconciliationCheckCount !== 28) issues.push('reconciliation check count must be 28');
  if (!verified.providerDefaultLegacy || !verified.providerDisabledSafe) {
    issues.push('provider default and disabled safety must be verified');
  }
  if (!verified.exactSourceMappingRequired || !verified.textTimeValueSimilarityForbidden) {
    issues.push('exact mapping and forbidden similarity contracts must be verified');
  }
  if (!historyContracts(verified)) {
    issues.push('history visibility and report projection contracts must be verified');
  }
  if (!verified.shadowEvidencePhiMinimised) issues.push('PHI-minimised shadow evidence must be verified');
  if (verified.rollbackMode !== 'legacy' || !verified.runtimeRoutesUnchanged) {
    issues.push('legacy rollback and unchanged runtime routes must be verified');
  }

  if (!readiness.claims.localReady) issues.push('local readiness claim must be true');
  if (readiness.claims.productionReady) issues.push('production readiness must remain false');
  if (readiness.claims.providerEnabled || readiness.claims.routeCutoverPerformed) {
    issues.push('provider and route cutover must remain disabled');
  }
  if (
    readiness.claims.productionObservationPresent
    || readiness.claims.rollbackExecutionEvidencePresent
    || readiness.claims.ownerAuthorizationPresent
  ) issues.push('production observation rollback execution and owner authorization must remain absent');
  if (readiness.claims.legacyRetirementApproved) issues.push('legacy retirement must remain unapproved');
  if (
    readiness.claims.productionMutationPerformed
    || readiness.claims.productionQueryPerformed
    || readiness.claims.localSyncActivated
    || readiness.claims.pushPerformed
    || readiness.claims.mainIntegrationPerformed
  ) issues.push('prohibited production sync push or integration claim is present');

  const gateNames = readiness.blockedGates.map((gate) => gate.gate).sort();
  if (JSON.stringify(gateNames) !== JSON.stringify(['legacy_retirement', 'production_activation'])) {
    issues.push('production activation and legacy retirement gates must be present');
  }
  if (readiness.blockedGates.some((gate) => gate.status !== 'blocked' || !gate.reason.trim())) {
    issues.push('all external gates must remain blocked with reasons');
  }

  const evidenceJson = JSON.stringify({ readiness, coverage }).toLowerCase();
  for (const forbidden of [
    'patient_name','phone','notes_payload','accession_value','barcode_value','result_value',
    'value_decimal','patient_link_public_id','observation_public_id','payload_json',
  ]) {
    if (evidenceJson.includes(forbidden)) issues.push(`readiness evidence contains forbidden PHI field: ${forbidden}`);
  }
  return [...new Set(issues)].sort();
}

export function checkLabResultSpecimenReadiness(root: string): LabResultSpecimenReadinessResult {
  const coverage = readJson<LabResultSpecimenProviderCoverage>(root, COVERAGE_PATH);
  const readiness = readJson<LabResultSpecimenReadinessEvidence>(root, READINESS_PATH);
  const issues = validateLabResultSpecimenReadiness(root, readiness, coverage);
  return {
    localReady: issues.length === 0 && readiness.claims.localReady,
    productionReady: issues.length === 0 && readiness.claims.productionReady,
    issues,
    issueCount: issues.length,
    selectedAdapterCount: coverage.selectedAdapters.length,
    knownWriterCount: coverage.knownWriters.length,
    knownReaderCount: coverage.knownReaders.length,
    unknownWriterAssignments: coverage.summary.unknownWriterAssignments,
    unknownReaderAssignments: coverage.summary.unknownReaderAssignments,
    blockedGateCount: readiness.blockedGates.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkLabResultSpecimenReadiness(process.cwd());
  console.log(JSON.stringify(result, null, 2));
  if (!result.localReady) process.exitCode = 1;
}
