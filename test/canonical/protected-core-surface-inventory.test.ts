import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROTECTED_CORE_INVENTORY_PATH,
  buildProtectedCoreSurfaceInventory,
  validateProtectedCoreSurfaceInventory,
} from '../../scripts/canonical/protected-core-surface-inventory';

const root = resolve(process.cwd());

function readGeneratedInventory() {
  return JSON.parse(readFileSync(resolve(root, PROTECTED_CORE_INVENTORY_PATH), 'utf8'));
}

describe('CDB-V1-010 protected production-core surface inventory', () => {
  it('classifies every protected-core writer and reader with zero unknown assignments', () => {
    const inventory = buildProtectedCoreSurfaceInventory(root);

    expect(inventory.task).toBe('CDB-V1-010-PROTECTED-PRODUCTION-CORE-SURFACE-INVENTORY');
    expect(inventory.productionAuthorization).toEqual({
      repositoryInventory: true,
      productionReadAccess: false,
      productionMutation: false,
      providerActivation: false,
      deploymentOrTrafficChange: false,
      liveLegacyRetirement: false,
    });
    expect(inventory.summary.protectedWriterCount).toBeGreaterThan(0);
    expect(inventory.summary.protectedReaderCount).toBeGreaterThan(0);
    expect(inventory.summary.unknownWriterCount).toBe(0);
    expect(inventory.summary.unknownReaderCount).toBe(0);
    expect(inventory.unknownWriters).toEqual([]);
    expect(inventory.unknownReaders).toEqual([]);
    expect(validateProtectedCoreSurfaceInventory(inventory, root)).toEqual([]);
  });

  it('covers the complete protected-core surface categories and route families', () => {
    const inventory = buildProtectedCoreSurfaceInventory(root);
    const kinds = new Set(inventory.surfaces.map((surface) => surface.kind));
    const routeMounts = new Set(
      inventory.surfaces
        .filter((surface) => surface.kind === 'http_route')
        .map((surface) => surface.routeMount),
    );
    const uiRoutes = new Set(
      inventory.surfaces
        .filter((surface) => surface.kind === 'ui_flow')
        .map((surface) => surface.routeMount),
    );

    for (const kind of [
      'http_route',
      'ui_flow',
      'writer',
      'reader',
      'table',
      'provider',
      'report',
      'scheduled_job',
      'export',
      'shared_dependency',
    ]) expect(kinds).toContain(kind);

    for (const route of [
      '/api/patients',
      '/api/appointments',
      '/api/queue',
      '/api/visits',
      '/api/reception',
      '/api/billing',
      '/api/billing-counter',
      '/api/payments',
      '/api/deposits',
      '/api/credit-notes',
      '/api/settlements',
      '/api/commissions',
      '/api/doctors',
      '/api/departments',
      '/api/tests',
      '/api/settings',
      '/api/users',
      '/api/permissions',
      '/api/access-control',
      '/api/audit',
    ]) expect(routeMounts).toContain(route);

    for (const route of [
      '/h/:slug/reception/dashboard',
      '/h/:slug/reception/patients',
      '/h/:slug/reception/patients/new',
      '/h/:slug/reception/billing',
      '/h/:slug/reception/appointments',
      '/h/:slug/reception/queue',
      '/h/:slug/billing',
      '/h/:slug/commissions',
      '/h/:slug/settings',
      '/h/:slug/access-control',
    ]) expect(uiRoutes).toContain(route);
  });

  it('records authority, proof, identity, money, migration, rollback and retirement rules for every surface', () => {
    const inventory = buildProtectedCoreSurfaceInventory(root);

    expect(inventory.surfaces.length).toBeGreaterThan(100);
    for (const surface of inventory.surfaces) {
      expect(surface.id).toMatch(/^pcsi_[0-9a-f]{24}$/);
      expect(surface.domain.length).toBeGreaterThan(0);
      expect(surface.path.length).toBeGreaterThan(0);
      expect(surface.currentAuthority.length).toBeGreaterThan(0);
      expect(surface.intendedCanonicalAuthority.length).toBeGreaterThan(0);
      expect(surface.productionProof.status).toBe('owner_approved_live_scope_repository_evidence');
      expect(surface.productionProof.evidence.length).toBeGreaterThan(0);
      expect(surface.identityRule.length).toBeGreaterThan(0);
      expect(surface.moneyRule.length).toBeGreaterThan(0);
      expect(surface.migrationBackfillRequirement.length).toBeGreaterThan(0);
      expect(surface.readPromotionRequirement.length).toBeGreaterThan(0);
      expect(surface.rollbackAction.length).toBeGreaterThan(0);
      expect(surface.retirementGate.length).toBeGreaterThan(0);
    }
  });

  it('keeps the checked-in machine inventory deterministic and current', () => {
    expect(existsSync(resolve(root, PROTECTED_CORE_INVENTORY_PATH))).toBe(true);
    expect(readGeneratedInventory()).toEqual(buildProtectedCoreSurfaceInventory(root));
  });
});
