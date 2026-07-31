import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Hospital registration billing seed contract', () => {
  it('executes every default billing seed insert', () => {
    const source = readFileSync('src/routes/register.ts', 'utf8');
    const inserts = source.match(/INSERT INTO billing_(?:service_departments|service_items|price_categories|schemes|fiscal_years)[\s\S]{0,260}?\.bind\([^;]+;/g) ?? [];

    expect(inserts.length).toBeGreaterThanOrEqual(5);
    for (const insert of inserts) {
      expect(insert).toContain('.run()');
    }
  });

  it('keeps service item insert placeholders aligned with its columns', () => {
    const source = readFileSync('src/routes/register.ts', 'utf8');
    expect(source).not.toContain('VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  });

  it('seeds accounting defaults for every hospital provisioning path', () => {
    const publicRegistration = readFileSync('src/routes/register.ts', 'utf8');
    const adminProvisioning = readFileSync('src/routes/admin/index.ts', 'utf8');
    const accountingProvisioning = readFileSync('src/lib/accounting-provisioning.ts', 'utf8');

    expect(publicRegistration).toContain('seedAccountingDefaults(c.env.DB');
    expect(adminProvisioning.match(/seedAccountingDefaults\(c\.env\.DB/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(accountingProvisioning).toContain('fiscal_years');
    expect(accountingProvisioning).toContain('voucher_types');
    expect(accountingProvisioning).toContain('chart_of_accounts');
    expect(accountingProvisioning).toContain('accounting_account_mappings');
    expect(accountingProvisioning).toContain("discount_allowed: '5950'");
    expect(accountingProvisioning).toContain('seedInventoryVendorDefaults');
  });

  it('seeds inventory vendor defaults for public hospital self-registration', () => {
    const publicRegistration = readFileSync('src/routes/register.ts', 'utf8');
    const inventoryVendorDefaults = readFileSync('src/lib/inventory-vendor-defaults.ts', 'utf8');

    expect(publicRegistration).toContain('seedInventoryVendorDefaults(c.env.DB');
    expect(inventoryVendorDefaults).toContain('Roche Diagnostics Supplier');
    expect(inventoryVendorDefaults).toContain('Mindray Biomedical Supplier');
    expect(inventoryVendorDefaults).toContain('Local Lab Consumables Supplier');
    expect(inventoryVendorDefaults).toContain('Tube & Needle Supplier');
  });

  it('seeds lab reagent defaults for new hospital provisioning', () => {
    const publicRegistration = readFileSync('src/routes/register.ts', 'utf8');

    expect(publicRegistration).toContain('seedLabReagentDefaults(c.env.DB');
  });
});
