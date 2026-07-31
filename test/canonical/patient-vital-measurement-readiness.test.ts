import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkPatientVitalMeasurementReadiness,
  validatePatientVitalMeasurementReadiness,
  type PatientVitalMeasurementProviderCoverage,
  type PatientVitalMeasurementReadinessEvidence,
} from '../../scripts/canonical/check-patient-vital-measurement-readiness';

const coveragePath = 'docs/database/canonical-patient-vital-measurement-provider-coverage.json';
const readinessPath = 'docs/database/patient-vital-measurement-readiness.json';

function load<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('canonical patient vital measurement readiness', () => {
  it('validates local disabled-provider readiness while production and retirement remain blocked', () => {
    expect(checkPatientVitalMeasurementReadiness(process.cwd())).toEqual({
      localReady: true,
      productionReady: false,
      issues: [],
      issueCount: 0,
      selectedAdapterCount: 2,
      knownReaderCount: 4,
      unknownReaderAssignments: 0,
      blockedGateCount: 2,
    });
  });

  it('requires exact mapping, nine partitions, twenty checks, zero route activation, and no production claims', () => {
    const coverage = load<PatientVitalMeasurementProviderCoverage>(coveragePath);
    const readiness = load<PatientVitalMeasurementReadinessEvidence>(readinessPath);
    expect(validatePatientVitalMeasurementReadiness(process.cwd(), readiness, coverage)).toEqual([]);
    expect(coverage.provider).toMatchObject({
      flagKey: 'canonical_patient_vital_measurement_provider_v1',
      enabledByDefault: false,
      defaultMode: 'legacy',
      rollbackMode: 'legacy',
      supportedModes: ['legacy', 'shadow', 'canonical'],
      exactSourceMappingRequired: true,
      valueTimeSimilarityForbidden: true,
      shadowEvidencePhiMinimised: true,
    });
    expect(coverage.summary).toEqual({
      selectedAdapterCount: 2,
      knownReaderCount: 4,
      unknownReaderAssignments: 0,
      routeActivationCount: 0,
    });
    expect(readiness.verifiedContracts).toMatchObject({
      backfillPartitionCount: 9,
      reconciliationCheckCount: 20,
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
    for (const forbidden of ['patient_name', 'phone', 'notes_payload', 'measurement_value', 'device_name']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('fails closed when a route is activated or required evidence is missing', () => {
    const coverage = load<PatientVitalMeasurementProviderCoverage>(coveragePath);
    const readiness = load<PatientVitalMeasurementReadinessEvidence>(readinessPath);
    const mutated: PatientVitalMeasurementProviderCoverage = JSON.parse(JSON.stringify(coverage));
    mutated.selectedAdapters[0].routeActivated = true;
    mutated.summary.routeActivationCount = 1;
    const issues = validatePatientVitalMeasurementReadiness(process.cwd(), readiness, mutated);
    expect(issues).toContain('selected adapters must not activate routes');
    expect(issues).toContain('route activation count must remain zero');

    const root = mkdtempSync(join(tmpdir(), 'vital-readiness-'));
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
    const broken = JSON.parse(JSON.stringify(readiness)) as PatientVitalMeasurementReadinessEvidence;
    broken.requiredEvidence.push({ kind: 'missing', path: 'missing-vital-evidence.txt' });
    writeFileSync(join(root, readinessPath), JSON.stringify(broken, null, 2));
    const result = checkPatientVitalMeasurementReadiness(root);
    expect(result.localReady).toBe(false);
    expect(result.issues).toContain('required evidence is missing: missing-vital-evidence.txt');
  });
});
