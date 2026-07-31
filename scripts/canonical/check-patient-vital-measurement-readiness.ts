import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PatientVitalMeasurementProviderCoverage {
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
    valueTimeSimilarityForbidden: boolean;
    shadowEvidencePhiMinimised: boolean;
  };
  selectedAdapters: Array<{
    id: string;
    kind: string;
    function: string;
    routeActivated: boolean;
    rollbackMode: string;
  }>;
  knownReaders: Array<{
    path: string;
    assignment: string;
    selectedAdapterId: string | null;
  }>;
  summary: {
    selectedAdapterCount: number;
    knownReaderCount: number;
    unknownReaderAssignments: number;
    routeActivationCount: number;
  };
}

export interface PatientVitalMeasurementReadinessEvidence {
  schemaVersion: number;
  domain: string;
  checkpoint: string;
  claims: {
    localReady: boolean;
    productionReady: boolean;
    providerEnabled: boolean;
    routeCutoverPerformed: boolean;
    productionObservationPresent: boolean;
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
    shadowEvidencePhiMinimised: boolean;
    rollbackMode: string;
    runtimeRoutesUnchanged: boolean;
  };
  requiredEvidence: Array<{ kind: string; path: string }>;
  blockedGates: Array<{ gate: string; status: string; reason: string }>;
}

export interface PatientVitalMeasurementReadinessResult {
  localReady: boolean;
  productionReady: boolean;
  issues: string[];
  issueCount: number;
  selectedAdapterCount: number;
  knownReaderCount: number;
  unknownReaderAssignments: number;
  blockedGateCount: number;
}

const COVERAGE_PATH = 'docs/database/canonical-patient-vital-measurement-provider-coverage.json';
const READINESS_PATH = 'docs/database/patient-vital-measurement-readiness.json';
const PROVIDER_IMPORT_PATTERN = /patient-vital-measurement-(?:provider|read-adapters)/;

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
}

function allUnique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export function validatePatientVitalMeasurementReadiness(
  root: string,
  readiness: PatientVitalMeasurementReadinessEvidence,
  coverage: PatientVitalMeasurementProviderCoverage,
): string[] {
  const issues: string[] = [];
  if (coverage.schemaVersion !== 1 || readiness.schemaVersion !== 1) issues.push('schema version must be 1');
  if (coverage.domain !== 'patient_vital_measurement' || readiness.domain !== 'patient_vital_measurement') {
    issues.push('domain must be patient_vital_measurement');
  }
  if (readiness.checkpoint !== 'CDB-123E') issues.push('checkpoint must be CDB-123E');
  if (coverage.provider.flagKey !== 'canonical_patient_vital_measurement_provider_v1') {
    issues.push('provider flag key is invalid');
  }
  if (coverage.provider.enabledByDefault || coverage.provider.defaultMode !== 'legacy') {
    issues.push('provider must be disabled and default to legacy');
  }
  if (coverage.provider.rollbackMode !== 'legacy') issues.push('provider rollback mode must be legacy');
  if (JSON.stringify(coverage.provider.supportedModes) !== JSON.stringify(['legacy', 'shadow', 'canonical'])) {
    issues.push('provider modes must be legacy shadow canonical');
  }
  if (!coverage.provider.exactSourceMappingRequired || !coverage.provider.valueTimeSimilarityForbidden) {
    issues.push('provider must require exact mapping and forbid value/time similarity');
  }
  if (!coverage.provider.shadowEvidencePhiMinimised) issues.push('shadow evidence must be PHI-minimised');
  if (!existsSync(join(root, coverage.provider.providerPath))) issues.push(`provider file is missing: ${coverage.provider.providerPath}`);
  if (!existsSync(join(root, coverage.provider.adapterPath))) issues.push(`adapter file is missing: ${coverage.provider.adapterPath}`);

  const adapterIds = coverage.selectedAdapters.map((item) => item.id);
  if (!allUnique(adapterIds)) issues.push('selected adapter IDs must be unique');
  if (coverage.selectedAdapters.length !== 2 || coverage.summary.selectedAdapterCount !== coverage.selectedAdapters.length) {
    issues.push('selected adapter count must be exactly two');
  }
  if (coverage.selectedAdapters.some((item) => item.routeActivated)) issues.push('selected adapters must not activate routes');
  if (coverage.selectedAdapters.some((item) => item.rollbackMode !== 'legacy')) issues.push('selected adapters must preserve legacy rollback');
  if (coverage.summary.routeActivationCount !== 0) issues.push('route activation count must remain zero');

  if (coverage.knownReaders.length !== 4 || coverage.summary.knownReaderCount !== coverage.knownReaders.length) {
    issues.push('known reader count must be exactly four');
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
    const source = readFileSync(path, 'utf8');
    if (PROVIDER_IMPORT_PATTERN.test(source)) issues.push(`runtime reader activates vital provider: ${reader.path}`);
  }

  for (const evidence of readiness.requiredEvidence) {
    if (!existsSync(join(root, evidence.path))) issues.push(`required evidence is missing: ${evidence.path}`);
  }
  if (!readiness.verifiedContracts.schema || !readiness.verifiedContracts.commands || !readiness.verifiedContracts.boundedBackfill) {
    issues.push('schema commands and bounded backfill must be verified');
  }
  if (readiness.verifiedContracts.backfillPartitionCount !== 9) issues.push('backfill partition count must be 9');
  if (readiness.verifiedContracts.reconciliationCheckCount !== 20) issues.push('reconciliation check count must be 20');
  if (!readiness.verifiedContracts.providerDefaultLegacy || !readiness.verifiedContracts.providerDisabledSafe) {
    issues.push('provider default and disabled safety must be verified');
  }
  if (!readiness.verifiedContracts.exactSourceMappingRequired || !readiness.verifiedContracts.shadowEvidencePhiMinimised) {
    issues.push('mapping and PHI-minimised evidence contracts must be verified');
  }
  if (readiness.verifiedContracts.rollbackMode !== 'legacy' || !readiness.verifiedContracts.runtimeRoutesUnchanged) {
    issues.push('legacy rollback and unchanged runtime routes must be verified');
  }

  if (!readiness.claims.localReady) issues.push('local readiness claim must be true');
  if (readiness.claims.productionReady) issues.push('production readiness must remain false');
  if (readiness.claims.providerEnabled || readiness.claims.routeCutoverPerformed) {
    issues.push('provider and route cutover must remain disabled');
  }
  if (readiness.claims.productionObservationPresent || readiness.claims.ownerAuthorizationPresent) {
    issues.push('production observation and owner authorization must remain absent');
  }
  if (readiness.claims.legacyRetirementApproved) issues.push('legacy retirement must remain unapproved');
  if (
    readiness.claims.productionMutationPerformed
    || readiness.claims.productionQueryPerformed
    || readiness.claims.localSyncActivated
    || readiness.claims.pushPerformed
    || readiness.claims.mainIntegrationPerformed
  ) {
    issues.push('prohibited production sync push or integration claim is present');
  }
  const gateNames = readiness.blockedGates.map((gate) => gate.gate).sort();
  if (JSON.stringify(gateNames) !== JSON.stringify(['legacy_retirement', 'production_activation'])) {
    issues.push('production activation and legacy retirement gates must be present');
  }
  if (readiness.blockedGates.some((gate) => gate.status !== 'blocked' || !gate.reason.trim())) {
    issues.push('all external gates must remain blocked with reasons');
  }

  const evidenceJson = JSON.stringify({ readiness, coverage }).toLowerCase();
  for (const forbidden of ['patient_name', 'phone', 'notes_payload', 'measurement_value', 'device_name']) {
    if (evidenceJson.includes(forbidden)) issues.push(`readiness evidence contains forbidden PHI field: ${forbidden}`);
  }
  return [...new Set(issues)].sort();
}

export function checkPatientVitalMeasurementReadiness(root: string): PatientVitalMeasurementReadinessResult {
  const coverage = readJson<PatientVitalMeasurementProviderCoverage>(root, COVERAGE_PATH);
  const readiness = readJson<PatientVitalMeasurementReadinessEvidence>(root, READINESS_PATH);
  const issues = validatePatientVitalMeasurementReadiness(root, readiness, coverage);
  return {
    localReady: issues.length === 0 && readiness.claims.localReady,
    productionReady: issues.length === 0 && readiness.claims.productionReady,
    issues,
    issueCount: issues.length,
    selectedAdapterCount: coverage.selectedAdapters.length,
    knownReaderCount: coverage.knownReaders.length,
    unknownReaderAssignments: coverage.summary.unknownReaderAssignments,
    blockedGateCount: readiness.blockedGates.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkPatientVitalMeasurementReadiness(process.cwd());
  console.log(JSON.stringify(result, null, 2));
  if (!result.localReady) process.exitCode = 1;
}
