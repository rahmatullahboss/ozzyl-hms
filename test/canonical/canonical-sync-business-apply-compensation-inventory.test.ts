import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { completeCanonicalSyncBusinessEvent } from '../../src/lib/canonical/local-sync-business-apply';
import {
  createCanonicalSyncBusinessPayload,
  parseCanonicalSyncBusinessPayload,
} from '../../src/lib/canonical/local-sync-business-payload';
import { projectCanonicalSyncBusinessMutation } from '../../src/lib/canonical/local-sync-business-projector';
import { claimCanonicalSyncInboxEvent, receiveCanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-inbox';
import { createCanonicalSyncEnvelope, type CanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-protocol';

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new Statement(
      this.sqlite,
      this.sql,
      params.map((value) => value === undefined ? null : value) as SQLInputValue[],
    );
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function database(sqlite: DatabaseSync): CanonicalBatchDatabase {
  return {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function createDependencies(sqlite: DatabaseSync): void {
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE canonical_service_catalog_items (
      tenant_id TEXT NOT NULL,
      service_public_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id,service_public_id)
    );
    CREATE TABLE canonical_practitioners (
      tenant_id TEXT NOT NULL,
      practitioner_public_id TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tenant_id,practitioner_public_id)
    );
    CREATE TABLE canonical_invoices (
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id,invoice_public_id)
    );
    CREATE TABLE canonical_invoice_lines (
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      line_public_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id,invoice_public_id,line_public_id)
    );
    CREATE TABLE canonical_service_events (
      tenant_id TEXT NOT NULL,
      event_public_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id,event_public_id)
    );
    INSERT INTO canonical_service_catalog_items VALUES ('100','service-1');
    INSERT INTO canonical_practitioners VALUES ('100','practitioner-1','active');
    INSERT INTO canonical_invoices VALUES ('100','invoice-1');
    INSERT INTO canonical_invoice_lines VALUES ('100','invoice-1','line-1');
    INSERT INTO canonical_service_events VALUES ('100','service-event-1');
  `);
  sqlite.exec(readFileSync('migrations/0513_canonical_practitioner_compensation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0514_canonical_inventory_links.sql', 'utf8'));
  sqlite.exec(`
    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
      priority,effective_from,effective_to,status,source_evidence_sha256
    ) VALUES (
      '100','rule-1',1,'all',NULL,NULL,NULL,'performing','commission','basis_points',2000,
      'net_after_discount','deduct','exclude',0,NULL,100,'2026-01-01',NULL,'active',
      '${'1'.repeat(64)}'
    );
    INSERT INTO canonical_inventory_items (
      tenant_id,item_public_id,item_kind,display_name,base_unit_code,status,source_evidence_sha256
    ) VALUES ('100','item-1','medicine','Test Item','piece','active','${'2'.repeat(64)}');
    INSERT INTO canonical_inventory_locations (
      tenant_id,location_public_id,location_type,display_name,status,source_evidence_sha256
    ) VALUES ('100','location-1','store','Main Store','active','${'3'.repeat(64)}');
    INSERT INTO canonical_inventory_lots (
      tenant_id,lot_public_id,item_public_id,lot_code,status,source_evidence_sha256
    ) VALUES ('100','lot-1','item-1','LOT-1','active','${'4'.repeat(64)}');
    INSERT INTO canonical_inventory_stock_policies (
      tenant_id,item_public_id,location_public_id,allow_negative_stock,source_evidence_sha256
    ) VALUES ('100','item-1','location-1',0,'${'5'.repeat(64)}');
  `);
}

function sourceHarness() {
  const sqlite = new DatabaseSync(':memory:');
  createDependencies(sqlite);
  sqlite.exec(`
    INSERT INTO canonical_compensation_accruals (
      tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
      service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
      rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
      gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
      earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
      business_date,payable_projection_guard,source_evidence_sha256
    ) VALUES (
      '100','accrual-1','invoice-1','line-1','service-event-1','practitioner-1',
      'performing','commission','rule-1',1,'net_after_discount','basis_points',2000,'BDT',
      1000,100,0,0,900,180,50,0,130,'accrued','2026-07-25T07:00:00Z',
      '2026-07-25',1,'${'6'.repeat(64)}'
    );
    INSERT INTO canonical_compensation_adjustments (
      tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
      settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
      accrual_adjusted_before_minor,accrual_adjusted_after_minor,
      accrual_settled_before_minor,accrual_settled_after_minor,
      accrual_payable_before_minor,accrual_payable_after_minor,
      occurred_at_utc,business_date,balance_guard,source_evidence_sha256
    ) VALUES (
      '100','adjustment-1','accrual-1',NULL,NULL,'credit','operator_correction',50,
      0,50,0,0,180,130,'2026-07-25T08:00:00Z','2026-07-25',1,'${'7'.repeat(64)}'
    );
    INSERT INTO canonical_inventory_balances (
      tenant_id,item_public_id,location_public_id,lot_public_id,quantity_base,version,
      projection_guard,source_evidence_sha256,updated_at_utc
    ) VALUES ('100','item-1','location-1','lot-1',7,1,1,'${'8'.repeat(64)}','2026-07-25T09:00:00Z');
    INSERT INTO canonical_inventory_movements (
      tenant_id,movement_public_id,item_public_id,location_public_id,lot_public_id,
      movement_type,direction,source_quantity,source_unit_code,conversion_numerator,
      conversion_denominator,quantity_base,signed_quantity_base,balance_before_base,
      balance_after_base,transfer_public_id,service_event_public_id,invoice_public_id,
      invoice_line_public_id,reversal_of_movement_public_id,source_type,source_public_id,
      source_line_public_id,source_table,status,occurred_at_utc,business_date,actor_user_id,
      balance_guard,source_evidence_sha256
    ) VALUES (
      '100','movement-1','item-1','location-1','lot-1','purchase_receipt','in',7,'piece',1,1,
      7,7,0,7,NULL,NULL,NULL,NULL,NULL,'purchase','purchase-1','purchase-line-1',
      'purchase_items','posted','2026-07-25T09:00:00Z','2026-07-25',NULL,1,
      '${'8'.repeat(64)}'
    );
  `);
  return { sqlite, db: database(sqlite) };
}

function targetHarness() {
  const sqlite = new DatabaseSync(':memory:');
  createDependencies(sqlite);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  return { sqlite, db: database(sqlite) };
}

async function applyEnvelope(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  claimSuffix: string,
): Promise<void> {
  await receiveCanonicalSyncEnvelope(db, envelope, '2026-07-25T10:00:00Z');
  const claim = await claimCanonicalSyncInboxEvent(db, {
    tenantId: envelope.tenantId,
    eventPublicId: envelope.eventPublicId,
    claimPublicId: `claim-${claimSuffix}`,
    claimOwnerPublicId: 'worker-offline-1',
    claimedAtUtc: '2026-07-25T10:00:10Z',
    claimExpiresAtUtc: '2026-07-25T11:00:10Z',
  });
  await completeCanonicalSyncBusinessEvent(db, {
    envelope,
    claimPublicId: claim.claimPublicId,
    appliedAtUtc: '2026-07-25T10:00:20Z',
  });
}

function accrualMutation() {
  return {
    kind: 'compensation_accrued' as const,
    entityPublicId: 'accrual-1',
    invoicePublicId: 'invoice-1',
    invoiceLinePublicId: 'line-1',
    serviceEventPublicId: 'service-event-1',
    practitionerPublicId: 'practitioner-1',
    practitionerRole: 'performing' as const,
    accrualStage: 'commission' as const,
    rulePublicId: 'rule-1',
    ruleVersion: 1,
    calculationBasis: 'net_after_discount' as const,
    rateType: 'basis_points' as const,
    rateValue: 2000,
    currencyCode: 'BDT',
    grossMinor: 1000,
    discountMinor: 100,
    taxMinor: 0,
    performerReserveMinor: 0,
    eligibleBaseMinor: 900,
    earnedMinor: 180,
    initialStatus: 'accrued' as const,
    accruedAtUtc: '2026-07-25T07:00:00Z',
    businessDate: '2026-07-25',
    sourceEvidenceSha256: '6'.repeat(64),
  };
}

async function accrualEnvelope() {
  return createCanonicalSyncEnvelope({
    tenantId: '100',eventPublicId: 'outbox-accrual-1',entityType: 'compensation_accrual',
    entityPublicId: 'accrual-1',eventType: 'canonical.compensation.accrued',aggregateVersion: 1,
    operation: 'upsert',occurredAtUtc: '2026-07-25T07:00:00Z',sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({
      event: {
        accrualPublicId: 'accrual-1',invoiceLinePublicId: 'line-1',
        practitionerPublicId: 'practitioner-1',practitionerRole: 'performing',earnedMinor: 180,
        currencyCode: 'BDT',
      },
      mutation: accrualMutation(),
    }),
  });
}

function adjustmentMutation() {
  return {
    kind: 'compensation_adjusted' as const,
    entityPublicId: 'accrual-1',
    adjustment: {
      adjustmentPublicId: 'adjustment-1',accrualPublicId: 'accrual-1',adjustmentType: 'credit',
      reasonCode: 'operator_correction',amountMinor: 50,adjustedBeforeMinor: 0,
      adjustedAfterMinor: 50,settledBeforeMinor: 0,settledAfterMinor: 0,
      payableBeforeMinor: 180,payableAfterMinor: 130,statusBefore: 'accrued',statusAfter: 'accrued',
      occurredAtUtc: '2026-07-25T08:00:00Z',businessDate: '2026-07-25',
      sourceEvidenceSha256: '7'.repeat(64),
    },
  };
}

async function adjustmentEnvelope() {
  return createCanonicalSyncEnvelope({
    tenantId: '100',eventPublicId: 'outbox-adjustment-1',entityType: 'compensation_accrual',
    entityPublicId: 'accrual-1',eventType: 'canonical.compensation.adjusted',aggregateVersion: 2,
    operation: 'upsert',occurredAtUtc: '2026-07-25T08:00:00Z',sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({
      event: {
        adjustmentPublicId: 'adjustment-1',accrualPublicId: 'accrual-1',adjustmentType: 'credit',
        amountMinor: 50,payableMinor: 130,
      },
      mutation: adjustmentMutation(),
    }),
  });
}

function inventoryMutation() {
  return {
    kind: 'inventory_movement_recorded' as const,
    entityPublicId: 'movement-1',itemPublicId: 'item-1',locationPublicId: 'location-1',
    lotPublicId: 'lot-1',movementType: 'purchase_receipt',direction: 'in' as const,
    sourceQuantity: 7,sourceUnitCode: 'piece',conversionNumerator: 1,conversionDenominator: 1,
    quantityBase: 7,signedQuantityBase: 7,balanceBeforeBase: 0,balanceAfterBase: 7,
    balanceVersionBefore: 0,balanceVersionAfter: 1,transferPublicId: null,
    serviceEventPublicId: null,invoicePublicId: null,invoiceLinePublicId: null,
    reversalOfMovementPublicId: null,sourceType: 'purchase',sourcePublicId: 'purchase-1',
    sourceLinePublicId: 'purchase-line-1',sourceTable: 'purchase_items',
    occurredAtUtc: '2026-07-25T09:00:00Z',businessDate: '2026-07-25',
    sourceEvidenceSha256: '8'.repeat(64),
  };
}

async function inventoryEnvelope(
  mutation = inventoryMutation(),
  eventPublicId = 'outbox-movement-1',
) {
  return createCanonicalSyncEnvelope({
    tenantId: '100',eventPublicId,entityType: 'inventory_movement',
    entityPublicId: mutation.entityPublicId,eventType: 'canonical.inventory.stock_movement.recorded',
    aggregateVersion: 1,operation: 'upsert',occurredAtUtc: mutation.occurredAtUtc,
    sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({
      event: {
        movementPublicId: mutation.entityPublicId,movementType: mutation.movementType,
        itemPublicId: mutation.itemPublicId,locationPublicId: mutation.locationPublicId,
        lotPublicId: mutation.lotPublicId,quantityBase: mutation.quantityBase,
        balanceAfterBase: mutation.balanceAfterBase,
      },
      mutation,
    }),
  });
}

describe('canonical sync compensation and inventory business projection/apply', () => {
  it('projects immutable compensation accrual, adjustment, and inventory movement authority', async () => {
    const { sqlite, db } = sourceHarness();
    try {
      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'compensation_accrual',entityPublicId: 'accrual-1',
        eventType: 'canonical.compensation.accrued',occurredAtUtc: '2026-07-25T07:00:00Z',
        businessDate: '2026-07-25',event: {
          accrualPublicId: 'accrual-1',invoiceLinePublicId: 'line-1',practitionerPublicId: 'practitioner-1',
          practitionerRole: 'performing',earnedMinor: 180,currencyCode: 'BDT',
        },
      })).resolves.toEqual(accrualMutation());

      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'compensation_accrual',entityPublicId: 'accrual-1',
        eventType: 'canonical.compensation.adjusted',occurredAtUtc: '2026-07-25T08:00:00Z',
        businessDate: '2026-07-25',event: {
          adjustmentPublicId: 'adjustment-1',accrualPublicId: 'accrual-1',adjustmentType: 'credit',
          amountMinor: 50,payableMinor: 130,
        },
      })).resolves.toEqual(adjustmentMutation());

      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'inventory_movement',entityPublicId: 'movement-1',
        eventType: 'canonical.inventory.stock_movement.recorded',occurredAtUtc: '2026-07-25T09:00:00Z',
        businessDate: '2026-07-25',event: {
          movementPublicId: 'movement-1',movementType: 'purchase_receipt',itemPublicId: 'item-1',
          locationPublicId: 'location-1',lotPublicId: 'lot-1',quantityBase: 7,balanceAfterBase: 7,
        },
      })).resolves.toEqual(inventoryMutation());
    } finally { sqlite.close(); }
  });

  it('applies accrual then adjustment with exact compare-and-swap balances', async () => {
    const { sqlite, db } = targetHarness();
    try {
      await applyEnvelope(db, await accrualEnvelope(), 'accrual');
      expect(sqlite.prepare(`
        SELECT earned_minor,adjusted_minor,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals WHERE accrual_public_id='accrual-1'
      `).get()).toEqual({
        earned_minor: 180,adjusted_minor: 0,settled_minor: 0,payable_minor: 180,status: 'accrued',
      });

      await applyEnvelope(db, await adjustmentEnvelope(), 'adjustment');
      expect(sqlite.prepare(`
        SELECT adjusted_minor,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals WHERE accrual_public_id='accrual-1'
      `).get()).toEqual({ adjusted_minor: 50,settled_minor: 0,payable_minor: 130,status: 'accrued' });
      expect(sqlite.prepare(`
        SELECT amount_minor,balance_guard FROM canonical_compensation_adjustments
        WHERE adjustment_public_id='adjustment-1'
      `).get()).toEqual({ amount_minor: 50,balance_guard: 1 });
    } finally { sqlite.close(); }
  });

  it('applies inventory balance version and immutable movement atomically', async () => {
    const { sqlite, db } = targetHarness();
    try {
      await applyEnvelope(db, await inventoryEnvelope(), 'movement');
      expect(sqlite.prepare(`
        SELECT quantity_base,version,projection_guard FROM canonical_inventory_balances
      `).get()).toEqual({ quantity_base: 7,version: 1,projection_guard: 1 });
      expect(sqlite.prepare(`
        SELECT balance_before_base,balance_after_base,balance_guard FROM canonical_inventory_movements
      `).get()).toEqual({ balance_before_base: 0,balance_after_base: 7,balance_guard: 1 });
    } finally { sqlite.close(); }
  });

  it('rolls back stale inventory version or negative-policy conflict', async () => {
    const { sqlite, db } = targetHarness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_inventory_balances (
          tenant_id,item_public_id,location_public_id,lot_public_id,quantity_base,version,
          projection_guard,source_evidence_sha256,updated_at_utc
        ) VALUES ('100','item-1','location-1','lot-1',1,1,1,?,'2026-07-25T08:00:00Z')
      `).run('9'.repeat(64));
      const envelope = await inventoryEnvelope();
      await receiveCanonicalSyncEnvelope(db, envelope, '2026-07-25T10:00:00Z');
      const claim = await claimCanonicalSyncInboxEvent(db, {
        tenantId: '100',eventPublicId: envelope.eventPublicId,claimPublicId: 'claim-stale',
        claimOwnerPublicId: 'worker-offline-1',claimedAtUtc: '2026-07-25T10:00:10Z',
        claimExpiresAtUtc: '2026-07-25T11:00:10Z',
      });
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope,claimPublicId: claim.claimPublicId,appliedAtUtc: '2026-07-25T10:00:20Z',
      })).rejects.toThrow();
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_inventory_movements`).get())
        .toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT quantity_base,version FROM canonical_inventory_balances`).get())
        .toEqual({ quantity_base: 1,version: 1 });
    } finally { sqlite.close(); }
  });

  it('fails closed when compensation practitioner or rule authority is missing', async () => {
    for (const table of ['canonical_practitioners', 'canonical_compensation_rules']) {
      const { sqlite, db } = targetHarness();
      try {
        sqlite.exec(`DELETE FROM ${table}`);
        await expect(applyEnvelope(db, await accrualEnvelope(), `missing-${table}`)).rejects.toThrow();
        expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_compensation_accruals`).get())
          .toEqual({ count: 0 });
      } finally { sqlite.close(); }
    }
  });

  it('fails closed when inventory lot authority is missing', async () => {
    const { sqlite, db } = targetHarness();
    try {
      sqlite.exec(`DELETE FROM canonical_inventory_lots`);
      await expect(applyEnvelope(db, await inventoryEnvelope(), 'missing-lot')).rejects.toThrow();
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_inventory_balances`).get())
        .toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_inventory_movements`).get())
        .toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });

  it('rolls back inventory movement that violates negative-stock policy', async () => {
    const { sqlite, db } = targetHarness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_inventory_balances (
          tenant_id,item_public_id,location_public_id,lot_public_id,quantity_base,version,
          projection_guard,source_evidence_sha256,updated_at_utc
        ) VALUES ('100','item-1','location-1','lot-1',3,1,1,?,'2026-07-25T09:00:00Z')
      `).run('9'.repeat(64));
      const mutation = {
        ...inventoryMutation(),entityPublicId: 'movement-negative',movementType: 'issue',
        direction: 'out' as const,sourceQuantity: 5,quantityBase: 5,signedQuantityBase: -5,
        balanceBeforeBase: 3,balanceAfterBase: -2,balanceVersionBefore: 1,balanceVersionAfter: 2,
        sourceType: 'issue',sourcePublicId: 'issue-1',sourceLinePublicId: 'issue-line-1',
        sourceTable: 'issue_items',occurredAtUtc: '2026-07-25T09:30:00Z',
        sourceEvidenceSha256: 'a'.repeat(64),
      };
      await expect(applyEnvelope(
        db,
        await inventoryEnvelope(mutation, 'outbox-movement-negative'),
        'negative-policy',
      )).rejects.toThrow();
      expect(sqlite.prepare(`SELECT quantity_base,version FROM canonical_inventory_balances`).get())
        .toEqual({ quantity_base: 3,version: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_inventory_movements`).get())
        .toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });

  it('rolls back duplicate inventory source fact after balance update', async () => {
    const { sqlite, db } = targetHarness();
    try {
      await applyEnvelope(db, await inventoryEnvelope(), 'movement-first');
      const duplicate = {
        ...inventoryMutation(),entityPublicId: 'movement-2',balanceBeforeBase: 7,balanceAfterBase: 14,
        balanceVersionBefore: 1,balanceVersionAfter: 2,occurredAtUtc: '2026-07-25T09:10:00Z',
        sourceEvidenceSha256: '9'.repeat(64),
      };
      await expect(applyEnvelope(
        db,
        await inventoryEnvelope(duplicate, 'outbox-movement-2'),
        'movement-duplicate',
      )).rejects.toThrow();
      expect(sqlite.prepare(`SELECT quantity_base,version FROM canonical_inventory_balances`).get())
        .toEqual({ quantity_base: 7,version: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_inventory_movements`).get())
        .toEqual({ count: 1 });
    } finally { sqlite.close(); }
  });

  it('rejects stale compensation adjustment balances atomically', async () => {
    const { sqlite, db } = targetHarness();
    try {
      await applyEnvelope(db, await accrualEnvelope(), 'accrual-stale');
      sqlite.exec(`
        UPDATE canonical_compensation_accruals
        SET adjusted_minor=10,payable_minor=170,status='accrued'
        WHERE accrual_public_id='accrual-1'
      `);
      await expect(applyEnvelope(db, await adjustmentEnvelope(), 'adjustment-stale')).rejects.toThrow();
      expect(sqlite.prepare(`SELECT adjusted_minor,payable_minor FROM canonical_compensation_accruals`).get())
        .toEqual({ adjusted_minor: 10,payable_minor: 170 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_compensation_adjustments`).get())
        .toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });

  it('rejects semantic inventory tampering before database mutation', async () => {
    const invalid = { ...inventoryMutation(), signedQuantityBase: -7 };
    const envelope = await inventoryEnvelope(invalid);
    expect(() => parseCanonicalSyncBusinessPayload(envelope)).toThrow(/signed|direction|balance/i);
  });
});
