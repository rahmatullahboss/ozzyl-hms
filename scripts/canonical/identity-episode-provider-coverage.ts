import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  AuthorityReaderAccess,
  CanonicalAuthorityAccessRegistry,
  ReaderProviderStatus,
} from './canonical-authority-access';

export type IdentityEpisodeProvider =
  | 'patient_identity'
  | 'practitioner'
  | 'appointment'
  | 'encounter'
  | 'admission_bed';

export type IdentityEpisodeAdoptionState =
  | 'inventory_only'
  | 'selected_library_adapter';

export interface IdentityEpisodeProviderDefinition {
  provider: IdentityEpisodeProvider;
  modulePath: string;
  flagKey: string;
  rollbackMode: 'legacy';
  conceptIds: string[];
}

export interface IdentityEpisodeProviderCoverageEntry {
  consumerId: string;
  provider: IdentityEpisodeProvider;
  providerModule: string;
  flagKey: string;
  rollbackMode: 'legacy';
  adoptionState: IdentityEpisodeAdoptionState;
  path: string;
  table: string;
  operations: string[];
  detectionMethods: string[];
  conceptIds: string[];
  domains: string[];
  owner: string;
  providerStatus: ReaderProviderStatus;
  retirementBlocker: string;
  targetProvider: string;
}

export interface IdentityEpisodeProviderCoverageSummary {
  eligibleReaderPairs: number;
  uniquePaths: number;
  uniqueTables: number;
  unknownProviderAssignments: number;
  providerStatusCounts: Record<ReaderProviderStatus, number>;
  providerCounts: Record<IdentityEpisodeProvider, number>;
  providerStatusDistribution: Record<IdentityEpisodeProvider, Record<ReaderProviderStatus, number>>;
  selectedAdapterCount: number;
}

export interface IdentityEpisodeProviderCoverageRegistry {
  version: 1;
  program: 'HMS Canonical Data Architecture';
  checkpoint: 'CDB-113F-IDENTITY-EPISODE-READ-PROMOTION';
  sourceRegistryPath: string;
  sourceRegistrySha256: string;
  providers: IdentityEpisodeProviderDefinition[];
  summary: IdentityEpisodeProviderCoverageSummary;
  entries: IdentityEpisodeProviderCoverageEntry[];
  unknownEntries: Array<Pick<AuthorityReaderAccess, 'path' | 'table' | 'conceptIds' | 'providerStatus'>>;
  safety: {
    productionReady: false;
    providerFlagsEnabledByDefault: false;
    routeCutoverClaimed: false;
    rollbackMode: 'legacy';
  };
}

const SOURCE_REGISTRY_PATH = 'docs/database/canonical-authority-access-registry.yaml';
const NON_CONSUMER_READER_PATHS = new Set([
  // Added by CDB-113F itself. Provider implementation reads are governed access,
  // but are not operational consumer pairs in the reviewed 619-reader inventory.
  'src/lib/canonical/patient-identity-provider.ts',
  // CDB-113G production observation is a governance probe over the existing
  // inventory, not an operational route/library consumer eligible for promotion.
  'scripts/canonical/identity-episode-production-observation.ts',
]);

export const IDENTITY_EPISODE_PROVIDER_DEFINITIONS: IdentityEpisodeProviderDefinition[] = [
  {
    provider: 'patient_identity',
    modulePath: 'src/lib/canonical/patient-identity-provider.ts',
    flagKey: 'canonical_patient_identity_provider_v1',
    rollbackMode: 'legacy',
    conceptIds: ['patient_identity', 'tenant_patient_linkage'],
  },
  {
    provider: 'practitioner',
    modulePath: 'src/lib/canonical/practitioner-provider.ts',
    flagKey: 'canonical_practitioner_provider_v1',
    rollbackMode: 'legacy',
    conceptIds: ['practitioner_identity', 'practitioner_account_links'],
  },
  {
    provider: 'appointment',
    modulePath: 'src/lib/canonical/appointment-provider.ts',
    flagKey: 'canonical_appointment_provider_v1',
    rollbackMode: 'legacy',
    conceptIds: ['appointment_intent'],
  },
  {
    provider: 'encounter',
    modulePath: 'src/lib/canonical/encounter-provider.ts',
    flagKey: 'canonical_encounter_provider_v1',
    rollbackMode: 'legacy',
    conceptIds: ['encounter_care_episode', 'emergency_case_extension', 'clinical_document_diagnosis'],
  },
  {
    provider: 'admission_bed',
    modulePath: 'src/lib/canonical/admission-bed-provider.ts',
    flagKey: 'canonical_admission_bed_provider_v1',
    rollbackMode: 'legacy',
    conceptIds: ['inpatient_admission_link', 'bed_occupancy_interval'],
  },
];

const ELIGIBLE_CONCEPTS = new Set(
  IDENTITY_EPISODE_PROVIDER_DEFINITIONS.flatMap((definition) => definition.conceptIds),
);

const PATIENT_TABLES = new Set([
  'patients',
  'global_patient_identity',
  'canonical_tenant_patient_links',
  'canonical_tenant_patient_link_events',
  'patient_aliases',
  'mpi_duplicate_suspects',
]);
const PRACTITIONER_TABLES = new Set([
  'doctors',
  'users',
  'employees',
  'doctor_schedules',
  'canonical_practitioners',
  'canonical_practitioner_identifiers',
  'canonical_practitioner_user_links',
  'canonical_practitioner_employee_links',
  'canonical_practitioner_classifications',
]);
const APPOINTMENT_TABLES = new Set([
  'appointments',
  'canonical_appointments',
  'canonical_appointment_status_events',
  'canonical_appointment_encounter_links',
]);
const ENCOUNTER_TABLES = new Set([
  'encounters',
  'visits',
  'canonical_encounters',
  'canonical_encounter_participants',
  'canonical_encounter_admission_links',
  'emergency_cases',
]);
const ADMISSION_BED_TABLES = new Set([
  'admissions',
  'beds',
  'patient_bed_infos',
  'canonical_admissions',
  'canonical_admission_status_events',
  'canonical_care_locations',
  'canonical_beds',
  'canonical_bed_stays',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function directProviderForTable(table: string): IdentityEpisodeProvider | null {
  if (PATIENT_TABLES.has(table)) return 'patient_identity';
  if (PRACTITIONER_TABLES.has(table)) return 'practitioner';
  if (APPOINTMENT_TABLES.has(table)) return 'appointment';
  if (ENCOUNTER_TABLES.has(table)) return 'encounter';
  if (ADMISSION_BED_TABLES.has(table)) return 'admission_bed';
  return null;
}

function consultationProvider(path: string): IdentityEpisodeProvider {
  const normalized = path.toLowerCase();
  if (
    normalized.includes('appointment')
    || normalized.includes('marketplace')
    || normalized.includes('reminder')
    || normalized.includes('scheduling')
    || normalized.includes('backfill-appointment')
    || normalized.includes('reconcile-appointment')
  ) return 'appointment';
  return 'encounter';
}

export function classifyIdentityEpisodeReader(
  reader: AuthorityReaderAccess,
): IdentityEpisodeProvider | null {
  if (!reader.conceptIds.some((conceptId) => ELIGIBLE_CONCEPTS.has(conceptId))) return null;
  if (reader.table === 'consultations') return consultationProvider(reader.path);

  const direct = directProviderForTable(reader.table);
  if (direct) return direct;

  const candidates = IDENTITY_EPISODE_PROVIDER_DEFINITIONS
    .filter((definition) => definition.conceptIds.some((conceptId) => reader.conceptIds.includes(conceptId)))
    .map((definition) => definition.provider);
  const unique = sortedUnique(candidates) as IdentityEpisodeProvider[];
  return unique.length === 1 ? unique[0] : null;
}

function consumerId(reader: AuthorityReaderAccess, provider: IdentityEpisodeProvider): string {
  return `iep_${sha256(JSON.stringify([1, provider, reader.path, reader.table])).slice(0, 24)}`;
}

function emptyStatusCounts(): Record<ReaderProviderStatus, number> {
  return { canonical: 0, shadow: 0, legacy: 0, compatibility: 0, external: 0 };
}

function emptyProviderCounts(): Record<IdentityEpisodeProvider, number> {
  return { patient_identity: 0, practitioner: 0, appointment: 0, encounter: 0, admission_bed: 0 };
}

function providerDefinition(provider: IdentityEpisodeProvider): IdentityEpisodeProviderDefinition {
  const definition = IDENTITY_EPISODE_PROVIDER_DEFINITIONS.find((entry) => entry.provider === provider);
  if (!definition) throw new Error(`Missing provider definition: ${provider}`);
  return definition;
}

function selectedConsumers(entries: IdentityEpisodeProviderCoverageEntry[]): Set<string> {
  const selected = new Set<string>();
  for (const definition of IDENTITY_EPISODE_PROVIDER_DEFINITIONS) {
    const first = entries.find((entry) => entry.provider === definition.provider);
    if (first) selected.add(first.consumerId);
  }
  return selected;
}

export function buildIdentityEpisodeProviderCoverageRegistry(
  rootInput: string,
): IdentityEpisodeProviderCoverageRegistry {
  const root = resolve(rootInput);
  const absoluteSource = join(root, SOURCE_REGISTRY_PATH);
  if (!existsSync(absoluteSource)) {
    throw new Error(`Canonical authority access registry is missing: ${SOURCE_REGISTRY_PATH}`);
  }
  const raw = readFileSync(absoluteSource, 'utf8');
  const source = JSON.parse(raw) as CanonicalAuthorityAccessRegistry;
  const unknownEntries: IdentityEpisodeProviderCoverageRegistry['unknownEntries'] = [];
  const entries: IdentityEpisodeProviderCoverageEntry[] = [];

  for (const reader of source.readers) {
    if (NON_CONSUMER_READER_PATHS.has(reader.path)) continue;
    if (!reader.conceptIds.some((conceptId) => ELIGIBLE_CONCEPTS.has(conceptId))) continue;
    const provider = classifyIdentityEpisodeReader(reader);
    if (!provider) {
      unknownEntries.push({
        path: reader.path,
        table: reader.table,
        conceptIds: [...reader.conceptIds],
        providerStatus: reader.providerStatus,
      });
      continue;
    }
    const definition = providerDefinition(provider);
    entries.push({
      consumerId: consumerId(reader, provider),
      provider,
      providerModule: definition.modulePath,
      flagKey: definition.flagKey,
      rollbackMode: definition.rollbackMode,
      adoptionState: 'inventory_only',
      path: reader.path,
      table: reader.table,
      operations: [...reader.operations],
      detectionMethods: [...reader.detectionMethods],
      conceptIds: [...reader.conceptIds],
      domains: [...reader.domains],
      owner: reader.owner,
      providerStatus: reader.providerStatus,
      retirementBlocker: reader.retirementBlocker,
      targetProvider: reader.targetProvider,
    });
  }

  entries.sort((a, b) =>
    a.provider.localeCompare(b.provider)
    || a.path.localeCompare(b.path)
    || a.table.localeCompare(b.table)
    || a.consumerId.localeCompare(b.consumerId));
  const selected = selectedConsumers(entries);
  for (const entry of entries) {
    if (selected.has(entry.consumerId)) entry.adoptionState = 'selected_library_adapter';
  }

  const providerStatusCounts = emptyStatusCounts();
  const providerCounts = emptyProviderCounts();
  const providerStatusDistribution = Object.fromEntries(
    IDENTITY_EPISODE_PROVIDER_DEFINITIONS.map((definition) => [definition.provider, emptyStatusCounts()]),
  ) as Record<IdentityEpisodeProvider, Record<ReaderProviderStatus, number>>;
  for (const entry of entries) {
    providerStatusCounts[entry.providerStatus] += 1;
    providerCounts[entry.provider] += 1;
    providerStatusDistribution[entry.provider][entry.providerStatus] += 1;
  }

  return {
    version: 1,
    program: 'HMS Canonical Data Architecture',
    checkpoint: 'CDB-113F-IDENTITY-EPISODE-READ-PROMOTION',
    sourceRegistryPath: SOURCE_REGISTRY_PATH,
    sourceRegistrySha256: sha256(raw),
    providers: IDENTITY_EPISODE_PROVIDER_DEFINITIONS.map((definition) => ({
      ...definition,
      conceptIds: [...definition.conceptIds],
    })),
    summary: {
      eligibleReaderPairs: entries.length + unknownEntries.length,
      uniquePaths: new Set([...entries.map((entry) => entry.path), ...unknownEntries.map((entry) => entry.path)]).size,
      uniqueTables: new Set([...entries.map((entry) => entry.table), ...unknownEntries.map((entry) => entry.table)]).size,
      unknownProviderAssignments: unknownEntries.length,
      providerStatusCounts,
      providerCounts,
      providerStatusDistribution,
      selectedAdapterCount: selected.size,
    },
    entries,
    unknownEntries: unknownEntries.sort((a, b) => a.path.localeCompare(b.path) || a.table.localeCompare(b.table)),
    safety: {
      productionReady: false,
      providerFlagsEnabledByDefault: false,
      routeCutoverClaimed: false,
      rollbackMode: 'legacy',
    },
  };
}

export const EXPECTED_IDENTITY_EPISODE_COVERAGE = {
  eligibleReaderPairs: 859,
  uniquePaths: 297,
  uniqueTables: 63,
  unknownProviderAssignments: 0,
  providerStatusCounts: {
    legacy: 417,
    compatibility: 85,
    canonical: 266,
    external: 89,
    shadow: 2,
  },
  providerStatusDistribution: {
    patient_identity: { legacy: 139, compatibility: 12, canonical: 43, external: 19, shadow: 0 },
    practitioner: { legacy: 82, compatibility: 10, canonical: 74, external: 70, shadow: 0 },
    appointment: { legacy: 31, compatibility: 9, canonical: 13, external: 0, shadow: 0 },
    encounter: { legacy: 96, compatibility: 37, canonical: 106, external: 0, shadow: 0 },
    admission_bed: { legacy: 69, compatibility: 17, canonical: 30, external: 0, shadow: 2 },
  },
} as const;

export function validateIdentityEpisodeProviderCoverageRegistry(
  registry: IdentityEpisodeProviderCoverageRegistry,
  rootInput: string,
): string[] {
  const issues: string[] = [];
  const root = resolve(rootInput);
  const sourcePath = join(root, registry.sourceRegistryPath);
  const sourceRaw = existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '';
  if (!sourceRaw) issues.push('source registry is missing');
  else if (sha256(sourceRaw) !== registry.sourceRegistrySha256) issues.push('source registry hash is stale');

  const expected = EXPECTED_IDENTITY_EPISODE_COVERAGE;
  for (const key of ['eligibleReaderPairs', 'uniquePaths', 'uniqueTables', 'unknownProviderAssignments'] as const) {
    if (registry.summary[key] !== expected[key]) {
      issues.push(`${key} expected ${expected[key]} but received ${registry.summary[key]}`);
    }
  }
  for (const [status, count] of Object.entries(expected.providerStatusCounts)) {
    if (registry.summary.providerStatusCounts[status as ReaderProviderStatus] !== count) {
      issues.push(`provider status ${status} expected ${count}`);
    }
  }
  for (const [provider, expectedStatuses] of Object.entries(expected.providerStatusDistribution)) {
    const actualStatuses = registry.summary.providerStatusDistribution[provider as IdentityEpisodeProvider];
    for (const [status, count] of Object.entries(expectedStatuses)) {
      if (actualStatuses[status as ReaderProviderStatus] !== count) {
        issues.push(`provider ${provider} status ${status} expected ${count}`);
      }
    }
  }
  for (const definition of registry.providers) {
    if (!existsSync(join(root, definition.modulePath))) issues.push(`provider module is missing: ${definition.modulePath}`);
    if (!definition.flagKey.trim()) issues.push(`provider flag is missing: ${definition.provider}`);
    if (definition.rollbackMode !== 'legacy') issues.push(`rollback mode is invalid: ${definition.provider}`);
  }
  const consumerIds = registry.entries.map((entry) => entry.consumerId);
  if (new Set(consumerIds).size !== consumerIds.length) issues.push('duplicate consumer IDs exist');
  if (registry.unknownEntries.length > 0) issues.push('unknown provider assignments exist');
  if (registry.entries.some((entry) => !IDENTITY_EPISODE_PROVIDER_DEFINITIONS.some(
    (definition) => definition.provider === entry.provider,
  ))) issues.push('entry has unsupported provider');
  if (registry.summary.selectedAdapterCount < IDENTITY_EPISODE_PROVIDER_DEFINITIONS.length) {
    issues.push('selected adapters do not cover all provider families');
  }
  if (registry.safety.productionReady || registry.safety.providerFlagsEnabledByDefault || registry.safety.routeCutoverClaimed) {
    issues.push('coverage registry makes an unsafe runtime claim');
  }
  return issues;
}
