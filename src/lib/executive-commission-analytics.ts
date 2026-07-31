import { getDb } from '../db';
import type { Env } from '../types';
import type { ExecutiveAnalyticsPage } from './executive-dashboard-types';

export const EXECUTIVE_COMMISSION_METRICS = [
  'visit_commission',
  'test_commission',
  'other_doctor_commission',
  'total_commission',
] as const;

export type CommissionMetric = typeof EXECUTIVE_COMMISSION_METRICS[number];
export type CommissionSourceType = 'consultation_fee' | 'lab_test' | 'referral' | 'procedure' | 'ipd_round';

const COMMISSION_SOURCES: Record<CommissionMetric, readonly CommissionSourceType[]> = {
  visit_commission: ['consultation_fee'],
  test_commission: ['lab_test', 'referral'],
  other_doctor_commission: ['procedure', 'ipd_round'],
  total_commission: ['consultation_fee', 'lab_test', 'referral', 'procedure', 'ipd_round'],
};

export type ExecutiveCommissionTotals = Record<CommissionMetric, number>;

export type ExecutiveCommissionDetailRow = {
  id?: string | number | null;
  occurred_at?: string | null;
  source_type?: string | null;
  source_label?: string | null;
  reference_no?: string | null;
  counter_name?: string | null;
  user_name?: string | null;
  amount?: number | string | null;
  status?: string | null;
  bill_id?: string | number | null;
  invoice_no?: string | null;
  patient_name?: string | null;
  patient_code?: string | null;
  service_names?: string | null;
  item_count?: string | number | null;
  gross_amount?: number | string | null;
  discount_amount?: number | string | null;
  net_amount?: number | string | null;
  paid_amount?: number | string | null;
  due_amount?: number | string | null;
};

export type ExecutiveCommissionBreakdown = {
  total: number;
  totalRows: number;
  sources: Array<{
    label: string;
    amount: number;
    count: number;
    key?: string;
    doctorId?: number;
  }>;
  rows: ExecutiveCommissionDetailRow[];
};

type CommissionAggregateRow = {
  source_type?: string | null;
  source_label?: string | null;
  source_key?: string | number | null;
  doctor_id?: string | number | null;
  amount?: number | string | null;
  row_count?: number | string | null;
};

const COMMISSION_AMOUNT_SQL = `MAX(
  0,
  (CASE
    WHEN COALESCE(dca.doctor_waiver_amount, 0) != 0
      OR COALESCE(dca.payable_commission_amount, 0) != 0
      THEN COALESCE(dca.payable_commission_amount, 0)
    ELSE COALESCE(dca.commission_amount, 0)
  END)
  - COALESCE(dca.reversed_amount, 0)
  - COALESCE(dca.clawback_amount, 0)
)`;
const ALLOWED_SOURCE_SQL = "'consultation_fee', 'lab_test', 'referral', 'procedure', 'ipd_round'";
const ELIGIBLE_COMMISSION_BILL_SQL = `(
  dca.bill_id IS NULL
  OR (
    b.id IS NOT NULL
    AND (
      COALESCE(b.status, 'open') = 'paid'
      OR (COALESCE(b.total, 0) > 0 AND COALESCE(b.paid, 0) >= COALESCE(b.total, 0))
    )
  )
)`;

function reportDateSql(): string {
  const expression = 'COALESCE(dca.accrued_date, dca.created_at)';
  return `CASE
    WHEN ${expression} IS NULL THEN NULL
    WHEN ${expression} LIKE '%Z' OR ${expression} LIKE '%+00:00' OR ${expression} LIKE '%-00:00'
      THEN date(${expression}, '+6 hours')
    ELSE date(${expression})
  END`;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function isExecutiveCommissionMetric(value: string): value is CommissionMetric {
  return (EXECUTIVE_COMMISSION_METRICS as readonly string[]).includes(value);
}

export function commissionSourceTypes(metric: CommissionMetric): readonly CommissionSourceType[] {
  return COMMISSION_SOURCES[metric];
}

export async function getExecutiveCommissionTotals(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  startDate: string;
  endDate: string;
}): Promise<ExecutiveCommissionTotals> {
  const db = getDb(args.dbBinding);
  const result = await db.$client.prepare(`/* executive_commission:totals */
    SELECT
      dca.source_type AS source_type,
      COALESCE(SUM(${COMMISSION_AMOUNT_SQL}), 0) AS amount,
      COUNT(*) AS row_count
    FROM doctor_commission_accruals dca
    LEFT JOIN bills b ON b.id = dca.bill_id AND b.tenant_id = dca.tenant_id
    WHERE dca.tenant_id = ?
      AND ${reportDateSql()} >= date(?)
      AND ${reportDateSql()} <= date(?)
      AND COALESCE(dca.status, 'accrued') != 'cancelled'
      AND ${ELIGIBLE_COMMISSION_BILL_SQL}
      AND dca.source_type IN (${ALLOWED_SOURCE_SQL})
    GROUP BY dca.source_type
  `).bind(args.tenantId, args.startDate, args.endDate).all<CommissionAggregateRow>();

  const bySource = new Map<CommissionSourceType, number>();
  for (const row of result.results || []) {
    const sourceType = String(row.source_type || '');
    if ((COMMISSION_SOURCES.total_commission as readonly string[]).includes(sourceType)) {
      bySource.set(sourceType as CommissionSourceType, roundMoney(Number(row.amount ?? 0)));
    }
  }

  const sum = (metric: CommissionMetric) => roundMoney(
    COMMISSION_SOURCES[metric].reduce((total, sourceType) => total + (bySource.get(sourceType) ?? 0), 0),
  );

  return {
    visit_commission: sum('visit_commission'),
    test_commission: sum('test_commission'),
    other_doctor_commission: sum('other_doctor_commission'),
    total_commission: sum('total_commission'),
  };
}

export async function getExecutiveCommissionBreakdown(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  startDate: string;
  endDate: string;
  metric: CommissionMetric;
  page: ExecutiveAnalyticsPage;
  includeDetails?: boolean;
  doctorId?: number;
}): Promise<ExecutiveCommissionBreakdown> {
  if (args.doctorId !== undefined && (!Number.isInteger(args.doctorId) || args.doctorId <= 0)) {
    throw new RangeError('doctorId must be a positive integer');
  }

  const db = getDb(args.dbBinding);
  const sourceTypes = commissionSourceTypes(args.metric);
  const sourcePlaceholders = placeholders(sourceTypes);
  const includeDetails = args.includeDetails ?? true;
  const groupedReferenceSql = `CASE
    WHEN dca.bill_id IS NOT NULL THEN 'bill-' || dca.bill_id
    ELSE 'accrual-' || dca.id
  END`;
  const doctorFilterSql = args.doctorId !== undefined ? 'AND dca.doctor_id = ?' : '';
  const sourceParams: Array<string | number> = [args.tenantId, args.startDate, args.endDate, ...sourceTypes];
  const detailParams: Array<string | number> = [...sourceParams];
  if (args.doctorId !== undefined) {
    sourceParams.push(args.doctorId);
    detailParams.push(args.doctorId);
  }
  detailParams.push(args.page.pageSize, args.page.offset);

  const statements = [
    db.$client.prepare(`/* executive_commission:${args.metric}:sources */
      SELECT
        COALESCE(NULLIF(TRIM(d.name), ''), 'Doctor #' || dca.doctor_id) AS source_label,
        CAST(dca.doctor_id AS TEXT) AS source_key,
        dca.doctor_id AS doctor_id,
        COALESCE(SUM(${COMMISSION_AMOUNT_SQL}), 0) AS amount,
        COUNT(DISTINCT ${groupedReferenceSql}) AS row_count
      FROM doctor_commission_accruals dca
      LEFT JOIN doctors d ON d.id = dca.doctor_id AND d.tenant_id = dca.tenant_id
      LEFT JOIN bills b ON b.id = dca.bill_id AND b.tenant_id = dca.tenant_id
      WHERE dca.tenant_id = ?
        AND ${reportDateSql()} >= date(?)
        AND ${reportDateSql()} <= date(?)
        AND dca.source_type IN (${sourcePlaceholders})
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
        AND ${ELIGIBLE_COMMISSION_BILL_SQL}
        ${doctorFilterSql}
      GROUP BY dca.doctor_id, source_label
      ORDER BY amount DESC, source_label ASC
    `).bind(...sourceParams),
    ...(includeDetails ? [db.$client.prepare(`/* executive_commission:${args.metric}:details */
      SELECT
        'commission-invoice-' || dca.doctor_id || '-' || ${groupedReferenceSql} AS id,
        MAX(COALESCE(dca.accrued_date, dca.created_at)) AS occurred_at,
        'commission' AS source_type,
        COALESCE(NULLIF(TRIM(d.name), ''), 'Doctor #' || dca.doctor_id) AS source_label,
        COALESCE(NULLIF(TRIM(MAX(b.invoice_no)), ''), 'ACCRUAL-' || MIN(dca.id)) AS reference_no,
        NULL AS counter_name,
        NULL AS user_name,
        COALESCE(SUM(${COMMISSION_AMOUNT_SQL}), 0) AS amount,
        CASE
          WHEN SUM(CASE WHEN COALESCE(dca.status, 'accrued') = 'paid' THEN 1 ELSE 0 END) = COUNT(*) THEN 'paid'
          WHEN SUM(CASE WHEN COALESCE(dca.status, 'accrued') IN ('approved', 'paid') THEN 1 ELSE 0 END) > 0 THEN 'approved'
          ELSE 'accrued'
        END AS status,
        dca.bill_id,
        MAX(b.invoice_no) AS invoice_no,
        MAX(pt.name) AS patient_name,
        MAX(pt.patient_code) AS patient_code,
        REPLACE(
          GROUP_CONCAT(DISTINCT COALESCE(
            NULLIF(TRIM(loi.test_name), ''),
            NULLIF(TRIM(ltc.name), ''),
            NULLIF(TRIM(dca.source_type), ''),
            'Commission'
          )),
          ',',
          ', '
        ) AS service_names,
        COUNT(DISTINCT CASE
          WHEN dca.lab_order_item_id IS NOT NULL THEN 'item-' || dca.lab_order_item_id
          ELSE 'accrual-' || dca.id
        END) AS item_count,
        CASE
          WHEN MAX(b.id) IS NOT NULL THEN COALESCE(MAX(b.total), 0) + COALESCE(MAX(b.discount), 0)
          ELSE COALESCE(SUM(dca.gross_amount), 0)
        END AS gross_amount,
        CASE WHEN MAX(b.id) IS NOT NULL THEN COALESCE(MAX(b.discount), 0) ELSE 0 END AS discount_amount,
        CASE
          WHEN MAX(b.id) IS NOT NULL THEN COALESCE(MAX(b.total), 0)
          ELSE COALESCE(SUM(dca.gross_amount), 0)
        END AS net_amount,
        CASE
          WHEN MAX(b.id) IS NOT NULL THEN COALESCE(MAX(b.paid), 0)
          ELSE COALESCE(SUM(dca.paid_amount), 0)
        END AS paid_amount,
        CASE
          WHEN MAX(b.id) IS NOT NULL THEN COALESCE(MAX(b.due), 0)
          ELSE COALESCE(SUM(dca.balance_amount), 0)
        END AS due_amount
      FROM doctor_commission_accruals dca
      LEFT JOIN doctors d ON d.id = dca.doctor_id AND d.tenant_id = dca.tenant_id
      LEFT JOIN bills b ON b.id = dca.bill_id AND b.tenant_id = dca.tenant_id
      LEFT JOIN patients pt ON pt.id = COALESCE(b.patient_id, dca.patient_id) AND pt.tenant_id = dca.tenant_id
      LEFT JOIN lab_order_items loi ON loi.id = dca.lab_order_item_id AND loi.tenant_id = dca.tenant_id
      LEFT JOIN lab_test_catalog ltc ON ltc.id = dca.lab_test_id AND ltc.tenant_id = dca.tenant_id
      WHERE dca.tenant_id = ?
        AND ${reportDateSql()} >= date(?)
        AND ${reportDateSql()} <= date(?)
        AND dca.source_type IN (${sourcePlaceholders})
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
        AND ${ELIGIBLE_COMMISSION_BILL_SQL}
        ${doctorFilterSql}
      GROUP BY dca.doctor_id, ${groupedReferenceSql}, dca.bill_id, source_label
      ORDER BY occurred_at DESC, MIN(dca.id) DESC
      LIMIT ? OFFSET ?
    `).bind(...detailParams)] : []),
  ];

  const batchResults = await db.$client.batch(statements);
  const sourceRows = (batchResults[0]?.results as unknown as CommissionAggregateRow[]) || [];
  const sources = sourceRows.map((row) => {
    const doctorId = Number(row.doctor_id ?? row.source_key);
    return {
      label: String(row.source_label || 'Unassigned Doctor'),
      amount: roundMoney(Number(row.amount ?? 0)),
      count: Number(row.row_count ?? 0),
      ...(row.source_key !== null && row.source_key !== undefined ? { key: String(row.source_key) } : {}),
      ...(Number.isInteger(doctorId) && doctorId > 0 ? { doctorId } : {}),
    };
  });
  const detailRows = includeDetails
    ? ((batchResults[1]?.results as unknown as ExecutiveCommissionDetailRow[]) || [])
    : [];

  return {
    sources,
    rows: detailRows,
    totalRows: sources.reduce((total, source) => total + source.count, 0),
    total: roundMoney(sources.reduce((total, source) => total + source.amount, 0)),
  };
}
