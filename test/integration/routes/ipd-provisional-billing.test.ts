import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const indexSource = readFileSync(join(root, 'src/index.ts'), 'utf8');
const billingProvisionalSource = readFileSync(join(root, 'src/routes/tenant/billingProvisional.ts'), 'utf8');
const drawerServicesSource = readFileSync(join(root, 'web/src/components/nursing/DrawerServicesTab.tsx'), 'utf8');
const ipdReportsSource = readFileSync(join(root, 'src/routes/tenant/ipdReports.ts'), 'utf8');

describe('canonical IPD provisional billing wiring', () => {
  it('does not expose the removed legacy IPD charges route module or route mount', () => {
    expect(existsSync(join(root, 'src/routes/tenant/ipdCharges.ts'))).toBe(false);
    expect(indexSource).not.toContain('/api/ipd-charges');
    expect(indexSource).not.toContain('ipdChargeRoutes');
  });

  it('keeps canonical provisional billing mounted as the IPD service-charge entry point', () => {
    expect(indexSource).toContain("app.route('/api/billing-provisional', billingProvisionalRoutes)");
    expect(billingProvisionalSource).toContain('createProvisionalItemsSchema');
    expect(billingProvisionalSource).toContain('billing_provisional_items');
    expect(billingProvisionalSource).toContain('patient_id does not match admission_id');
  });

  it('posts nursing drawer service charges as manual provisional billing items', () => {
    expect(drawerServicesSource).toContain('/api/billing-provisional');
    expect(drawerServicesSource).toContain("item_category: 'nursing_service'");
    expect(drawerServicesSource).toContain('unit_price: unitPrice');
    expect(drawerServicesSource).not.toContain('/api/ipd-charges');
  });

  it('reports IPD revenue from canonical provisional and bed-charge sources', () => {
    expect(ipdReportsSource).toContain('billing_provisional_items');
    expect(ipdReportsSource).toContain('patient_bed_infos');
    expect(ipdReportsSource).toContain("'bed_charge' AS type");
    expect(ipdReportsSource).not.toContain('FROM ipd_charges');
  });
});
