import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROTECTED_CORE_WRITER_COVERAGE_PATH,
  buildProtectedCoreWriterCommandCoverage,
  validateProtectedCoreWriterCommandCoverage,
} from '../../scripts/canonical/protected-core-writer-command-coverage';
import { buildProtectedCoreSurfaceInventory } from '../../scripts/canonical/protected-core-surface-inventory';

const root = resolve(process.cwd());

function readGeneratedCoverage() {
  return JSON.parse(readFileSync(resolve(root, PROTECTED_CORE_WRITER_COVERAGE_PATH), 'utf8'));
}

describe('CDB-V1-030A protected writer command coverage baseline', () => {
  it('classifies every protected writer against the frozen authority contract', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(root);

    expect(coverage.task).toBe('CDB-V1-030A-PROTECTED-WRITER-COMMAND-COVERAGE-BASELINE');
    expect(coverage.summary.writerCount).toBe(buildProtectedCoreSurfaceInventory(root).summary.protectedWriterCount);
    expect(coverage.summary.unclassifiedWriterCount).toBe(0);
    expect(coverage.unclassifiedWriters).toEqual([]);
    expect(validateProtectedCoreWriterCommandCoverage(coverage, root)).toEqual([]);

    for (const writer of coverage.writers) {
      expect(writer.writerId).toMatch(/^pcwcc_[0-9a-f]{24}$/);
      expect(writer.protectedConceptIds.length).toBeGreaterThan(0);
      expect(writer.requiredCommandNames.length).toBeGreaterThan(0);
      expect(writer.classification).toMatch(/^(canonical_command|atomic_compatibility|external_governed|strict_blocked|command_required|fixture_isolated)$/);
      expect(writer.transactionRule).toContain('one D1 batch');
      expect(writer.idempotencyRule.length).toBeGreaterThan(0);
      expect(writer.rollbackRule.length).toBeGreaterThan(0);
    }
  });

  it('keeps Canonical authority writers on their frozen command boundaries', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(root);
    const canonical = coverage.writers.filter((writer) => writer.classification === 'canonical_command');

    expect(canonical.length).toBeGreaterThan(0);
    for (const writer of canonical) {
      expect(writer.lifecycleStatus).toBe('canonical_authority');
      expect(writer.currentTargetCommand).toContain('retain as registered canonical authority');
      expect(writer.requiredCommandNames.length).toBeGreaterThan(0);
      expect(writer.implementedCommandModules.length + writer.contractOnlyCommandModules.length).toBeGreaterThan(0);
      expect(writer.compatibilityRule).toContain('direct ad-hoc writes are prohibited');
    }
  });

  it('recognizes integrated strict financial compatibility routes and isolates fixtures', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(root);
    const strictIntegrated = coverage.writers.filter((writer) => writer.classification === 'atomic_compatibility');
    const fixtures = coverage.writers.filter((writer) => writer.classification === 'fixture_isolated');

    expect(strictIntegrated.length).toBeGreaterThan(0);
    expect(fixtures.length).toBe(4);
    expect(strictIntegrated.some((writer) => writer.path === 'src/routes/tenant/billing.ts')).toBe(true);
    expect(strictIntegrated.some((writer) => writer.path === 'src/routes/tenant/deposits.ts')).toBe(true);
    expect(strictIntegrated.some((writer) => writer.path === 'src/routes/tenant/creditNotes.ts')).toBe(true);
    expect(strictIntegrated.some((writer) => writer.path === 'src/routes/tenant/approvals.ts')).toBe(true);
    expect(strictIntegrated).toContainEqual(expect.objectContaining({
      path: 'src/routes/tenant/doctors.ts',
      table: 'doctors',
      strictBoundaryIds: ['practitioner.manage.doctor-route'],
    }));
    expect(strictIntegrated).toContainEqual(expect.objectContaining({
      path: 'src/routes/tenant/settings-import-export.ts',
      table: 'patients',
      strictBoundaryIds: ['patient-identity.import-route'],
    }));

    for (const writer of strictIntegrated) {
      expect(writer.strictBoundaryIds.length).toBeGreaterThan(0);
      expect(writer.compatibilityRule).toContain('atomic');
    }
    for (const writer of fixtures) {
      expect(writer.lifecycleStatus).toBe('protected_fixture');
      expect(writer.compatibilityRule).toContain('production runtime');
    }
  });

  it('records complete protected command coverage and routes to read-provider work', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(root);
    const required = coverage.writers.filter((writer) => writer.classification === 'command_required');

    expect(required).toEqual([]);
    expect(coverage.summary.commandRequiredWriterCount).toBe(0);
    expect(coverage.summary.strictBlockedWriterCount).toBe(0);
    expect(coverage.programState.commandCoverageComplete).toBe(true);
    expect(coverage.programState.nextCheckpoint).toBe('CDB-V1-040-CANONICAL-READ-PROVIDERS-AND-SHADOW-COMPARISON');
    expect(coverage.implementationGroups).toEqual([]);
  });

  it('keeps production execution and provider activation disabled', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(root);
    expect(coverage.productionAuthorization).toEqual({
      repositoryCoverageBaseline: true,
      productionReadAccess: false,
      productionMutation: false,
      providerActivation: false,
      deploymentOrTrafficChange: false,
      liveLegacyRetirement: false,
    });
  });

  it('keeps the checked-in writer coverage deterministic and current', () => {
    expect(existsSync(resolve(root, PROTECTED_CORE_WRITER_COVERAGE_PATH))).toBe(true);
    expect(readGeneratedCoverage()).toEqual(buildProtectedCoreWriterCommandCoverage(root));
  });
});
