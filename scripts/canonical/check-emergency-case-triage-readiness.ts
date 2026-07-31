import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface EmergencyCaseTriageCoverageEntry {
  path: string;
  assignment: string;
  reason: string;
}
export interface EmergencyCaseTriageSelectedAdapter {
  consumerId: string;
  function: string;
  surface: string;
  runtimeActivated: boolean;
}
export interface EmergencyCaseTriageCoverage {
  schemaVersion: number;
  provider: string;
  providerFlag: string;
  providerModule: string;
  adapterModule: string;
  enabledByDefault: boolean;
  defaultMode: string;
  rollbackMode: string;
  selectedAdapters: EmergencyCaseTriageSelectedAdapter[];
  writers: EmergencyCaseTriageCoverageEntry[];
  readers: EmergencyCaseTriageCoverageEntry[];
  knownWriterCount: number;
  knownReaderCount: number;
  selectedAdapterCount: number;
  unknownWriterAssignments: number;
  unknownReaderAssignments: number;
  routeActivationCount: number;
}
export interface EmergencyCaseTriageReadiness {
  schemaVersion: number;
  checkpoint: string;
  provider: string;
  providerFlag: string;
  providerEnabledByDefault: boolean;
  providerDefaultMode: string;
  providerRollbackMode: string;
  providerEnabled: boolean;
  routeCutoverPerformed: boolean;
  routeActivationCount: number;
  selectedAdapterCount: number;
  knownWriterCount: number;
  knownReaderCount: number;
  unknownWriterAssignments: number;
  unknownReaderAssignments: number;
  targetTableCount: number;
  atomicCommandCount: number;
  persistentBackfillPartitionCount: number;
  fixedReconciliationCheckCount: number;
  requiredArtifacts: string[];
  providerEvidence: Record<string, boolean>;
  implementationEvidence: Record<string, boolean | number>;
  productionGates: Record<string, boolean>;
  localReady: boolean;
  productionReady: boolean;
}
export interface EmergencyCaseTriageReadinessOptions {
  root?: string;
  coverage?: EmergencyCaseTriageCoverage;
  readiness?: EmergencyCaseTriageReadiness;
}
export interface EmergencyCaseTriageReadinessResult {
  localReady: boolean;
  productionReady: boolean;
  issues: string[];
  selectedAdapterCount: number;
  knownWriterCount: number;
  knownReaderCount: number;
  routeActivationCount: number;
}

const COVERAGE_PATH = 'docs/database/canonical-emergency-case-triage-provider-coverage.json';
const READINESS_PATH = 'docs/database/emergency-case-triage-readiness.json';
const EXPECTED_ADAPTERS = [
  'readEmergencyBoardAdapter',
  'readEmergencyPatientTimelineAdapter',
  'readEmergencyDispositionHandoffAdapter',
] as const;
const EXPECTED_WRITERS = [
  'src/routes/tenant/emergency.ts',
  'src/routes/tenant/reception.ts',
  'src/routes/tenant/admissions.ts',
  'src/routes/tenant/appointments.ts',
] as const;
const EXPECTED_READERS = [
  'src/routes/tenant/emergency.ts',
  'src/routes/tenant/qualityKpi.ts',
  'src/routes/tenant/doctors.ts',
  'src/routes/tenant/ipdReports.ts',
  'src/routes/tenant/patients-timeline.ts',
  'src/lib/patient-reference-registry.ts',
] as const;
const RUNTIME_IMPORT_MARKERS = [
  'emergency-case-triage-provider',
  'emergency-case-triage-read-adapters',
  'canonical_emergency_case_triage_provider_v1',
] as const;
const REQUIRED_PROVIDER_EVIDENCE = [
  'exactSourceMappingRequired',
  'similarityIdentityForbidden',
  'legacyUnmappedNonIdentityReadAllowed',
  'identitySensitiveLegacyReadRequiresMapping',
  'shadowModeRequiresMapping',
  'canonicalModeRequiresMapping',
  'canonicalRootFailClosed',
  'arrivalHistoryVisible',
  'lifecycleHistoryVisible',
  'triageHistoryVisible',
  'classificationHistoryVisible',
  'dispositionHistoryVisible',
  'externalAuthorityLinksVisible',
  'shadowEvidencePhiMinimised',
  'rollbackModeLegacy',
] as const;
const REQUIRED_IMPLEMENTATION_EVIDENCE = [
  'schemaImplemented',
  'commandsImplemented',
  'backfillImplemented',
  'reconciliationImplemented',
  'providerImplemented',
  'adaptersImplemented',
  'coverageComplete',
  'sourceOfTruthRegistered',
  'legacySourcesReadOnlyDuringBackfill',
  'secondPassZeroNewBusinessRows',
  'reconciliationReceiptReplaySafe',
] as const;

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
}
function readText(root: string, path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}
function pushIf(issues: string[], condition: boolean, code: string): void {
  if (condition) issues.push(code);
}
function exactSet(values: string[], expected: readonly string[]): boolean {
  return values.length === expected.length
    && values.every((value) => expected.includes(value))
    && new Set(values).size === values.length;
}

export function checkEmergencyCaseTriageReadiness(
  options: EmergencyCaseTriageReadinessOptions = {},
): EmergencyCaseTriageReadinessResult {
  const root = resolve(options.root ?? process.cwd());
  const coverage = options.coverage ?? readJson<EmergencyCaseTriageCoverage>(root, COVERAGE_PATH);
  const readiness = options.readiness ?? readJson<EmergencyCaseTriageReadiness>(root, READINESS_PATH);
  const issues: string[] = [];

  pushIf(issues, coverage.schemaVersion !== 1, 'CDB127E_COVERAGE_SCHEMA_VERSION');
  pushIf(issues, readiness.schemaVersion !== 1, 'CDB127E_READINESS_SCHEMA_VERSION');
  pushIf(issues, coverage.provider !== 'emergency_case_triage', 'CDB127E_COVERAGE_PROVIDER');
  pushIf(issues, readiness.provider !== 'emergency_case_triage', 'CDB127E_READINESS_PROVIDER');
  pushIf(
    issues,
    coverage.providerFlag !== 'canonical_emergency_case_triage_provider_v1'
      || readiness.providerFlag !== coverage.providerFlag,
    'CDB127E_PROVIDER_FLAG',
  );
  pushIf(
    issues,
    coverage.enabledByDefault !== false || readiness.providerEnabledByDefault !== false,
    'CDB127E_PROVIDER_DEFAULT_ENABLED',
  );
  pushIf(
    issues,
    coverage.defaultMode !== 'legacy' || readiness.providerDefaultMode !== 'legacy',
    'CDB127E_PROVIDER_DEFAULT_MODE',
  );
  pushIf(
    issues,
    coverage.rollbackMode !== 'legacy' || readiness.providerRollbackMode !== 'legacy',
    'CDB127E_PROVIDER_ROLLBACK_MODE',
  );
  pushIf(issues, readiness.providerEnabled !== false, 'CDB127E_PROVIDER_MUST_REMAIN_DISABLED');
  pushIf(issues, readiness.routeCutoverPerformed !== false, 'CDB127E_ROUTE_CUTOVER_FORBIDDEN');

  const adapterFunctions = coverage.selectedAdapters.map((item) => item.function);
  pushIf(issues, !exactSet(adapterFunctions, EXPECTED_ADAPTERS), 'CDB127E_SELECTED_ADAPTER_SET');
  pushIf(
    issues,
    coverage.selectedAdapters.some((item) => item.runtimeActivated !== false),
    'CDB127E_SELECTED_ADAPTER_RUNTIME_ACTIVATION',
  );
  pushIf(
    issues,
    coverage.selectedAdapterCount !== 3 || readiness.selectedAdapterCount !== 3
      || coverage.selectedAdapterCount !== coverage.selectedAdapters.length,
    'CDB127E_SELECTED_ADAPTER_COUNT',
  );

  const writerPaths = coverage.writers.map((item) => item.path);
  const readerPaths = coverage.readers.map((item) => item.path);
  pushIf(issues, !exactSet(writerPaths, EXPECTED_WRITERS), 'CDB127E_WRITER_SET');
  pushIf(issues, !exactSet(readerPaths, EXPECTED_READERS), 'CDB127E_READER_SET');
  pushIf(
    issues,
    coverage.writers.some((item) => item.assignment !== 'legacy_unchanged'),
    'CDB127E_WRITER_ASSIGNMENT',
  );
  pushIf(
    issues,
    coverage.readers.some((item) => item.assignment !== 'legacy_unchanged'),
    'CDB127E_READER_ASSIGNMENT',
  );
  pushIf(
    issues,
    coverage.knownWriterCount !== 4 || readiness.knownWriterCount !== 4
      || coverage.knownWriterCount !== coverage.writers.length,
    'CDB127E_WRITER_COUNT',
  );
  pushIf(
    issues,
    coverage.knownReaderCount !== 6 || readiness.knownReaderCount !== 6
      || coverage.knownReaderCount !== coverage.readers.length,
    'CDB127E_READER_COUNT',
  );
  pushIf(
    issues,
    coverage.unknownWriterAssignments !== 0 || readiness.unknownWriterAssignments !== 0,
    'CDB127E_UNKNOWN_WRITER_ASSIGNMENT',
  );
  pushIf(
    issues,
    coverage.unknownReaderAssignments !== 0 || readiness.unknownReaderAssignments !== 0,
    'CDB127E_UNKNOWN_READER_ASSIGNMENT',
  );
  pushIf(
    issues,
    coverage.routeActivationCount !== 0 || readiness.routeActivationCount !== 0,
    'CDB127E_ROUTE_ACTIVATION_COUNT',
  );

  for (const path of readiness.requiredArtifacts) {
    pushIf(issues, !existsSync(resolve(root, path)), `CDB127E_MISSING_ARTIFACT:${path}`);
  }
  for (const path of [...new Set([...writerPaths, ...readerPaths])]) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) {
      issues.push(`CDB127E_MISSING_COVERAGE_PATH:${path}`);
      continue;
    }
    const source = readFileSync(absolute, 'utf8');
    for (const marker of RUNTIME_IMPORT_MARKERS) {
      pushIf(issues, source.includes(marker), `CDB127E_RUNTIME_IMPORT:${path}:${marker}`);
    }
  }

  const providerPath = coverage.providerModule;
  const adapterPath = coverage.adapterModule;
  pushIf(issues, !existsSync(resolve(root, providerPath)), 'CDB127E_PROVIDER_MODULE_MISSING');
  pushIf(issues, !existsSync(resolve(root, adapterPath)), 'CDB127E_ADAPTER_MODULE_MISSING');
  if (existsSync(resolve(root, providerPath))) {
    const provider = readText(root, providerPath);
    for (const required of [
      'legacy', 'shadow', 'canonical', 'canonical_emergency_case_triage_provider_v1',
      'exact canonical emergency case mapping is required',
      'exact canonical emergency case mapping does not resolve',
      'canonical_emergency_arrival_assessments',
      'canonical_emergency_case_status_events',
      'canonical_emergency_triage_assessments',
      'canonical_emergency_case_classifications',
      'canonical_emergency_disposition_events',
    ]) pushIf(issues, !provider.includes(required), `CDB127E_PROVIDER_EVIDENCE:${required}`);
  }
  if (existsSync(resolve(root, adapterPath))) {
    const adapters = readText(root, adapterPath);
    for (const required of EXPECTED_ADAPTERS) {
      pushIf(issues, !adapters.includes(`function ${required}`), `CDB127E_ADAPTER_EVIDENCE:${required}`);
    }
    for (const required of ['mismatchCount', 'criticalMismatchCount', 'acceptedExceptionCount', 'evidenceSha256']) {
      pushIf(issues, !adapters.includes(required), `CDB127E_SHADOW_EVIDENCE:${required}`);
    }
  }

  for (const key of REQUIRED_PROVIDER_EVIDENCE) {
    pushIf(issues, readiness.providerEvidence[key] !== true, `CDB127E_PROVIDER_EVIDENCE_FLAG:${key}`);
  }
  for (const key of REQUIRED_IMPLEMENTATION_EVIDENCE) {
    pushIf(issues, readiness.implementationEvidence[key] !== true, `CDB127E_IMPLEMENTATION_EVIDENCE:${key}`);
  }
  pushIf(
    issues,
    readiness.implementationEvidence.reconciliationChecksPassed !== 24,
    'CDB127E_RECONCILIATION_EVIDENCE_COUNT',
  );
  pushIf(issues, readiness.targetTableCount !== 6, 'CDB127E_TABLE_COUNT');
  pushIf(issues, readiness.atomicCommandCount !== 9, 'CDB127E_COMMAND_COUNT');
  pushIf(issues, readiness.persistentBackfillPartitionCount !== 8, 'CDB127E_PARTITION_COUNT');
  pushIf(issues, readiness.fixedReconciliationCheckCount !== 24, 'CDB127E_RECONCILIATION_COUNT');
  pushIf(issues, readiness.localReady !== true, 'CDB127E_LOCAL_READY_CLAIM');

  const activeProductionGates = Object.entries(readiness.productionGates)
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  pushIf(
    issues,
    readiness.productionReady === true && activeProductionGates.length !== Object.keys(readiness.productionGates).length,
    'CDB127E_PREMATURE_PRODUCTION_READY',
  );
  pushIf(
    issues,
    readiness.productionReady !== false,
    'CDB127E_PRODUCTION_READY_MUST_REMAIN_FALSE',
  );

  const localReady = issues.length === 0;
  const productionReady = localReady
    && readiness.productionReady === true
    && readiness.providerEnabled === true
    && readiness.routeCutoverPerformed === true
    && activeProductionGates.length === Object.keys(readiness.productionGates).length;
  return {
    localReady,
    productionReady,
    issues,
    selectedAdapterCount: coverage.selectedAdapterCount,
    knownWriterCount: coverage.knownWriterCount,
    knownReaderCount: coverage.knownReaderCount,
    routeActivationCount: coverage.routeActivationCount,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = checkEmergencyCaseTriageReadiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.localReady) process.exitCode = 1;
}
