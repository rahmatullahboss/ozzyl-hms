import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface BillPaidResidualPreparedStatement {
  bind(...values: unknown[]): BillPaidResidualPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface BillPaidResidualDatabase {
  prepare(sql: string): BillPaidResidualPreparedStatement;
  batch(statements: BillPaidResidualPreparedStatement[]): Promise<unknown[]>;
}

export interface BillPaidResidualOptions {
  tenantId: string;
  currencyCode: string;
  nowUtc?: string;
}

export interface BillPaidResidualResult {
  completed: true;
  billsScanned: number;
  residualReceiptsCreated: number;
  residualAllocationsCreated: number;
  staleDueClassifications: number;
  reused: number;
}

interface BillAuthorityRow {
  id: number;
  patient_id: number;
  invoice_no: string | null;
  invoice_code: string | null;
  total: number;
  paid: number | null;
  paid_amount: number | null;
  due: number | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  invoice_public_id: string;
  invoice_number: string;
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  net_due_minor: number;
  invoice_status: string;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}

export const SOURCE_BILL_PAID_RESIDUAL = 'legacy_bill_paid_residual';

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

function exactMinor(value: number | null, label: string): number {
  const major = value ?? 0;
  if (!Number.isFinite(major) || major < 0) throw new RangeError(`${label} must be non-negative`);
  const minor = toMinorUnits(String(major));
  if (minor < 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} is unsafe`);
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

async function evidence(
  row: BillAuthorityRow,
  targetPaidMinor: number,
  targetDueMinor: number,
): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_BILL_PAID_RESIDUAL,
    sourcePublicId: String(row.id),
    invoiceNumber: row.invoice_no ?? row.invoice_code,
    patientId: row.patient_id,
    totalMajor: row.total,
    paidMajor: row.paid,
    paidAmountMajor: row.paid_amount,
    dueMajor: row.due,
    status: row.status,
    createdAt: row.created_at,
    targetPaidMinor,
    targetDueMinor,
  });
}

async function existingMapping(
  db: BillPaidResidualDatabase,
  tenantId: string,
  sourceId: string,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='bill_balance_authority'
      AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(tenantId, SOURCE_BILL_PAID_RESIDUAL, sourceId).first<MappingRow>();
}

function mappingStatement(
  db: BillPaidResidualDatabase,
  tenantId: string,
  entityType: string,
  canonicalId: string,
  sourceId: string,
  evidenceSha256: string,
  nowUtc: string,
): BillPaidResidualPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,'bills','mapped',1,?,?,?)
  `).bind(
    tenantId, entityType, canonicalId, SOURCE_BILL_PAID_RESIDUAL, sourceId,
    evidenceSha256, nowUtc, nowUtc,
  );
}

async function staleDueIssue(
  db: BillPaidResidualDatabase,
  tenantId: string,
  row: BillAuthorityRow,
  targetDueMinor: number,
  evidenceSha256: string,
  nowUtc: string,
): Promise<BillPaidResidualPreparedStatement> {
  const issueId = await createDeterministicSourceId(
    'issue', tenantId, SOURCE_BILL_PAID_RESIDUAL, `${row.id}:stale-due`,
  );
  return db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,issue_type,issue_code,entity_type,entity_public_id,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,
      summary,details_json,first_seen_at_utc,last_seen_at_utc,resolved_at_utc,
      resolved_by_public_id,resolution_code,created_at_utc,updated_at_utc
    ) VALUES (?,?, 'bill_balance_reconciliation',
      'LEGACY_DUE_STALE_AGAINST_VERIFIED_PAYMENT','invoice',?,?,?,?,'info','resolved',1,
      'Verified payment authority exceeds the stale legacy due header.',?, ?,?,?,
      'canonical-backfill','VERIFIED_PAYMENT_AUTHORITY_PRESERVED',?,?)
  `).bind(
    tenantId, issueId, row.invoice_public_id, SOURCE_BILL_PAID_RESIDUAL,
    String(row.id), evidenceSha256,
    JSON.stringify({
      legacyDueMinor: exactMinor(row.due, 'legacy due'),
      canonicalDueMinor: targetDueMinor,
    }),
    nowUtc, nowUtc, nowUtc, nowUtc, nowUtc,
  );
}

export async function backfillBillPaidResiduals(
  db: BillPaidResidualDatabase,
  options: BillPaidResidualOptions,
): Promise<BillPaidResidualResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const currencyCode = exactCurrency(options.currencyCode);
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const rows = (await db.prepare(`
    SELECT b.id,b.patient_id,b.invoice_no,b.invoice_code,b.total,b.paid,b.paid_amount,
           b.due,b.status,b.created_at,b.updated_at,
           i.invoice_public_id,i.invoice_number,i.legacy_patient_id,i.currency_code,
           i.total_minor,i.paid_minor,i.due_minor,i.net_due_minor,i.status AS invoice_status
    FROM bills b
    JOIN canonical_source_mappings m
      ON m.tenant_id=? AND m.entity_type='invoice' AND m.source_type='legacy_bill'
      AND m.source_public_id=CAST(b.id AS TEXT) AND m.mapping_status='mapped'
    JOIN canonical_invoices i
      ON i.tenant_id=m.tenant_id AND i.invoice_public_id=m.canonical_public_id
    WHERE CAST(b.tenant_id AS TEXT)=?
    ORDER BY b.id
  `).bind(tenantId, tenantId).all<BillAuthorityRow>()).results;

  let residualReceiptsCreated = 0;
  let residualAllocationsCreated = 0;
  let staleDueClassifications = 0;
  let reused = 0;

  for (const row of rows) {
    if (
      row.invoice_status !== 'posted'
      || row.legacy_patient_id !== row.patient_id
      || row.currency_code !== currencyCode
    ) {
      throw new Error(`Bill balance authority mismatch for bill ${row.id}`);
    }
    const legacyTotalMinor = exactMinor(row.total, 'legacy total');
    const legacyDueMinor = exactMinor(row.due, 'legacy due');
    if (legacyTotalMinor !== row.total_minor || legacyDueMinor > legacyTotalMinor) {
      throw new Error(`Bill total authority mismatch for bill ${row.id}`);
    }
    const targetPaidMinor = Math.max(legacyTotalMinor - legacyDueMinor, row.paid_minor);
    if (targetPaidMinor > legacyTotalMinor) throw new Error(`Verified payment exceeds bill total for bill ${row.id}`);
    const targetDueMinor = legacyTotalMinor - targetPaidMinor;
    const sourceId = String(row.id);
    const sourceEvidence = await evidence(row, targetPaidMinor, targetDueMinor);
    const authorityId = await createDeterministicSourceId(
      'bba', tenantId, SOURCE_BILL_PAID_RESIDUAL, sourceId,
    );
    const prior = await existingMapping(db, tenantId, sourceId);
    if (prior) {
      const canonicalAuthorityMatches = row.paid_minor === targetPaidMinor
        && row.due_minor === targetDueMinor
        && row.net_due_minor === targetDueMinor;
      if (
        prior.mapping_status !== 'mapped'
        || prior.canonical_public_id !== authorityId
        || (prior.evidence_sha256 !== sourceEvidence && !canonicalAuthorityMatches)
      ) {
        throw new Error(`Bill balance evidence drift detected for bill ${row.id}`);
      }
      reused += 1;
      continue;
    }

    const residualMinor = targetPaidMinor - row.paid_minor;
    if (residualMinor < 0 || residualMinor > row.due_minor || residualMinor > row.net_due_minor) {
      throw new Error(`Bill residual cannot be safely allocated for bill ${row.id}`);
    }
    const statements: BillPaidResidualPreparedStatement[] = [];

    if (residualMinor > 0) {
      const receiptId = await createDeterministicSourceId(
        'payrcpt', tenantId, SOURCE_BILL_PAID_RESIDUAL, sourceId,
      );
      const tenderId = await createDeterministicSourceId(
        'paytnd', tenantId, SOURCE_BILL_PAID_RESIDUAL, sourceId,
      );
      const allocationId = await createDeterministicSourceId(
        'payall', tenantId, SOURCE_BILL_PAID_RESIDUAL, sourceId,
      );
      const receivedAt = legacyUtc(row.updated_at ?? row.created_at, nowUtc);
      const receiptNumber = `HIST-${row.invoice_number}`;
      statements.push(
        db.prepare(`
          INSERT INTO canonical_payment_receipts (
            tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
            total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
            business_date,external_transaction_id,posted_at_utc,failed_at_utc,reversed_at_utc,
            reconciliation_guard,source_evidence_sha256,refunded_minor,net_received_minor,
            refund_projection_guard,created_at_utc,updated_at_utc
          ) VALUES (?,?,?,?,?,?,?,0,'posted',?,?,NULL,?,NULL,NULL,1,?,0,?,1,?,?)
        `).bind(
          tenantId, receiptId, receiptNumber, row.patient_id, currencyCode,
          residualMinor, residualMinor, receivedAt,
          businessDate(row.updated_at ?? row.created_at, receivedAt), receivedAt,
          sourceEvidence, residualMinor, nowUtc, nowUtc,
        ),
        db.prepare(`
          INSERT INTO canonical_payment_tenders (
            tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
            amount_minor,status,external_transaction_id,captured_at_utc,failed_at_utc,
            reversed_at_utc,source_evidence_sha256,reversed_minor,remaining_minor,
            reversal_projection_guard,created_at_utc,updated_at_utc
          ) VALUES (?,?,?,'other','legacy_bill_balance',?,'captured',NULL,?,NULL,NULL,?,0,?,1,?,?)
        `).bind(
          tenantId, tenderId, receiptId, residualMinor, receivedAt,
          sourceEvidence, residualMinor, nowUtc, nowUtc,
        ),
        db.prepare(`
          INSERT INTO canonical_payment_allocations (
            tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
            invoice_line_public_id,amount_minor,invoice_due_before_minor,
            invoice_due_after_minor,status,allocated_at_utc,reversed_at_utc,
            balance_guard,source_evidence_sha256,reversed_minor,remaining_minor,
            reversal_projection_guard,created_at_utc,updated_at_utc
          ) VALUES (?,?,?,?,NULL,?,?,?,'active',?,NULL,1,?,0,?,1,?,?)
        `).bind(
          tenantId, allocationId, receiptId, row.invoice_public_id,
          residualMinor, row.due_minor, row.due_minor - residualMinor,
          receivedAt, sourceEvidence, residualMinor, nowUtc, nowUtc,
        ),
        db.prepare(`
          UPDATE canonical_invoices
          SET paid_minor=?,due_minor=?,net_due_minor=?,updated_at_utc=?
          WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
            AND paid_minor=? AND due_minor=? AND net_due_minor=?
        `).bind(
          targetPaidMinor, targetDueMinor, targetDueMinor, nowUtc,
          tenantId, row.invoice_public_id,
          row.paid_minor, row.due_minor, row.net_due_minor,
        ),
        mappingStatement(db, tenantId, 'payment_receipt', receiptId, sourceId, sourceEvidence, nowUtc),
        mappingStatement(db, tenantId, 'payment_tender', tenderId, sourceId, sourceEvidence, nowUtc),
        mappingStatement(db, tenantId, 'payment_allocation', allocationId, sourceId, sourceEvidence, nowUtc),
      );
      residualReceiptsCreated += 1;
      residualAllocationsCreated += 1;
    }

    if (targetDueMinor !== legacyDueMinor) {
      statements.push(await staleDueIssue(
        db, tenantId, row, targetDueMinor, sourceEvidence, nowUtc,
      ));
      staleDueClassifications += 1;
    }
    statements.push(mappingStatement(
      db, tenantId, 'bill_balance_authority', authorityId,
      sourceId, sourceEvidence, nowUtc,
    ));
    await db.batch(statements);
  }

  return {
    completed: true,
    billsScanned: rows.length,
    residualReceiptsCreated,
    residualAllocationsCreated,
    staleDueClassifications,
    reused,
  };
}
