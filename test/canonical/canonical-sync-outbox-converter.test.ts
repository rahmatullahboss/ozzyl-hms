import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  CANONICAL_SYNC_OUTBOX_AGGREGATE_TYPES,
  CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST,
  CanonicalSyncOutboxConversionError,
  convertCanonicalOutboxEventToSyncEnvelope,
} from '../../src/lib/canonical/local-sync-outbox-converter';
import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';

const TENANT = '100';
const OCCURRED = '2026-07-25T00:00:00Z';
const SOURCE_NODE = 'node-local-1';

type RunResult = {
  success: boolean;
  meta: { changes: number; last_row_id: number; duration: number };
};

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.sqlite,
      this.sql,
      params.map((value) => (value === undefined ? null : value)) as SQLInputValue[],
    );
  }

  async run(): Promise<RunResult> {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE canonical_outbox_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      event_public_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_public_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at_utc TEXT NOT NULL,
      business_date TEXT,
      status TEXT NOT NULL,
      processing_attempts INTEGER NOT NULL DEFAULT 0,
      locked_at_utc TEXT,
      locked_by TEXT,
      published_at_utc TEXT,
      UNIQUE (tenant_id,event_public_id)
    );
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sync_key TEXT
    );
    CREATE TABLE canonical_encounters (
      tenant_id TEXT NOT NULL,
      encounter_public_id TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      encounter_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at_utc TEXT NOT NULL,
      ended_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (tenant_id,encounter_public_id)
    );
    CREATE TABLE canonical_service_requests (
      tenant_id TEXT NOT NULL,
      request_public_id TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      encounter_public_id TEXT,
      service_public_id TEXT NOT NULL,
      requested_quantity INTEGER NOT NULL,
      fulfilled_quantity INTEGER NOT NULL DEFAULT 0,
      last_event_public_id TEXT,
      status TEXT NOT NULL,
      requested_at_utc TEXT NOT NULL,
      cancelled_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (tenant_id,request_public_id)
    );
    CREATE TABLE canonical_service_events (
      tenant_id TEXT NOT NULL,
      event_public_id TEXT NOT NULL,
      request_public_id TEXT,
      encounter_public_id TEXT,
      service_public_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL,
      occurred_at_utc TEXT NOT NULL,
      cancelled_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (tenant_id,event_public_id)
    );
    CREATE TABLE canonical_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      subtotal_minor INTEGER NOT NULL,
      adjustment_total_minor INTEGER NOT NULL,
      total_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      issued_at_utc TEXT NOT NULL,
      cancelled_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,invoice_public_id)
    );
    CREATE TABLE canonical_invoice_encounter_links (
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      encounter_public_id TEXT NOT NULL,
      legacy_admission_id INTEGER NOT NULL,
      link_type TEXT NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (tenant_id,invoice_public_id)
    );
    CREATE TABLE canonical_encounter_admission_links (
      tenant_id TEXT NOT NULL,
      encounter_public_id TEXT NOT NULL,
      legacy_admission_id INTEGER NOT NULL,
      admission_no TEXT NOT NULL,
      PRIMARY KEY (tenant_id,encounter_public_id)
    );
    CREATE TABLE canonical_invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      line_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      line_type TEXT NOT NULL,
      service_event_public_id TEXT,
      adjustment_code TEXT,
      quantity INTEGER NOT NULL,
      unit_amount_minor INTEGER NOT NULL,
      line_amount_minor INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,line_public_id)
    );
    CREATE TABLE canonical_payment_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      receipt_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      allocated_total_minor INTEGER NOT NULL,
      unallocated_minor INTEGER NOT NULL,
      received_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      external_transaction_id TEXT,
      posted_at_utc TEXT,
      failed_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,receipt_public_id)
    );
    CREATE TABLE canonical_payment_tenders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      tender_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      tender_type TEXT NOT NULL,
      method_code TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      external_transaction_id TEXT,
      captured_at_utc TEXT,
      failed_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,tender_public_id)
    );
    CREATE TABLE canonical_payment_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      allocation_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_line_public_id TEXT,
      amount_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,
      allocated_at_utc TEXT NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,allocation_public_id)
    );
    CREATE TABLE canonical_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      deposit_public_id TEXT NOT NULL,
      deposit_number TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      applied_minor INTEGER NOT NULL DEFAULT 0,
      refunded_minor INTEGER NOT NULL DEFAULT 0,
      available_minor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'posted',
      received_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      posted_at_utc TEXT NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,deposit_public_id)
    );
    CREATE TABLE canonical_deposit_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      application_public_id TEXT NOT NULL,
      deposit_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_line_public_id TEXT,
      amount_minor INTEGER NOT NULL,
      deposit_available_before_minor INTEGER NOT NULL,
      deposit_available_after_minor INTEGER NOT NULL,
      invoice_paid_before_minor INTEGER NOT NULL,
      invoice_paid_after_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,
      invoice_net_due_before_minor INTEGER NOT NULL,
      invoice_net_due_after_minor INTEGER NOT NULL,
      applied_at_utc TEXT NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,application_public_id)
    );
    CREATE TABLE canonical_payment_reversals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      reversal_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      tender_public_id TEXT NOT NULL,
      allocation_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      reason_code TEXT NOT NULL,
      status TEXT NOT NULL,
      reversed_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      allocation_reversed_before_minor INTEGER NOT NULL,
      allocation_reversed_after_minor INTEGER NOT NULL,
      tender_reversed_before_minor INTEGER NOT NULL,
      tender_reversed_after_minor INTEGER NOT NULL,
      receipt_refunded_before_minor INTEGER NOT NULL,
      receipt_refunded_after_minor INTEGER NOT NULL,
      invoice_paid_before_minor INTEGER NOT NULL,
      invoice_paid_after_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,
      invoice_net_due_before_minor INTEGER NOT NULL,
      invoice_net_due_after_minor INTEGER NOT NULL,
      compensation_guard INTEGER NOT NULL,
      balance_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,reversal_public_id)
    );
    CREATE TABLE canonical_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      refund_public_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      deposit_public_id TEXT,
      receipt_public_id TEXT,
      tender_public_id TEXT,
      allocation_public_id TEXT,
      payment_reversal_public_id TEXT,
      amount_minor INTEGER NOT NULL,
      tender_type TEXT NOT NULL,
      method_code TEXT NOT NULL,
      status TEXT NOT NULL,
      refunded_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      reversed_at_utc TEXT,
      source_available_before_minor INTEGER,
      source_available_after_minor INTEGER,
      liability_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,refund_public_id)
    );
    CREATE TABLE canonical_compensation_accruals (
      tenant_id TEXT NOT NULL, accrual_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL, invoice_line_public_id TEXT NOT NULL,
      service_event_public_id TEXT, practitioner_public_id TEXT,
      practitioner_role TEXT NOT NULL, accrual_stage TEXT NOT NULL,
      rule_public_id TEXT NOT NULL, rule_version INTEGER NOT NULL,
      calculation_basis TEXT NOT NULL, rate_type TEXT NOT NULL, rate_value INTEGER NOT NULL,
      currency_code TEXT NOT NULL, gross_minor INTEGER NOT NULL, discount_minor INTEGER NOT NULL,
      tax_minor INTEGER NOT NULL, performer_reserve_minor INTEGER NOT NULL,
      eligible_base_minor INTEGER NOT NULL, earned_minor INTEGER NOT NULL,
      adjusted_minor INTEGER NOT NULL, settled_minor INTEGER NOT NULL, payable_minor INTEGER NOT NULL,
      status TEXT NOT NULL, accrued_at_utc TEXT NOT NULL, business_date TEXT NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (tenant_id,accrual_public_id)
    );
    CREATE TABLE canonical_compensation_adjustments (
      tenant_id TEXT NOT NULL, adjustment_public_id TEXT NOT NULL,
      accrual_public_id TEXT NOT NULL, settlement_public_id TEXT,
      settlement_allocation_public_id TEXT, adjustment_type TEXT NOT NULL,
      reason_code TEXT NOT NULL, amount_minor INTEGER NOT NULL,
      accrual_adjusted_before_minor INTEGER NOT NULL, accrual_adjusted_after_minor INTEGER NOT NULL,
      accrual_settled_before_minor INTEGER NOT NULL, accrual_settled_after_minor INTEGER NOT NULL,
      accrual_payable_before_minor INTEGER NOT NULL, accrual_payable_after_minor INTEGER NOT NULL,
      occurred_at_utc TEXT NOT NULL, business_date TEXT NOT NULL,
      balance_guard INTEGER NOT NULL, source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (tenant_id,adjustment_public_id)
    );
    CREATE TABLE canonical_inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
      movement_public_id TEXT NOT NULL, item_public_id TEXT NOT NULL,
      location_public_id TEXT NOT NULL, lot_public_id TEXT NOT NULL,
      movement_type TEXT NOT NULL, direction TEXT NOT NULL, source_quantity INTEGER NOT NULL,
      source_unit_code TEXT NOT NULL, conversion_numerator INTEGER NOT NULL,
      conversion_denominator INTEGER NOT NULL, quantity_base INTEGER NOT NULL,
      signed_quantity_base INTEGER NOT NULL, balance_before_base INTEGER NOT NULL,
      balance_after_base INTEGER NOT NULL, transfer_public_id TEXT,
      service_event_public_id TEXT, invoice_public_id TEXT, invoice_line_public_id TEXT,
      reversal_of_movement_public_id TEXT, source_type TEXT NOT NULL,
      source_public_id TEXT NOT NULL, source_line_public_id TEXT NOT NULL,
      source_table TEXT NOT NULL, status TEXT NOT NULL, occurred_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL, balance_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id,movement_public_id)
    );
    CREATE TABLE canonical_sync_inbox_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      event_public_id TEXT NOT NULL
    );
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
    INSERT INTO canonical_encounters VALUES (
      '100','encounter-1',101,'outpatient','completed',
      '${OCCURRED}','${OCCURRED}','${'a'.repeat(64)}'
    );
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(statements: CanonicalPreparedStatement[]) {
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

function directPayload(payload: Record<string, unknown>): string {
  return stableCanonicalJson(payload);
}

function commandPayload(payload: Record<string, unknown>): string {
  return stableCanonicalJson({
    schemaVersion: 1,
    command: {
      name: 'canonical.test.command',
      requestFingerprint: 'a'.repeat(64),
      result: { ok: true },
    },
    event: payload,
  });
}

function insertOutbox(
  sqlite: DatabaseSync,
  overrides: Partial<{
    tenantId: string;
    eventPublicId: string;
    aggregateType: string;
    aggregatePublicId: string;
    eventType: string;
    eventVersion: number;
    payloadJson: string;
    occurredAtUtc: string;
    businessDate: string | null;
    status: string;
    processingAttempts: number;
    lockedAtUtc: string | null;
    lockedBy: string | null;
    publishedAtUtc: string | null;
  }> = {},
): number {
  const row = {
    tenantId: TENANT,
    eventPublicId: 'outbox-encounter-1',
    aggregateType: 'canonical_encounter',
    aggregatePublicId: 'encounter-1',
    eventType: 'canonical.encounter.started',
    eventVersion: 1,
    payloadJson: directPayload({
      encounterPublicId: 'encounter-1',
      encounterType: 'outpatient',
      status: 'in_progress',
    }),
    occurredAtUtc: OCCURRED,
    businessDate: '2026-07-25',
    status: 'pending',
    processingAttempts: 0,
    lockedAtUtc: null,
    lockedBy: null,
    publishedAtUtc: null,
    ...overrides,
  };
  const result = sqlite.prepare(`
    INSERT INTO canonical_outbox_events (
      tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
      event_version,payload_json,occurred_at_utc,business_date,status,processing_attempts,
      locked_at_utc,locked_by,published_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.tenantId,
    row.eventPublicId,
    row.aggregateType,
    row.aggregatePublicId,
    row.eventType,
    row.eventVersion,
    row.payloadJson,
    row.occurredAtUtc,
    row.businessDate,
    row.status,
    row.processingAttempts,
    row.lockedAtUtc,
    row.lockedBy,
    row.publishedAtUtc,
  );
  return Number(result.lastInsertRowid);
}

function insertInvoiceAuthority(
  sqlite: DatabaseSync,
  invoicePublicId: string,
  totalMinor = 100,
): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,cancelled_at_utc,
      source_evidence_sha256
    ) VALUES (?,?,?,?,?, ?,0,?,'cancelled',?,?,?)
  `).run(
    TENANT,
    invoicePublicId,
    `INV-${invoicePublicId}`,
    101,
    'BDT',
    totalMinor,
    totalMinor,
    OCCURRED,
    OCCURRED,
    'd'.repeat(64),
  );
  sqlite.prepare(`
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES (?,?,?,'service',?,NULL,1,?,?,?)
  `).run(
    TENANT,
    `line-${invoicePublicId}`,
    invoicePublicId,
    `service-event-${invoicePublicId}`,
    totalMinor,
    totalMinor,
    'e'.repeat(64),
  );
}

async function convert(db: CanonicalBatchDatabase, eventPublicId: string, tenantId = TENANT) {
  return convertCanonicalOutboxEventToSyncEnvelope(db, {
    tenantId,
    eventPublicId,
    sourceNodePublicId: SOURCE_NODE,
  });
}

describe('canonical outbox allowlist governance', () => {
  it('covers nine exact aggregate types and twenty-one reviewed event mappings', () => {
    expect(CANONICAL_SYNC_OUTBOX_AGGREGATE_TYPES).toEqual([
      'canonical_deposit',
      'canonical_encounter',
      'canonical_inventory_movement',
      'canonical_invoice',
      'canonical_payment_receipt',
      'canonical_refund',
      'canonical_service_event',
      'canonical_service_request',
      'compensation_accrual',
    ]);
    expect(CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST).toHaveLength(21);
    expect(new Set(CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST.map((entry) => (
      `${entry.aggregateType}:${entry.eventType}`
    ))).size).toBe(21);
    expect(CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST.filter((entry) => entry.operation === 'tombstone'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ eventType: 'canonical.invoice.cancelled' }),
        expect.objectContaining({ eventType: 'canonical.payment.reversed' }),
      ]));
  });
});

describe('canonical outbox payload and source validation', () => {
  it('normalizes direct and command-envelope payloads to equivalent event payloads', async () => {
    const { sqlite, db } = harness();
    try {
      insertOutbox(sqlite);
      insertOutbox(sqlite, {
        eventPublicId: 'outbox-encounter-2',
        eventType: 'canonical.encounter.completed',
        payloadJson: commandPayload({ encounterPublicId: 'encounter-1', status: 'completed' }),
      });
      const first = await convert(db, 'outbox-encounter-1');
      const second = await convert(db, 'outbox-encounter-2');
      expect(first.payload).toEqual({
        schemaVersion: 1,
        event: {
          encounterPublicId: 'encounter-1',
          encounterType: 'outpatient',
          status: 'in_progress',
        },
        mutation: {
          kind: 'encounter_started',
          entityPublicId: 'encounter-1',
          patientSyncKey: 'uhid:P-001',
          encounterType: 'outpatient',
          startedAtUtc: OCCURRED,
          sourceEvidenceSha256: 'a'.repeat(64),
        },
      });
      expect(second.payload).toEqual({
        schemaVersion: 1,
        event: { encounterPublicId: 'encounter-1', status: 'completed' },
        mutation: {
          kind: 'encounter_completed',
          entityPublicId: 'encounter-1',
          encounterType: 'outpatient',
          startedAtUtc: OCCURRED,
          completedAtUtc: OCCURRED,
          sourceEvidenceSha256: 'a'.repeat(64),
        },
      });
      expect(first.aggregateVersion).toBe(1);
      expect(second.aggregateVersion).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('rejects missing rows, unsupported mappings, event schema versions, terminal source states, and malformed payloads', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(convert(db, 'missing-event')).rejects.toBeInstanceOf(CanonicalSyncOutboxConversionError);
      insertOutbox(sqlite, { eventPublicId: 'bad-event', eventType: 'canonical.encounter.unknown' });
      await expect(convert(db, 'bad-event')).rejects.toThrow(/unsupported/i);
      insertOutbox(sqlite, { eventPublicId: 'bad-version', eventVersion: 2 });
      await expect(convert(db, 'bad-version')).rejects.toThrow(/event schema version/i);
      insertOutbox(sqlite, { eventPublicId: 'cancelled-source', status: 'cancelled' });
      await expect(convert(db, 'cancelled-source')).rejects.toThrow(/status/i);
      insertOutbox(sqlite, { eventPublicId: 'dead-source', status: 'dead_letter' });
      await expect(convert(db, 'dead-source')).rejects.toThrow(/status/i);
      insertOutbox(sqlite, { eventPublicId: 'malformed', payloadJson: '{bad' });
      await expect(convert(db, 'malformed')).rejects.toThrow(/payload/i);
      insertOutbox(sqlite, { eventPublicId: 'array-payload', payloadJson: '[]' });
      await expect(convert(db, 'array-payload')).rejects.toThrow(/plain object/i);
      insertOutbox(sqlite, {
        eventPublicId: 'bad-command-version',
        payloadJson: stableCanonicalJson({ schemaVersion: 2, command: {}, event: {} }),
      });
      await expect(convert(db, 'bad-command-version')).rejects.toThrow(/command envelope/i);
    } finally {
      sqlite.close();
    }
  });

  it('rejects aggregate identity mismatch and cross-tenant lookup', async () => {
    const { sqlite, db } = harness();
    try {
      insertOutbox(sqlite, {
        payloadJson: directPayload({ encounterPublicId: 'encounter-other' }),
      });
      await expect(convert(db, 'outbox-encounter-1')).rejects.toThrow(/aggregate identity/i);
      await expect(convert(db, 'outbox-encounter-1', '200')).rejects.toBeInstanceOf(CanonicalSyncOutboxConversionError);
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical outbox aggregate version authority', () => {
  it('uses source outbox id order rather than event schema version or occurrence timestamp', async () => {
    const { sqlite, db } = harness();
    try {
      insertOutbox(sqlite, {
        eventPublicId: 'invoice-issued',
        aggregateType: 'canonical_invoice',
        aggregatePublicId: 'invoice-1',
        eventType: 'canonical.invoice.issued',
        payloadJson: directPayload({
          invoicePublicId: 'invoice-1',
          status: 'posted',
          subtotalMinor: 100,
          adjustmentTotalMinor: 0,
          totalMinor: 100,
        }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'invoice-cancelled',
        aggregateType: 'canonical_invoice',
        aggregatePublicId: 'invoice-1',
        eventType: 'canonical.invoice.cancelled',
        eventVersion: 1,
        occurredAtUtc: OCCURRED,
        payloadJson: directPayload({
          invoicePublicId: 'invoice-1',
          status: 'cancelled',
          totalMinor: 100,
          reversedCompensationMinor: 0,
          reversedCompensationCount: 0,
        }),
      });
      insertInvoiceAuthority(sqlite, 'invoice-1');
      const issued = await convert(db, 'invoice-issued');
      const cancelled = await convert(db, 'invoice-cancelled');
      expect(issued.aggregateVersion).toBe(1);
      expect(cancelled.aggregateVersion).toBe(2);
      expect(cancelled.operation).toBe('tombstone');
    } finally {
      sqlite.close();
    }
  });

  it('maps clinical cancellation events as aggregate-version-two lifecycle upserts', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        UPDATE canonical_encounters
        SET status='cancelled',ended_at_utc='2026-07-25T01:00:00Z'
        WHERE tenant_id='100' AND encounter_public_id='encounter-1'
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'encounter-start',
        aggregateType: 'canonical_encounter',
        aggregatePublicId: 'encounter-1',
        eventType: 'canonical.encounter.started',
        occurredAtUtc: OCCURRED,
        payloadJson: directPayload({
          encounterPublicId: 'encounter-1',
          encounterType: 'outpatient',
          status: 'in_progress',
        }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'encounter-cancel',
        aggregateType: 'canonical_encounter',
        aggregatePublicId: 'encounter-1',
        eventType: 'canonical.encounter.cancelled',
        occurredAtUtc: '2026-07-25T01:00:00Z',
        payloadJson: directPayload({ encounterPublicId: 'encounter-1', status: 'cancelled' }),
      });
      const encounterCancellation = await convert(db, 'encounter-cancel');
      expect(encounterCancellation.aggregateVersion).toBe(2);
      expect(encounterCancellation.operation).toBe('upsert');
      expect((encounterCancellation.payload as { mutation: { kind: string } }).mutation.kind)
        .toBe('encounter_cancelled');

      sqlite.prepare(`
        INSERT INTO canonical_service_requests VALUES (
          '100','request-cancelled',101,'encounter-1','service-1',2,1,NULL,'cancelled',
          '${OCCURRED}','2026-07-25T01:30:00Z','${'b'.repeat(64)}'
        )
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'request-create',
        aggregateType: 'canonical_service_request',
        aggregatePublicId: 'request-cancelled',
        eventType: 'canonical.service_request.created',
        occurredAtUtc: OCCURRED,
        payloadJson: directPayload({
          requestPublicId: 'request-cancelled',
          servicePublicId: 'service-1',
          requestedQuantity: 2,
          status: 'active',
        }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'request-cancel',
        aggregateType: 'canonical_service_request',
        aggregatePublicId: 'request-cancelled',
        eventType: 'canonical.service_request.cancelled',
        occurredAtUtc: '2026-07-25T01:30:00Z',
        payloadJson: directPayload({
          requestPublicId: 'request-cancelled',
          status: 'cancelled',
          fulfilledQuantity: 1,
        }),
      });
      const requestCancellation = await convert(db, 'request-cancel');
      expect(requestCancellation.aggregateVersion).toBe(2);
      expect(requestCancellation.operation).toBe('upsert');
      expect(requestCancellation.dependencies).toEqual([
        { entityType: 'encounter', entityPublicId: 'encounter-1', minimumVersion: 1 },
      ]);
      expect((requestCancellation.payload as { mutation: { kind: string } }).mutation.kind)
        .toBe('service_request_cancelled');

      sqlite.exec(`
        INSERT INTO canonical_service_requests VALUES (
          '100','request-event-cancel',101,'encounter-1','service-1',2,0,NULL,'active',
          '${OCCURRED}',NULL,'${'d'.repeat(64)}'
        );
        INSERT INTO canonical_service_events VALUES (
          '100','service-event-cancelled','request-event-cancel','encounter-1','service-1',
          'completed',1,'cancelled','${OCCURRED}','${OCCURRED}','${'c'.repeat(64)}'
        );
      `);
      insertOutbox(sqlite, {
        eventPublicId: 'service-event-recorded',
        aggregateType: 'canonical_service_event',
        aggregatePublicId: 'service-event-cancelled',
        eventType: 'canonical.service_event.recorded',
        payloadJson: directPayload({
          eventPublicId: 'service-event-cancelled', requestPublicId: 'request-event-cancel',
          eventType: 'completed', quantity: 1, requestStatus: 'partially_fulfilled',
        }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'service-event-cancel',
        aggregateType: 'canonical_service_event',
        aggregatePublicId: 'service-event-cancelled',
        eventType: 'canonical.service_event.cancelled',
        payloadJson: directPayload({
          eventPublicId: 'service-event-cancelled', requestPublicId: 'request-event-cancel',
          status: 'cancelled', fulfilledQuantityBefore: 1, fulfilledQuantityAfter: 0,
          requestStatusAfter: 'active', previousEventPublicId: null,
        }),
      });
      const serviceEventCancellation = await convert(db, 'service-event-cancel');
      expect(serviceEventCancellation.aggregateVersion).toBe(2);
      expect(serviceEventCancellation.operation).toBe('upsert');
      expect(serviceEventCancellation.entityPublicId).toBe('service-event-cancelled');
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when an unsupported predecessor would create an unexplained version gap', async () => {
    const { sqlite, db } = harness();
    try {
      insertOutbox(sqlite, {
        eventPublicId: 'invoice-unsupported',
        aggregateType: 'canonical_invoice',
        aggregatePublicId: 'invoice-1',
        eventType: 'canonical.invoice.reopened',
        payloadJson: directPayload({ invoicePublicId: 'invoice-1' }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'invoice-cancelled',
        aggregateType: 'canonical_invoice',
        aggregatePublicId: 'invoice-1',
        eventType: 'canonical.invoice.cancelled',
        payloadJson: directPayload({ invoicePublicId: 'invoice-1' }),
      });
      insertInvoiceAuthority(sqlite, 'invoice-1');
      await expect(convert(db, 'invoice-cancelled')).rejects.toThrow(/unsupported predecessor/i);
    } finally {
      sqlite.close();
    }
  });

  it('does not count another tenant or aggregate in the source sequence', async () => {
    const { sqlite, db } = harness();
    try {
      insertOutbox(sqlite, { tenantId: '200' });
      insertOutbox(sqlite, { eventPublicId: 'encounter-other', aggregatePublicId: 'encounter-2' });
      insertOutbox(sqlite);
      expect((await convert(db, 'outbox-encounter-1')).aggregateVersion).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical outbox dependency extraction', () => {
  it('maps encounter, service request, and service event dependencies', async () => {
    const { sqlite, db } = harness();
    try {
      insertOutbox(sqlite);
      insertOutbox(sqlite, {
        eventPublicId: 'request-event',
        aggregateType: 'canonical_service_request',
        aggregatePublicId: 'request-1',
        eventType: 'canonical.service_request.created',
        payloadJson: directPayload({
          requestPublicId: 'request-1',
          servicePublicId: 'service-1',
          requestedQuantity: 1,
          status: 'active',
        }),
      });
      sqlite.prepare(`
        INSERT INTO canonical_service_requests VALUES (
          '100','request-1',101,'encounter-1','service-1',1,0,NULL,'active',
          '${OCCURRED}',NULL,'${'b'.repeat(64)}'
        )
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'service-event-outbox',
        aggregateType: 'canonical_service_event',
        aggregatePublicId: 'service-event-1',
        eventType: 'canonical.service_event.recorded',
        payloadJson: directPayload({
          eventPublicId: 'service-event-1',
          requestPublicId: 'request-1',
          eventType: 'accepted',
          quantity: 1,
          requestStatus: 'active',
        }),
      });
      sqlite.prepare(`
        INSERT INTO canonical_service_events VALUES (
          '100','service-event-1','request-1','encounter-1','service-1','accepted',1,'posted',
          '${OCCURRED}',NULL,'${'c'.repeat(64)}'
        )
      `).run();

      expect((await convert(db, 'outbox-encounter-1')).dependencies).toEqual([]);
      expect((await convert(db, 'request-event')).dependencies).toEqual([
        { entityType: 'encounter', entityPublicId: 'encounter-1', minimumVersion: 1 },
      ]);
      expect((await convert(db, 'service-event-outbox')).dependencies).toEqual([
        { entityType: 'encounter', entityPublicId: 'encounter-1', minimumVersion: 1 },
        { entityType: 'service_request', entityPublicId: 'request-1', minimumVersion: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('maps invoice and payment dependencies from canonical authority', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
          subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,source_evidence_sha256
        ) VALUES ('100','invoice-1','INV-001',101,'BDT',200,0,200,'cancelled',
          '${OCCURRED}','${'d'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_invoice_encounter_links VALUES (
          '100','invoice-1','encounter-1',501,'discharge_invoice','${'f'.repeat(64)}'
        )
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_encounter_admission_links VALUES (
          '100','encounter-1',501,'ADM-001'
        )
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_invoice_lines (
          tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
          adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
        ) VALUES
          ('100','line-1','invoice-1','service','service-event-2',NULL,1,100,100,'${'a'.repeat(64)}'),
          ('100','line-2','invoice-1','service','service-event-1',NULL,1,100,100,'${'b'.repeat(64)}')
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'invoice-issued', aggregateType: 'canonical_invoice', aggregatePublicId: 'invoice-1',
        eventType: 'canonical.invoice.issued', payloadJson: directPayload({
          invoicePublicId: 'invoice-1', status: 'posted', subtotalMinor: 200,
          adjustmentTotalMinor: 0, totalMinor: 200,
        }),
      });
      sqlite.prepare(`
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
          subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,source_evidence_sha256
        ) VALUES ('100','invoice-2','INV-002',101,'BDT',100,0,100,'posted',
          '${OCCURRED}','${'c'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,received_at_utc,business_date,
          external_transaction_id,posted_at_utc,failed_at_utc,source_evidence_sha256
        ) VALUES ('100','receipt-1','R-001',101,'BDT',200,200,0,'${OCCURRED}',
          '2026-07-25',NULL,'${OCCURRED}',NULL,'${'e'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_payment_tenders (
          tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,amount_minor,
          external_transaction_id,captured_at_utc,failed_at_utc,source_evidence_sha256
        ) VALUES ('100','tender-1','receipt-1','cash','cash',200,NULL,'${OCCURRED}',NULL,'${'f'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_payment_allocations (
          tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,invoice_line_public_id,
          amount_minor,invoice_due_before_minor,invoice_due_after_minor,allocated_at_utc,source_evidence_sha256
        ) VALUES ('100','alloc-1','receipt-1','invoice-2',NULL,100,100,0,'${OCCURRED}','${'1'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_payment_allocations (
          tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,invoice_line_public_id,
          amount_minor,invoice_due_before_minor,invoice_due_after_minor,allocated_at_utc,source_evidence_sha256
        ) VALUES ('100','alloc-2','receipt-1','invoice-1',NULL,100,200,100,'${OCCURRED}','${'2'.repeat(64)}')
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'payment-posted', aggregateType: 'canonical_payment_receipt', aggregatePublicId: 'receipt-1',
        eventType: 'canonical.payment.receipt.posted', payloadJson: directPayload({
          receiptPublicId: 'receipt-1', status: 'posted', totalMinor: 200,
          allocatedMinor: 200, unallocatedMinor: 0, cashTenderMinor: 200,
        }),
      });
      expect((await convert(db, 'invoice-issued')).dependencies).toEqual([
        { entityType: 'encounter', entityPublicId: 'encounter-1', minimumVersion: 1 },
        { entityType: 'service_event', entityPublicId: 'service-event-1', minimumVersion: 1 },
        { entityType: 'service_event', entityPublicId: 'service-event-2', minimumVersion: 1 },
      ]);
      expect((await convert(db, 'payment-posted')).dependencies).toEqual([
        { entityType: 'invoice', entityPublicId: 'invoice-1', minimumVersion: 1 },
        { entityType: 'invoice', entityPublicId: 'invoice-2', minimumVersion: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('maps deposit recorded/applied dependencies from exact payload evidence', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
          currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
          received_at_utc,business_date,posted_at_utc,source_evidence_sha256
        ) VALUES ('100','deposit-1','DEP-001','receipt-1',101,'BDT',500,200,0,300,'posted',
          '${OCCURRED}','2026-07-25','${OCCURRED}','${'3'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_deposit_applications (
          tenant_id,application_public_id,deposit_public_id,invoice_public_id,invoice_line_public_id,
          amount_minor,deposit_available_before_minor,deposit_available_after_minor,
          invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,invoice_due_after_minor,
          invoice_net_due_before_minor,invoice_net_due_after_minor,applied_at_utc,source_evidence_sha256
        ) VALUES ('100','application-1','deposit-1','invoice-1',NULL,200,500,300,
          0,200,500,300,500,300,'${OCCURRED}','${'4'.repeat(64)}')
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'deposit-recorded', aggregateType: 'canonical_deposit', aggregatePublicId: 'deposit-1',
        eventType: 'canonical.deposit.recorded',
        payloadJson: directPayload({ depositPublicId: 'deposit-1', receiptPublicId: 'receipt-1', amountMinor: 500 }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'deposit-applied', aggregateType: 'canonical_deposit', aggregatePublicId: 'deposit-1',
        eventType: 'canonical.deposit.applied',
        payloadJson: directPayload({
          applicationPublicId: 'application-1', depositPublicId: 'deposit-1',
          invoicePublicId: 'invoice-1', amountMinor: 200,
        }),
      });
      expect((await convert(db, 'deposit-recorded')).dependencies).toEqual([
        { entityType: 'payment_receipt', entityPublicId: 'receipt-1', minimumVersion: 1 },
      ]);
      expect((await convert(db, 'deposit-applied')).dependencies).toEqual([
        { entityType: 'invoice', entityPublicId: 'invoice-1', minimumVersion: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('derives one deposit entity version stream across deposit and refund aggregates', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
          currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
          received_at_utc,business_date,posted_at_utc,source_evidence_sha256
        ) VALUES ('100','deposit-refund-1','DEP-001','receipt-1',101,'BDT',500,200,100,200,'posted',
          '${OCCURRED}','2026-07-25','${OCCURRED}','${'3'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_refunds (
          tenant_id,refund_public_id,source_type,deposit_public_id,receipt_public_id,
          tender_public_id,allocation_public_id,payment_reversal_public_id,amount_minor,
          tender_type,method_code,status,refunded_at_utc,business_date,reversed_at_utc,
          source_available_before_minor,source_available_after_minor,liability_guard,
          source_evidence_sha256
        ) VALUES ('100','refund-deposit-1','deposit','deposit-refund-1',NULL,NULL,NULL,NULL,
          100,'cash','cash','posted','2026-07-25T00:10:00Z','2026-07-25',NULL,500,400,1,
          '${'4'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_deposit_applications (
          tenant_id,application_public_id,deposit_public_id,invoice_public_id,invoice_line_public_id,
          amount_minor,deposit_available_before_minor,deposit_available_after_minor,
          invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,invoice_due_after_minor,
          invoice_net_due_before_minor,invoice_net_due_after_minor,applied_at_utc,source_evidence_sha256
        ) VALUES ('100','application-after-refund','deposit-refund-1','invoice-1',NULL,200,400,200,
          0,200,500,300,500,300,'2026-07-25T00:20:00Z','${'5'.repeat(64)}')
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'deposit-refund-recorded',
        aggregateType: 'canonical_deposit',
        aggregatePublicId: 'deposit-refund-1',
        eventType: 'canonical.deposit.recorded',
        occurredAtUtc: OCCURRED,
        payloadJson: directPayload({
          depositPublicId: 'deposit-refund-1', receiptPublicId: 'receipt-1', amountMinor: 500,
        }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'deposit-refunded',
        aggregateType: 'canonical_refund',
        aggregatePublicId: 'refund-deposit-1',
        eventType: 'canonical.deposit.refunded',
        occurredAtUtc: '2026-07-25T00:10:00Z',
        payloadJson: directPayload({
          refundPublicId: 'refund-deposit-1', depositPublicId: 'deposit-refund-1',
          amountMinor: 100, tenderType: 'cash',
        }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'deposit-applied-after-refund',
        aggregateType: 'canonical_deposit',
        aggregatePublicId: 'deposit-refund-1',
        eventType: 'canonical.deposit.applied',
        occurredAtUtc: '2026-07-25T00:20:00Z',
        payloadJson: directPayload({
          applicationPublicId: 'application-after-refund', depositPublicId: 'deposit-refund-1',
          invoicePublicId: 'invoice-1', amountMinor: 200,
        }),
      });

      const recorded = await convert(db, 'deposit-refund-recorded');
      const refunded = await convert(db, 'deposit-refunded');
      const applied = await convert(db, 'deposit-applied-after-refund');
      expect(recorded.aggregateVersion).toBe(1);
      expect(refunded).toMatchObject({
        entityType: 'deposit',
        entityPublicId: 'deposit-refund-1',
        aggregateVersion: 2,
        operation: 'upsert',
        dependencies: [],
      });
      expect(applied.aggregateVersion).toBe(3);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed on malformed or unsupported deposit-lifecycle predecessors', async () => {
    const { sqlite, db } = harness();
    try {
      for (const [refundPublicId, amountMinor] of [['refund-bad', 50], ['refund-good', 100]] as const) {
        sqlite.prepare(`
          INSERT INTO canonical_refunds (
            tenant_id,refund_public_id,source_type,deposit_public_id,receipt_public_id,
            tender_public_id,allocation_public_id,payment_reversal_public_id,amount_minor,
            tender_type,method_code,status,refunded_at_utc,business_date,reversed_at_utc,
            source_available_before_minor,source_available_after_minor,liability_guard,
            source_evidence_sha256
          ) VALUES ('100',?,'deposit','deposit-gap',NULL,NULL,NULL,NULL,?,'cash','cash','posted',
            '${OCCURRED}','2026-07-25',NULL,500,500-?,1,'${'6'.repeat(64)}')
        `).run(refundPublicId, amountMinor, amountMinor);
      }
      insertOutbox(sqlite, {
        eventPublicId: 'deposit-gap-recorded', aggregateType: 'canonical_deposit',
        aggregatePublicId: 'deposit-gap', eventType: 'canonical.deposit.recorded',
        payloadJson: directPayload({ depositPublicId: 'deposit-gap', receiptPublicId: 'receipt-1', amountMinor: 500 }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'deposit-gap-unsupported', aggregateType: 'canonical_refund',
        aggregatePublicId: 'refund-bad', eventType: 'canonical.deposit.refund_reversed',
        payloadJson: directPayload({ refundPublicId: 'refund-bad', depositPublicId: 'deposit-gap' }),
      });
      insertOutbox(sqlite, {
        eventPublicId: 'deposit-gap-valid', aggregateType: 'canonical_refund',
        aggregatePublicId: 'refund-good', eventType: 'canonical.deposit.refunded',
        payloadJson: directPayload({
          refundPublicId: 'refund-good', depositPublicId: 'deposit-gap', amountMinor: 100, tenderType: 'cash',
        }),
      });
      await expect(convert(db, 'deposit-gap-valid')).rejects.toThrow(/unsupported predecessor/i);
    } finally {
      sqlite.close();
    }
  });

  it('maps compensation and inventory dependencies from canonical authority', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_compensation_accruals VALUES (
          '100','accrual-1','invoice-1','line-1','service-event-1',NULL,
          'performing','commission','rule-1',1,'net_after_discount','basis_points',2000,'BDT',
          1000,100,0,0,900,180,0,0,180,'unassigned','${OCCURRED}','2026-07-25',
          '${'6'.repeat(64)}'
        )
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'comp-accrued', aggregateType: 'compensation_accrual', aggregatePublicId: 'accrual-1',
        eventType: 'canonical.compensation.accrued', payloadJson: directPayload({
          accrualPublicId: 'accrual-1', invoiceLinePublicId: 'line-1', practitionerPublicId: null,
          practitionerRole: 'performing', earnedMinor: 180, currencyCode: 'BDT',
        }),
      });
      sqlite.prepare(`
        INSERT INTO canonical_inventory_movements (
          tenant_id,movement_public_id,item_public_id,location_public_id,lot_public_id,
          movement_type,direction,source_quantity,source_unit_code,conversion_numerator,
          conversion_denominator,quantity_base,signed_quantity_base,balance_before_base,
          balance_after_base,transfer_public_id,service_event_public_id,invoice_public_id,
          invoice_line_public_id,reversal_of_movement_public_id,source_type,source_public_id,
          source_line_public_id,source_table,status,occurred_at_utc,business_date,balance_guard,
          source_evidence_sha256
        ) VALUES (
          '100','movement-1','item-1','location-1','lot-1','sale','out',2,'piece',1,1,2,-2,
          10,8,NULL,'service-event-1','invoice-1','line-1',NULL,'sale','sale-1','sale-line-1',
          'sale_items','posted','${OCCURRED}','2026-07-25',1,'${'8'.repeat(64)}'
        )
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'movement-posted', aggregateType: 'canonical_inventory_movement', aggregatePublicId: 'movement-1',
        eventType: 'canonical.inventory.movement.posted', payloadJson: directPayload({
          movementPublicId: 'movement-1', movementType: 'sale', itemPublicId: 'item-1',
          locationPublicId: 'location-1', lotPublicId: 'lot-1', quantityBase: 2, balanceAfterBase: 8,
        }),
      });
      expect((await convert(db, 'comp-accrued')).dependencies).toEqual([
        { entityType: 'invoice', entityPublicId: 'invoice-1', minimumVersion: 1 },
        { entityType: 'service_event', entityPublicId: 'service-event-1', minimumVersion: 1 },
      ]);
      expect((await convert(db, 'movement-posted')).dependencies).toEqual([
        { entityType: 'invoice', entityPublicId: 'invoice-1', minimumVersion: 1 },
        { entityType: 'service_event', entityPublicId: 'service-event-1', minimumVersion: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when required canonical dependency authority is missing', async () => {
    const { sqlite, db } = harness();
    try {
      insertOutbox(sqlite, {
        eventPublicId: 'request-event', aggregateType: 'canonical_service_request', aggregatePublicId: 'request-1',
        eventType: 'canonical.service_request.created', payloadJson: directPayload({ requestPublicId: 'request-1' }),
      });
      await expect(convert(db, 'request-event')).rejects.toThrow(/dependency authority/i);
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical outbox conversion safety', () => {
  it('maps payment reversal to tombstone and remains deterministic and read-only', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_payment_allocations (
          tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,invoice_line_public_id,
          amount_minor,invoice_due_before_minor,invoice_due_after_minor,allocated_at_utc,source_evidence_sha256
        ) VALUES ('100','alloc-1','receipt-1','invoice-1',NULL,100,100,0,'${OCCURRED}','${'5'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_payment_reversals (
          tenant_id,reversal_public_id,receipt_public_id,tender_public_id,allocation_public_id,
          invoice_public_id,amount_minor,reason_code,status,reversed_at_utc,business_date,
          allocation_reversed_before_minor,allocation_reversed_after_minor,
          tender_reversed_before_minor,tender_reversed_after_minor,
          receipt_refunded_before_minor,receipt_refunded_after_minor,
          invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,
          invoice_due_after_minor,invoice_net_due_before_minor,invoice_net_due_after_minor,
          compensation_guard,balance_guard,source_evidence_sha256
        ) VALUES ('100','reversal-1','receipt-1','tender-1','alloc-1','invoice-1',100,
          'operator_correction','posted','${OCCURRED}','2026-07-25',0,100,0,100,0,100,
          100,0,0,100,0,100,1,1,'${'6'.repeat(64)}')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_refunds (
          tenant_id,refund_public_id,source_type,deposit_public_id,receipt_public_id,
          tender_public_id,allocation_public_id,payment_reversal_public_id,amount_minor,
          tender_type,method_code,status,refunded_at_utc,business_date,reversed_at_utc,
          source_available_before_minor,source_available_after_minor,liability_guard,
          source_evidence_sha256
        ) VALUES ('100','refund-1','payment',NULL,'receipt-1','tender-1','alloc-1',
          'reversal-1',100,'cash','cash','posted','${OCCURRED}','2026-07-25',NULL,
          NULL,NULL,1,'${'7'.repeat(64)}')
      `).run();
      insertOutbox(sqlite, {
        eventPublicId: 'payment-posted', aggregateType: 'canonical_payment_receipt', aggregatePublicId: 'receipt-1',
        eventType: 'canonical.payment.receipt.posted', payloadJson: directPayload({
          receiptPublicId: 'receipt-1', status: 'posted', totalMinor: 100,
          allocatedMinor: 100, unallocatedMinor: 0, cashTenderMinor: 100,
        }),
        status: 'published', publishedAtUtc: OCCURRED, processingAttempts: 2,
      });
      insertOutbox(sqlite, {
        eventPublicId: 'payment-reversed', aggregateType: 'canonical_payment_receipt', aggregatePublicId: 'receipt-1',
        eventType: 'canonical.payment.reversed', payloadJson: directPayload({
          allocationPublicId: 'alloc-1', amountMinor: 100, receiptPublicId: 'receipt-1',
          refundPublicId: 'refund-1', reversalPublicId: 'reversal-1', tenderPublicId: 'tender-1',
        }),
        status: 'retry', processingAttempts: 3,
      });
      const before = sqlite.prepare(`SELECT * FROM canonical_outbox_events ORDER BY id`).all();
      const first = await convert(db, 'payment-reversed');
      const second = await convert(db, 'payment-reversed');
      expect(first.operation).toBe('tombstone');
      expect(first.aggregateVersion).toBe(2);
      expect(first.payload).toMatchObject({
        schemaVersion: 1,
        mutation: {
          kind: 'payment_reversed',
          reversalPublicId: 'reversal-1',
          refundPublicId: 'refund-1',
          amountMinor: 100,
        },
      });
      expect(first.idempotencyKey).toBe(second.idempotencyKey);
      expect(first.payloadSha256).toBe(second.payloadSha256);
      expect(stableCanonicalJson(first)).not.toContain('"id":');
      expect(sqlite.prepare(`SELECT * FROM canonical_outbox_events ORDER BY id`).all()).toEqual(before);
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});
