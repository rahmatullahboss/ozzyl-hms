import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PrescriptionMedicationProviderCoverage {
  version: number;
  checkpoint: string;
  scope: string;
  provider: {
    modulePath: string;
    adapterPath: string;
    flagKey: string;
    enabledByDefault: boolean;
    defaultMode: string;
    supportedModes: string[];
    rollbackMode: string;
  };
  selectedAdapters: Array<{
    consumerId: string;
    adapterFunction: string;
    projectionKind: string;
    sourceTypes: string[];
    adoptionState: string;
    routeActivated: boolean;
  }>;
  knownReaders: Array<{
    path: string;
    assignment: string;
    selectedAdapterId: string;
    secondaryAdapterId?: string;
    runtimeState: string;
  }>;
  identityPolicy: {
    exactSourceMappingRequiredForCanonicalMode: boolean;
    exactTenantPatientLinkRequired: boolean;
    exactEncounterEvidenceRequired: boolean;
    exactPractitionerEvidenceRequired: boolean;
    nameTextNumericOrTimeFallbackAllowed: boolean;
  };
  separationPolicy: {
    prescriptionDocumentSeparateFromMedicationOrder: boolean;
    medicationAdministrationIncluded: boolean;
    medicationReconciliationIncluded: boolean;
    fulfilmentIncluded: boolean;
    stockIncluded: boolean;
    billingOrPaymentIncluded: boolean;
  };
  summary: {
    selectedAdapterCount: number;
    knownReaderCount: number;
    unknownReaderAssignments: number;
    routeActivationCount: number;
  };
  safety: {
    providerFlagChanged: boolean;
    routeChanged: boolean;
    trafficChanged: boolean;
    productionObservationPresent: boolean;
    legacyRetirementApproved: boolean;
  };
}

export interface PrescriptionMedicationReadinessEvidence {
  version: number;
  checkpoint: string;
  scope: string;
  provider: {
    modulePath: string;
    adapterPath: string;
    coveragePath: string;
    flagKey: string;
    enabledByDefault: boolean;
    defaultMode: string;
    rollbackMode: string;
  };
  requiredEvidence: Array<{ kind: string; path: string }>;
  gates: {
    schema: string;
    commands: string;
    backfill: string;
    reconciliation: string;
    provider: string;
    selectedReaders: string;
    production: string;
    retirement: string;
  };
  claims: {
    localReady: boolean;
    productionReady: boolean;
    providerEnabled: boolean;
    routeCutoverPerformed: boolean;
    productionObservationPresent: boolean;
    legacyRetirementApproved: boolean;
    legacyRuntimeChanged: boolean;
    productionMutationPerformed: boolean;
    productionQueryPerformed: boolean;
    localSyncActivated: boolean;
    pushPerformed: boolean;
    mainIntegrationPerformed: boolean;
  };
  blockers: string[];
  safety: {
    phiMinimisedEvidence: boolean;
    prescriptionAndMedicationOrderSeparated: boolean;
    administrationExcluded: boolean;
    medicationReconciliationExcluded: boolean;
    fulfilmentExcluded: boolean;
    stockBillingPaymentExcluded: boolean;
    textOrTimeIdentityFallbackAllowed: boolean;
  };
}

export interface PrescriptionMedicationReadinessResult {
  localReady: boolean;
  productionReady: false;
  issues: string[];
  issueCount: number;
  selectedAdapterCount: number;
  knownReaderCount: number;
  unknownReaderAssignments: number;
  blockedGateCount: number;
}

const CHECKPOINT = 'CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-DISABLED-PROVIDERS-READINESS';
const COVERAGE_PATH = 'docs/database/canonical-prescription-medication-provider-coverage.json';
const READINESS_PATH = 'docs/database/prescription-medication-readiness.json';
const FLAG_KEY = 'canonical_prescription_medication_provider_v1';
const EXPECTED_READERS = new Set([
  'src/routes/global-portal.ts',
  'src/routes/tenant/patients-chart.ts',
  'src/routes/tenant/nursing/clinical-summary.ts',
]);
const EXPECTED_ADAPTERS = new Set([
  'cdb121e_prescription_detail',
  'cdb121e_medication_order_detail',
]);

function parseJson<T>(root: string, relativePath: string, issues: string[]): T | null {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    issues.push(`readiness artifact is missing: ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
  } catch {
    issues.push(`readiness artifact is invalid JSON: ${relativePath}`);
    return null;
  }
}

function exactSet(values: string[], expected: Set<string>): boolean {
  return values.length === expected.size
    && new Set(values).size === values.length
    && values.every((value) => expected.has(value));
}

function containsUnsafeEvidenceKey(value: unknown): boolean {
  return /patient_name|phone|medicine_name|dose_text|instructions_text/i.test(JSON.stringify(value));
}

export function validatePrescriptionMedicationReadiness(
  root: string,
  readiness: PrescriptionMedicationReadinessEvidence,
  coverage: PrescriptionMedicationProviderCoverage,
): string[] {
  const issues: string[] = [];

  if (readiness.version !== 1 || coverage.version !== 1) {
    issues.push('readiness and coverage version must equal 1');
  }
  if (readiness.checkpoint !== CHECKPOINT || coverage.checkpoint !== CHECKPOINT) {
    issues.push(`checkpoint must equal ${CHECKPOINT}`);
  }
  if (readiness.scope !== 'local_disabled_provider_readiness_only') {
    issues.push('readiness scope must remain local disabled-provider readiness only');
  }
  if (coverage.scope !== 'local_selected_library_adapter_contracts_only') {
    issues.push('coverage scope must remain selected local library-adapter contracts only');
  }

  if (readiness.provider.modulePath !== 'src/lib/canonical/prescription-medication-provider.ts'
    || coverage.provider.modulePath !== readiness.provider.modulePath) {
    issues.push('provider module path is invalid or inconsistent');
  }
  if (readiness.provider.adapterPath !== 'src/lib/canonical/prescription-medication-read-adapters.ts'
    || coverage.provider.adapterPath !== readiness.provider.adapterPath) {
    issues.push('provider adapter path is invalid or inconsistent');
  }
  if (readiness.provider.coveragePath !== COVERAGE_PATH) {
    issues.push('provider coverage path is invalid');
  }
  if (readiness.provider.flagKey !== FLAG_KEY || coverage.provider.flagKey !== FLAG_KEY) {
    issues.push('provider flag key is invalid');
  }
  if (readiness.provider.enabledByDefault || coverage.provider.enabledByDefault) {
    issues.push('provider must remain disabled by default');
  }
  if (readiness.provider.defaultMode !== 'legacy' || coverage.provider.defaultMode !== 'legacy') {
    issues.push('provider default mode must remain legacy');
  }
  if (readiness.provider.rollbackMode !== 'legacy' || coverage.provider.rollbackMode !== 'legacy') {
    issues.push('provider rollback mode must remain legacy');
  }
  if (!exactSet(coverage.provider.supportedModes, new Set(['legacy', 'shadow', 'canonical']))) {
    issues.push('provider supported modes must be legacy, shadow, and canonical');
  }

  if (coverage.summary.selectedAdapterCount !== 2
    || coverage.selectedAdapters.length !== 2
    || !exactSet(coverage.selectedAdapters.map((entry) => entry.consumerId), EXPECTED_ADAPTERS)) {
    issues.push('coverage must contain exactly two selected adapters');
  }
  if (coverage.selectedAdapters.some((entry) => entry.routeActivated)) {
    issues.push('selected adapters must not activate routes');
  }
  if (coverage.summary.routeActivationCount !== 0) {
    issues.push('route activation count must remain zero');
  }
  if (coverage.summary.knownReaderCount !== 3
    || coverage.knownReaders.length !== 3
    || !exactSet(coverage.knownReaders.map((entry) => entry.path), EXPECTED_READERS)) {
    issues.push('coverage must contain exactly the three reviewed readers');
  }
  const calculatedUnknown = coverage.knownReaders.filter((entry) => entry.assignment === 'unknown').length;
  if (coverage.summary.unknownReaderAssignments !== 0 || calculatedUnknown !== 0) {
    issues.push('coverage must contain zero unknown reader assignments');
  }
  if (coverage.knownReaders.some((entry) => entry.runtimeState !== 'legacy_unchanged')) {
    issues.push('reviewed readers must remain legacy unchanged');
  }

  if (!coverage.identityPolicy.exactSourceMappingRequiredForCanonicalMode
    || !coverage.identityPolicy.exactTenantPatientLinkRequired
    || !coverage.identityPolicy.exactEncounterEvidenceRequired
    || !coverage.identityPolicy.exactPractitionerEvidenceRequired
    || coverage.identityPolicy.nameTextNumericOrTimeFallbackAllowed) {
    issues.push('coverage identity policy must remain exact and fail closed');
  }
  if (!coverage.separationPolicy.prescriptionDocumentSeparateFromMedicationOrder
    || coverage.separationPolicy.medicationAdministrationIncluded
    || coverage.separationPolicy.medicationReconciliationIncluded
    || coverage.separationPolicy.fulfilmentIncluded
    || coverage.separationPolicy.stockIncluded
    || coverage.separationPolicy.billingOrPaymentIncluded) {
    issues.push('prescription and medication-order authority separation is invalid');
  }

  for (const entry of readiness.requiredEvidence) {
    if (!entry.path || !existsSync(join(root, entry.path))) {
      issues.push(`required evidence is missing: ${entry.path}`);
    }
  }
  const evidenceKinds = new Set(readiness.requiredEvidence.map((entry) => entry.kind));
  for (const kind of [
    'schema', 'schema_test', 'commands', 'command_test', 'backfill', 'backfill_test',
    'reconciliation', 'reconciliation_test', 'provider', 'adapter', 'provider_test',
    'backfill_reconciliation_receipt',
  ]) {
    if (!evidenceKinds.has(kind)) issues.push(`required evidence kind is missing: ${kind}`);
  }

  const expectedGates: Record<keyof PrescriptionMedicationReadinessEvidence['gates'], string> = {
    schema: 'passed',
    commands: 'passed',
    backfill: 'passed',
    reconciliation: 'passed',
    provider: 'passed_disabled',
    selectedReaders: 'passed_local_contracts',
    production: 'blocked',
    retirement: 'blocked',
  };
  for (const [key, expected] of Object.entries(expectedGates)) {
    if (readiness.gates[key as keyof typeof expectedGates] !== expected) {
      issues.push(`readiness gate ${key} must equal ${expected}`);
    }
  }

  if (!readiness.claims.localReady) issues.push('local readiness must be true');
  if (readiness.claims.productionReady) issues.push('production readiness must remain false');
  if (readiness.claims.providerEnabled) issues.push('provider activation must remain false');
  if (readiness.claims.routeCutoverPerformed) issues.push('route cutover must remain false');
  if (readiness.claims.productionObservationPresent) issues.push('production observation must remain absent');
  if (readiness.claims.legacyRetirementApproved) issues.push('legacy retirement approval must remain false');
  if (readiness.claims.legacyRuntimeChanged) issues.push('legacy runtime change must remain false');
  if (readiness.claims.productionMutationPerformed) issues.push('production mutation must remain false');
  if (readiness.claims.productionQueryPerformed) issues.push('production query must remain false');
  if (readiness.claims.localSyncActivated) issues.push('local sync activation must remain false');
  if (readiness.claims.pushPerformed) issues.push('push must remain false');
  if (readiness.claims.mainIntegrationPerformed) issues.push('main integration must remain false');

  if (readiness.blockers.length < 4) issues.push('readiness must retain explicit production and retirement blockers');
  if (!readiness.safety.phiMinimisedEvidence
    || !readiness.safety.prescriptionAndMedicationOrderSeparated
    || !readiness.safety.administrationExcluded
    || !readiness.safety.medicationReconciliationExcluded
    || !readiness.safety.fulfilmentExcluded
    || !readiness.safety.stockBillingPaymentExcluded
    || readiness.safety.textOrTimeIdentityFallbackAllowed) {
    issues.push('readiness safety claims are invalid');
  }
  if (coverage.safety.providerFlagChanged
    || coverage.safety.routeChanged
    || coverage.safety.trafficChanged
    || coverage.safety.productionObservationPresent
    || coverage.safety.legacyRetirementApproved) {
    issues.push('coverage safety state must remain disabled and unpromoted');
  }
  if (containsUnsafeEvidenceKey({ readiness, coverage })) {
    issues.push('readiness evidence contains unsafe clinical or identity field names');
  }

  return [...new Set(issues)];
}

export function checkPrescriptionMedicationReadiness(rootInput = process.cwd()): PrescriptionMedicationReadinessResult {
  const root = rootInput;
  const parseIssues: string[] = [];
  const coverage = parseJson<PrescriptionMedicationProviderCoverage>(root, COVERAGE_PATH, parseIssues);
  const readiness = parseJson<PrescriptionMedicationReadinessEvidence>(root, READINESS_PATH, parseIssues);
  const issues = coverage && readiness
    ? [...parseIssues, ...validatePrescriptionMedicationReadiness(root, readiness, coverage)]
    : parseIssues;
  const uniqueIssues = [...new Set(issues)];
  return {
    localReady: uniqueIssues.length === 0 && readiness?.claims.localReady === true,
    productionReady: false,
    issues: uniqueIssues,
    issueCount: uniqueIssues.length,
    selectedAdapterCount: coverage?.summary.selectedAdapterCount ?? 0,
    knownReaderCount: coverage?.summary.knownReaderCount ?? 0,
    unknownReaderAssignments: coverage?.summary.unknownReaderAssignments ?? 0,
    blockedGateCount: readiness == null
      ? 0
      : [readiness.gates.production, readiness.gates.retirement].filter((value) => value === 'blocked').length,
  };
}

function isMainModule(): boolean {
  const argvPath = process.argv[1];
  return argvPath != null && fileURLToPath(import.meta.url) === argvPath;
}

if (isMainModule()) {
  const result = checkPrescriptionMedicationReadiness(process.cwd());
  console.log(JSON.stringify(result, null, 2));
  if (result.issueCount > 0) process.exitCode = 1;
}
