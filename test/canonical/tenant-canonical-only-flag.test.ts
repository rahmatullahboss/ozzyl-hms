import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCanonicalOnlyFlagSql,
  executeCanonicalOnlyFlagChange,
  type CanonicalOnlyActivationEvidence,
} from '../../scripts/canonical/set-production-canonical-only-financial-flag';

const NOW = '2026-07-18T07:00:00.000Z';

function validEvidence(): CanonicalOnlyActivationEvidence {
  return {
    schemaVersion: 1,
    authorizationId: 'CDB-101-TENANT-100-CANONICAL-ONLY-20260718',
    tenantId: '100',
    operator: 'Rahmatullah Zisan',
    productionDatabaseId: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
    candidateVersionId: '11111111-1111-4111-8111-111111111111',
    candidateCommit: 'a'.repeat(40),
    observedAtUtc: '2026-07-18T06:55:00.000Z',
    expiresAtUtc: '2026-07-18T08:00:00.000Z',
    tenant101LegacySmokePassed: true,
    tenant100CanonicalOnlyZeroLegacyWritePassed: true,
    safeErrorSmokePassed: true,
    rollbackRehearsalPassed: true,
  };
}

describe('tenant-100 canonical-only production flag wrapper', () => {
  it('does not expose a package command that can enable canonical-only financial mode', () => {
    const packageJson = readFileSync('package.json', 'utf8');
    expect(packageJson).not.toContain('canonical:set-production-canonical-only-financial-flag');
  });

  it('builds an exact rollback that cannot disable any other flag', () => {
    const sql = buildCanonicalOnlyFlagSql({
      action: 'disable',
      evidence: validEvidence(),
      effectiveAtUtc: NOW,
    });

    expect(sql).toContain("tenant_id = '100'");
    expect(sql).toContain("flag_key = 'canonical_financial_dual_write_v1'");
    expect(sql).toContain("mode = 'canonical'");
    expect(sql).toContain("is_enabled = 1");
    expect(sql).not.toMatch(/tenant_id\s*!=|canonical_reporting_v1/);
  });

  it.each([
    ['wrong tenant', (evidence: CanonicalOnlyActivationEvidence) => ({ ...evidence, tenantId: '101' })],
    ['expired authorization', (evidence: CanonicalOnlyActivationEvidence) => ({ ...evidence, expiresAtUtc: '2026-07-18T06:59:59.000Z' })],
    ['missing candidate evidence', (evidence: CanonicalOnlyActivationEvidence) => ({ ...evidence, candidateVersionId: '' })],
    ['missing tenant-101 smoke', (evidence: CanonicalOnlyActivationEvidence) => ({ ...evidence, tenant101LegacySmokePassed: false })],
    ['missing zero-legacy-write smoke', (evidence: CanonicalOnlyActivationEvidence) => ({ ...evidence, tenant100CanonicalOnlyZeroLegacyWritePassed: false })],
    ['missing safe error evidence', (evidence: CanonicalOnlyActivationEvidence) => ({ ...evidence, safeErrorSmokePassed: false })],
    ['missing rollback rehearsal', (evidence: CanonicalOnlyActivationEvidence) => ({ ...evidence, rollbackRehearsalPassed: false })],
  ])('starts zero child processes for %s', async (_label, mutate) => {
    let externalCommandCount = 0;
    const result = await executeCanonicalOnlyFlagChange({
      action: 'enable',
      evidence: mutate(validEvidence()),
      atUtc: NOW,
      effectiveAtUtc: NOW,
      confirmationToken: validEvidence().authorizationId,
      execute: true,
    }, async () => {
      externalCommandCount += 1;
      throw new Error('runner must not execute');
    });

    expect(externalCommandCount).toBe(0);
    expect(result.externalCommandCount).toBe(0);
    expect(result.productionMutationPerformed).toBe(false);
  });
});
