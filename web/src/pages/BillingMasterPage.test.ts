import { describe, expect, it } from 'vitest';

describe('BillingMasterPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./BillingMasterPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('includes referral hospitals tab', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, './BillingMasterPage.tsx'),
      'utf-8',
    );
    expect(src).toContain("key: 'referralHospitals'");
    expect(src).toContain('ReferralHospitalsTab');
  });

  it('exposes advanced scheme policy fields without making the base form noisy', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, './BillingMasterPage.tsx'),
      'utf-8',
    );
    expect(src).toContain('Policy / benefit rules');
    expect(src).toContain('DISCOUNT_SOURCE_OPTIONS');
    expect(src).toContain('Default price category');
    expect(src).toContain('Auto-suggest in billing');
  });

  it('includes configurable IPD bed charge policy controls', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, './BillingMasterPage.tsx'),
      'utf-8',
    );

    expect(src).toContain("key: 'bedPolicy'");
    expect(src).toContain('BedChargePolicyTab');
    expect(src).toContain('ipd_bed_charge_day_count_mode');
    expect(src).toContain('ipd_bed_charge_grace_hours');
    expect(src).toContain('ipd_bed_charge_check_in_hour');
    expect(src).toContain('ipd_bed_charge_early_check_in_grace_hours');
    expect(src).toContain('Half-day threshold hours');
  });
});
