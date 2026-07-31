import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  ADMISSION_DEPOSIT_BACKFILL_APPROVAL,
  buildAdmissionDepositBackfillExpectedRows,
  buildAdmissionDepositBackfillSql,
  executeAdmissionDepositBackfill,
  type AdmissionDepositBackfillGateway,
  type AdmissionDepositBackfillRow,
} from '../../scripts/canonical/execute-production-admission-deposit-backfill';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

function sourceRows(): AdmissionDepositBackfillRow[] {
  return [
    {
      id: 108,
      patient_id: 1262,
      admission_id: 13089,
      deposit_receipt_no: 'DEP-000048',
      amount: 300,
      transaction_type: 'deposit',
      payment_method: 'cash',
      remarks: 'Admission deposit for ADM-000064',
      reference_bill_id: null,
      counter_id: 2,
      counter_session_id: 28,
      is_active: 1,
      created_by: 103,
      created_at: '2026-07-22 08:11:24',
      updated_at: null,
      receipt_public_id: null,
      tender_public_id: null,
      deposit_public_id: null,
      receipt_evidence_sha256: null,
      tender_evidence_sha256: null,
      deposit_evidence_sha256: null,
      receipt_mapping_count: 0,
      tender_mapping_count: 0,
      deposit_mapping_count: 0,
    },
    {
      id: 109,
      patient_id: 1326,
      admission_id: 13090,
      deposit_receipt_no: 'DEP-000049',
      amount: 300,
      transaction_type: 'deposit',
      payment_method: 'cash',
      remarks: 'Admission deposit for ADM-000065',
      reference_bill_id: null,
      counter_id: 2,
      counter_session_id: 28,
      is_active: 1,
      created_by: 103,
      created_at: '2026-07-22 08:12:03',
      updated_at: null,
      receipt_public_id: null,
      tender_public_id: null,
      deposit_public_id: null,
      receipt_evidence_sha256: null,
      tender_evidence_sha256: null,
      deposit_evidence_sha256: null,
      receipt_mapping_count: 0,
      tender_mapping_count: 0,
      deposit_mapping_count: 0,
    },
  ];
}

describe('production admission deposit backfill', () => {
  it('repairs exactly the two reviewed admission deposits and verifies canonical post-state', async () => {
    let rows = sourceRows();
    const expectedRows = await buildAdmissionDepositBackfillExpectedRows(rows);
    const writes: string[] = [];
    const gateway: AdmissionDepositBackfillGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readRows() {
        return rows;
      },
      async writeRepair(sql) {
        writes.push(sql);
        rows = rows.map((row) => {
          const expected = expectedRows.find((candidate) => candidate.sourceId === row.id)!;
          return {
            ...row,
            receipt_public_id: expected.receiptPublicId,
            tender_public_id: expected.tenderPublicId,
            deposit_public_id: expected.depositPublicId,
            receipt_evidence_sha256: expected.receiptEvidenceSha256,
            tender_evidence_sha256: expected.receiptEvidenceSha256,
            deposit_evidence_sha256: expected.depositEvidenceSha256,
            receipt_mapping_count: 1,
            tender_mapping_count: 1,
            deposit_mapping_count: 1,
          };
        });
        return { changes: 1, rowsWritten: 12 };
      },
    };

    const result = await executeAdmissionDepositBackfill({
      approval: ADMISSION_DEPOSIT_BACKFILL_APPROVAL,
      execute: true,
    }, gateway);

    expect(result).toMatchObject({
      repaired: true,
      execution: 'created',
      sourceRows: 2,
      canonicalRowsCreated: 6,
      mappingsCreated: 6,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("deposit_receipt_no='DEP-000048'");
    expect(writes[0]).toContain("deposit_receipt_no='DEP-000049'");
    expect(writes[0]).toContain("source_public_id='108'");
    expect(writes[0]).toContain("source_public_id='109'");
  });

  it('verifies an exact completed repair without issuing a second write', async () => {
    const expectedRows = await buildAdmissionDepositBackfillExpectedRows(sourceRows());
    const rows = sourceRows().map((row) => {
      const expected = expectedRows.find((candidate) => candidate.sourceId === row.id)!;
      return {
        ...row,
        receipt_public_id: expected.receiptPublicId,
        tender_public_id: expected.tenderPublicId,
        deposit_public_id: expected.depositPublicId,
        receipt_evidence_sha256: expected.receiptEvidenceSha256,
        tender_evidence_sha256: expected.receiptEvidenceSha256,
        deposit_evidence_sha256: expected.depositEvidenceSha256,
        receipt_mapping_count: 1,
        tender_mapping_count: 1,
        deposit_mapping_count: 1,
      };
    });
    let writes = 0;
    const gateway: AdmissionDepositBackfillGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readRows() {
        return rows;
      },
      async writeRepair() {
        writes += 1;
        return { changes: 0, rowsWritten: 0 };
      },
    };

    const result = await executeAdmissionDepositBackfill({
      approval: ADMISSION_DEPOSIT_BACKFILL_APPROVAL,
      execute: true,
    }, gateway);

    expect(result).toMatchObject({ repaired: true, execution: 'verified_existing' });
    expect(writes).toBe(0);
  });

  it('executes the generated guarded SQL against SQLite and creates the exact scoped rows', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE billing_deposits (
        id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
        admission_id INTEGER, deposit_receipt_no TEXT NOT NULL, amount REAL NOT NULL,
        transaction_type TEXT NOT NULL, payment_method TEXT, remarks TEXT,
        reference_bill_id INTEGER, counter_id INTEGER, counter_session_id INTEGER,
        is_active INTEGER, created_by INTEGER, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE canonical_payment_receipts (
        tenant_id TEXT NOT NULL, receipt_public_id TEXT NOT NULL, receipt_number TEXT NOT NULL,
        legacy_patient_id INTEGER NOT NULL, currency_code TEXT NOT NULL, total_minor INTEGER NOT NULL,
        allocated_total_minor INTEGER NOT NULL, unallocated_minor INTEGER NOT NULL, status TEXT NOT NULL,
        received_at_utc TEXT NOT NULL, business_date TEXT NOT NULL, legacy_collector_id INTEGER,
        legacy_counter_id INTEGER, legacy_counter_session_id INTEGER, external_transaction_id TEXT,
        posted_at_utc TEXT, failed_at_utc TEXT, reversed_at_utc TEXT, reconciliation_guard INTEGER NOT NULL,
        source_evidence_sha256 TEXT NOT NULL, refunded_minor INTEGER NOT NULL,
        net_received_minor INTEGER NOT NULL, refund_projection_guard INTEGER NOT NULL,
        created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
        UNIQUE (tenant_id, receipt_public_id), UNIQUE (tenant_id, receipt_number)
      );
      CREATE TABLE canonical_payment_tenders (
        tenant_id TEXT NOT NULL, tender_public_id TEXT NOT NULL, receipt_public_id TEXT NOT NULL,
        tender_type TEXT NOT NULL, method_code TEXT NOT NULL, amount_minor INTEGER NOT NULL,
        status TEXT NOT NULL, external_transaction_id TEXT, captured_at_utc TEXT,
        failed_at_utc TEXT, reversed_at_utc TEXT, source_evidence_sha256 TEXT NOT NULL,
        reversed_minor INTEGER NOT NULL, remaining_minor INTEGER NOT NULL,
        reversal_projection_guard INTEGER NOT NULL, created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
        UNIQUE (tenant_id, tender_public_id)
      );
      CREATE TABLE canonical_deposits (
        tenant_id TEXT NOT NULL, deposit_public_id TEXT NOT NULL, deposit_number TEXT NOT NULL,
        receipt_public_id TEXT NOT NULL, legacy_patient_id INTEGER NOT NULL, currency_code TEXT NOT NULL,
        amount_minor INTEGER NOT NULL, applied_minor INTEGER NOT NULL, refunded_minor INTEGER NOT NULL,
        available_minor INTEGER NOT NULL, status TEXT NOT NULL, received_at_utc TEXT NOT NULL,
        business_date TEXT NOT NULL, posted_at_utc TEXT NOT NULL, reversed_at_utc TEXT,
        reconciliation_guard INTEGER NOT NULL, source_evidence_sha256 TEXT NOT NULL,
        created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
        UNIQUE (tenant_id, deposit_public_id), UNIQUE (tenant_id, deposit_number)
      );
      CREATE TABLE canonical_source_mappings (
        tenant_id TEXT NOT NULL, entity_type TEXT NOT NULL, canonical_public_id TEXT NOT NULL,
        source_type TEXT NOT NULL, source_public_id TEXT NOT NULL, source_table TEXT NOT NULL,
        mapping_status TEXT NOT NULL, mapping_version INTEGER NOT NULL, evidence_sha256 TEXT NOT NULL,
        created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
        UNIQUE (tenant_id, entity_type, source_type, source_public_id)
      );
    `);
    const insert = database.prepare(`
      INSERT INTO billing_deposits (
        id,tenant_id,patient_id,admission_id,deposit_receipt_no,amount,transaction_type,
        payment_method,remarks,reference_bill_id,counter_id,counter_session_id,is_active,
        created_by,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const row of sourceRows()) {
      insert.run(
        row.id, '100', row.patient_id, row.admission_id, row.deposit_receipt_no, row.amount,
        row.transaction_type, row.payment_method, row.remarks, row.reference_bill_id,
        row.counter_id, row.counter_session_id, row.is_active, row.created_by,
        row.created_at, row.updated_at,
      );
    }

    database.exec(await buildAdmissionDepositBackfillSql(sourceRows(), '2026-07-22T11:30:00.000Z'));

    expect(database.prepare("SELECT COUNT(*) count FROM canonical_payment_receipts WHERE tenant_id='100'").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) count FROM canonical_payment_tenders WHERE tenant_id='100'").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) count FROM canonical_deposits WHERE tenant_id='100'").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) count FROM canonical_source_mappings WHERE tenant_id='100'").get()).toMatchObject({ count: 6 });
    expect(database.prepare("SELECT SUM(total_minor) total FROM canonical_payment_receipts WHERE tenant_id='100'").get()).toMatchObject({ total: 60_000 });
    expect(database.prepare("SELECT SUM(available_minor) total FROM canonical_deposits WHERE tenant_id='100'").get()).toMatchObject({ total: 60_000 });
    database.close();
  });

  it('fails closed before write for wrong approval, source drift, or partial canonical state', async () => {
    let writes = 0;
    const gateway: AdmissionDepositBackfillGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readRows() {
        return [{ ...sourceRows()[0], amount: 301 }, sourceRows()[1]];
      },
      async writeRepair() {
        writes += 1;
        return { changes: 12, rowsWritten: 12 };
      },
    };

    await expect(executeAdmissionDepositBackfill({ approval: 'wrong', execute: true }, gateway)).rejects.toThrow(/approval/i);
    await expect(executeAdmissionDepositBackfill({ approval: ADMISSION_DEPOSIT_BACKFILL_APPROVAL, execute: true }, gateway)).rejects.toThrow(/source state/i);

    const partialGateway: AdmissionDepositBackfillGateway = {
      ...gateway,
      async readRows() {
        return [{ ...sourceRows()[0], receipt_mapping_count: 1 }, sourceRows()[1]];
      },
    };
    await expect(executeAdmissionDepositBackfill({ approval: ADMISSION_DEPOSIT_BACKFILL_APPROVAL, execute: true }, partialGateway)).rejects.toThrow(/partial canonical state/i);
    expect(writes).toBe(0);
  });
});
