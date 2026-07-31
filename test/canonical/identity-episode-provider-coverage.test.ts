import { describe, expect, it } from 'vitest';
import type { AuthorityReaderAccess } from '../../scripts/canonical/canonical-authority-access';
import {
  buildIdentityEpisodeProviderCoverageRegistry,
  classifyIdentityEpisodeReader,
  validateIdentityEpisodeProviderCoverageRegistry,
} from '../../scripts/canonical/identity-episode-provider-coverage';

const root = process.cwd();

function reader(input: Partial<AuthorityReaderAccess> & Pick<AuthorityReaderAccess, 'path' | 'table' | 'conceptIds'>): AuthorityReaderAccess {
  return {
    path: input.path,
    table: input.table,
    conceptIds: input.conceptIds,
    operations: input.operations ?? ['from'],
    detectionMethods: input.detectionMethods ?? ['raw_sql'],
    domains: input.domains ?? ['clinical'],
    owner: input.owner ?? 'test',
    providerStatus: input.providerStatus ?? 'legacy',
    retirementBlocker: input.retirementBlocker ?? 'test only',
    targetProvider: input.targetProvider ?? 'test provider',
  };
}

describe('identity and episode provider coverage registry', () => {
  it('builds the exact reviewed inventory and provider distribution', () => {
    const registry = buildIdentityEpisodeProviderCoverageRegistry(root);
    expect(registry.summary).toMatchObject({
      eligibleReaderPairs: 859,
      uniquePaths: 297,
      uniqueTables: 63,
      unknownProviderAssignments: 0,
      providerCounts: {
        patient_identity: 213,
        practitioner: 236,
        appointment: 53,
        encounter: 239,
        admission_bed: 118,
      },
      providerStatusCounts: {
        legacy: 417,
        compatibility: 85,
        canonical: 266,
        external: 89,
        shadow: 2,
      },
      selectedAdapterCount: 5,
    });
    expect(registry.entries).toHaveLength(859);
    expect(registry.unknownEntries).toEqual([]);
    expect(validateIdentityEpisodeProviderCoverageRegistry(registry, root)).toEqual([]);
  });

  it('is deterministic and assigns stable non-PHI consumer IDs', () => {
    const first = buildIdentityEpisodeProviderCoverageRegistry(root);
    const second = buildIdentityEpisodeProviderCoverageRegistry(root);
    expect(second).toEqual(first);
    expect(first.sourceRegistrySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.entries.every((entry) => /^iep_[0-9a-f]{24}$/.test(entry.consumerId))).toBe(true);
    expect(new Set(first.entries.map((entry) => entry.consumerId)).size).toBe(859);
    expect(JSON.stringify(first.entries.map((entry) => entry.consumerId))).not.toMatch(/name|phone|mobile|email/i);
  });

  it('classifies mixed consultations and practitioner scheduling by reviewed path/table rules', () => {
    expect(classifyIdentityEpisodeReader(reader({
      path: 'scripts/canonical/backfill-appointments.ts',
      table: 'consultations',
      conceptIds: ['appointment_intent', 'encounter_care_episode'],
    }))).toBe('appointment');
    expect(classifyIdentityEpisodeReader(reader({
      path: 'src/routes/tenant/patients-timeline.ts',
      table: 'consultations',
      conceptIds: ['appointment_intent', 'encounter_care_episode'],
    }))).toBe('encounter');
    expect(classifyIdentityEpisodeReader(reader({
      path: 'src/routes/tenant/doctorSchedules.ts',
      table: 'doctor_schedules',
      conceptIds: ['appointment_intent'],
    }))).toBe('practitioner');
    expect(classifyIdentityEpisodeReader(reader({
      path: 'src/routes/tenant/clinical/notes.ts',
      table: 'clinical_notes',
      conceptIds: ['clinical_document_diagnosis'],
    }))).toBe('encounter');
  });

  it('fails closed on stale hash, duplicate consumers, unknown assignments, and unsafe claims', () => {
    const stale = structuredClone(buildIdentityEpisodeProviderCoverageRegistry(root));
    stale.sourceRegistrySha256 = '0'.repeat(64);
    expect(validateIdentityEpisodeProviderCoverageRegistry(stale, root)).toContain('source registry hash is stale');

    const duplicate = structuredClone(buildIdentityEpisodeProviderCoverageRegistry(root));
    duplicate.entries[1].consumerId = duplicate.entries[0].consumerId;
    expect(validateIdentityEpisodeProviderCoverageRegistry(duplicate, root)).toContain('duplicate consumer IDs exist');

    const unknown = structuredClone(buildIdentityEpisodeProviderCoverageRegistry(root));
    unknown.unknownEntries.push({
      path: 'src/routes/unknown.ts',
      table: 'unknown_table',
      conceptIds: ['appointment_intent'],
      providerStatus: 'legacy',
    });
    unknown.summary.unknownProviderAssignments = 1;
    expect(validateIdentityEpisodeProviderCoverageRegistry(unknown, root)).toEqual(expect.arrayContaining([
      'unknownProviderAssignments expected 0 but received 1',
      'unknown provider assignments exist',
    ]));

    const unsafe = structuredClone(buildIdentityEpisodeProviderCoverageRegistry(root));
    (unsafe.safety as { productionReady: boolean }).productionReady = true;
    expect(validateIdentityEpisodeProviderCoverageRegistry(unsafe, root)).toContain(
      'coverage registry makes an unsafe runtime claim',
    );
  });
});
