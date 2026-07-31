import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync('migrations/0372_lab_consumable_consumption_claims.sql', 'utf8');
const qcMigrationSource = readFileSync('migrations/0373_lab_consumable_stock_qc.sql', 'utf8');
const onboardMigrationSource = readFileSync('migrations/0374_lab_consumable_stock_onboard_expiry.sql', 'utf8');
const locationMigrationSource = readFileSync('migrations/0375_lab_consumable_stock_locations.sql', 'utf8');
const wasteMigrationSource = readFileSync('migrations/0376_lab_consumable_waste_requests.sql', 'utf8');

describe('lab consumable consumption claim migration', () => {
  it('creates a claim table for lab order item consumption idempotency', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS lab_consumable_consumption_claims');
    expect(migrationSource).toContain('reference_type');
    expect(migrationSource).toContain('reference_id');
  });

  it('enforces one auto-consumption claim per tenant and lab order item reference', () => {
    expect(migrationSource).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_consumable_claim_once');
    expect(migrationSource).toContain('tenant_id, reference_type, reference_id');
  });
});

describe('lab consumable stock QC migration', () => {
  it('adds QC tracking columns to stock lots', () => {
    expect(qcMigrationSource).toContain('ALTER TABLE lab_consumable_stock ADD COLUMN qc_status');
    expect(qcMigrationSource).toContain("DEFAULT 'not_required'");
    expect(qcMigrationSource).toContain('qc_checked_at');
    expect(qcMigrationSource).toContain('qc_checked_by');
    expect(qcMigrationSource).toContain('qc_remarks');
    expect(qcMigrationSource).toContain("CHECK(qc_status IN ('pending','passed','failed','not_required'))");
  });

  it('indexes QC status for usable stock filtering', () => {
    expect(qcMigrationSource).toContain('CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_qc');
    expect(qcMigrationSource).toContain('tenant_id, qc_status');
    expect(qcMigrationSource).toContain('quantity_available');
  });
});

describe('lab consumable stock onboard expiry migration', () => {
  it('adds open-vial and onboard expiry tracking columns', () => {
    expect(onboardMigrationSource).toContain('ALTER TABLE lab_consumable_stock ADD COLUMN opened_at');
    expect(onboardMigrationSource).toContain('opened_by');
    expect(onboardMigrationSource).toContain('onboard_expiry_days');
    expect(onboardMigrationSource).toContain('onboard_expires_at');
    expect(onboardMigrationSource).toContain('opened_remarks');
  });

  it('indexes onboard expiry for usable stock filtering', () => {
    expect(onboardMigrationSource).toContain('CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_onboard_expiry');
    expect(onboardMigrationSource).toContain('tenant_id, onboard_expires_at');
    expect(onboardMigrationSource).toContain('quantity_available');
  });
});


describe('lab consumable stock location migration', () => {
  it('creates tenant-scoped lab consumable locations', () => {
    expect(locationMigrationSource).toContain('CREATE TABLE IF NOT EXISTS lab_consumable_locations');
    expect(locationMigrationSource).toContain('location_code');
    expect(locationMigrationSource).toContain('location_name');
    expect(locationMigrationSource).toContain('location_type');
    expect(locationMigrationSource).toContain('tenant_id');
  });

  it('links stock lots to a lab stock location', () => {
    expect(locationMigrationSource).toContain('ALTER TABLE lab_consumable_stock ADD COLUMN location_id');
    expect(locationMigrationSource).toContain('CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_location');
    expect(locationMigrationSource).toContain('tenant_id, location_id');
    expect(locationMigrationSource).toContain('quantity_available');
  });
});

describe('lab consumable waste request migration', () => {
  it('creates an approval table for lab consumable wastage', () => {
    expect(wasteMigrationSource).toContain('CREATE TABLE IF NOT EXISTS lab_consumable_waste_requests');
    expect(wasteMigrationSource).toContain('stock_id');
    expect(wasteMigrationSource).toContain('consumable_id');
    expect(wasteMigrationSource).toContain('quantity');
    expect(wasteMigrationSource).toContain('status');
    expect(wasteMigrationSource).toContain('reviewed_by');
  });

  it('indexes pending waste requests by tenant and stock lot', () => {
    expect(wasteMigrationSource).toContain('CREATE INDEX IF NOT EXISTS idx_lab_consumable_waste_status');
    expect(wasteMigrationSource).toContain('tenant_id, status, requested_at');
    expect(wasteMigrationSource).toContain('CREATE INDEX IF NOT EXISTS idx_lab_consumable_waste_stock');
    expect(wasteMigrationSource).toContain('tenant_id, stock_id');
  });
});
