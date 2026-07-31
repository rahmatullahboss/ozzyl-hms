import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface DepositReceiptPreparedStatement {
  bind(...values: unknown[]): DepositReceiptPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface DepositReceiptBackfillDatabase {
  prepare(sql: string): DepositReceiptPreparedStatement;
  batch(statements: DepositReceiptPreparedStatement[]): Promise<unknown[]>;
}

export interface DepositReceiptBackfillOptions {
  tenantId: string;
  currencyCode: string;
  nowUtc?: string;
}

export interface DepositReceiptBackfillResult {
  completed: true;
  scanned: number;
  receiptsCreated: number;
  tendersCreated: number;
  reused: number;
  skipped: number;
  ambiguous: number;
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

export const SOURCE_DEPOSIT_RECEIPT = 'legacy_billing_deposit';

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value) throw new TypeError(`${label} is invalid`);
  return value;
}

function currency(value: string): string {
  exact(value, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(value)) throw new TypeError('currencyCode must be three uppercase letters');
  return value;
}

function exactMinor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('Deposit amount must be positive');
  const minor = toMinorUnits(String(value));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Deposit amount is unsafe');
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

function tender(value: string | null): {
  type: 'cash' | 'card' | 'mobile_wallet' | 'bank_transfer' | 'gateway' | 'other';
  method: string;
} | null {
  const method = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!method || method === 'cash') return { type: 'cash', method: 'cash' };
  if (['card', 'credit_card', 'debit_card'].includes(method)) return { type: 'card', method };
  if (['mobile', 'mobile_banking', 'mobile_wallet', 'bkash', 'nagad', 'rocket'].includes(method)) {
    return { type: 'mobile_wallet', method };
  }
  if (['bank', 'bank_transfer'].includes(method)) return { type: 'bank_transfer', method };
  if (['gateway', 'online'].includes(method)) return { type: 'gateway', method };
  if (method === 'other') return { type: 'other', method };
  return null;
}

async function evidence(row: DepositRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_DEPOSIT_RECEIPT,
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

function mappingStatement(
  db: DepositReceiptBackfillDatabase,
  tenantId: string,
  entityType: 'payment_receipt' | 'payment_tender',
  canonicalId: string,
  sourceId: string,
  evidenceSha256: string,
  nowUtc: string,
): DepositReceiptPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,'billing_deposits','mapped',1,?,?,?)
  `).bind(
    tenantId, entityType, canonicalId, SOURCE_DEPOSIT_RECEIPT, sourceId,
    evidenceSha256, nowUtc, nowUtc,
  );
}

export async function backfillDepositReceipts(
  db: DepositReceiptBackfillDatabase,
  options: DepositReceiptBackfillOptions,
): Promise<DepositReceiptBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const currencyCode = currency(options.currencyCode);
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const rows = (await db.prepare(`
    SELECT id,patient_id,deposit_receipt_no,amount,transaction_type,payment_method,
           remarks,reference_bill_id,counter_id,counter_session_id,is_active,
           created_by,created_at,updated_at
    FROM billing_deposits
    WHERE CAST(tenant_id AS TEXT)=?
    ORDER BY id
  `).bind(tenantId).all<DepositRow>()).results;
  const duplicateReceipts = new Set(
    (await db.prepare(`
      SELECT deposit_receipt_no
      FROM billing_deposits
      WHERE CAST(tenant_id AS TEXT)=? AND lower(COALESCE(transaction_type,''))='deposit'
        AND COALESCE(is_active,1)=1
      GROUP BY deposit_receipt_no HAVING COUNT(*)>1
    `).bind(tenantId).all<{ deposit_receipt_no: string }>()).results
      .map((row) => row.deposit_receipt_no),
  );

  let receiptsCreated = 0;
  let tendersCreated = 0;
  let reused = 0;
  let skipped = 0;
  let ambiguous = 0;

  for (const row of rows) {
    if ((row.transaction_type ?? '').trim().toLowerCase() !== 'deposit' || row.is_active === 0) {
      skipped += 1;
      continue;
    }
    const receiptNumber = row.deposit_receipt_no?.trim();
    if (!receiptNumber || duplicateReceipts.has(row.deposit_receipt_no)) {
      ambiguous += 1;
      continue;
    }
    let amountMinor: number;
    const resolvedTender = tender(row.payment_method);
    try {
      amountMinor = exactMinor(row.amount);
      if (!resolvedTender || !Number.isSafeInteger(row.patient_id) || row.patient_id <= 0) throw new Error();
    } catch {
      skipped += 1;
      continue;
    }
    const sourceId = String(row.id);
    const sourceEvidence = await evidence(row);
    const prior = await db.prepare(`
      SELECT canonical_public_id,mapping_status,evidence_sha256
      FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='payment_receipt'
        AND source_type=? AND source_public_id=? LIMIT 1
    `).bind(tenantId, SOURCE_DEPOSIT_RECEIPT, sourceId).first<MappingRow>();
    if (prior) {
      if (prior.mapping_status !== 'mapped' || !prior.canonical_public_id || prior.evidence_sha256 !== sourceEvidence) {
        throw new Error(`Deposit receipt evidence drift detected for source ${sourceId}`);
      }
      reused += 1;
      continue;
    }

    const receiptId = await createDeterministicSourceId('payrcpt', tenantId, SOURCE_DEPOSIT_RECEIPT, sourceId);
    const tenderId = await createDeterministicSourceId('paytnd', tenantId, SOURCE_DEPOSIT_RECEIPT, sourceId);
    const receivedAt = legacyUtc(row.created_at, nowUtc);
    await db.batch([
      db.prepare(`
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,legacy_collector_id,legacy_counter_id,legacy_counter_session_id,
          external_transaction_id,posted_at_utc,failed_at_utc,reversed_at_utc,
          reconciliation_guard,source_evidence_sha256,refunded_minor,net_received_minor,
          refund_projection_guard,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,0,?,'posted',?,?,?,?,?,NULL,?,NULL,NULL,1,?,0,?,1,?,?)
      `).bind(
        tenantId, receiptId, receiptNumber, row.patient_id, currencyCode,
        amountMinor, amountMinor, receivedAt, businessDate(row.created_at, receivedAt),
        row.created_by, row.counter_id, row.counter_session_id, receivedAt,
        sourceEvidence, amountMinor, nowUtc, nowUtc,
      ),
      db.prepare(`
        INSERT INTO canonical_payment_tenders (
          tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
          amount_minor,status,external_transaction_id,captured_at_utc,failed_at_utc,
          reversed_at_utc,source_evidence_sha256,reversed_minor,remaining_minor,
          reversal_projection_guard,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,'captured',NULL,?,NULL,NULL,?,0,?,1,?,?)
      `).bind(
        tenantId, tenderId, receiptId, resolvedTender.type, resolvedTender.method,
        amountMinor, receivedAt, sourceEvidence, amountMinor, nowUtc, nowUtc,
      ),
      mappingStatement(db, tenantId, 'payment_receipt', receiptId, sourceId, sourceEvidence, nowUtc),
      mappingStatement(db, tenantId, 'payment_tender', tenderId, sourceId, sourceEvidence, nowUtc),
    ]);
    receiptsCreated += 1;
    tendersCreated += 1;
  }

  return {
    completed: true,
    scanned: rows.length,
    receiptsCreated,
    tendersCreated,
    reused,
    skipped,
    ambiguous,
  };
}
