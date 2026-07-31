import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  finalizeIpdDischargeBilling,
  type FinalizeIpdDischargeBillingInput,
} from '../../src/lib/canonical/commands/finalize-ipd-discharge-billing';

const NOW = '2026-07-24T02:00:00.000Z';
const DATE = '2026-07-24';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
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

const MIGRATIONS = [
  '0505_canonical_program_foundation.sql',
  '0506_canonical_practitioners.sql',
  '0507_canonical_encounters.sql',
  '0508_canonical_service_catalog.sql',
  '0509_canonical_service_requests_events.sql',
  '0510_canonical_invoices.sql',
  '0511_canonical_payments.sql',
  '0512_canonical_adjustments.sql',
  '0513_canonical_practitioner_compensation.sql',
  '0514_canonical_inventory_links.sql',
  '0515_canonical_accounting_outbox.sql',
  '0532_canonical_financial_batch_assertions.sql',
  '0535_canonical_invoice_encounter_links.sql',
] as const;

function harness(controls: { beforeBatch?: (sqlite: DatabaseSync) => void } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of MIGRATIONS) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_financial (
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      UNIQUE (tenant_id, source_id)
    );
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      controls.beforeBatch?.(sqlite);
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
  return { sqlite, db };
}

function seedEncounter(
  sqlite: DatabaseSync,
  status: 'in_progress' | 'completed' = 'in_progress',
  encounterType: 'inpatient' | 'emergency' = 'inpatient',
): void {
  const ended = status === 'completed' ? NOW : null;
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
      started_at_utc,ended_at_utc,source_evidence_sha256
    ) VALUES ('100','enc-ipd-701',501,?,?,'2026-07-20T02:00:00.000Z',?,?)
  `).run(encounterType, status, ended, HASH_A);
  sqlite.prepare(`
    INSERT INTO canonical_encounter_admission_links (
      tenant_id,encounter_public_id,legacy_admission_id,admission_no,link_status,source_evidence_sha256
    ) VALUES ('100','enc-ipd-701',701,'ADM-701','active',?)
  `).run(HASH_B);
  sqlite.prepare(`
    INSERT INTO canonical_bed_stays (
      tenant_id,bed_stay_public_id,encounter_public_id,legacy_patient_bed_info_id,
      legacy_admission_id,legacy_bed_id,started_at_utc,ended_at_utc,status,source_evidence_sha256
    ) VALUES ('100','bedstay-701','enc-ipd-701',801,701,91,'2026-07-20T02:00:00.000Z',?,?,?)
  `).run(ended, status === 'completed' ? 'completed' : 'active', HASH_C);
}

function seedDeposit(sqlite: DatabaseSync, amountMinor: number): void {
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES ('100','receipt-deposit-1','DEP-RCP-1',501,'BDT',?,0,?,'posted',
      '2026-07-20T03:00:00.000Z','2026-07-20','2026-07-20T03:00:00.000Z',1,?,0,?,1)
  `).run(amountMinor, amountMinor, HASH_A, amountMinor);
  sqlite.prepare(`
    INSERT INTO canonical_deposits (
      tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
      currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
      received_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
    ) VALUES ('100','deposit-1','DEP-1','receipt-deposit-1',501,'BDT',?,0,0,?,'posted',
      '2026-07-20T03:00:00.000Z','2026-07-20','2026-07-20T03:00:00.000Z',1,?)
  `).run(amountMinor, amountMinor, HASH_B);
}

function settlementInput(overrides: Partial<FinalizeIpdDischargeBillingInput> = {}): FinalizeIpdDischargeBillingInput {
  const base: FinalizeIpdDischargeBillingInput = {
    tenantId: '100',
    commandIdempotencyKey: 'ipd-discharge:ADM-701:INV-IPD-701',
    invoiceSettlement: {
      tenantId: '100',
      commandIdempotencyKey: 'nested-settlement:INV-IPD-701',
      invoice: {
        tenantId: '100',
        invoicePublicId: 'invoice-ipd-701',
        invoiceNumber: 'INV-IPD-701',
        legacyPatientId: 501,
        currencyCode: 'BDT',
        issuedAtUtc: NOW,
        businessDate: DATE,
        lines: [{
          linePublicId: 'invoice-ipd-line-701',
          lineType: 'other_adjustment',
          serviceEventPublicId: null,
          adjustmentCode: 'IPD_DISCHARGE',
          quantity: 1,
          unitAmountMinor: 100_000,
          sourceEvidenceSha256: HASH_A,
        }],
        sourceType: 'legacy_live_bill',
        sourcePublicId: 'INV-IPD-701',
        sourceTable: 'bills',
        sourceEvidenceSha256: HASH_B,
        idempotencyKey: 'legacy_live_bill:INV-IPD-701',
        outboxEventPublicId: 'outbox-invoice-ipd-701',
      },
      payment: null,
      deposit: null,
    },
    encounter: {
      legacyAdmissionId: 701,
      legacyPatientId: 501,
      completedAtUtc: NOW,
      sourceType: 'legacy_admission_discharge',
      sourcePublicId: '701',
      sourceTable: 'admissions',
      sourceEvidenceSha256: HASH_C,
      eventPublicId: 'outbox-encounter-completed-701',
    },
    depositRefund: null,
  };
  return {
    ...base,
    ...overrides,
    invoiceSettlement: {
      ...base.invoiceSettlement,
      ...(overrides.invoiceSettlement ?? {}),
      invoice: {
        ...base.invoiceSettlement.invoice,
        ...(overrides.invoiceSettlement?.invoice ?? {}),
      },
    },
    encounter: { ...base.encounter, ...(overrides.encounter ?? {}) },
    depositRefund: overrides.depositRefund === undefined ? base.depositRefund : overrides.depositRefund,
  };
}

function payment(amountMinor: number) {
  return {
    receiptPublicId: 'receipt-ipd-701',
    receiptNumber: 'RCP-IPD-701',
    tenderPublicId: 'tender-ipd-701',
    allocationPublicId: 'allocation-ipd-701',
    tenderType: 'cash' as const,
    methodCode: 'cash',
    amountMinor,
    externalTransactionId: null,
    legacyCollectorId: 9,
    legacyCounterId: 3,
    legacyCounterSessionId: 30,
    receivedAtUtc: NOW,
    sourceType: 'legacy_live_payment',
    sourcePublicId: 'RCP-IPD-701',
    sourceTable: 'payments',
    sourceEvidenceSha256: HASH_A,
    paymentOutboxEventPublicId: 'outbox-payment-ipd-701',
    cashCustodyEventPublicId: 'outbox-payment-cash-ipd-701',
  };
}

function depositApply(amountMinor: number) {
  return {
    adjustmentNumber: 'DAD-IPD-701',
    amountMinor,
    appliedAtUtc: NOW,
    businessDate: DATE,
    sourceType: 'legacy_live_deposit',
    sourceTable: 'billing_deposits',
  };
}

function refund(amountMinor: number) {
  return {
    operationPublicId: 'deposit-refund-operation-701',
    amountMinor,
    refundReceiptNumber: 'DRF-IPD-701',
    tenderType: 'cash' as const,
    methodCode: 'cash',
    sourceType: 'legacy_live_deposit_refund',
    sourcePublicId: 'DRF-IPD-701',
    sourceTable: 'billing_deposits',
    sourceEvidenceSha256: HASH_B,
    outboxEventPublicId: 'outbox-deposit-refund-ipd-701',
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('finalizeIpdDischargeBilling', () => {
  it('creates a credit discharge invoice, explicit encounter link, and completes the encounter', async () => {
    const { sqlite, db } = harness();
    try {
      seedEncounter(sqlite);
      const result = await finalizeIpdDischargeBilling(db, settlementInput());
      expect(result.result).toMatchObject({
        invoicePublicId: 'invoice-ipd-701',
        encounterPublicId: 'enc-ipd-701',
        paidMinor: 0,
        dueMinor: 100_000,
        refundedMinor: 0,
      });
      expect(sqlite.prepare(`
        SELECT status,ended_at_utc FROM canonical_encounters WHERE encounter_public_id='enc-ipd-701'
      `).get()).toEqual({ status: 'completed', ended_at_utc: NOW });
      expect(sqlite.prepare(`
        SELECT status,ended_at_utc FROM canonical_bed_stays WHERE bed_stay_public_id='bedstay-701'
      `).get()).toEqual({ status: 'completed', ended_at_utc: NOW });
      expect(sqlite.prepare(`
        SELECT invoice_public_id,encounter_public_id,legacy_admission_id,link_type
        FROM canonical_invoice_encounter_links
      `).get()).toEqual({
        invoice_public_id: 'invoice-ipd-701',
        encounter_public_id: 'enc-ipd-701',
        legacy_admission_id: 701,
        link_type: 'discharge_invoice',
      });
    } finally {
      sqlite.close();
    }
  });

  it('accepts an exact emergency-origin admission encounter and completes it at discharge', async () => {
    const { sqlite, db } = harness();
    try {
      seedEncounter(sqlite, 'in_progress', 'emergency');
      const result = await finalizeIpdDischargeBilling(db, settlementInput());
      expect(result.result).toMatchObject({
        encounterPublicId: 'enc-ipd-701',
        legacyAdmissionId: 701,
      });
      expect(sqlite.prepare(`
        SELECT encounter_type,status,ended_at_utc
        FROM canonical_encounters WHERE encounter_public_id='enc-ipd-701'
      `).get()).toEqual({ encounter_type: 'emergency', status: 'completed', ended_at_utc: NOW });
    } finally {
      sqlite.close();
    }
  });

  it('applies deposit, collects payment, and refunds excess deposit from one source snapshot', async () => {
    const { sqlite, db } = harness();
    try {
      seedEncounter(sqlite);
      seedDeposit(sqlite, 90_000);
      const result = await finalizeIpdDischargeBilling(db, settlementInput({
        invoiceSettlement: {
          ...settlementInput().invoiceSettlement,
          payment: payment(30_000),
          deposit: depositApply(70_000),
        },
        depositRefund: refund(20_000),
      }));
      expect(result.result).toMatchObject({
        paidMinor: 100_000,
        dueMinor: 0,
        depositMinor: 70_000,
        paymentMinor: 30_000,
        refundedMinor: 20_000,
      });
      expect(sqlite.prepare(`
        SELECT applied_minor,refunded_minor,available_minor FROM canonical_deposits
        WHERE deposit_public_id='deposit-1'
      `).get()).toEqual({ applied_minor: 70_000, refunded_minor: 20_000, available_minor: 0 });
      expect(sqlite.prepare(`
        SELECT source_type,amount_minor,tender_type,status FROM canonical_refunds
      `).get()).toEqual({ source_type: 'deposit', amount_minor: 20_000, tender_type: 'cash', status: 'posted' });
      expect(count(sqlite, 'canonical_deposit_applications')).toBe(1);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(2);
      expect(count(sqlite, 'canonical_invoice_encounter_links')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back authoritative legacy statements when deposit state changes before commit', async () => {
    let changed = false;
    const { sqlite, db } = harness({
      beforeBatch(database) {
        if (changed) return;
        changed = true;
        database.prepare(`
          UPDATE canonical_deposits SET refunded_minor=1000,available_minor=89000
          WHERE tenant_id='100' AND deposit_public_id='deposit-1'
        `).run();
      },
    });
    try {
      seedEncounter(sqlite);
      seedDeposit(sqlite, 90_000);
      const authoritative = db.prepare(`
        INSERT INTO legacy_financial (tenant_id,source_id) VALUES ('100','legacy-discharge-701')
      `);
      await expect(finalizeIpdDischargeBilling(db, settlementInput({
        invoiceSettlement: {
          ...settlementInput().invoiceSettlement,
          deposit: depositApply(70_000),
        },
        depositRefund: refund(20_000),
      }), { authoritativeStatements: [authoritative] })).rejects.toThrow();
      expect(count(sqlite, 'legacy_financial')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(sqlite.prepare(`
        SELECT status,ended_at_utc FROM canonical_encounters WHERE encounter_public_id='enc-ipd-701'
      `).get()).toEqual({ status: 'in_progress', ended_at_utc: null });
    } finally {
      sqlite.close();
    }
  });

  it('fails closed before authoritative writes when the canonical encounter is missing', async () => {
    const { sqlite, db } = harness();
    try {
      const authoritative = db.prepare(`
        INSERT INTO legacy_financial (tenant_id,source_id) VALUES ('100','legacy-discharge-701')
      `);
      await expect(finalizeIpdDischargeBilling(db, settlementInput(), {
        authoritativeStatements: [authoritative],
      })).rejects.toThrow(/encounter/i);
      expect(count(sqlite, 'legacy_financial')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when the encounter is already completed', async () => {
    const { sqlite, db } = harness();
    try {
      seedEncounter(sqlite, 'completed');
      await expect(finalizeIpdDischargeBilling(db, settlementInput())).rejects.toThrow(/in_progress|completed/i);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('replays the same request and rejects changed settlement under the same key', async () => {
    const { sqlite, db } = harness();
    try {
      seedEncounter(sqlite);
      const first = await finalizeIpdDischargeBilling(db, settlementInput());
      const replay = await finalizeIpdDischargeBilling(db, settlementInput());
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      await expect(finalizeIpdDischargeBilling(db, settlementInput({
        invoiceSettlement: {
          ...settlementInput().invoiceSettlement,
          payment: payment(10_000),
        },
      }))).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });
});
