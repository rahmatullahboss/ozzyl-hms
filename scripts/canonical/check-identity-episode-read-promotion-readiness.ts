import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  IdentityEpisodeProvider,
  IdentityEpisodeProviderCoverageRegistry,
} from './identity-episode-provider-coverage';

const EVIDENCE_PATH = 'docs/database/identity-episode-read-promotion-evidence.json';
const RETIREMENT_GATES_PATH = 'docs/database/legacy-write-retirement-gates.yaml';

export interface IdentityEpisodeReadPromotionEvidence {
  version: number;
  checkpoint: string;
  scope: string;
  coverage: {
    registryPath: string;
    registrySha256: string;
    sourceRegistrySha256: string;
    eligibleReaderPairs: number;
    uniquePaths: number;
    uniqueTables: number;
    unknownProviderAssignments: number;
  };
  providers: Array<{
    provider: IdentityEpisodeProvider;
    modulePath: string;
    flagKey: string;
    enabledByDefault: boolean;
  }>;
  selectedAdapters: Array<{
    provider: IdentityEpisodeProvider;
    consumerId: string;
    adapterId: string;
  }>;
  focusedTests: string[];
  secondPassEvidence: string[];
  mappingPolicy: {
    requiresExactTenantScopedMapping: boolean;
    acceptedIssueIds: string[];
    namePhoneLabelNumericOrTimeMatchingAllowed: boolean;
  };
  localShadowEvidence: {
    criticalUnexplainedVarianceCount: number;
    errorCount: number;
    latencyBudgetMs: number;
    maxObservedElapsedMs: number;
    acceptedExceptionIds: string[];
  };
  rollback: {
    mode: string;
    description: string;
  };
  claims: {
    localSelectedAdapterEvidenceComplete: boolean;
    productionObservationPresent: boolean;
    ownerAuthorizationPresent: boolean;
    productionReady: boolean;
    legacyRetirementApproved: boolean;
  };
  safety: Record<string, boolean>;
}

interface RetirementGate {
  id: string;
  productionCutoverComplete: boolean;
  canonicalReadPromotionComplete: boolean;
  observationComplete: boolean;
  rollbackEvidenceFresh: boolean;
  ownerAuthorizationPresent: boolean;
  legacyAuthorityRetirementApproved: boolean;
  compatibilityAdapterRetirementApproved: boolean;
  fixtureRetirementApproved: boolean;
}
interface RetirementGateRegistry { domains: RetirementGate[] }

export interface IdentityEpisodeReadinessResult {
  localReady: boolean;
  productionReady: false;
  issues: string[];
  checkedProviderCount: number;
  checkedAdapterCount: number;
  blockedRetirementGateCount: number;
}

const PROVIDERS: IdentityEpisodeProvider[] = [
  'patient_identity',
  'practitioner',
  'appointment',
  'encounter',
  'admission_bed',
];
const REQUIRED_RETIREMENT_GATES = [
  'patient_identity',
  'practitioner_identity',
  'appointment_intent',
  'encounter_care_episode',
  'inpatient_admission_bed_occupancy',
];

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function readJson<T>(root: string, path: string): T {
  const absolute = join(root, path);
  if (!existsSync(absolute)) throw new Error(`required evidence is missing: ${path}`);
  return JSON.parse(readFileSync(absolute, 'utf8')) as T;
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export function evaluateIdentityEpisodeReadPromotionReadiness(
  rootInput: string,
  evidenceOverride?: IdentityEpisodeReadPromotionEvidence,
): IdentityEpisodeReadinessResult {
  const root = resolve(rootInput);
  const issues: string[] = [];
  let evidence: IdentityEpisodeReadPromotionEvidence;
  try {
    evidence = evidenceOverride ?? readJson<IdentityEpisodeReadPromotionEvidence>(root, EVIDENCE_PATH);
  } catch (error) {
    return {
      localReady: false,
      productionReady: false,
      issues: [error instanceof Error ? error.message : String(error)],
      checkedProviderCount: 0,
      checkedAdapterCount: 0,
      blockedRetirementGateCount: 0,
    };
  }

  let registry: IdentityEpisodeProviderCoverageRegistry | null = null;
  const coveragePath = join(root, evidence.coverage.registryPath);
  if (!existsSync(coveragePath)) {
    issues.push('coverage registry is missing');
  } else {
    const raw = readFileSync(coveragePath, 'utf8');
    if (sha256(raw) !== evidence.coverage.registrySha256) issues.push('coverage registry hash is stale');
    try {
      registry = JSON.parse(raw) as IdentityEpisodeProviderCoverageRegistry;
    } catch {
      issues.push('coverage registry is invalid JSON');
    }
  }

  if (registry) {
    if (registry.sourceRegistrySha256 !== evidence.coverage.sourceRegistrySha256) {
      issues.push('coverage source registry hash is stale');
    }
    const expectedCounts = {
      eligibleReaderPairs: 859,
      uniquePaths: 297,
      uniqueTables: 63,
      unknownProviderAssignments: 0,
    };
    for (const [key, expected] of Object.entries(expectedCounts)) {
      const actualEvidence = evidence.coverage[key as keyof typeof expectedCounts];
      const actualRegistry = registry.summary[key as keyof typeof expectedCounts];
      if (actualEvidence !== expected || actualRegistry !== expected) {
        issues.push(`coverage ${key} must equal ${expected}`);
      }
    }
  }

  const providerNames = evidence.providers.map((provider) => provider.provider);
  if (!unique(providerNames) || providerNames.length !== PROVIDERS.length
    || PROVIDERS.some((provider) => !providerNames.includes(provider))) {
    issues.push('all five provider families must appear exactly once');
  }
  for (const provider of evidence.providers) {
    if (!existsSync(join(root, provider.modulePath))) issues.push(`provider module is missing: ${provider.modulePath}`);
    if (provider.enabledByDefault) issues.push(`provider is enabled by default: ${provider.provider}`);
    const coverageProvider = registry?.providers.find((entry) => entry.provider === provider.provider);
    if (!coverageProvider || coverageProvider.modulePath !== provider.modulePath || coverageProvider.flagKey !== provider.flagKey) {
      issues.push(`provider evidence does not match coverage: ${provider.provider}`);
    }
  }

  const adapterConsumers = evidence.selectedAdapters.map((adapter) => adapter.consumerId);
  const adapterIds = evidence.selectedAdapters.map((adapter) => adapter.adapterId);
  if (!unique(adapterConsumers) || !unique(adapterIds) || evidence.selectedAdapters.length !== PROVIDERS.length) {
    issues.push('selected adapters must contain five unique provider consumers and adapter IDs');
  }
  for (const provider of PROVIDERS) {
    const adapter = evidence.selectedAdapters.find((entry) => entry.provider === provider);
    if (!adapter) {
      issues.push(`selected adapter is missing: ${provider}`);
      continue;
    }
    const covered = registry?.entries.find((entry) => entry.consumerId === adapter.consumerId);
    if (!covered || covered.provider !== provider || covered.adoptionState !== 'selected_library_adapter') {
      issues.push(`selected adapter coverage is invalid: ${provider}`);
    }
  }

  if (evidence.focusedTests.length === 0 || evidence.focusedTests.some((path) => !existsSync(join(root, path)))) {
    issues.push('focused test evidence is missing');
  }
  if (evidence.secondPassEvidence.length < 4
    || evidence.secondPassEvidence.some((path) => !existsSync(join(root, path)))) {
    issues.push('second-pass authority evidence is missing');
  }
  if (!evidence.mappingPolicy.requiresExactTenantScopedMapping
    || evidence.mappingPolicy.namePhoneLabelNumericOrTimeMatchingAllowed) {
    issues.push('identity-sensitive mapping policy is unsafe');
  }
  if (evidence.mappingPolicy.acceptedIssueIds.some((value) => !value.trim())) {
    issues.push('accepted mapping issue IDs must be stable and non-empty');
  }

  if (evidence.localShadowEvidence.criticalUnexplainedVarianceCount !== 0) {
    issues.push('critical unexplained local variance exists');
  }
  if (evidence.localShadowEvidence.errorCount !== 0) issues.push('local provider errors exist');
  if (evidence.localShadowEvidence.latencyBudgetMs <= 0
    || evidence.localShadowEvidence.maxObservedElapsedMs > evidence.localShadowEvidence.latencyBudgetMs) {
    issues.push('local latency budget evidence failed');
  }
  if (evidence.localShadowEvidence.acceptedExceptionIds.some((value) => !value.trim())) {
    issues.push('accepted exception IDs must be stable and non-empty');
  }

  if (evidence.rollback.mode !== 'legacy' || !/retain|retaining/i.test(evidence.rollback.description)) {
    issues.push('rollback must return to legacy while retaining canonical evidence');
  }
  if (!evidence.claims.localSelectedAdapterEvidenceComplete) issues.push('local selected-adapter evidence is incomplete');
  if (evidence.claims.productionObservationPresent) issues.push('production observation must remain absent');
  if (evidence.claims.ownerAuthorizationPresent) issues.push('owner authorization must remain absent');
  if (evidence.claims.productionReady) issues.push('production-ready claim is forbidden');
  if (evidence.claims.legacyRetirementApproved) issues.push('legacy retirement approval is forbidden');
  if (Object.values(evidence.safety).some(Boolean)) issues.push('unsafe runtime or repository mutation is claimed');

  let blockedRetirementGateCount = 0;
  try {
    const gates = readJson<RetirementGateRegistry>(root, RETIREMENT_GATES_PATH);
    for (const gateId of REQUIRED_RETIREMENT_GATES) {
      const gate = gates.domains.find((entry) => entry.id === gateId);
      if (!gate) {
        issues.push(`retirement gate is missing: ${gateId}`);
        continue;
      }
      const blocked = !gate.productionCutoverComplete
        && !gate.canonicalReadPromotionComplete
        && !gate.observationComplete
        && !gate.rollbackEvidenceFresh
        && !gate.ownerAuthorizationPresent
        && !gate.legacyAuthorityRetirementApproved
        && !gate.compatibilityAdapterRetirementApproved
        && !gate.fixtureRetirementApproved;
      if (!blocked) issues.push(`retirement gate is not fully blocked: ${gateId}`);
      else blockedRetirementGateCount += 1;
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  return {
    localReady: issues.length === 0,
    productionReady: false,
    issues,
    checkedProviderCount: evidence.providers.length,
    checkedAdapterCount: evidence.selectedAdapters.length,
    blockedRetirementGateCount,
  };
}

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const result = evaluateIdentityEpisodeReadPromotionReadiness(root);
  console.log(JSON.stringify(result, null, 2));
  if (!result.localReady) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
