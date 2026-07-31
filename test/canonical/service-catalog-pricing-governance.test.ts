import { describe, expect, it } from 'vitest';
import { buildProtectedCoreWriterCommandCoverage } from '../../scripts/canonical/protected-core-writer-command-coverage';

const EXPECTED_BOUNDARIES = [
  {
    path: 'src/lib/canonical/service-catalog-route-integration.ts',
    table: 'billing_service_items',
    boundary: 'service-catalog.route-adapter-compatibility',
  },
  {
    path: 'src/lib/canonical/service-catalog-route-integration.ts',
    table: 'billing_item_price_category_maps',
    boundary: 'service-price.route-adapter-compatibility',
  },
  {
    path: 'src/routes/tenant/billingMaster.ts',
    table: 'billing_service_items',
    boundary: 'service-catalog.manage.billing-master',
  },
  {
    path: 'src/routes/tenant/billingMaster.ts',
    table: 'billing_item_price_category_maps',
    boundary: 'service-price.manage.billing-master',
  },
  {
    path: 'src/routes/tenant/priceCategories.ts',
    table: 'billing_item_price_category_maps',
    boundary: 'service-price.manage.price-categories',
  },
  {
    path: 'src/routes/tenant/settings-import-export.ts',
    table: 'billing_service_items',
    boundary: 'service-catalog.manage.settings-import',
  },
  {
    path: 'src/routes/tenant/settings-import-export.ts',
    table: 'billing_item_price_category_maps',
    boundary: 'service-price.manage.settings-import',
  },
] as const;

describe('service catalog and pricing governance coverage', () => {
  it('classifies all five protected route writer pairs as atomic compatibility', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(process.cwd());

    for (const expected of EXPECTED_BOUNDARIES) {
      const writer = coverage.writers.find((candidate) => (
        candidate.path === expected.path && candidate.table === expected.table
      ));
      expect(writer, `${expected.path}:${expected.table}`).toBeDefined();
      expect(writer?.classification, `${expected.path}:${expected.table}`).toBe('atomic_compatibility');
      expect(writer?.strictBoundaryIds, `${expected.path}:${expected.table}`).toContain(expected.boundary);
    }
  });

  it('reduces service-catalog/pricing command-required coverage to zero', () => {
    const coverage = buildProtectedCoreWriterCommandCoverage(process.cwd());
    const remaining = coverage.writers.filter((writer) => (
      writer.classification === 'command_required'
      && writer.protectedConceptIds.includes('service_catalog_pricing')
    ));

    expect(remaining).toEqual([]);
  });
});
