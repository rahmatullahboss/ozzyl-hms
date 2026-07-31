import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backend = readFileSync('src/routes/tenant/billingCounter.legacy.ts', 'utf8');
const frontend = readFileSync('web/src/pages/BillingCounterPage.tsx', 'utf8');

describe('Billing Counter performer reserve contract', () => {
  it('loads effective performer rules in a tenant-scoped batch endpoint', () => {
    expect(backend).toContain("get('/performer-payout-rules'");
    expect(backend).toContain('diagnostic_performer_payout_rules');
    expect(backend).toContain('service_item_ids');
    expect(backend).toContain("requirePermission('billing.counter.read')");
  });

  it('shows auto-reserve state and never submits a manual performer for reserved tests', () => {
    expect(frontend).toContain('performerPayoutRule');
    expect(frontend).toContain('auto-reserved per unit');
    expect(frontend).toContain('Automatic performer reserve');
    expect(frontend).toContain('performerDoctorId: line.serviceItem?.performerPayoutRule ? undefined');
    expect(frontend).toContain("performerDoctorId: ''");
  });
});
