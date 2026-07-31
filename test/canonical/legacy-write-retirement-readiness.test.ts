import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLegacyWriteRetirementReadiness,
  type RetirementReasonCode,
} from '../../scripts/canonical/check-legacy-write-retirement-readiness';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hms-retirement-readiness-'));
  roots.push(root);
  mkdirSync(join(root, 'docs/database'), { recursive: true });
  return root;
}

function writeJson(root: string, name: string, value: unknown): void {
  writeFileSync(
    join(root, 'docs/database', name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function allowance(lifecycleStatus = 'legacy_authority'): Record<string, unknown> {
  return {
    path: 'src/routes/tenant/billing.ts',
    table: 'bills',
    owner: 'billing-platform',
    removalPhase: 'P05',
    reason: 'Legacy bill write remains active before cutover.',
    lifecycleStatus,
    retirementBlocker: 'Production invoice cutover is incomplete.',
    retirementTask: 'CDB-105B',
    reviewedAtUtc: '2026-07-24T22:45:00Z',
  };
}

function gates(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    reviewedAtUtc: '2026-07-24T22:45:00Z',
    retirementTask: 'CDB-105B',
    domains: [
      {
        id: 'billing_invoice',
        tables: ['bills'],
        productionCutoverComplete: false,
        canonicalReadPromotionComplete: false,
        observationComplete: false,
        rollbackEvidenceFresh: false,
        ownerAuthorizationPresent: false,
        legacyAuthorityRetirementApproved: false,
        compatibilityAdapterRetirementApproved: false,
        fixtureRetirementApproved: false,
        blocker: 'Production invoice retirement evidence is incomplete.',
        evidenceReferences: [],
        ...overrides,
      },
    ],
  };
}

function writeFixture(
  root: string,
  gateOverrides: Record<string, unknown> = {},
  lifecycleStatus = 'legacy_authority',
): void {
  writeJson(root, 'legacy-table-disposition.yaml', {
    version: 1,
    tables: [
      {
        name: 'bills',
        owner: 'billing-platform',
        disposition: 'active_legacy',
        writePolicy: 'allowed_until_cutover',
        removalPhase: 'P05',
        reason: 'Legacy bills remain active before cutover.',
      },
    ],
    directWriteAllowlist: [allowance(lifecycleStatus)],
    duplicateMigrationNumbers: [],
    destructiveMigrations: [],
  });
  writeJson(root, 'legacy-write-retirement-gates.yaml', gates(gateOverrides));
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('legacy write retirement readiness', () => {
  it('blocks a legacy authority with stable common and lifecycle reason codes', () => {
    const root = createRoot();
    writeFixture(root);

    const result = buildLegacyWriteRetirementReadiness(root);
    expect(result.allowanceCount).toBe(1);
    expect(result.eligibleAllowanceCount).toBe(0);
    expect(result.blockedAllowanceCount).toBe(1);
    expect(result.byDomain).toEqual({
      billing_invoice: { total: 1, eligible: 0, blocked: 1 },
    });
    expect(result.blockedScopes[0]).toEqual({
      scope: 'src/routes/tenant/billing.ts:bills',
      domain: 'billing_invoice',
      reasons: [
        'PRODUCTION_CUTOVER_INCOMPLETE',
        'CANONICAL_READ_PROMOTION_INCOMPLETE',
        'OBSERVATION_INCOMPLETE',
        'ROLLBACK_EVIDENCE_NOT_FRESH',
        'OWNER_AUTHORIZATION_MISSING',
        'LEGACY_AUTHORITY_RETIREMENT_NOT_APPROVED',
      ] satisfies RetirementReasonCode[],
    });
  });

  it('marks an exact scope eligible only when all common and matching lifecycle gates pass', () => {
    const root = createRoot();
    writeFixture(root, {
      productionCutoverComplete: true,
      canonicalReadPromotionComplete: true,
      observationComplete: true,
      rollbackEvidenceFresh: true,
      ownerAuthorizationPresent: true,
      legacyAuthorityRetirementApproved: true,
      blocker: '',
    });

    const result = buildLegacyWriteRetirementReadiness(root);
    expect(result.eligibleAllowanceCount).toBe(1);
    expect(result.blockedAllowanceCount).toBe(0);
    expect(result.eligibleScopes).toEqual(['src/routes/tenant/billing.ts:bills']);
  });

  it('still blocks canonical compatibility without its specific retirement approval', () => {
    const root = createRoot();
    writeFixture(root, {
      productionCutoverComplete: true,
      canonicalReadPromotionComplete: true,
      observationComplete: true,
      rollbackEvidenceFresh: true,
      ownerAuthorizationPresent: true,
      legacyAuthorityRetirementApproved: true,
      blocker: 'Compatibility adapter retirement is not approved.',
    }, 'canonical_compatibility');

    expect(buildLegacyWriteRetirementReadiness(root).blockedScopes[0].reasons).toEqual([
      'COMPATIBILITY_ADAPTER_RETIREMENT_NOT_APPROVED',
    ]);
  });

  it('rejects a registered table mapped to multiple retirement domains', () => {
    const root = createRoot();
    writeFixture(root);
    const duplicateDomains = gates() as { domains: Record<string, unknown>[] };
    duplicateDomains.domains.push({
      ...duplicateDomains.domains[0],
      id: 'duplicate_billing',
    });
    writeJson(root, 'legacy-write-retirement-gates.yaml', duplicateDomains);

    expect(() => buildLegacyWriteRetirementReadiness(root)).toThrow(/exactly one retirement domain/i);
  });

  it('reports the real repository as 68 blocked and zero eligible allowances', () => {
    const result = buildLegacyWriteRetirementReadiness(process.cwd());
    expect(result.allowanceCount).toBe(68);
    expect(result.eligibleAllowanceCount).toBe(0);
    expect(result.blockedAllowanceCount).toBe(68);
    expect(result.byDomain).toEqual({
      billing_invoice: { total: 40, eligible: 0, blocked: 40 },
      inventory_movement: { total: 9, eligible: 0, blocked: 9 },
      payment_collection: { total: 10, eligible: 0, blocked: 10 },
      practitioner_compensation: { total: 9, eligible: 0, blocked: 9 },
    });
    expect(result.byLifecycleStatus).toEqual({
      canonical_compatibility: 28,
      legacy_authority: 37,
      protected_fixture: 3,
    });
  });
});
