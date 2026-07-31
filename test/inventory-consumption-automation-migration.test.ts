import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync('migrations/0398_inventory_consumption_automation.sql', 'utf8');
const phase0Report = readFileSync('docs/reports/2026-07-01-inventory-consumption-phase0.md', 'utf8');

describe('inventory consumption automation migration', () => {
  it('creates rule, event, exception, and policy tables without replacing canonical stock ledgers', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS InventoryConsumptionRule');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS InventoryConsumptionRuleItem');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS InventoryConsumptionEvent');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS InventoryConsumptionEventItem');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS InventoryConsumptionException');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS InventoryConsumptionPolicy');

    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS InventoryStockAutomation');
    expect(migration).toContain('PostedConsumptionId INTEGER REFERENCES InventoryConsumption(ConsumptionId)');
    expect(migration).toContain('ReversalConsumptionId INTEGER REFERENCES InventoryConsumption(ConsumptionId)');
  });

  it('supports the planned trigger types and deduction modes', () => {
    for (const trigger of ['billing_item', 'lab_test', 'ot_procedure', 'procedure', 'nursing_task', 'emergency_service', 'pharmacy_sale', 'package', 'manual_reference']) {
      expect(migration).toContain(trigger);
    }
    for (const mode of ['auto', 'suggest_confirm', 'scan_required', 'approval_required', 'manual_only']) {
      expect(migration).toContain(mode);
    }
  });

  it('adds idempotency, status, and exception indexes for safe posting and owner review', () => {
    expect(migration).toContain('uq_inv_cons_event_idempotency');
    expect(migration).toContain('idx_inv_cons_event_status');
    expect(migration).toContain('idx_inv_cons_event_reference');
    expect(migration).toContain('idx_inv_cons_exception_status');
    expect(migration).toContain('idx_inv_cons_rule_trigger');
  });

  it('documents the current system anchors before implementation continues', () => {
    expect(phase0Report).toContain('src/lib/inventory-issue-service.ts');
    expect(phase0Report).toContain('src/routes/tenant/inventory/workflowAdapters.ts');
    expect(phase0Report).toContain('No existing table is replaced');
    expect(phase0Report).toContain('No new stock balance table is introduced');
  });
});
