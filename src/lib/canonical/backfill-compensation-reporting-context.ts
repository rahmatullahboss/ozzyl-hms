import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from './command-batch';
import { buildCanonicalCompensationReportingContextStatement } from './compensation-reporting-context';
import { toMinorUnits } from './money';

interface QueryPreparedStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): QueryPreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface CanonicalCompensationReportingContextBackfillInput {
  tenantId: string;
  maxRows?: number;
}

export interface CanonicalCompensationReportingContextBackfillResult {
  doctorContextsCreated: number;
  performerContextsCreated: number;
  totalContextsCreated: number;
  remainingActiveAccrualsWithoutContext: number;
}

type DoctorContextRow = {
  accrual_public_id: string;
  earned_minor: number | string;
  source_kind: string;
  incentive_type: string | null;
  legacy_bill_id: number | string | null;
  legacy_invoice_item_id: number | string | null;
  legacy_lab_order_item_id: number | string | null;
  detail_name: string | null;
  source_reference: string | null;
  waiver_reason: string | null;
  doctor_waiver_amount: number | string | null;
};

type PerformerContextRow = {
  accrual_public_id: string;
  earned_minor: number | string;
  legacy_bill_id: number | string;
  legacy_invoice_item_id: number | string;
  detail_name: string | null;
  source_reference: string | null;
};

type CountRow = { count: number | string };

const DOCTOR_CONTEXT_SQL = `
  SELECT DISTINCT
    accrual.accrual_public_id,
    accrual.earned_minor,
    legacy.source_type AS source_kind,
    legacy.incentive_type,
    legacy.bill_id AS legacy_bill_id,
    invoice_item.id AS legacy_invoice_item_id,
    legacy.lab_order_item_id AS legacy_lab_order_item_id,
    COALESCE(
      NULLIF(TRIM(lab_item.test_name), ''),
      NULLIF(TRIM(invoice_item.description), ''),
      NULLIF(TRIM(legacy.source_type), '')
    ) AS detail_name,
    NULLIF(TRIM(bill.invoice_no), '') AS source_reference,
    NULLIF(TRIM(legacy.waiver_reason), '') AS waiver_reason,
    COALESCE(legacy.doctor_waiver_amount, 0) AS doctor_waiver_amount
  FROM canonical_compensation_accruals accrual
  JOIN canonical_source_mappings mapping
    ON mapping.tenant_id=accrual.tenant_id
   AND mapping.entity_type='compensation_accrual'
   AND mapping.canonical_public_id=accrual.accrual_public_id
   AND mapping.source_type='legacy_doctor_commission_accrual'
   AND mapping.mapping_status='mapped'
  JOIN doctor_commission_accruals legacy
    ON CAST(legacy.tenant_id AS TEXT)=accrual.tenant_id
   AND (
     legacy.canonical_source_key=mapping.source_public_id
     OR CAST(legacy.id AS TEXT)=mapping.source_public_id
   )
  LEFT JOIN canonical_compensation_reporting_context existing
    ON existing.tenant_id=accrual.tenant_id
   AND existing.accrual_public_id=accrual.accrual_public_id
  LEFT JOIN bills bill
    ON CAST(bill.tenant_id AS TEXT)=accrual.tenant_id
   AND bill.id=legacy.bill_id
  LEFT JOIN lab_order_items lab_item
    ON CAST(lab_item.tenant_id AS TEXT)=accrual.tenant_id
   AND lab_item.id=legacy.lab_order_item_id
  LEFT JOIN invoice_items invoice_item
    ON invoice_item.id=(
      SELECT candidate.id
      FROM invoice_items candidate
      WHERE CAST(candidate.tenant_id AS TEXT)=accrual.tenant_id
        AND candidate.bill_id=legacy.bill_id
        AND COALESCE(candidate.status,'active') <> 'cancelled'
        AND (
          (legacy.lab_order_item_id IS NOT NULL AND candidate.reference_id=legacy.lab_order_item_id)
          OR (legacy.lab_order_item_id IS NULL AND legacy.lab_test_id IS NOT NULL AND candidate.reference_id=legacy.lab_test_id)
          OR (legacy.lab_order_item_id IS NULL AND legacy.lab_test_id IS NULL)
        )
      ORDER BY candidate.id ASC
      LIMIT 1
    )
  WHERE accrual.tenant_id=?
    AND existing.id IS NULL
  ORDER BY accrual.id ASC
  LIMIT ?
`;

const PERFORMER_CONTEXT_SQL = `
  SELECT DISTINCT
    accrual.accrual_public_id,
    accrual.earned_minor,
    legacy.bill_id AS legacy_bill_id,
    legacy.invoice_item_id AS legacy_invoice_item_id,
    COALESCE(NULLIF(TRIM(legacy.test_name), ''), 'Diagnostic Service') AS detail_name,
    NULLIF(TRIM(bill.invoice_no), '') AS source_reference
  FROM canonical_compensation_accruals accrual
  JOIN canonical_source_mappings mapping
    ON mapping.tenant_id=accrual.tenant_id
   AND mapping.entity_type='compensation_accrual'
   AND mapping.canonical_public_id=accrual.accrual_public_id
   AND mapping.source_type='legacy_diagnostic_performer_reserve'
   AND mapping.mapping_status='mapped'
  JOIN diagnostic_performer_reserves legacy
    ON CAST(legacy.tenant_id AS TEXT)=accrual.tenant_id
   AND (
     legacy.canonical_source_key=mapping.source_public_id
     OR CAST(legacy.id AS TEXT)=mapping.source_public_id
   )
  LEFT JOIN canonical_compensation_reporting_context existing
    ON existing.tenant_id=accrual.tenant_id
   AND existing.accrual_public_id=accrual.accrual_public_id
  LEFT JOIN bills bill
    ON CAST(bill.tenant_id AS TEXT)=accrual.tenant_id
   AND bill.id=legacy.bill_id
  WHERE accrual.tenant_id=?
    AND existing.id IS NULL
    AND legacy.status <> 'cancelled'
  ORDER BY accrual.id ASC
  LIMIT ?
`;

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function boundedRows(value: number | undefined): number {
  const maxRows = value ?? 1_000;
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0 || maxRows > 10_000) {
    throw new RangeError('maxRows must be a positive integer no greater than 10000');
  }
  return maxRows;
}

function positiveIntegerOrNull(value: unknown, label: string): number | null {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return number;
}

function nonnegativeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return number;
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

async function rows<T>(
  db: CanonicalBatchDatabase,
  sql: string,
  tenantId: string,
  limit: number,
): Promise<T[]> {
  const statement = db.prepare(sql) as QueryPreparedStatement;
  const result = await statement.bind(tenantId, limit).all<T>();
  return result.results ?? [];
}

function dedupeByAccrual<T extends { accrual_public_id: string }>(
  candidates: T[],
  label: string,
): T[] {
  const unique = new Map<string, T>();
  for (const candidate of candidates) {
    const accrualPublicId = exact(candidate.accrual_public_id, `${label}.accrualPublicId`);
    const existing = unique.get(accrualPublicId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) {
      throw new Error(`Conflicting ${label} source rows for canonical accrual ${accrualPublicId}`);
    }
    unique.set(accrualPublicId, candidate);
  }
  return Array.from(unique.values());
}

export async function countActiveCanonicalCompensationAccrualsWithoutReportingContext(
  db: CanonicalBatchDatabase,
  tenantIdInput: string,
): Promise<number> {
  const tenantId = exact(tenantIdInput, 'tenantId');
  const row = await db.prepare(`
    SELECT COUNT(*) count
    FROM canonical_compensation_accruals accrual
    LEFT JOIN canonical_compensation_reporting_context context
      ON context.tenant_id=accrual.tenant_id
     AND context.accrual_public_id=accrual.accrual_public_id
    WHERE accrual.tenant_id=?
      AND accrual.status <> 'reversed'
      AND context.id IS NULL
  `).bind(tenantId).first<CountRow>();
  return nonnegativeInteger(row?.count ?? 0, 'missing reporting context count');
}

export async function backfillCanonicalCompensationReportingContext(
  db: CanonicalBatchDatabase,
  input: CanonicalCompensationReportingContextBackfillInput,
): Promise<CanonicalCompensationReportingContextBackfillResult> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const maxRows = boundedRows(input.maxRows);
  const doctorCandidates = dedupeByAccrual(
    await rows<DoctorContextRow>(db, DOCTOR_CONTEXT_SQL, tenantId, maxRows),
    'doctor compensation',
  );
  const remaining = Math.max(0, maxRows - doctorCandidates.length);
  const performerCandidates = remaining === 0
    ? []
    : dedupeByAccrual(
      await rows<PerformerContextRow>(db, PERFORMER_CONTEXT_SQL, tenantId, remaining),
      'performer reserve',
    );

  const doctorStatements: CanonicalPreparedStatement[] = [];
  for (const candidate of doctorCandidates) {
    const earnedMinor = nonnegativeInteger(candidate.earned_minor, 'canonical earned amount');
    const doctorWaiverMinor = Number(toMinorUnits(String(candidate.doctor_waiver_amount ?? 0)));
    if (doctorWaiverMinor > earnedMinor) {
      throw new Error(
        `Legacy doctor waiver exceeds canonical earned commission for ${candidate.accrual_public_id}`,
      );
    }
    doctorStatements.push(await buildCanonicalCompensationReportingContextStatement(db, {
      tenantId,
      accrualPublicId: candidate.accrual_public_id,
      legacyBillId: positiveIntegerOrNull(candidate.legacy_bill_id, 'legacyBillId'),
      doctorWaiverMinor,
      context: {
        sourceKind: exact(candidate.source_kind, 'sourceKind'),
        incentiveType: optionalText(candidate.incentive_type),
        legacyInvoiceItemId: positiveIntegerOrNull(
          candidate.legacy_invoice_item_id,
          'legacyInvoiceItemId',
        ),
        legacyLabOrderItemId: positiveIntegerOrNull(
          candidate.legacy_lab_order_item_id,
          'legacyLabOrderItemId',
        ),
        detailName: optionalText(candidate.detail_name),
        sourceReference: optionalText(candidate.source_reference),
        waiverReason: optionalText(candidate.waiver_reason),
      },
    }));
  }

  const performerStatements: CanonicalPreparedStatement[] = [];
  for (const candidate of performerCandidates) {
    nonnegativeInteger(candidate.earned_minor, 'canonical earned amount');
    performerStatements.push(await buildCanonicalCompensationReportingContextStatement(db, {
      tenantId,
      accrualPublicId: candidate.accrual_public_id,
      legacyBillId: positiveIntegerOrNull(candidate.legacy_bill_id, 'legacyBillId'),
      doctorWaiverMinor: 0,
      context: {
        sourceKind: 'performer_reserve',
        incentiveType: 'performer',
        legacyInvoiceItemId: positiveIntegerOrNull(
          candidate.legacy_invoice_item_id,
          'legacyInvoiceItemId',
        ),
        detailName: optionalText(candidate.detail_name),
        sourceReference: optionalText(candidate.source_reference),
      },
    }));
  }

  if (doctorStatements.length > 0) await db.batch(doctorStatements);
  if (performerStatements.length > 0) await db.batch(performerStatements);
  const remainingActiveAccrualsWithoutContext =
    await countActiveCanonicalCompensationAccrualsWithoutReportingContext(db, tenantId);

  return {
    doctorContextsCreated: doctorStatements.length,
    performerContextsCreated: performerStatements.length,
    totalContextsCreated: doctorStatements.length + performerStatements.length,
    remainingActiveAccrualsWithoutContext,
  };
}
