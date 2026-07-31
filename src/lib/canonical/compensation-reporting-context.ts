import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from './command-batch';
import { createSourceEvidenceSha256 } from './source-mapping';

export interface CanonicalCompensationReportingContextInput {
  sourceKind: string;
  incentiveType?: string | null;
  legacyInvoiceItemId?: number | null;
  legacyLabOrderItemId?: number | null;
  detailName?: string | null;
  sourceReference?: string | null;
  waiverReason?: string | null;
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function optionalText(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return requiredText(value, label);
}

function positiveIntegerOrNull(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export async function buildCanonicalCompensationReportingContextStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    accrualPublicId: string;
    legacyBillId: number | null;
    doctorWaiverMinor: number;
    context: CanonicalCompensationReportingContextInput;
  },
): Promise<CanonicalPreparedStatement> {
  const tenantId = requiredText(input.tenantId, 'tenantId');
  const accrualPublicId = requiredText(input.accrualPublicId, 'accrualPublicId');
  const legacyBillId = positiveIntegerOrNull(input.legacyBillId, 'legacyBillId');
  const doctorWaiverMinor = nonnegativeInteger(input.doctorWaiverMinor, 'doctorWaiverMinor');
  const sourceKind = requiredText(input.context.sourceKind, 'reportingContext.sourceKind');
  const incentiveType = optionalText(input.context.incentiveType, 'reportingContext.incentiveType');
  const legacyInvoiceItemId = positiveIntegerOrNull(
    input.context.legacyInvoiceItemId,
    'reportingContext.legacyInvoiceItemId',
  );
  const legacyLabOrderItemId = positiveIntegerOrNull(
    input.context.legacyLabOrderItemId,
    'reportingContext.legacyLabOrderItemId',
  );
  const detailName = optionalText(input.context.detailName, 'reportingContext.detailName');
  const sourceReference = optionalText(input.context.sourceReference, 'reportingContext.sourceReference');
  const waiverReason = optionalText(input.context.waiverReason, 'reportingContext.waiverReason');
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'canonical_compensation_reporting_context',
    accrualPublicId,
    sourceKind,
    incentiveType,
    legacyBillId,
    legacyInvoiceItemId,
    legacyLabOrderItemId,
    detailName,
    sourceReference,
    waiverReason,
    doctorWaiverMinor,
  });

  return db.prepare(`
    INSERT INTO canonical_compensation_reporting_context (
      tenant_id,accrual_public_id,source_kind,incentive_type,legacy_bill_id,
      legacy_invoice_item_id,legacy_lab_order_item_id,detail_name,source_reference,
      waiver_reason,doctor_waiver_minor,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    tenantId,
    accrualPublicId,
    sourceKind,
    incentiveType,
    legacyBillId,
    legacyInvoiceItemId,
    legacyLabOrderItemId,
    detailName,
    sourceReference,
    waiverReason,
    doctorWaiverMinor,
    sourceEvidenceSha256,
  );
}
