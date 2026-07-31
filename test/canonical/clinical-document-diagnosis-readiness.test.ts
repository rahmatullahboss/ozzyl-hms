import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkClinicalDocumentDiagnosisReadiness,
  validateClinicalDocumentDiagnosisReadiness,
  type ClinicalDocumentDiagnosisProviderCoverage,
  type ClinicalDocumentDiagnosisReadinessEvidence,
} from '../../scripts/canonical/check-clinical-document-diagnosis-readiness';

const coveragePath = 'docs/database/canonical-clinical-document-diagnosis-provider-coverage.json';
const readinessPath = 'docs/database/clinical-document-diagnosis-readiness.json';

function load<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('canonical clinical document diagnosis readiness', () => {
  it('validates local disabled-provider readiness while production and retirement remain blocked', () => {
    const result = checkClinicalDocumentDiagnosisReadiness(process.cwd());
    expect(result).toEqual({
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

  it('requires exact mapping, no route activation, no PHI evidence, and no production claims', () => {
    const coverage = load<ClinicalDocumentDiagnosisProviderCoverage>(coveragePath);
    const readiness = load<ClinicalDocumentDiagnosisReadinessEvidence>(readinessPath);
    expect(validateClinicalDocumentDiagnosisReadiness(process.cwd(), readiness, coverage)).toEqual([]);
    expect(coverage.provider).toMatchObject({
      flagKey: 'canonical_clinical_document_diagnosis_provider_v1',
      enabledByDefault: false,
      defaultMode: 'legacy',
      rollbackMode: 'legacy',
      supportedModes: ['legacy', 'shadow', 'canonical'],
    });
    expect(coverage.summary).toMatchObject({
      selectedAdapterCount: 2,
      knownReaderCount: 4,
      unknownReaderAssignments: 0,
      routeActivationCount: 0,
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
    const json = JSON.stringify({ coverage, readiness });
    for (const forbidden of ['patient_name', 'phone', 'note_content', 'diagnosis_display', 'object_reference']) {
      expect(json.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('fails closed when a route is activated or a required evidence file is missing', () => {
    const coverage = load<ClinicalDocumentDiagnosisProviderCoverage>(coveragePath);
    const readiness = load<ClinicalDocumentDiagnosisReadinessEvidence>(readinessPath);
    const mutated: ClinicalDocumentDiagnosisProviderCoverage = JSON.parse(JSON.stringify(coverage));
    mutated.selectedAdapters[0].routeActivated = true;
    mutated.summary.routeActivationCount = 1;
    const issues = validateClinicalDocumentDiagnosisReadiness(process.cwd(), readiness, mutated);
    expect(issues).toContain('selected adapters must not activate routes');
    expect(issues).toContain('route activation count must remain zero');

    const root = mkdtempSync(join(tmpdir(), 'clinical-readiness-'));
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
    const broken = JSON.parse(JSON.stringify(readiness)) as ClinicalDocumentDiagnosisReadinessEvidence;
    broken.requiredEvidence.push({ kind: 'missing', path: 'missing-evidence.txt' });
    writeFileSync(join(root, readinessPath), JSON.stringify(broken, null, 2));
    const result = checkClinicalDocumentDiagnosisReadiness(root);
    expect(result.localReady).toBe(false);
    expect(result.issues).toContain('required evidence is missing: missing-evidence.txt');
  });
});
