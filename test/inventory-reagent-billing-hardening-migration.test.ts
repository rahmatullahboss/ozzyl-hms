import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0409_small_hospital_reagent_billing_hardening.sql';

describe('small-hospital reagent billing hardening migration', () => {
  it('adds source-linked reversal and open-exception dedupe guards without changing policy values', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('ALTER TABLE lab_consumable_movements ADD COLUMN reverses_movement_id INTEGER');
    expect(sql).toContain('idx_lab_consumable_return_source_unique');
    expect(sql).toContain("WHERE movement_type = 'return' AND reverses_movement_id IS NOT NULL");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS lab_reagent_reversal_guard');
    expect(sql).toContain('ALTER TABLE lab_inventory_exceptions ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 1');
    expect(sql).toContain('ALTER TABLE lab_inventory_exceptions ADD COLUMN last_occurred_at DATETIME');
    expect(sql).toContain('idx_lab_inventory_exception_open_unique');
    expect(sql).not.toContain('UPDATE lab_inventory_policy');
  });
});
