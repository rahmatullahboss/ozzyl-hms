import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0400_inventory_reagent_integrity_hardening.sql';

describe('inventory reagent integrity migration', () => {
  it('creates tenant-scoped reagent progress and demand event dedupe tables', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS lab_consumable_mapping_progress');
    expect(sql).toContain('expected_quantity');
    expect(sql).toContain('committed_quantity');
    expect(sql).toContain('projected_quantity');
    expect(sql).toContain('UNIQUE (tenant_id, lab_order_item_id, consumable_id)');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS inventory_demand_source_event');
    expect(sql).toContain('UNIQUE (tenant_id, source_type, source_id)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_lab_consumable_mapping_progress_status');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_inventory_demand_source_event_item_date');
  });
});
