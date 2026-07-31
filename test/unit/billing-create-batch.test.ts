import { describe, expect, it } from 'vitest';
import { buildBillCreationBatch } from '../../src/lib/billing-create-batch';

class RecordingStatement {
  constructor(
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): RecordingStatement {
    return new RecordingStatement(this.sql, params);
  }
}

function createRecordingDb() {
  const prepared: RecordingStatement[] = [];
  const db = {
    prepare(sql: string) {
      const statement = new RecordingStatement(sql);
      prepared.push(statement);
      return statement;
    },
  } as unknown as D1Database;
  return { db, prepared };
}

const baseInput = {
  tenantId: '100',
  userId: '101',
  patientId: 2001,
  visitId: null,
  invoiceNo: 'INV-000123',
  referringDoctorId: 301,
  categoryTotals: {
    testBill: 0,
    doctorVisitBill: 500,
    admissionBill: 0,
    operationBill: 0,
    medicineBill: 0,
  },
  discount: 0,
  discountReason: null,
  discountByName: null,
  total: 500,
  taxTotal: 0,
  counterId: 1,
  counterSessionId: 9,
  businessDate: '2026-07-29',
  occurredAtUtc: '2026-07-29T03:30:00.000Z',
  commandIdempotencyKey: 'billing-create:INV-000123',
  items: [{
    itemCategory: 'doctor_visit',
    description: 'Consultation',
    quantity: 1,
    unitPrice: 500,
    lineTotal: 500,
    taxAmount: 0,
    referenceId: 44,
    serviceItemId: null,
    canonicalSourceKey: 'bill-service:INV-000123:1',
  }],
};

describe('D1-native bill creation batch', () => {
  it('builds a bill insert and item inserts without explicit transaction statements', () => {
    const { db } = createRecordingDb();
    const statements = buildBillCreationBatch(db, baseInput);
    const sql = statements.map((statement) => (statement as unknown as RecordingStatement).sql).join('\n');

    expect(statements).toHaveLength(2);
    expect(sql).toContain('INSERT INTO "bills"');
    expect(sql).toContain('RETURNING id');
    expect(sql).toContain('INSERT INTO "invoice_items"');
    expect(sql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/i);
  });

  it('scopes invoice-item bill lookup by both tenant and invoice number', () => {
    const { db } = createRecordingDb();
    const statements = buildBillCreationBatch(db, baseInput);
    const item = statements[1] as unknown as RecordingStatement;

    expect(item.sql).toContain('FROM "bills"');
    expect(item.sql).toContain('tenant_id = ?');
    expect(item.sql).toContain('invoice_no = ?');
    expect(item.params.slice(-3)).toEqual(['100', '100', 'INV-000123']);
  });

  it('adds the visit-service ledger statement only when a visit is present', () => {
    const { db } = createRecordingDb();
    const withoutVisit = buildBillCreationBatch(db, baseInput);
    const withVisit = buildBillCreationBatch(db, { ...baseInput, visitId: 7001 });

    expect(withoutVisit).toHaveLength(2);
    expect(withVisit).toHaveLength(3);
    const visitService = withVisit[2] as unknown as RecordingStatement;
    expect(visitService.sql).toContain('INSERT INTO "visit_services"');
    expect(visitService.sql).toContain('canonical_source_key');
    expect(visitService.params).toContain('bill-service:INV-000123:1');
  });

  it('attaches an async strict service-acceptance factory without changing legacy enumeration', () => {
    const { db } = createRecordingDb();
    const statements = buildBillCreationBatch(db, { ...baseInput, visitId: 7001 }) as D1PreparedStatement[] & {
      strictAuthoritativeStatements?: () => Promise<readonly D1PreparedStatement[]>;
    };
    expect(typeof statements.strictAuthoritativeStatements).toBe('function');
    expect(Object.keys(statements)).not.toContain('strictAuthoritativeStatements');
  });
});
