import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkRadiologyAcquisitionReportReadiness,
  validateRadiologyAcquisitionReportReadiness,
  type RadiologyAcquisitionReportProviderCoverage,
  type RadiologyAcquisitionReportReadinessEvidence,
} from '../../scripts/canonical/check-radiology-acquisition-report-readiness';

const root = process.cwd();
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
}
function fixtures(): {
  coverage: RadiologyAcquisitionReportProviderCoverage;
  readiness: RadiologyAcquisitionReportReadinessEvidence;
} {
  return {
    coverage: readJson('docs/database/canonical-radiology-acquisition-report-provider-coverage.json'),
    readiness: readJson('docs/database/radiology-acquisition-report-readiness.json'),
  };
}

describe('canonical radiology acquisition/report readiness', () => {
  it('is locally ready, production blocked, complete, disabled-safe, and route-inactive', () => {
    const result = checkRadiologyAcquisitionReportReadiness(root);
    expect(result).toEqual({
      localReady: true,
      productionReady: false,
      issues: [],
      issueCount: 0,
      selectedAdapterCount: 4,
      knownWriterCount: 8,
      knownReaderCount: 11,
      unknownWriterAssignments: 0,
      unknownReaderAssignments: 0,
      routeActivationCount: 0,
      blockedGateCount: 2,
    });
  });

  it('fails closed on provider activation, missing mapping/history, coverage drift, or production claims', () => {
    const { coverage, readiness } = fixtures();
    coverage.provider.enabledByDefault = true;
    coverage.provider.exactSourceMappingRequired = false;
    coverage.provider.dicomHierarchyVisible = false;
    coverage.provider.rawDicomPayloadStored = true;
    coverage.summary.routeActivationCount = 1;
    coverage.summary.unknownReaderAssignments = 1;
    coverage.selectedAdapters[0].routeActivated = true;
    readiness.claims.productionReady = true;
    readiness.claims.providerEnabled = true;
    readiness.claims.productionObservationPresent = true;
    readiness.verifiedContracts.reconciliationCheckCount = 29;
    readiness.verifiedContracts.runtimeRoutesUnchanged = false;
    const issues = validateRadiologyAcquisitionReportReadiness(root, readiness, coverage);
    expect(issues).toEqual(expect.arrayContaining([
      'provider must be disabled and default to legacy',
      'provider must require exact mapping and forbid similarity identity',
      'provider history, hierarchy, provenance, signed lineage, projection, and raw payload contracts are incomplete',
      'route activation count must remain zero',
      'unknown reader assignments must be zero',
      'selected adapter must not activate routes: cdb126e_acquisition_worklist_detail',
      'production readiness must remain false',
      'provider and route cutover must remain disabled',
      'production observation rollback execution and owner authorization must remain absent',
      'reconciliation check count must be 30',
      'legacy rollback and unchanged runtime routes must be verified',
    ]));
  });

  it('keeps all known runtime writers/readers legacy_unchanged and free of provider imports', () => {
    const { coverage, readiness } = fixtures();
    expect(coverage.knownWriters.every((item) => item.assignment === 'legacy_unchanged')).toBe(true);
    expect(coverage.knownReaders.every((item) => item.assignment === 'legacy_unchanged')).toBe(true);
    expect(coverage.selectedAdapters.every((item) => item.kind === 'library_adapter' && !item.routeActivated)).toBe(true);
    expect(readiness.claims.routeCutoverPerformed).toBe(false);
    expect(readiness.claims.providerEnabled).toBe(false);
    expect(validateRadiologyAcquisitionReportReadiness(root, readiness, coverage)).toEqual([]);
  });
});
