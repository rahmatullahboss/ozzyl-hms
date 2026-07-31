import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkEmergencyCaseTriageReadiness,
  type EmergencyCaseTriageCoverage,
  type EmergencyCaseTriageReadiness,
} from '../../scripts/canonical/check-emergency-case-triage-readiness';

const coveragePath = 'docs/database/canonical-emergency-case-triage-provider-coverage.json';
const readinessPath = 'docs/database/emergency-case-triage-readiness.json';

function coverage(): EmergencyCaseTriageCoverage {
  return JSON.parse(readFileSync(coveragePath, 'utf8')) as EmergencyCaseTriageCoverage;
}
function readiness(): EmergencyCaseTriageReadiness {
  return JSON.parse(readFileSync(readinessPath, 'utf8')) as EmergencyCaseTriageReadiness;
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('canonical emergency case/triage readiness', () => {
  it('is locally ready, production blocked, complete, disabled-safe, and route-inactive', () => {
    const result = checkEmergencyCaseTriageReadiness();
    expect(result).toEqual({
      localReady: true,
      productionReady: false,
      issues: [],
      selectedAdapterCount: 3,
      knownWriterCount: 4,
      knownReaderCount: 6,
      routeActivationCount: 0,
    });
    const evidence = readiness();
    expect(evidence).toMatchObject({
      checkpoint: 'CDB-127E-CANONICAL-EMERGENCY-CASE-TRIAGE-PROVIDER-READINESS-VERIFIED',
      providerEnabledByDefault: false,
      providerDefaultMode: 'legacy',
      providerRollbackMode: 'legacy',
      providerEnabled: false,
      routeCutoverPerformed: false,
      localReady: true,
      productionReady: false,
      targetTableCount: 6,
      atomicCommandCount: 9,
      persistentBackfillPartitionCount: 8,
      fixedReconciliationCheckCount: 24,
    });
    expect(Object.values(evidence.productionGates).every((value) => value === false)).toBe(true);
  });

  it('fails closed on provider activation, missing mapping/history evidence, coverage drift, or production claims', () => {
    const baseCoverage = coverage();
    const baseReadiness = readiness();

    const enabled = clone(baseReadiness);
    enabled.providerEnabled = true;
    expect(checkEmergencyCaseTriageReadiness({ coverage: baseCoverage, readiness: enabled }).issues)
      .toContain('CDB127E_PROVIDER_MUST_REMAIN_DISABLED');

    const missingMapping = clone(baseReadiness);
    missingMapping.providerEvidence.exactSourceMappingRequired = false;
    expect(checkEmergencyCaseTriageReadiness({ coverage: baseCoverage, readiness: missingMapping }).issues)
      .toContain('CDB127E_PROVIDER_EVIDENCE_FLAG:exactSourceMappingRequired');

    const missingHistory = clone(baseReadiness);
    missingHistory.providerEvidence.dispositionHistoryVisible = false;
    expect(checkEmergencyCaseTriageReadiness({ coverage: baseCoverage, readiness: missingHistory }).issues)
      .toContain('CDB127E_PROVIDER_EVIDENCE_FLAG:dispositionHistoryVisible');

    const driftedCoverage = clone(baseCoverage);
    driftedCoverage.unknownReaderAssignments = 1;
    expect(checkEmergencyCaseTriageReadiness({ coverage: driftedCoverage, readiness: baseReadiness }).issues)
      .toContain('CDB127E_UNKNOWN_READER_ASSIGNMENT');

    const activatedAdapter = clone(baseCoverage);
    activatedAdapter.selectedAdapters[0].runtimeActivated = true;
    expect(checkEmergencyCaseTriageReadiness({ coverage: activatedAdapter, readiness: baseReadiness }).issues)
      .toContain('CDB127E_SELECTED_ADAPTER_RUNTIME_ACTIVATION');

    const prematureProduction = clone(baseReadiness);
    prematureProduction.productionReady = true;
    expect(checkEmergencyCaseTriageReadiness({ coverage: baseCoverage, readiness: prematureProduction }).issues)
      .toEqual(expect.arrayContaining([
        'CDB127E_PREMATURE_PRODUCTION_READY',
        'CDB127E_PRODUCTION_READY_MUST_REMAIN_FALSE',
      ]));
  });

  it('keeps every reviewed runtime writer/reader legacy_unchanged and free of provider imports', () => {
    const evidence = coverage();
    expect(evidence.writers).toHaveLength(4);
    expect(evidence.readers).toHaveLength(6);
    expect(evidence.selectedAdapters).toHaveLength(3);
    expect(evidence.unknownWriterAssignments).toBe(0);
    expect(evidence.unknownReaderAssignments).toBe(0);
    expect(evidence.routeActivationCount).toBe(0);
    const markers = [
      'emergency-case-triage-provider',
      'emergency-case-triage-read-adapters',
      'canonical_emergency_case_triage_provider_v1',
    ];
    for (const entry of [...evidence.writers, ...evidence.readers]) {
      expect(entry.assignment).toBe('legacy_unchanged');
      const source = readFileSync(entry.path, 'utf8');
      for (const marker of markers) expect(source).not.toContain(marker);
    }
  });
});
