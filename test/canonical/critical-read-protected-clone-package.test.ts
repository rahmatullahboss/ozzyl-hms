import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packagePath = 'docs/database/cdb-v1-040c-protected-clone-comparison-package.json';

describe('CDB-V1-040C protected-clone comparison package', () => {
  it('is prepared but not authorized or executed', () => {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, any>;
    expect(pkg.checkpoint).toBe('CDB-V1-040C-REMAINING-CRITICAL-READ-PROVIDER-INTEGRATION');
    expect(pkg.status).toBe('prepared_not_authorized');
    expect(pkg.authorization).toMatchObject({
      freshExactAuthorizationRequired: true,
      present: false,
      historicalAuthorizationReusable: false,
    });
    expect(pkg.execution).toMatchObject({
      entryPoint: 'runCriticalReadShadowBatch',
      recordLimit: 100,
      performed: false,
      protectedCloneQueried: false,
      productionQueried: false,
      providerActivated: false,
      trafficChanged: false,
      deploymentPerformed: false,
    });
  });

  it('binds all six provider and consumer scopes to zero-variance legacy rollback', () => {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, any>;
    expect(pkg.providerKeys).toEqual([
      'canonical_patient_identity_provider_v1',
      'canonical_practitioner_provider_v1',
      'canonical_appointment_provider_v1',
      'canonical_encounter_provider_v1',
      'canonical_admission_bed_provider_v1',
      'canonical_compensation_accrual_provider_v1',
    ]);
    expect(pkg.consumerIds).toHaveLength(6);
    expect(pkg.acceptance).toMatchObject({
      selectedProvider: 'legacy',
      rollbackMode: 'legacy',
      criticalUnexplainedVarianceCount: 0,
      varianceIds: [],
      providerErrorCount: 0,
      mappingAmbiguityCount: 0,
      crossTenantReferenceCount: 0,
      latencyBudgetBreachCount: 0,
      secondPassNewBusinessRows: 0,
    });
    expect(pkg.evidenceContract).toMatchObject({
      exactSourceRowKeyRequired: true,
      exactCanonicalRowKeyRequired: true,
      tenantScopeRequired: true,
      buildShaRequired: true,
      sourceSnapshotSha256Required: true,
      bdtIntegerMinorUnitsRequiredForCompensation: true,
      deterministicVarianceIdsRequired: true,
      latencyEvidenceRequired: true,
      phiMinimized: true,
      persistenceTable: 'canonical_reconciliation_runs',
    });
  });

  it('contains no credential, database URL, token or executable production command', () => {
    const raw = readFileSync(packagePath, 'utf8');
    expect(raw).not.toMatch(/(?:api[_-]?token|password|secret|credential|database[_-]?url|wrangler\s+d1\s+execute)/i);
    expect(raw).not.toMatch(/https?:\/\//i);
  });
});
