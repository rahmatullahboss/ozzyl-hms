import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const admissionsSource = readFileSync(join(root, 'src/routes/tenant/admissions.ts'), 'utf8');
const migrationSource = readFileSync(join(root, 'migrations/0385_bed_equipment_map.sql'), 'utf8');
const bedPageSource = readFileSync(join(root, 'web/src/pages/BedManagement.tsx'), 'utf8');
const assetPageSource = readFileSync(join(root, 'web/src/pages/AssetManagement.tsx'), 'utf8');

describe('Bed Command Center backend contract', () => {
  it('adds durable per-bed equipment mapping with tenant-scoped indexes', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS bed_equipment_map');
    expect(migrationSource).toContain('tenant_id TEXT NOT NULL');
    expect(migrationSource).toContain('bed_id INTEGER NOT NULL');
    expect(migrationSource).toContain('fixed_asset_stock_id INTEGER');
    expect(migrationSource).toContain("CHECK (status IN ('available', 'in_use', 'faulty', 'maintenance', 'missing'))");
    expect(migrationSource).toContain('idx_bed_equipment_map_bed');
    expect(migrationSource).toContain('idx_bed_equipment_map_status');
  });

  it('enriches ward-bed overview with patient, doctor and equipment issue counts', () => {
    expect(admissionsSource).toContain("app.get('/ward-bed-overview'");
    expect(admissionsSource).toContain('p.age AS patient_age');
    expect(admissionsSource).toContain('p.mobile AS patient_mobile');
    expect(admissionsSource).toContain('d.name AS doctor_name');
    expect(admissionsSource).toContain('equipment_count');
    expect(admissionsSource).toContain('equipment_issue_count');
    expect(admissionsSource).toContain("status IN ('faulty','maintenance','missing')");
  });

  it('exposes command-detail data with housekeeping, equipment and maintenance timeline', () => {
    expect(admissionsSource).toContain("app.get('/beds/:id/command-detail'");
    expect(admissionsSource).toContain('housekeeping_tasks');
    expect(admissionsSource).toContain('bed_equipment_map');
    expect(admissionsSource).toContain('asset_maintenance_log');
    expect(admissionsSource).toContain('maintenanceLogs');
    expect(admissionsSource).toContain('timeline: augmentedTimeline');
  });

  it('exposes GET and PUT equipment APIs and audits equipment updates', () => {
    expect(admissionsSource).toContain("app.get('/beds/:id/equipment'");
    expect(admissionsSource).toContain("app.put('/beds/:id/equipment'");
    expect(admissionsSource).toContain("UPDATE bed_equipment_map SET is_active = 0");
    expect(admissionsSource).toContain('INSERT INTO bed_equipment_map');
    expect(admissionsSource).toContain('update_bed_equipment');
  });

  it('keeps ward rename compatible with old and new payload shapes', () => {
    expect(admissionsSource).toContain('new_name?: string; name?: string');
    expect(admissionsSource).toContain('body.new_name ?? body.name');
  });
});

describe('Bed Command Center frontend contract', () => {
  it('renders the command-center controls and equipment issue KPI', () => {
    expect(bedPageSource).toContain('searchTerm');
    expect(bedPageSource).toContain('floorFilter');
    expect(bedPageSource).toContain('typeFilter');
    expect(bedPageSource).toContain('Equipment Issues');
    expect(bedPageSource).toContain('equipment_issue_count');
    expect(bedPageSource).toContain('Room Assets / Bedside Equipment');
  });

  it('supports inventory asset linking and maintenance logging from the bed drawer', () => {
    expect(bedPageSource).toContain('/api/inventory/assets?status=active');
    expect(bedPageSource).toContain('applyAssetToEquipmentRow');
    expect(bedPageSource).toContain('/api/inventory/assets/maintenance');
    expect(bedPageSource).toContain('Log maintenance ticket');
    expect(bedPageSource).toContain('Mark bed maintenance');
  });

  it('links maintenance timeline rows into Asset Management', () => {
    expect(bedPageSource).toContain('/asset-management?tab=maintenance&log=');
    expect(bedPageSource).toContain('Open maintenance');
    expect(bedPageSource).toContain('command-detail');
  });
});

describe('Asset Management maintenance deep links', () => {
  it('parses tab/log query params and focuses a selected maintenance log', () => {
    expect(assetPageSource).toContain('getAssetManagementQueryState');
    expect(assetPageSource).toContain('maintenance');
    expect(assetPageSource).toContain('focusLogId');
    expect(assetPageSource).toContain('maintenance-log-${focusLogId}');
    expect(assetPageSource).toContain('scrollIntoView');
    expect(assetPageSource).toContain('Focused maintenance log');
  });
});
