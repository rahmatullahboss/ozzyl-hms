import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const backendRouteTests: Record<string, string[]> = {
  adjustmentRequests: ['test/integration/routes/inventory/inventory-adjustment-requests.test.ts'],
  assets: ['test/integration/routes/inventory/assets.test.ts'],
  consumptionEvents: ['test/inventory-consumption-events.test.ts', 'test/inventory-consumption-routes.test.ts'],
  consumptionExceptions: ['test/inventory-consumption-exceptions.test.ts', 'test/inventory-consumption-routes.test.ts'],
  consumptionReports: ['test/inventory-consumption-queue-read.test.ts', 'test/inventory-consumption-routes.test.ts'],
  consumptionRules: ['test/inventory-consumption-rules.test.ts', 'test/inventory-consumption-rules-db.test.ts'],
  countSessions: ['test/integration/routes/inventory/inventory-returns-adjustments-counts.test.ts'],
  dashboard: ['test/integration/routes/inventory/inventory-dashboard-issues.test.ts', 'test/inventory-dashboard-batching.test.ts'],
  dispatch: ['test/integration/routes/inventory/inventory-dispatch.test.ts', 'test/integration/routes/inventory/inventory-dispatch-fifo.test.ts', 'test/integration/routes/inventory/inventory-dispatch-safety.test.ts'],
  donations: ['test/integration/routes/inventory/donations.test.ts'],
  gr: ['test/integration/routes/inventory/inventory-gr.test.ts', 'test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts'],
  importExport: ['test/integration/routes/inventory/inventory-import-export.test.ts'],
  intelligence: ['test/unit/inventory-intelligence-route-helpers.test.ts', 'test/unit/inventory-intelligence-recompute.test.ts', 'test/unit/inventory-intelligence-recompute-db.test.ts', 'test/unit/inventory-dashboard-smart-assistant.test.ts'],
  issueOperations: ['test/integration/routes/inventory/inventory-issue-operations.test.ts'],
  issues: ['test/integration/routes/inventory/inventory-issues-edge-cases.test.ts', 'test/integration/routes/inventory/inventory-issue-idempotency.test.ts', 'test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts'],
  items: ['test/integration/routes/inventory/inventory-items.test.ts', 'test/integration/routes/inventory/inventory-item-master.test.ts'],
  locations: ['test/integration/routes/inventory/inventory-stores.test.ts', 'test/integration/routes/inventory/inventory-qr.test.ts'],
  pharmacyBridge: ['test/integration/routes/inventory/pharmacyBridge.test.ts'],
  po: ['test/integration/routes/inventory/inventory-po.test.ts', 'test/inventory-po-fiscal-year.test.ts'],
  purchaseRequests: ['test/integration/routes/inventory/inventory-workflow-enhancements.test.ts'],
  qr: ['test/integration/routes/inventory/inventory-qr.test.ts'],
  quickStart: ['test/integration/routes/inventory/quick-start.test.ts'],
  reorder: ['test/integration/routes/inventory/reorder.test.ts'],
  reports: ['test/integration/routes/inventory/inventory-reports.test.ts', 'test/integration/routes/inventory/inventory-reports-edge-cases.test.ts'],
  req: ['test/integration/routes/inventory/inventory-req.test.ts'],
  reservations: ['test/integration/routes/inventory/reservations.test.ts'],
  return: ['test/integration/routes/inventory/inventory-return.test.ts'],
  returns: ['test/integration/routes/inventory/inventory-returns-adjustments-counts.test.ts'],
  rfq: ['test/integration/routes/inventory/inventory-rfq.test.ts'],
  settings: ['test/integration/routes/inventory/inventory-settings.test.ts'],
  stock: ['test/integration/routes/inventory/inventory-stock.test.ts', 'test/integration/routes/inventory/inventory-stock-overview.test.ts'],
  stores: ['test/integration/routes/inventory/inventory-stores.test.ts'],
  transfers: ['test/integration/routes/inventory/inventory-transfers.test.ts', 'test/integration/routes/inventory/inventory-transfer-fifo.test.ts'],
  vendors: ['test/integration/routes/inventory/inventory-vendors.test.ts'],
  workflowAdapters: ['test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts'],
  writeoff: ['test/integration/routes/inventory/inventory-writeoff.test.ts'],
};

const requiredInventoryFlows: Record<string, string[]> = {
  'item/vendor/store master data': ['test/integration/routes/inventory/inventory-items.test.ts', 'test/integration/routes/inventory/inventory-vendors.test.ts', 'test/integration/routes/inventory/inventory-stores.test.ts'],
  'purchase order and goods receipt': ['test/integration/routes/inventory/inventory-po.test.ts', 'test/integration/routes/inventory/inventory-gr.test.ts'],
  'stock ledger and overview': ['test/integration/routes/inventory/inventory-stock.test.ts', 'test/integration/routes/inventory/inventory-stock-overview.test.ts'],
  'requisition dispatch issue': ['test/integration/routes/inventory/inventory-req.test.ts', 'test/integration/routes/inventory/inventory-dispatch.test.ts', 'test/integration/routes/inventory/inventory-issues-edge-cases.test.ts'],
  'fifo and over-issue safety': ['test/integration/routes/inventory/inventory-dispatch-fifo.test.ts', 'test/integration/routes/inventory/inventory-transfer-fifo.test.ts', 'test/integration/routes/inventory/inventory-dispatch-safety.test.ts'],
  'transfers returns counts adjustments writeoff': ['test/integration/routes/inventory/inventory-transfers.test.ts', 'test/integration/routes/inventory/inventory-returns-adjustments-counts.test.ts', 'test/integration/routes/inventory/inventory-adjustment-requests.test.ts', 'test/integration/routes/inventory/inventory-writeoff.test.ts'],
  'reports dashboard reorder accounting': ['test/integration/routes/inventory/inventory-reports.test.ts', 'test/integration/routes/inventory/inventory-dashboard-issues.test.ts', 'test/integration/routes/inventory/reorder.test.ts', 'test/integration/routes/inventory-accounting.test.ts'],
  'import export onboarding': ['test/integration/routes/inventory/inventory-import-export.test.ts', 'test/integration/routes/inventory/quick-start.test.ts'],
  'lab ot pharmacy bridges': ['test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts', 'test/integration/routes/inventory/pharmacyBridge.test.ts', 'test/lab-inventory-bridge-contract.test.ts', 'test/lab-inventory-bridge-db.test.ts'],
  'consumption automation': ['test/inventory-consumption-routes.test.ts', 'test/inventory-consumption-posting.test.ts', 'test/inventory-consumption-triggering.test.ts', 'test/inventory-consumption-confirmation.test.ts'],
  'traceability reservations donations assets': ['test/integration/routes/inventory/inventory-qr.test.ts', 'test/integration/routes/inventory/reservations.test.ts', 'test/integration/routes/inventory/donations.test.ts', 'test/integration/routes/inventory/assets.test.ts'],
};

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).filter(name => name.endsWith('.ts')).map(name => name.replace(/\.ts$/, '')).sort();
}

describe('inventory coverage matrix', () => {
  it('requires every backend inventory route module to be represented by tests', () => {
    const routeNames = listTsFiles('src/routes/tenant/inventory').filter(name => !['helpers', 'index'].includes(name));
    expect(routeNames).toEqual(Object.keys(backendRouteTests).sort());

    for (const [routeName, tests] of Object.entries(backendRouteTests)) {
      expect(tests.length, `${routeName} should have at least one mapped test`).toBeGreaterThan(0);
      for (const testPath of tests) {
        expect(existsSync(testPath), `${routeName} missing mapped test file: ${testPath}`).toBe(true);
      }
    }
  });

  it('requires mounted inventory routes to keep their route modules covered', () => {
    const indexSource = readFileSync('src/routes/tenant/inventory/index.ts', 'utf8');
    for (const routeName of Object.keys(backendRouteTests)) {
      expect(indexSource, `${routeName} should be imported/mounted in inventory index`).toContain(`./${routeName}`);
    }
  });

  it('requires every inventory UI page to have a colocated test file', () => {
    const pageDir = join('web', 'src', 'pages', 'inventory');
    const pages = readdirSync(pageDir).filter(name => name.endsWith('.tsx') && !name.includes('.test.')).map(name => name.replace(/\.tsx$/, '')).sort();
    const tests = new Set(readdirSync(pageDir).filter(name => name.endsWith('.test.ts') || name.endsWith('.test.tsx')).map(name => name.replace(/\.test\.tsx?$/, '')));

    for (const page of pages) {
      expect(tests.has(page), `${page}.tsx is missing ${page}.test.ts`).toBe(true);
    }
  });

  it('keeps high-risk inventory workflows mapped to tests', () => {
    for (const [flowName, tests] of Object.entries(requiredInventoryFlows)) {
      expect(tests.length, `${flowName} should have mapped tests`).toBeGreaterThan(0);
      for (const testPath of tests) {
        expect(existsSync(testPath), `${flowName} missing ${testPath}`).toBe(true);
      }
    }
  });
});
