import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkPrescriptionMedicationReadiness,
  validatePrescriptionMedicationReadiness,
  type PrescriptionMedicationProviderCoverage,
  type PrescriptionMedicationReadinessEvidence,
} from '../../scripts/canonical/check-prescription-medication-readiness';

const root = process.cwd();
const coveragePath = 'docs/database/canonical-prescription-medication-provider-coverage.json';
const readinessPath = 'docs/database/prescription-medication-readiness.json';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('canonical prescription and medication readiness', () => {
  it('records exact selected readers, disabled provider state, and blocked production/retirement gates', () => {
    const coverage = readJson<PrescriptionMedicationProviderCoverage>(coveragePath);
    const readiness = readJson<PrescriptionMedicationReadinessEvidence>(readinessPath);

    expect(coverage).toMatchObject({
      version: 1,
      checkpoint: 'CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-DISABLED-PROVIDERS-READINESS',
      provider: {
        modulePath: 'src/lib/canonical/prescription-medication-provider.ts',
        adapterPath: 'src/lib/canonical/prescription-medication-read-adapters.ts',
        flagKey: 'canonical_prescription_medication_provider_v1',
        enabledByDefault: false,
        defaultMode: 'legacy',
      },
      summary: {
        selectedAdapterCount: 2,
        knownReaderCount: 3,
        unknownReaderAssignments: 0,
      },
    });
    expect(coverage.selectedAdapters).toEqual([
      expect.objectContaining({
        consumerId: 'cdb121e_prescription_detail',
        adapterFunction: 'readPrescriptionDocumentAdapter',
        sourceTypes: ['legacy_prescription'],
      }),
      expect.objectContaining({
        consumerId: 'cdb121e_medication_order_detail',
        adapterFunction: 'readMedicationOrderAdapter',
        sourceTypes: ['legacy_prescription_item', 'legacy_cln_medication_order'],
      }),
    ]);
    expect(new Set(coverage.knownReaders.map((reader) => reader.path))).toEqual(new Set([
      'src/routes/global-portal.ts',
      'src/routes/tenant/patients-chart.ts',
      'src/routes/tenant/nursing/clinical-summary.ts',
    ]));
    expect(coverage.knownReaders.every((reader) => reader.assignment !== 'unknown')).toBe(true);

    expect(readiness).toMatchObject({
      version: 1,
      checkpoint: 'CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-DISABLED-PROVIDERS-READINESS',
      scope: 'local_disabled_provider_readiness_only',
      claims: {
        localReady: true,
        productionReady: false,
        providerEnabled: false,
        routeCutoverPerformed: false,
        productionObservationPresent: false,
        legacyRetirementApproved: false,
      },
      gates: {
        schema: 'passed',
        commands: 'passed',
        backfill: 'passed',
        reconciliation: 'passed',
        provider: 'passed_disabled',
        selectedReaders: 'passed_local_contracts',
        production: 'blocked',
        retirement: 'blocked',
      },
    });
    expect(readiness.requiredEvidence.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'migrations/0554_canonical_prescription_medication_intent.sql',
      'src/lib/canonical/commands/manage-prescription-medication-intent.ts',
      'scripts/canonical/backfill-prescription-medication-intent.ts',
      'scripts/canonical/reconcile-prescription-medication-intent.ts',
      'docs/database/migration-runs/P11-canonical-prescription-medication-intent-backfill-reconciliation.md',
    ]));
    expect(JSON.stringify({ coverage, readiness })).not.toMatch(/patient_name|phone|medicine_name|dose_text|instructions_text/i);
  });

  it('passes the repository readiness checker with zero issues and blocked production gates', () => {
    const result = checkPrescriptionMedicationReadiness(root);
    expect(result).toEqual({
      localReady: true,
      productionReady: false,
      issues: [],
      issueCount: 0,
      selectedAdapterCount: 2,
      knownReaderCount: 3,
      unknownReaderAssignments: 0,
      blockedGateCount: 2,
    });
  });

  it('fails closed on enabled providers, unknown readers, missing evidence, or false production claims', () => {
    const coverage = readJson<PrescriptionMedicationProviderCoverage>(coveragePath);
    const readiness = readJson<PrescriptionMedicationReadinessEvidence>(readinessPath);

    const enabled = structuredClone(readiness);
    enabled.provider.enabledByDefault = true;
    enabled.claims.providerEnabled = true;
    expect(validatePrescriptionMedicationReadiness(root, enabled, coverage)).toEqual(expect.arrayContaining([
      'provider must remain disabled by default',
      'provider activation must remain false',
    ]));

    const unknown = structuredClone(coverage);
    unknown.knownReaders[0].assignment = 'unknown';
    unknown.summary.unknownReaderAssignments = 1;
    expect(validatePrescriptionMedicationReadiness(root, readiness, unknown)).toEqual(expect.arrayContaining([
      'coverage must contain zero unknown reader assignments',
    ]));

    const missing = structuredClone(readiness);
    missing.requiredEvidence[0].path = 'missing/evidence.sql';
    expect(validatePrescriptionMedicationReadiness(root, missing, coverage)).toEqual(expect.arrayContaining([
      'required evidence is missing: missing/evidence.sql',
    ]));

    const unsafe = structuredClone(readiness);
    unsafe.claims.productionReady = true;
    unsafe.claims.routeCutoverPerformed = true;
    unsafe.claims.legacyRetirementApproved = true;
    expect(validatePrescriptionMedicationReadiness(root, unsafe, coverage)).toEqual(expect.arrayContaining([
      'production readiness must remain false',
      'route cutover must remain false',
      'legacy retirement approval must remain false',
    ]));
  });
});
