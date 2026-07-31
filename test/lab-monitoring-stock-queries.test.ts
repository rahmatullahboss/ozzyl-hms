import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync('src/routes/tenant/labMonitoring.ts', 'utf8');
const reagentStockSyncSource = readFileSync('src/lib/lab-reagent-stock-sync.ts', 'utf8');

describe('lab monitoring stock query contracts', () => {
  it('does not count expired, QC-pending, or onboard-expired stock as usable stock', () => {
    expect(routeSource).toContain('date(s.expiry_date) >= CURRENT_DATE');
    expect(routeSource).toContain("s.qc_status IN ('not_required', 'passed')");
    expect(routeSource).toContain('date(s.onboard_expires_at) >= CURRENT_DATE');
  });

  it('delegates reagent, chemical, and kit stock-in lots to QC-pending canonical stock creation', () => {
    expect(routeSource).toContain('isCanonicalReagentCategory(consumable.category)');
    expect(routeSource).toContain('createCanonicalReagentStock(c.env.DB');
    expect(reagentStockSyncSource).toContain("return ['reagent', 'chemical', 'kit'].includes");
    expect(reagentStockSyncSource).toContain("return isCanonicalReagentCategory(category) ? 'pending' : 'not_required';");
  });

  it('tenant scopes consumable detail stock lots and filters QC-pending lots', () => {
    expect(routeSource).toContain('s.tenant_id = ? AND s.quantity_available > 0');
    expect(routeSource).toContain("AND s.qc_status IN ('not_required', 'passed')");
  });

  it('keeps low stock alerts based on usable total_stock threshold', () => {
    expect(routeSource).toContain('HAVING total_stock <= c.reorder_level');
    expect(routeSource).toContain("s.qc_status IN ('not_required', 'passed')");
  });

  it('exposes a tenant-scoped QC update endpoint for stock lots', () => {
    expect(routeSource).toContain("labMonitoring.post('/stock/:stockId/qc'");
    expect(routeSource).toContain('qc_status = ?');
    expect(routeSource).toContain('WHERE id = ? AND tenant_id = ?');
    expect(routeSource).toContain('qc_checked_by = ?');
    expect(routeSource).toContain('qc_performed');
  });

  it('exposes a tenant-scoped stock-open endpoint for onboard expiry tracking', () => {
    expect(routeSource).toContain("labMonitoring.post('/stock/:stockId/open'");
    expect(routeSource).toContain('opened_at = datetime');
    expect(routeSource).toContain('onboard_expires_at = date');
    expect(routeSource).toContain('stock_opened');
  });

  it('exposes tenant-scoped stock locations and location-aware stock flows', () => {
    expect(routeSource).toContain("labMonitoring.get('/stock/locations'");
    expect(routeSource).toContain("labMonitoring.post('/stock/locations'");
    expect(routeSource).toContain("labMonitoring.put('/stock/locations/:locationId'");
    expect(routeSource).toContain("labMonitoring.delete('/stock/locations/:locationId'");
    expect(routeSource).toContain('location_id: z.number().int().positive().optional()');
    expect(routeSource).toContain('LEFT JOIN lab_consumable_locations');
    expect(routeSource).toContain('locationId: data.location_id');
  });

  it('exposes a tenant-scoped whole-lot location transfer flow', () => {
    expect(routeSource).toContain("labMonitoring.post('/stock/:stockId/transfer-location'");
    expect(routeSource).toContain('target_location_id: z.number().int().positive()');
    expect(routeSource).toContain('SET location_id = ?');
    expect(routeSource).toContain("'transfer_out'");
    expect(routeSource).toContain("'transfer_in'");
    expect(routeSource).toContain("'location_transfer'");
  });

  it('exposes a tenant-scoped wastage/write-off approval flow', () => {
    expect(routeSource).toContain("labMonitoring.get('/stock/waste-requests'");
    expect(routeSource).toContain("labMonitoring.post('/stock/waste-requests'");
    expect(routeSource).toContain("labMonitoring.post('/stock/waste-requests/:requestId/approve'");
    expect(routeSource).toContain("labMonitoring.post('/stock/waste-requests/:requestId/reject'");
    expect(routeSource).toContain("z.enum(['expired', 'broken', 'qc_failed', 'spillage', 'temperature_breach', 'other'])");
    expect(routeSource).toContain("z.enum(['pending', 'approved', 'rejected', 'all'])");
    expect(routeSource).toContain('Remarks are required when waste reason is other');
    expect(routeSource).toContain('quantity_wasted = quantity_wasted + ?');
    expect(routeSource).toContain("'waste'");
    expect(routeSource).toContain("'waste_disposed'");
    expect(routeSource).toContain("wr.status = 'pending'");
  });
});
