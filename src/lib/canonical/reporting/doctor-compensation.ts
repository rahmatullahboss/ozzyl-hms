import {
  addCurrencyAmount,
  addSafe,
  all,
  exact,
  reportingRange,
  safeNonNegativeInteger,
  type CanonicalReportingDatabase,
  type CanonicalReportingPreparedStatement,
} from './common';

export type CanonicalDoctorCompensationPreparedStatement = CanonicalReportingPreparedStatement;
export type CanonicalDoctorCompensationDatabase = CanonicalReportingDatabase;

export type CanonicalDoctorCompensationRole =
  | 'performing'
  | 'referring'
  | 'prescribing'
  | 'reporting';

export interface CanonicalDoctorCompensationInput {
  tenantId: string;
  startDate: string;
  endDate: string;
}

export interface CanonicalDoctorCompensationRow {
  practitionerPublicId: string;
  displayName: string;
  practitionerRole: CanonicalDoctorCompensationRole;
  currencyCode: string;
  accrualCount: number;
  outstandingCount: number;
  grossMinor: number;
  discountMinor: number;
  performerReserveMinor: number;
  eligibleBaseMinor: number;
  earnedMinor: number;
  adjustedMinor: number;
  settledMinor: number;
  payableMinor: number;
}

export interface CanonicalDoctorCompensationReport {
  rows: CanonicalDoctorCompensationRow[];
  summary: {
    practitionerCount: number;
    accrualCount: number;
    outstandingCount: number;
    earnedByCurrency: Record<string, number>;
    adjustedByCurrency: Record<string, number>;
    settledByCurrency: Record<string, number>;
    payableByCurrency: Record<string, number>;
  };
  queryContract: {
    dateBasis: 'compensation_business_date';
    sourceOfTruth: 'canonical_compensation_accruals';
    readOnly: true;
  };
}

interface SourceRow {
  practitioner_public_id: string;
  display_name: string;
  practitioner_role: string;
  currency_code: string;
  accrual_count: number;
  outstanding_count: number;
  gross_minor: number;
  discount_minor: number;
  performer_reserve_minor: number;
  eligible_base_minor: number;
  earned_minor: number;
  adjusted_minor: number;
  settled_minor: number;
  payable_minor: number;
}

function compensationRole(value: string): CanonicalDoctorCompensationRole {
  if (!['performing', 'referring', 'prescribing', 'reporting'].includes(value)) {
    throw new RangeError('Canonical compensation practitioner role is not supported');
  }
  return value as CanonicalDoctorCompensationRole;
}

export async function getCanonicalDoctorCompensation(
  db: CanonicalDoctorCompensationDatabase,
  input: CanonicalDoctorCompensationInput,
): Promise<CanonicalDoctorCompensationReport> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const range = reportingRange(input.startDate, input.endDate);
  const sourceRows = await all<SourceRow>(db.prepare(`
    SELECT
      c.practitioner_public_id,
      p.display_name,
      c.practitioner_role,
      c.currency_code,
      COUNT(*) accrual_count,
      SUM(CASE WHEN c.payable_minor>0 THEN 1 ELSE 0 END) outstanding_count,
      SUM(c.gross_minor) gross_minor,
      SUM(c.discount_minor) discount_minor,
      SUM(c.performer_reserve_minor) performer_reserve_minor,
      SUM(c.eligible_base_minor) eligible_base_minor,
      SUM(c.earned_minor) earned_minor,
      SUM(c.adjusted_minor) adjusted_minor,
      SUM(c.settled_minor) settled_minor,
      SUM(c.payable_minor) payable_minor
    FROM canonical_compensation_accruals c
    JOIN canonical_practitioners p
      ON p.tenant_id=c.tenant_id
     AND p.practitioner_public_id=c.practitioner_public_id
    WHERE c.tenant_id=?
      AND c.business_date>=?
      AND c.business_date<=?
      AND c.status NOT IN ('cancelled','reversed')
      AND c.practitioner_public_id IS NOT NULL
    GROUP BY
      c.practitioner_public_id,
      p.display_name,
      c.practitioner_role,
      c.currency_code
    ORDER BY payable_minor DESC,p.display_name,c.practitioner_public_id,c.practitioner_role,c.currency_code
  `).bind(tenantId, range.startDate, range.endDate));

  const rows: CanonicalDoctorCompensationRow[] = sourceRows.map((source) => ({
    practitionerPublicId: exact(source.practitioner_public_id, 'practitionerPublicId'),
    displayName: exact(source.display_name, 'displayName'),
    practitionerRole: compensationRole(source.practitioner_role),
    currencyCode: exact(source.currency_code, 'currencyCode'),
    accrualCount: safeNonNegativeInteger(source.accrual_count, 'compensation accrual count'),
    outstandingCount: safeNonNegativeInteger(source.outstanding_count, 'compensation outstanding count'),
    grossMinor: safeNonNegativeInteger(source.gross_minor, 'compensation gross amount'),
    discountMinor: safeNonNegativeInteger(source.discount_minor, 'compensation discount amount'),
    performerReserveMinor: safeNonNegativeInteger(source.performer_reserve_minor, 'compensation performer reserve'),
    eligibleBaseMinor: safeNonNegativeInteger(source.eligible_base_minor, 'compensation eligible base'),
    earnedMinor: safeNonNegativeInteger(source.earned_minor, 'compensation earned amount'),
    adjustedMinor: safeNonNegativeInteger(source.adjusted_minor, 'compensation adjusted amount'),
    settledMinor: safeNonNegativeInteger(source.settled_minor, 'compensation settled amount'),
    payableMinor: safeNonNegativeInteger(source.payable_minor, 'compensation payable amount'),
  }));

  const summary: CanonicalDoctorCompensationReport['summary'] = {
    practitionerCount: new Set(rows.map((row) => row.practitionerPublicId)).size,
    accrualCount: 0,
    outstandingCount: 0,
    earnedByCurrency: {},
    adjustedByCurrency: {},
    settledByCurrency: {},
    payableByCurrency: {},
  };
  for (const row of rows) {
    summary.accrualCount = addSafe(summary.accrualCount, row.accrualCount, 'doctor compensation accrual summary');
    summary.outstandingCount = addSafe(
      summary.outstandingCount,
      row.outstandingCount,
      'doctor compensation outstanding summary',
    );
    addCurrencyAmount(summary.earnedByCurrency, row.currencyCode, row.earnedMinor, 'doctor compensation earned summary');
    addCurrencyAmount(summary.adjustedByCurrency, row.currencyCode, row.adjustedMinor, 'doctor compensation adjusted summary');
    addCurrencyAmount(summary.settledByCurrency, row.currencyCode, row.settledMinor, 'doctor compensation settled summary');
    addCurrencyAmount(summary.payableByCurrency, row.currencyCode, row.payableMinor, 'doctor compensation payable summary');
  }

  return {
    rows,
    summary,
    queryContract: {
      dateBasis: 'compensation_business_date',
      sourceOfTruth: 'canonical_compensation_accruals',
      readOnly: true,
    },
  };
}
