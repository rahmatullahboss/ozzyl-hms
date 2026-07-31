import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface DepositLifecyclePreparedStatement {
  bind(...values: unknown[]): DepositLifecyclePreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface DepositLifecycleDatabase {
  prepare(sql: string): DepositLifecyclePreparedStatement;
  batch(statements: DepositLifecyclePreparedStatement[]): Promise<unknown[]>;
}

export interface DepositLifecycleOptions {
  tenantId: string;
  currencyCode: string;
  nowUtc?: string;
}

export interface DepositLifecycleResult {
  completed: true;
  depositsCreated: number;
  applicationsCreated: number;
  refundsCreated: number;
  transactionsMapped: number;
  reused: number;
}

interface DepositRow {
  id: number;
  patient_id: number;
  deposit_receipt_no: string;
  amount: number;
  transaction_type: string;
  payment_method: string | null;
  remarks: string | null;
  reference_bill_id: number | null;
  counter_id: number | null;
  counter_session_id: number | null;
  is_active: number | null;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}

interface ReceiptAuthority {
  receipt_public_id: string;
  receipt_number: string;
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  received_at_utc: string;
  business_date: string;
  posted_at_utc: string | null;
  tender_public_id: string;
  tender_type: 'cash' | 'card' | 'mobile_wallet' | 'bank_transfer' | 'gateway' | 'other';
  method_code: string;
}

interface AvailableDeposit {
  deposit_public_id: string;
  receipt_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  amount_minor: number;
  applied_minor: number;
  refunded_minor: number;
  available_minor: number;
  received_at_utc: string;
  tender_public_id: string;
  tender_type: 'cash' | 'card' | 'mobile_wallet' | 'bank_transfer' | 'gateway' | 'other';
  method_code: string;
}

interface InvoiceAuthority {
  invoice_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  status: string;
  paid_minor: number;
  due_minor: number;
  net_due_minor: number;
}

interface Fragment {
  deposit: AvailableDeposit;
  amountMinor: number;
}

export const SOURCE_DEPOSIT = 'legacy_billing_deposit';
export const SOURCE_LIFECYCLE = 'legacy_billing_deposit_lifecycle';

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value) throw new TypeError(`${label} is invalid`);
  return value;
}

function exactCurrency(value: string): string {
  exact(value, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(value)) throw new TypeError('currencyCode must be three uppercase letters');
  return value;
}

function exactMinor(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  const minor = toMinorUnits(String(value));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} is unsafe`);
  return Number(minor);
}

function legacyUtc(value: string | null, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return toUtcIso(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}+06:00`);
}

function businessDate(value: string | null, fallbackUtc: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value?.trim() ?? '');
  return match?.[1] ?? fallbackUtc.slice(0, 10);
}

async function depositEvidence(row: DepositRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_DEPOSIT,
    sourcePublicId: String(row.id),
    patientId: row.patient_id,
    depositReceiptNo: row.deposit_receipt_no,
    amountMajor: row.amount,
    transactionType: row.transaction_type,
    paymentMethod: row.payment_method,
    referenceBillId: row.reference_bill_id,
    counterId: row.counter_id,
    counterSessionId: row.counter_session_id,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function sourceEvidence(row: DepositRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_LIFECYCLE,
    sourcePublicId: String(row.id),
    patientId: row.patient_id,
    receiptNumber: row.deposit_receipt_no,
    amountMajor: row.amount,
    transactionType: row.transaction_type,
    paymentMethod: row.payment_method,
    remarks: row.remarks,
    referenceBillId: row.reference_bill_id,
    counterId: row.counter_id,
    counterSessionId: row.counter_session_id,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function existingMapping(
  db: DepositLifecycleDatabase,
  tenantId: string,
  entityType: string,
  sourceType: string,
  sourceId: string,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, entityType, sourceType, sourceId).first<MappingRow>();
}

function mappingStatement(
  db: DepositLifecycleDatabase,
  tenantId: string,
  entityType: string,
  canonicalId: string,
  sourceType: string,
  sourceId: string,
  evidenceSha256: string,
  nowUtc: string,
): DepositLifecyclePreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,'billing_deposits','mapped',1,?,?,?)
  `).bind(
    tenantId, entityType, canonicalId, sourceType, sourceId,
    evidenceSha256, nowUtc, nowUtc,
  );
}

async function receiptAuthority(
  db: DepositLifecycleDatabase,
  tenantId: string,
  sourceId: string,
): Promise<ReceiptAuthority | null> {
  return db.prepare(`
    SELECT r.receipt_public_id,r.receipt_number,r.legacy_patient_id,r.currency_code,
           r.total_minor,r.received_at_utc,r.business_date,r.posted_at_utc,
           t.tender_public_id,t.tender_type,t.method_code
    FROM canonical_source_mappings rm
    JOIN canonical_payment_receipts r
      ON r.tenant_id=rm.tenant_id AND r.receipt_public_id=rm.canonical_public_id
    JOIN canonical_source_mappings tm
      ON tm.tenant_id=rm.tenant_id AND tm.entity_type='payment_tender'
      AND tm.source_type=rm.source_type AND tm.source_public_id=rm.source_public_id
      AND tm.mapping_status='mapped'
    JOIN canonical_payment_tenders t
      ON t.tenant_id=tm.tenant_id AND t.tender_public_id=tm.canonical_public_id
    WHERE rm.tenant_id=? AND rm.entity_type='payment_receipt'
      AND rm.source_type=? AND rm.source_public_id=? AND rm.mapping_status='mapped'
    LIMIT 1
  `).bind(tenantId, SOURCE_DEPOSIT, sourceId).first<ReceiptAuthority>();
}

async function createDeposits(
  db: DepositLifecycleDatabase,
  tenantId: string,
  currencyCode: string,
  nowUtc: string,
  rows: DepositRow[],
): Promise<{ created: number; reused: number }> {
  let created = 0;
  let reused = 0;
  for (const row of rows) {
    if (row.is_active === 0 || row.transaction_type.trim().toLowerCase() !== 'deposit') continue;
    const sourceId = String(row.id);
    const evidence = await depositEvidence(row);
    const prior = await existingMapping(db, tenantId, 'deposit', SOURCE_DEPOSIT, sourceId);
    if (prior) {
      if (prior.mapping_status !== 'mapped' || !prior.canonical_public_id || prior.evidence_sha256 !== evidence) {
        throw new Error(`Deposit evidence drift detected for source ${sourceId}`);
      }
      reused += 1;
      continue;
    }
    const receipt = await receiptAuthority(db, tenantId, sourceId);
    if (!receipt) throw new Error(`Deposit receipt authority missing for source ${sourceId}`);
    const amountMinor = exactMinor(row.amount, 'deposit amount');
    if (
      receipt.legacy_patient_id !== row.patient_id
      || receipt.currency_code !== currencyCode
      || receipt.total_minor !== amountMinor
      || !receipt.posted_at_utc
    ) {
      throw new Error(`Deposit receipt authority mismatch for source ${sourceId}`);
    }
    const depositId = await createDeterministicSourceId('dep', tenantId, SOURCE_DEPOSIT, sourceId);
    await db.batch([
      db.prepare(`
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,
          legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
          available_minor,status,received_at_utc,business_date,posted_at_utc,
          reversed_at_utc,reconciliation_guard,source_evidence_sha256,
          created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,0,0,?,'posted',?,?,?,NULL,1,?,?,?)
      `).bind(
        tenantId, depositId, row.deposit_receipt_no, receipt.receipt_public_id,
        row.patient_id, currencyCode, amountMinor, amountMinor,
        receipt.received_at_utc, receipt.business_date, receipt.posted_at_utc,
        evidence, nowUtc, nowUtc,
      ),
      mappingStatement(db, tenantId, 'deposit', depositId, SOURCE_DEPOSIT, sourceId, evidence, nowUtc),
    ]);
    created += 1;
  }
  return { created, reused };
}

async function availableDeposits(
  db: DepositLifecycleDatabase,
  tenantId: string,
  patientId: number,
  occurredAtUtc: string,
): Promise<AvailableDeposit[]> {
  return (await db.prepare(`
    SELECT d.deposit_public_id,d.receipt_public_id,d.legacy_patient_id,d.currency_code,
           d.amount_minor,d.applied_minor,d.refunded_minor,d.available_minor,d.received_at_utc,
           t.tender_public_id,t.tender_type,t.method_code
    FROM canonical_deposits d
    JOIN canonical_payment_tenders t
      ON t.tenant_id=d.tenant_id AND t.receipt_public_id=d.receipt_public_id
      AND t.status='captured'
    WHERE d.tenant_id=? AND d.legacy_patient_id=? AND d.status='posted'
      AND d.available_minor>0 AND d.received_at_utc<=?
    ORDER BY d.received_at_utc,d.id
  `).bind(tenantId, patientId, occurredAtUtc).all<AvailableDeposit>()).results;
}

function fifoFragments(deposits: AvailableDeposit[], amountMinor: number): Fragment[] {
  let remaining = amountMinor;
  const fragments: Fragment[] = [];
  for (const deposit of deposits) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, deposit.available_minor);
    if (amount <= 0) continue;
    fragments.push({ deposit, amountMinor: amount });
    remaining -= amount;
  }
  if (remaining !== 0) throw new Error('Insufficient canonical deposit balance for FIFO reconstruction');
  return fragments;
}

async function invoiceAuthority(
  db: DepositLifecycleDatabase,
  tenantId: string,
  legacyBillId: number,
): Promise<InvoiceAuthority | null> {
  return db.prepare(`
    SELECT i.invoice_public_id,i.legacy_patient_id,i.currency_code,i.status,
           i.paid_minor,i.due_minor,i.net_due_minor
    FROM canonical_source_mappings m
    JOIN canonical_invoices i
      ON i.tenant_id=m.tenant_id AND i.invoice_public_id=m.canonical_public_id
    WHERE m.tenant_id=? AND m.entity_type='invoice' AND m.source_type='legacy_bill'
      AND m.source_public_id=? AND m.mapping_status='mapped'
    LIMIT 1
  `).bind(tenantId, String(legacyBillId)).first<InvoiceAuthority>();
}

function resolveLegacyIssue(
  db: DepositLifecycleDatabase,
  tenantId: string,
  sourceId: string,
  nowUtc: string,
): DepositLifecyclePreparedStatement {
  return db.prepare(`
    UPDATE canonical_processing_issues
    SET status='resolved',resolved_at_utc=?,resolved_by_public_id='canonical-backfill',
        resolution_code='FIFO_LIFECYCLE_RECONSTRUCTED',updated_at_utc=?
    WHERE tenant_id=? AND issue_type='adjustment_backfill'
      AND issue_code='DEPOSIT_TRANSACTION_TYPE_UNSUPPORTED'
      AND source_type='legacy_billing_deposit' AND source_public_id=?
      AND status IN ('open','acknowledged')
  `).bind(nowUtc, nowUtc, tenantId, sourceId);
}

async function processAdjustment(
  db: DepositLifecycleDatabase,
  tenantId: string,
  currencyCode: string,
  nowUtc: string,
  row: DepositRow,
  evidence: string,
): Promise<number> {
  if (!row.reference_bill_id) throw new Error(`Deposit adjustment ${row.id} has no bill authority`);
  const occurredAt = legacyUtc(row.created_at, nowUtc);
  const amountMinor = exactMinor(row.amount, 'deposit adjustment amount');
  const invoice = await invoiceAuthority(db, tenantId, row.reference_bill_id);
  if (
    !invoice
    || invoice.legacy_patient_id !== row.patient_id
    || invoice.currency_code !== currencyCode
    || invoice.status !== 'posted'
    || invoice.due_minor < amountMinor
    || invoice.net_due_minor < amountMinor
  ) {
    throw new Error(`Insufficient or invalid canonical invoice authority for deposit adjustment ${row.id}`);
  }
  const fragments = fifoFragments(
    await availableDeposits(db, tenantId, row.patient_id, occurredAt),
    amountMinor,
  );
  const statements: DepositLifecyclePreparedStatement[] = [];
  let invoicePaid = invoice.paid_minor;
  let invoiceDue = invoice.due_minor;
  let invoiceNetDue = invoice.net_due_minor;
  for (const [index, fragment] of fragments.entries()) {
    const before = fragment.deposit.available_minor;
    const after = before - fragment.amountMinor;
    const paidAfter = invoicePaid + fragment.amountMinor;
    const dueAfter = invoiceDue - fragment.amountMinor;
    const netDueAfter = invoiceNetDue - fragment.amountMinor;
    const sourceFragment = `${row.id}:${index + 1}`;
    const applicationId = await createDeterministicSourceId(
      'depa', tenantId, SOURCE_LIFECYCLE, sourceFragment,
    );
    statements.push(
      db.prepare(`
        INSERT INTO canonical_deposit_applications (
          tenant_id,application_public_id,deposit_public_id,invoice_public_id,
          invoice_line_public_id,amount_minor,deposit_available_before_minor,
          deposit_available_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
          invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
          invoice_net_due_after_minor,status,applied_at_utc,reversed_at_utc,
          balance_guard,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,'active',?,NULL,1,?,?,?)
      `).bind(
        tenantId, applicationId, fragment.deposit.deposit_public_id, invoice.invoice_public_id,
        fragment.amountMinor, before, after, invoicePaid, paidAfter, invoiceDue, dueAfter,
        invoiceNetDue, netDueAfter, occurredAt, evidence, nowUtc, nowUtc,
      ),
      db.prepare(`
        UPDATE canonical_deposits
        SET applied_minor=applied_minor+?,available_minor=available_minor-?,updated_at_utc=?
        WHERE tenant_id=? AND deposit_public_id=? AND status='posted' AND available_minor=?
      `).bind(
        fragment.amountMinor, fragment.amountMinor, nowUtc,
        tenantId, fragment.deposit.deposit_public_id, before,
      ),
      mappingStatement(
        db, tenantId, 'deposit_application', applicationId,
        SOURCE_LIFECYCLE, sourceFragment, evidence, nowUtc,
      ),
    );
    invoicePaid = paidAfter;
    invoiceDue = dueAfter;
    invoiceNetDue = netDueAfter;
  }
  statements.push(
    db.prepare(`
      UPDATE canonical_invoices
      SET paid_minor=?,due_minor=?,net_due_minor=?,updated_at_utc=?
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
        AND paid_minor=? AND due_minor=? AND net_due_minor=?
    `).bind(
      invoicePaid, invoiceDue, invoiceNetDue, nowUtc,
      tenantId, invoice.invoice_public_id,
      invoice.paid_minor, invoice.due_minor, invoice.net_due_minor,
    ),
  );
  const parentId = await createDeterministicSourceId('dlt', tenantId, SOURCE_LIFECYCLE, String(row.id));
  statements.push(
    mappingStatement(
      db, tenantId, 'deposit_lifecycle_transaction', parentId,
      SOURCE_LIFECYCLE, String(row.id), evidence, nowUtc,
    ),
    resolveLegacyIssue(db, tenantId, String(row.id), nowUtc),
  );
  await db.batch(statements);
  return fragments.length;
}

async function processRefund(
  db: DepositLifecycleDatabase,
  tenantId: string,
  nowUtc: string,
  row: DepositRow,
  evidence: string,
): Promise<number> {
  const occurredAt = legacyUtc(row.created_at, nowUtc);
  const amountMinor = exactMinor(row.amount, 'deposit refund amount');
  const fragments = fifoFragments(
    await availableDeposits(db, tenantId, row.patient_id, occurredAt),
    amountMinor,
  );
  const statements: DepositLifecyclePreparedStatement[] = [];
  for (const [index, fragment] of fragments.entries()) {
    const before = fragment.deposit.available_minor;
    const after = before - fragment.amountMinor;
    const sourceFragment = `${row.id}:${index + 1}`;
    const refundId = await createDeterministicSourceId('rfnd', tenantId, SOURCE_LIFECYCLE, sourceFragment);
    statements.push(
      db.prepare(`
        INSERT INTO canonical_refunds (
          tenant_id,refund_public_id,source_type,deposit_public_id,receipt_public_id,
          tender_public_id,allocation_public_id,payment_reversal_public_id,
          amount_minor,tender_type,method_code,status,refunded_at_utc,business_date,
          reversed_at_utc,source_available_before_minor,source_available_after_minor,
          liability_guard,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,'deposit',?,NULL,NULL,NULL,NULL,?,?,?,'posted',?,?,NULL,?,?,1,?,?,?)
      `).bind(
        tenantId, refundId, fragment.deposit.deposit_public_id,
        fragment.amountMinor, fragment.deposit.tender_type, fragment.deposit.method_code,
        occurredAt, businessDate(row.created_at, occurredAt), before, after,
        evidence, nowUtc, nowUtc,
      ),
      db.prepare(`
        UPDATE canonical_deposits
        SET refunded_minor=refunded_minor+?,available_minor=available_minor-?,updated_at_utc=?
        WHERE tenant_id=? AND deposit_public_id=? AND status='posted' AND available_minor=?
      `).bind(
        fragment.amountMinor, fragment.amountMinor, nowUtc,
        tenantId, fragment.deposit.deposit_public_id, before,
      ),
      mappingStatement(
        db, tenantId, 'refund', refundId,
        SOURCE_LIFECYCLE, sourceFragment, evidence, nowUtc,
      ),
    );
  }
  const parentId = await createDeterministicSourceId('dlt', tenantId, SOURCE_LIFECYCLE, String(row.id));
  statements.push(
    mappingStatement(
      db, tenantId, 'deposit_lifecycle_transaction', parentId,
      SOURCE_LIFECYCLE, String(row.id), evidence, nowUtc,
    ),
    resolveLegacyIssue(db, tenantId, String(row.id), nowUtc),
  );
  await db.batch(statements);
  return fragments.length;
}

export async function backfillDepositLifecycle(
  db: DepositLifecycleDatabase,
  options: DepositLifecycleOptions,
): Promise<DepositLifecycleResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const currencyCode = exactCurrency(options.currencyCode);
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const rows = (await db.prepare(`
    SELECT id,patient_id,deposit_receipt_no,amount,transaction_type,payment_method,
           remarks,reference_bill_id,counter_id,counter_session_id,is_active,
           created_by,created_at,updated_at
    FROM billing_deposits
    WHERE CAST(tenant_id AS TEXT)=? AND COALESCE(is_active,1)=1
    ORDER BY COALESCE(created_at,''),id
  `).bind(tenantId).all<DepositRow>()).results;

  const deposits = await createDeposits(db, tenantId, currencyCode, nowUtc, rows);
  let applicationsCreated = 0;
  let refundsCreated = 0;
  let transactionsMapped = 0;
  let reused = deposits.reused;

  for (const row of rows) {
    const type = row.transaction_type.trim().toLowerCase();
    if (type !== 'adjustment' && type !== 'refund') continue;
    const sourceId = String(row.id);
    const evidence = await sourceEvidence(row);
    const prior = await existingMapping(
      db, tenantId, 'deposit_lifecycle_transaction', SOURCE_LIFECYCLE, sourceId,
    );
    if (prior) {
      if (prior.mapping_status !== 'mapped' || !prior.canonical_public_id || prior.evidence_sha256 !== evidence) {
        throw new Error(`Deposit lifecycle evidence drift detected for source ${sourceId}`);
      }
      reused += 1;
      continue;
    }
    if (type === 'adjustment') applicationsCreated += await processAdjustment(
      db, tenantId, currencyCode, nowUtc, row, evidence,
    );
    else refundsCreated += await processRefund(db, tenantId, nowUtc, row, evidence);
    transactionsMapped += 1;
  }

  return {
    completed: true,
    depositsCreated: deposits.created,
    applicationsCreated,
    refundsCreated,
    transactionsMapped,
    reused,
  };
}
