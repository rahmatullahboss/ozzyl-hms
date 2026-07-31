import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkMedicationAdministrationReadiness,
  validateMedicationAdministrationReadiness,
  type MedicationAdministrationProviderCoverage,
  type MedicationAdministrationReadinessEvidence,
} from '../../scripts/canonical/check-medication-administration-readiness';

const coveragePath = 'docs/database/canonical-medication-administration-provider-coverage.json';
const readinessPath = 'docs/database/medication-administration-readiness.json';

function load<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('canonical medication administration readiness', () => {
  it('validates local disabled-provider readiness while production and retirement remain blocked', () => {
    expect(checkMedicationAdministrationReadiness(process.cwd())).toEqual({
      localReady: true,
      productionReady: false,
      issues: [],
      issueCount: 0,
      selectedAdapterCount: 2,
      knownReaderCount: 5,
      unknownReaderAssignments: 0,
      blockedGateCount: 2,
    });
  });

  it('requires exact mapping, eight partitions, twenty-two checks, history visibility, zero route activation, and no production claims', () => {
    const coverage = load<MedicationAdministrationProviderCoverage>(coveragePath);
    const readiness = load<MedicationAdministrationReadinessEvidence>(readinessPath);
    expect(validateMedicationAdministrationReadiness(process.cwd(), readiness, coverage)).toEqual([]);
    expect(coverage.provider).toMatchObject({
      flagKey: 'canonical_medication_administration_provider_v1',
      enabledByDefault: false,
      defaultMode: 'legacy',
      rollbackMode: 'legacy',
      supportedModes: ['legacy', 'shadow', 'canonical'],
      exactSourceMappingRequired: true,
      textTimeSimilarityForbidden: true,
      correctionHistoryVisible: true,
      reconciliationHistoryVisible: true,
      shadowEvidencePhiMinimised: true,
    });
    expect(coverage.summary).toEqual({
      selectedAdapterCount: 2,
      knownReaderCount: 5,
      unknownReaderAssignments: 0,
      routeActivationCount: 0,
    });
    expect(readiness.verifiedContracts).toMatchObject({
      backfillPartitionCount: 8,
      reconciliationCheckCount: 22,
      runtimeRoutesUnchanged: true,
    });
    expect(readiness.claims).toMatchObject({
      localReady: true,
      productionReady: false,
      providerEnabled: false,
      routeCutoverPerformed: false,
      productionObservationPresent: false,
      ownerAuthorizationPresent: false,
      legacyRetirementApproved: false,
      productionMutationPerformed: false,
      productionQueryPerformed: false,
      localSyncActivated: false,
      pushPerformed: false,
      mainIntegrationPerformed: false,
    });
    const json = JSON.stringify({ coverage, readiness }).toLowerCase();
    for (const forbidden of [
      'patient_name','phone','notes_payload','medication_name','dose_value','reason_not_given','patient_link_public_id',
    ]) expect(json).not.toContain(forbidden);
  });

  it('fails closed when a route is activated or required evidence is missing', () => {
    const coverage = load<MedicationAdministrationProviderCoverage>(coveragePath);
    const readiness = load<MedicationAdministrationReadinessEvidence>(readinessPath);
    const mutated: MedicationAdministrationProviderCoverage = JSON.parse(JSON.stringify(coverage));
    mutated.selectedAdapters[0].routeActivated = true;
    mutated.summary.routeActivationCount = 1;
    const issues = validateMedicationAdministrationReadiness(process.cwd(), readiness, mutated);
    expect(issues).toContain('selected adapters must not activate routes');
    expect(issues).toContain('route activation count must remain zero');

    const root = mkdtempSync(join(tmpdir(), 'medication-administration-readiness-'));
    const fixturePaths = new Set([
      coveragePath,
      coverage.provider.providerPath,
      coverage.provider.adapterPath,
      ...coverage.knownReaders.map((reader) => reader.path),
      ...readiness.requiredEvidence.map((evidence) => evidence.path),
    ]);
    for (const path of fixturePaths) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(path, target);
    }
    const broken = JSON.parse(JSON.stringify(readiness)) as MedicationAdministrationReadinessEvidence;
    broken.requiredEvidence.push({ kind: 'missing', path: 'missing-medication-administration-evidence.txt' });
    writeFileSync(join(root, readinessPath), JSON.stringify(broken, null, 2));
    const result = checkMedicationAdministrationReadiness(root);
    expect(result.localReady).toBe(false);
    expect(result.issues).toContain('required evidence is missing: missing-medication-administration-evidence.txt');
  });
});
