import type { FinancialReconciliationEnvelope } from '../../../packages/shared/src/dashboard';
import { getDb } from '../../db';
import { buildFinancialReconciliation } from '../../lib/dashboard/reconciliation';
import type { ExecutiveDashboardPeriod } from '../../lib/executive-dashboard-period';
import type { Env } from '../../types';
import { PATIENT_AGE_BUCKET_ORDER, type PatientAgeBucket } from './patientAge';
import {
  buildPatientAgeAnalyticsResponse,
  type PatientAgeAggregateInput,
  type PatientAgeAnalyticsResponse,
} from './patientAgeContract';

const COLLECTION_ATTRIBUTION_WARNING = 'Collection is attributed from bill paid totals to the invoice service date; payment-date allocation is not used.';
const UNKNOWN_AGE_WARNING = 'Some activity is grouped under Unknown age because date of birth is missing, invalid, or after the service date.';

type PatientAgeSummaryDbRow = {
  bucket?: string | null;
  unique_patients?: number | string | null;
  visits?: number | string | null;
  admissions?: number | string | null;
  services?: number | string | null;
  bill_count?: number | string | null;
  collection?: number | string | null;
  repeat_patients?: number | string | null;
};

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function nonNegativeMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function normalizeBucket(value: unknown): PatientAgeBucket | null {
  const normalized = String(value ?? '').trim() as PatientAgeBucket;
  return PATIENT_AGE_BUCKET_ORDER.includes(normalized) ? normalized : null;
}

function localServiceDate(expression: string): string {
  return `CASE
    WHEN ${expression} IS NULL THEN NULL
    WHEN ${expression} LIKE '%Z' OR ${expression} LIKE '%+00:00' OR ${expression} LIKE '%-00:00'
      THEN date(${expression}, '+6 hours')
    ELSE date(${expression})
  END`;
}

function ageAtServiceExpression(): string {
  return `CASE
    WHEN birth_date IS NULL OR service_date IS NULL OR birth_date > service_date THEN NULL
    ELSE
      CAST(strftime('%Y', service_date) AS INTEGER)
      - CAST(strftime('%Y', birth_date) AS INTEGER)
      - CASE
          WHEN strftime('%m-%d', service_date) < CASE
            WHEN strftime('%m-%d', birth_date) = '02-29'
              AND NOT (
                CAST(strftime('%Y', service_date) AS INTEGER) % 4 = 0
                AND (
                  CAST(strftime('%Y', service_date) AS INTEGER) % 100 != 0
                  OR CAST(strftime('%Y', service_date) AS INTEGER) % 400 = 0
                )
              )
              THEN '02-28'
            ELSE strftime('%m-%d', birth_date)
          END
          THEN 1
          ELSE 0
        END
  END`;
}

function patientAgeSummarySql(): string {
  const visitDate = localServiceDate('COALESCE(v.visit_date, v.created_at)');
  const admissionDate = localServiceDate('COALESCE(a.admission_date, a.created_at)');
  const billDate = localServiceDate('b.created_at');
  const ageExpression = ageAtServiceExpression();

  return `/* dashboard_patient_age:summary */
    WITH normalized_activity AS (
      SELECT
        v.patient_id AS patient_id,
        date(p.date_of_birth) AS birth_date,
        ${visitDate} AS service_date,
        1 AS visit_count,
        0 AS admission_count,
        0 AS service_count,
        NULL AS bill_id,
        0 AS collection
      FROM visits v
      JOIN patients p ON p.id = v.patient_id AND p.tenant_id = v.tenant_id
      WHERE v.tenant_id = ?
        AND ${visitDate} >= date(?)
        AND ${visitDate} <= date(?)

      UNION ALL

      SELECT
        a.patient_id AS patient_id,
        date(p.date_of_birth) AS birth_date,
        ${admissionDate} AS service_date,
        0 AS visit_count,
        1 AS admission_count,
        0 AS service_count,
        NULL AS bill_id,
        0 AS collection
      FROM admissions a
      JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND ${admissionDate} >= date(?)
        AND ${admissionDate} <= date(?)

      UNION ALL

      SELECT
        b.patient_id AS patient_id,
        date(p.date_of_birth) AS birth_date,
        ${billDate} AS service_date,
        0 AS visit_count,
        0 AS admission_count,
        COALESCE(SUM(CASE
          WHEN COALESCE(ii.status, 'active') = 'cancelled' THEN 0
          ELSE MAX(1, COALESCE(ii.quantity, 1))
        END), 0) AS service_count,
        b.id AS bill_id,
        MAX(0, COALESCE(b.paid, 0)) AS collection
      FROM bills b
      JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      LEFT JOIN invoice_items ii ON ii.bill_id = b.id AND ii.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND ${billDate} >= date(?)
        AND ${billDate} <= date(?)
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      GROUP BY b.tenant_id, b.id, b.patient_id, p.date_of_birth, b.created_at, b.paid
    ),
    dated_activity AS (
      SELECT *
      FROM normalized_activity
      WHERE patient_id IS NOT NULL AND service_date IS NOT NULL
    ),
    aged_activity AS (
      SELECT
        *,
        ${ageExpression} AS age_at_service
      FROM dated_activity
    ),
    bucketed_activity AS (
      SELECT
        *,
        CASE
          WHEN age_at_service IS NULL OR age_at_service < 0 THEN 'unknown'
          WHEN age_at_service <= 5 THEN '0_5'
          WHEN age_at_service <= 17 THEN '6_17'
          WHEN age_at_service <= 30 THEN '18_30'
          WHEN age_at_service <= 45 THEN '31_45'
          WHEN age_at_service <= 60 THEN '46_60'
          ELSE '61_plus'
        END AS bucket
      FROM aged_activity
    ),
    patient_bucket_rollup AS (
      SELECT
        bucket,
        patient_id,
        SUM(visit_count) AS visits,
        SUM(admission_count) AS admissions,
        SUM(service_count) AS services,
        COUNT(DISTINCT bill_id) AS bill_count,
        ROUND(SUM(collection), 2) AS collection
      FROM bucketed_activity
      GROUP BY bucket, patient_id
    )
    SELECT
      bucket,
      COUNT(DISTINCT patient_id) AS unique_patients,
      SUM(visits) AS visits,
      SUM(admissions) AS admissions,
      SUM(services) AS services,
      SUM(bill_count) AS bill_count,
      ROUND(SUM(collection), 2) AS collection,
      SUM(CASE WHEN visits > 1 THEN 1 ELSE 0 END) AS repeat_patients
    FROM patient_bucket_rollup
    GROUP BY bucket
    ORDER BY CASE bucket
      WHEN '0_5' THEN 1
      WHEN '6_17' THEN 2
      WHEN '18_30' THEN 3
      WHEN '31_45' THEN 4
      WHEN '46_60' THEN 5
      WHEN '61_plus' THEN 6
      ELSE 7
    END`;
}

function mapSummaryRows(rows: readonly PatientAgeSummaryDbRow[]): PatientAgeAggregateInput[] {
  const mapped: PatientAgeAggregateInput[] = [];
  for (const row of rows) {
    const bucket = normalizeBucket(row.bucket);
    if (!bucket) continue;
    mapped.push({
      bucket,
      uniquePatients: nonNegativeInteger(row.unique_patients),
      visits: nonNegativeInteger(row.visits),
      admissions: nonNegativeInteger(row.admissions),
      services: nonNegativeInteger(row.services),
      billCount: nonNegativeInteger(row.bill_count),
      collection: nonNegativeMoney(row.collection),
      repeatPatients: nonNegativeInteger(row.repeat_patients),
    });
  }
  return mapped;
}

export async function getPatientAgeAnalytics(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
}): Promise<PatientAgeAnalyticsResponse> {
  const db = getDb(args.dbBinding);
  const result = await db.$client.prepare(patientAgeSummarySql()).bind(
    args.tenantId,
    args.period.startDate,
    args.period.endDate,
    args.tenantId,
    args.period.startDate,
    args.period.endDate,
    args.tenantId,
    args.period.startDate,
    args.period.endDate,
  ).all<PatientAgeSummaryDbRow>();

  const rows = mapSummaryRows(result.results ?? []);
  const warnings = [COLLECTION_ATTRIBUTION_WARNING];
  if (rows.some((row) => row.bucket === 'unknown' && row.uniquePatients > 0)) {
    warnings.push(UNKNOWN_AGE_WARNING);
  }

  return buildPatientAgeAnalyticsResponse({
    period: args.period,
    rows,
    warnings,
  });
}

export type PatientAgeAggregateDetailView = 'services' | 'doctors' | 'departments';
export type PatientAgeDetailSort = 'name' | 'uniquePatients' | 'visits' | 'services' | 'collection';
export type PatientAgeDetailSortDirection = 'asc' | 'desc';

export interface PatientAgeAggregateDetailRow {
  id: number | string | null;
  name: string;
  category: string | null;
  uniquePatients: number;
  visits: number;
  services: number;
  quantity?: number;
  collection: number;
}

export interface PatientAgeAggregateDetailResponse {
  period: ExecutiveDashboardPeriod;
  ageBucket: PatientAgeBucket;
  view: PatientAgeAggregateDetailView;
  rows: PatientAgeAggregateDetailRow[];
  totals: {
    uniquePatients: number;
    visits: number;
    services: number;
    collection: number;
  };
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
  reconciliation: Record<string, FinancialReconciliationEnvelope>;
  warnings: string[];
}

type PatientAgeDetailDbRow = {
  row_id?: number | string | null;
  row_name?: string | null;
  category?: string | null;
  unique_patients?: number | string | null;
  visits?: number | string | null;
  services?: number | string | null;
  collection?: number | string | null;
  total_rows?: number | string | null;
  overall_unique_patients?: number | string | null;
  overall_visits?: number | string | null;
  overall_services?: number | string | null;
  overall_collection?: number | string | null;
};

const DETAIL_SORT_COLUMNS: Record<PatientAgeDetailSort, string> = {
  name: 'row_name',
  uniquePatients: 'unique_patients',
  visits: 'visits',
  services: 'services',
  collection: 'collection',
};

function bucketCaseSql(ageColumn = 'age_at_service'): string {
  return `CASE
    WHEN ${ageColumn} IS NULL OR ${ageColumn} < 0 THEN 'unknown'
    WHEN ${ageColumn} <= 5 THEN '0_5'
    WHEN ${ageColumn} <= 17 THEN '6_17'
    WHEN ${ageColumn} <= 30 THEN '18_30'
    WHEN ${ageColumn} <= 45 THEN '31_45'
    WHEN ${ageColumn} <= 60 THEN '46_60'
    ELSE '61_plus'
  END`;
}

function invoiceDetailCtes(): string {
  const billDate = localServiceDate('b.created_at');
  const ageExpression = ageAtServiceExpression();
  return `
    bill_base AS (
      SELECT
        b.tenant_id,
        b.id AS bill_id,
        b.patient_id,
        date(p.date_of_birth) AS birth_date,
        ${billDate} AS service_date,
        MAX(0, COALESCE(b.paid, 0)) AS bill_collection
      FROM bills b
      JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND ${billDate} >= date(?)
        AND ${billDate} <= date(?)
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    ),
    bill_aged AS (
      SELECT *, ${ageExpression} AS age_at_service
      FROM bill_base
    ),
    eligible_bills AS (
      SELECT *, ${bucketCaseSql()} AS bucket
      FROM bill_aged
      WHERE ${bucketCaseSql()} = ?
    ),
    active_items AS (
      SELECT
        eb.bill_id,
        eb.patient_id,
        eb.bill_collection,
        ii.id AS item_id,
        COALESCE(NULLIF(TRIM(ii.description), ''), 'Invoice item #' || ii.id) AS service_name,
        COALESCE(NULLIF(TRIM(ii.item_category), ''), 'Uncategorized') AS service_category,
        COALESCE(ii.doctor_id, NULL) AS doctor_id,
        NULLIF(TRIM(d.name), '') AS doctor_name,
        COALESCE(ii.service_department_id, NULL) AS department_id,
        NULLIF(TRIM(sd.department_name), '') AS department_name,
        MAX(1, COALESCE(ii.quantity, 1)) AS service_count,
        CASE
          WHEN COALESCE(ii.line_total, 0) > 0 THEN COALESCE(ii.line_total, 0)
          ELSE MAX(0, COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1))
        END AS line_amount
      FROM eligible_bills eb
      JOIN invoice_items ii ON ii.bill_id = eb.bill_id AND ii.tenant_id = eb.tenant_id
      LEFT JOIN doctors d ON d.id = ii.doctor_id AND d.tenant_id = ii.tenant_id
      LEFT JOIN billing_service_departments sd ON sd.id = ii.service_department_id AND sd.tenant_id = ii.tenant_id
      WHERE COALESCE(ii.status, 'active') != 'cancelled'
    ),
    bill_item_totals AS (
      SELECT bill_id, SUM(line_amount) AS allocation_base
      FROM active_items
      GROUP BY bill_id
    ),
    allocated_items AS (
      SELECT
        ai.patient_id,
        'service:' || LOWER(TRIM(ai.service_category)) || ':' || LOWER(TRIM(ai.service_name)) AS service_id,
        ai.service_name,
        ai.service_category,
        ai.doctor_id,
        COALESCE(ai.doctor_name, 'Unassigned doctor') AS doctor_name,
        ai.department_id,
        COALESCE(ai.department_name, 'Unassigned department') AS department_name,
        ai.service_count,
        CASE
          WHEN COALESCE(bit.allocation_base, 0) > 0
            THEN ai.bill_collection * ai.line_amount / bit.allocation_base
          ELSE 0
        END AS allocated_collection
      FROM active_items ai
      LEFT JOIN bill_item_totals bit ON bit.bill_id = ai.bill_id
    ),
    collection_fallback AS (
      SELECT
        eb.patient_id,
        'service:uncategorized:invoice-payment' AS service_id,
        'Invoice payment' AS service_name,
        'Uncategorized' AS service_category,
        NULL AS doctor_id,
        'Unassigned doctor' AS doctor_name,
        NULL AS department_id,
        'Unassigned department' AS department_name,
        0 AS service_count,
        eb.bill_collection AS allocated_collection
      FROM eligible_bills eb
      LEFT JOIN bill_item_totals bit ON bit.bill_id = eb.bill_id
      WHERE COALESCE(bit.allocation_base, 0) <= 0
    ),
    invoice_facts AS (
      SELECT * FROM allocated_items
      UNION ALL
      SELECT * FROM collection_fallback
    )`;
}

function visitDetailCtes(): string {
  const visitDate = localServiceDate('COALESCE(v.visit_date, v.created_at)');
  const ageExpression = ageAtServiceExpression();
  return `
    visit_base AS (
      SELECT
        v.patient_id,
        date(p.date_of_birth) AS birth_date,
        ${visitDate} AS service_date,
        v.doctor_id,
        NULLIF(TRIM(d.name), '') AS doctor_name,
        d.department_id,
        NULLIF(TRIM(sd.department_name), '') AS department_name
      FROM visits v
      JOIN patients p ON p.id = v.patient_id AND p.tenant_id = v.tenant_id
      LEFT JOIN doctors d ON d.id = v.doctor_id AND d.tenant_id = v.tenant_id
      LEFT JOIN billing_service_departments sd ON sd.id = d.department_id AND sd.tenant_id = v.tenant_id
      WHERE v.tenant_id = ?
        AND ${visitDate} >= date(?)
        AND ${visitDate} <= date(?)
    ),
    visit_aged AS (
      SELECT *, ${ageExpression} AS age_at_service
      FROM visit_base
    ),
    eligible_visits AS (
      SELECT *, ${bucketCaseSql()} AS bucket
      FROM visit_aged
      WHERE ${bucketCaseSql()} = ?
    )`;
}

function patientAgeDetailSql(args: {
  view: PatientAgeAggregateDetailView;
  sortBy: PatientAgeDetailSort;
  sortDirection: PatientAgeDetailSortDirection;
}): string {
  const sortColumn = DETAIL_SORT_COLUMNS[args.sortBy];
  const direction = args.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const orderBy = `ORDER BY ${sortColumn} ${direction}, row_name ASC`;

  if (args.view === 'services') {
    return `/* dashboard_patient_age:details:services */
      WITH ${invoiceDetailCtes()},
      grouped_rows AS (
        SELECT
          service_id AS row_id,
          service_name AS row_name,
          service_category AS category,
          COUNT(DISTINCT patient_id) AS unique_patients,
          0 AS visits,
          SUM(service_count) AS services,
          ROUND(SUM(allocated_collection), 2) AS collection
        FROM invoice_facts
        GROUP BY service_id, service_name, service_category
      ),
      overall_totals AS (
        SELECT
          COUNT(DISTINCT patient_id) AS overall_unique_patients,
          0 AS overall_visits,
          COALESCE(SUM(service_count), 0) AS overall_services,
          ROUND(COALESCE(SUM(allocated_collection), 0), 2) AS overall_collection
        FROM invoice_facts
      )
      SELECT
        grouped_rows.*,
        (SELECT COUNT(*) FROM grouped_rows) AS total_rows,
        overall_totals.*
      FROM grouped_rows
      CROSS JOIN overall_totals
      ${orderBy}
      LIMIT ? OFFSET ?`;
  }

  const rowId = args.view === 'doctors' ? 'doctor_id' : 'department_id';
  const rowName = args.view === 'doctors' ? 'doctor_name' : 'department_name';
  const category = args.view === 'doctors' ? 'Doctor' : 'Department';
  const marker = `dashboard_patient_age:details:${args.view}`;
  return `/* ${marker} */
    WITH ${invoiceDetailCtes()},
    ${visitDetailCtes()},
    detail_facts AS (
      SELECT
        ${rowId} AS row_id,
        ${rowName} AS row_name,
        patient_id,
        0 AS visits,
        service_count AS services,
        allocated_collection AS collection
      FROM invoice_facts

      UNION ALL

      SELECT
        ${rowId} AS row_id,
        COALESCE(${rowName}, '${args.view === 'doctors' ? 'Unassigned doctor' : 'Unassigned department'}') AS row_name,
        patient_id,
        1 AS visits,
        0 AS services,
        0 AS collection
      FROM eligible_visits
    ),
    normalized_facts AS (
      SELECT
        row_id,
        COALESCE(NULLIF(TRIM(row_name), ''), '${args.view === 'doctors' ? 'Unassigned doctor' : 'Unassigned department'}') AS row_name,
        patient_id,
        visits,
        services,
        collection
      FROM detail_facts
    ),
    grouped_rows AS (
      SELECT
        row_id,
        row_name,
        '${category}' AS category,
        COUNT(DISTINCT patient_id) AS unique_patients,
        SUM(visits) AS visits,
        SUM(services) AS services,
        ROUND(SUM(collection), 2) AS collection
      FROM normalized_facts
      GROUP BY row_id, row_name
    ),
    overall_totals AS (
      SELECT
        COUNT(DISTINCT patient_id) AS overall_unique_patients,
        COALESCE(SUM(visits), 0) AS overall_visits,
        COALESCE(SUM(services), 0) AS overall_services,
        ROUND(COALESCE(SUM(collection), 0), 2) AS overall_collection
      FROM normalized_facts
    )
    SELECT
      grouped_rows.*,
      (SELECT COUNT(*) FROM grouped_rows) AS total_rows,
      overall_totals.*
    FROM grouped_rows
    CROSS JOIN overall_totals
    ${orderBy}
    LIMIT ? OFFSET ?`;
}

function normalizeDetailRowId(value: unknown): number | string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value);
  return /^-?\d+$/.test(text) ? Number(text) : text;
}

function mapDetailRows(rows: readonly PatientAgeDetailDbRow[], view: PatientAgeAggregateDetailView): PatientAgeAggregateDetailRow[] {
  return rows.map((row) => {
    const services = nonNegativeInteger(row.services);
    return {
      id: normalizeDetailRowId(row.row_id),
      name: String(row.row_name ?? '').trim() || (view === 'doctors'
        ? 'Unassigned doctor'
        : view === 'departments'
          ? 'Unassigned department'
          : 'Unnamed service'),
      category: row.category === null || row.category === undefined ? null : String(row.category),
      uniquePatients: nonNegativeInteger(row.unique_patients),
      visits: nonNegativeInteger(row.visits),
      services,
      ...(view === 'services' ? { quantity: services } : {}),
      collection: nonNegativeMoney(row.collection),
    };
  });
}

function detailTotals(row: PatientAgeDetailDbRow | undefined): PatientAgeAggregateDetailResponse['totals'] {
  return {
    uniquePatients: nonNegativeInteger(row?.overall_unique_patients),
    visits: nonNegativeInteger(row?.overall_visits),
    services: nonNegativeInteger(row?.overall_services),
    collection: nonNegativeMoney(row?.overall_collection),
  };
}

export async function getPatientAgeAggregateDetails(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  ageBucket: PatientAgeBucket;
  view: PatientAgeAggregateDetailView;
  sortBy: PatientAgeDetailSort;
  sortDirection: PatientAgeDetailSortDirection;
  page: number;
  pageSize: number;
}): Promise<PatientAgeAggregateDetailResponse> {
  const db = getDb(args.dbBinding);
  const offset = (args.page - 1) * args.pageSize;
  const detailParams: unknown[] = [
    args.tenantId,
    args.period.startDate,
    args.period.endDate,
    args.ageBucket,
  ];
  if (args.view !== 'services') {
    detailParams.push(
      args.tenantId,
      args.period.startDate,
      args.period.endDate,
      args.ageBucket,
    );
  }
  detailParams.push(args.pageSize, offset);

  const [detailResult, summary] = await Promise.all([
    db.$client.prepare(patientAgeDetailSql({
      view: args.view,
      sortBy: args.sortBy,
      sortDirection: args.sortDirection,
    })).bind(...detailParams).all<PatientAgeDetailDbRow>(),
    getPatientAgeAnalytics({
      dbBinding: args.dbBinding,
      tenantId: args.tenantId,
      period: args.period,
    }),
  ]);

  const rawRows = detailResult.results ?? [];
  const metadata = rawRows[0];
  const rows = mapDetailRows(rawRows, args.view);
  const totals = detailTotals(metadata);
  const totalRows = nonNegativeInteger(metadata?.total_rows);
  const summaryBucket = summary.rows.find((row) => row.bucket === args.ageBucket);
  const checkedAt = new Date().toISOString();
  const reconciliation: Record<string, FinancialReconciliationEnvelope> = {
    services: buildFinancialReconciliation({
      summaryTotal: summaryBucket?.services ?? 0,
      detailTotal: totals.services,
      detailRowCount: totalRows,
      detailGrain: `${args.view} grouped service quantity for one age-at-service bucket`,
      checkedAt,
      providerMode: 'legacy',
    }),
    collection: buildFinancialReconciliation({
      summaryTotal: summaryBucket?.collection ?? 0,
      detailTotal: totals.collection,
      detailRowCount: totalRows,
      detailGrain: `${args.view} grouped invoice-service collection for one age-at-service bucket`,
      checkedAt,
      providerMode: 'legacy',
    }),
  };
  if (args.view !== 'services') {
    reconciliation.visits = buildFinancialReconciliation({
      summaryTotal: summaryBucket?.visits ?? 0,
      detailTotal: totals.visits,
      detailRowCount: totalRows,
      detailGrain: `${args.view} grouped visits for one age-at-service bucket`,
      checkedAt,
      providerMode: 'legacy',
    });
  }

  return {
    period: args.period,
    ageBucket: args.ageBucket,
    view: args.view,
    rows,
    totals,
    page: args.page,
    pageSize: args.pageSize,
    totalRows,
    hasNextPage: args.page * args.pageSize < totalRows,
    reconciliation,
    warnings: summary.warnings,
  };
}

export interface PatientAgePatientDetailRow {
  patientId: number;
  patientCode: string | null;
  patientName: string | null;
  ageAtService: number | null;
  bucket: PatientAgeBucket;
  latestServiceAt: string;
  visits: number;
  admissions: number;
  services: number;
  collection: number;
}

export interface PatientAgePatientDetailResponse {
  period: ExecutiveDashboardPeriod;
  ageBucket: PatientAgeBucket;
  view: 'patients';
  rows: PatientAgePatientDetailRow[];
  totals: {
    uniquePatients: number;
    visits: number;
    admissions: number;
    services: number;
    collection: number;
  };
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
  reconciliation: Record<string, FinancialReconciliationEnvelope>;
  warnings: string[];
}

type PatientAgePatientDbRow = {
  patient_id?: number | string | null;
  patient_code?: string | null;
  patient_name?: string | null;
  age_at_service?: number | string | null;
  bucket?: string | null;
  latest_service_at?: string | null;
  visits?: number | string | null;
  admissions?: number | string | null;
  services?: number | string | null;
  collection?: number | string | null;
  total_rows?: number | string | null;
  overall_unique_patients?: number | string | null;
  overall_visits?: number | string | null;
  overall_admissions?: number | string | null;
  overall_services?: number | string | null;
  overall_collection?: number | string | null;
};

function patientAgePatientDetailSql(args: {
  sortBy: PatientAgeDetailSort;
  sortDirection: PatientAgeDetailSortDirection;
}): string {
  const sortColumns: Record<PatientAgeDetailSort, string> = {
    name: 'patient_name',
    uniquePatients: 'patient_id',
    visits: 'visits',
    services: 'services',
    collection: 'collection',
  };
  const sortColumn = sortColumns[args.sortBy];
  const direction = args.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const visitDate = localServiceDate('COALESCE(v.visit_date, v.created_at)');
  const admissionDate = localServiceDate('COALESCE(a.admission_date, a.created_at)');
  const billDate = localServiceDate('b.created_at');
  const ageExpression = ageAtServiceExpression();

  return `/* dashboard_patient_age:details:patients */
    WITH normalized_activity AS (
      SELECT
        v.patient_id,
        p.patient_code,
        p.name AS patient_name,
        date(p.date_of_birth) AS birth_date,
        ${visitDate} AS service_date,
        1 AS visit_count,
        0 AS admission_count,
        0 AS service_count,
        NULL AS bill_id,
        0 AS collection
      FROM visits v
      JOIN patients p ON p.id = v.patient_id AND p.tenant_id = v.tenant_id
      WHERE v.tenant_id = ?
        AND ${visitDate} >= date(?)
        AND ${visitDate} <= date(?)

      UNION ALL

      SELECT
        a.patient_id,
        p.patient_code,
        p.name AS patient_name,
        date(p.date_of_birth) AS birth_date,
        ${admissionDate} AS service_date,
        0 AS visit_count,
        1 AS admission_count,
        0 AS service_count,
        NULL AS bill_id,
        0 AS collection
      FROM admissions a
      JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND ${admissionDate} >= date(?)
        AND ${admissionDate} <= date(?)

      UNION ALL

      SELECT
        b.patient_id,
        p.patient_code,
        p.name AS patient_name,
        date(p.date_of_birth) AS birth_date,
        ${billDate} AS service_date,
        0 AS visit_count,
        0 AS admission_count,
        COALESCE(SUM(CASE
          WHEN COALESCE(ii.status, 'active') = 'cancelled' THEN 0
          ELSE MAX(1, COALESCE(ii.quantity, 1))
        END), 0) AS service_count,
        b.id AS bill_id,
        MAX(0, COALESCE(b.paid, 0)) AS collection
      FROM bills b
      JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      LEFT JOIN invoice_items ii ON ii.bill_id = b.id AND ii.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND ${billDate} >= date(?)
        AND ${billDate} <= date(?)
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      GROUP BY b.tenant_id, b.id, b.patient_id, p.patient_code, p.name, p.date_of_birth, b.created_at, b.paid
    ),
    dated_activity AS (
      SELECT *
      FROM normalized_activity
      WHERE patient_id IS NOT NULL AND service_date IS NOT NULL
    ),
    aged_activity AS (
      SELECT *, ${ageExpression} AS age_at_service
      FROM dated_activity
    ),
    bucketed_activity AS (
      SELECT *, ${bucketCaseSql()} AS bucket
      FROM aged_activity
    ),
    eligible_activity AS (
      SELECT *
      FROM bucketed_activity
      WHERE bucket = ?
    ),
    patient_rollup AS (
      SELECT
        patient_id,
        MAX(patient_code) AS patient_code,
        MAX(patient_name) AS patient_name,
        MAX(age_at_service) AS age_at_service,
        MAX(bucket) AS bucket,
        MAX(service_date) AS latest_service_at,
        SUM(visit_count) AS visits,
        SUM(admission_count) AS admissions,
        SUM(service_count) AS services,
        ROUND(SUM(collection), 2) AS collection
      FROM eligible_activity
      GROUP BY patient_id
    ),
    overall_totals AS (
      SELECT
        COUNT(*) AS overall_unique_patients,
        COALESCE(SUM(visits), 0) AS overall_visits,
        COALESCE(SUM(admissions), 0) AS overall_admissions,
        COALESCE(SUM(services), 0) AS overall_services,
        ROUND(COALESCE(SUM(collection), 0), 2) AS overall_collection
      FROM patient_rollup
    )
    SELECT
      patient_rollup.*,
      (SELECT COUNT(*) FROM patient_rollup) AS total_rows,
      overall_totals.*
    FROM patient_rollup
    CROSS JOIN overall_totals
    ORDER BY ${sortColumn} ${direction}, patient_id ASC
    LIMIT ? OFFSET ?`;
}

function mapPatientDetailRows(rows: readonly PatientAgePatientDbRow[]): PatientAgePatientDetailRow[] {
  const mapped: PatientAgePatientDetailRow[] = [];
  for (const row of rows) {
    const patientId = Number(row.patient_id);
    const bucket = normalizeBucket(row.bucket);
    const latestServiceAt = String(row.latest_service_at ?? '').trim();
    if (!Number.isInteger(patientId) || patientId <= 0 || !bucket || !latestServiceAt) continue;
    const rawAge = row.age_at_service === null || row.age_at_service === undefined
      ? null
      : Number(row.age_at_service);
    mapped.push({
      patientId,
      patientCode: row.patient_code === null || row.patient_code === undefined ? null : String(row.patient_code),
      patientName: row.patient_name === null || row.patient_name === undefined ? null : String(row.patient_name),
      ageAtService: rawAge !== null && Number.isInteger(rawAge) && rawAge >= 0 ? rawAge : null,
      bucket,
      latestServiceAt,
      visits: nonNegativeInteger(row.visits),
      admissions: nonNegativeInteger(row.admissions),
      services: nonNegativeInteger(row.services),
      collection: nonNegativeMoney(row.collection),
    });
  }
  return mapped;
}

export async function getPatientAgePatientDetails(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  ageBucket: PatientAgeBucket;
  sortBy: PatientAgeDetailSort;
  sortDirection: PatientAgeDetailSortDirection;
  page: number;
  pageSize: number;
}): Promise<PatientAgePatientDetailResponse> {
  const db = getDb(args.dbBinding);
  const offset = (args.page - 1) * args.pageSize;
  const [detailResult, summary] = await Promise.all([
    db.$client.prepare(patientAgePatientDetailSql({
      sortBy: args.sortBy,
      sortDirection: args.sortDirection,
    })).bind(
      args.tenantId,
      args.period.startDate,
      args.period.endDate,
      args.tenantId,
      args.period.startDate,
      args.period.endDate,
      args.tenantId,
      args.period.startDate,
      args.period.endDate,
      args.ageBucket,
      args.pageSize,
      offset,
    ).all<PatientAgePatientDbRow>(),
    getPatientAgeAnalytics({
      dbBinding: args.dbBinding,
      tenantId: args.tenantId,
      period: args.period,
    }),
  ]);

  const rawRows = detailResult.results ?? [];
  const metadata = rawRows[0];
  const rows = mapPatientDetailRows(rawRows);
  const totals = {
    uniquePatients: nonNegativeInteger(metadata?.overall_unique_patients),
    visits: nonNegativeInteger(metadata?.overall_visits),
    admissions: nonNegativeInteger(metadata?.overall_admissions),
    services: nonNegativeInteger(metadata?.overall_services),
    collection: nonNegativeMoney(metadata?.overall_collection),
  };
  const totalRows = nonNegativeInteger(metadata?.total_rows);
  const summaryBucket = summary.rows.find((row) => row.bucket === args.ageBucket);
  const checkedAt = new Date().toISOString();
  const reconciliation: Record<string, FinancialReconciliationEnvelope> = {
    visits: buildFinancialReconciliation({
      summaryTotal: summaryBucket?.visits ?? 0,
      detailTotal: totals.visits,
      detailRowCount: totalRows,
      detailGrain: 'one permission-gated patient rollup for visits in an age-at-service bucket',
      checkedAt,
      providerMode: 'legacy',
    }),
    admissions: buildFinancialReconciliation({
      summaryTotal: summaryBucket?.admissions ?? 0,
      detailTotal: totals.admissions,
      detailRowCount: totalRows,
      detailGrain: 'one permission-gated patient rollup for admissions in an age-at-service bucket',
      checkedAt,
      providerMode: 'legacy',
    }),
    services: buildFinancialReconciliation({
      summaryTotal: summaryBucket?.services ?? 0,
      detailTotal: totals.services,
      detailRowCount: totalRows,
      detailGrain: 'one permission-gated patient rollup for services in an age-at-service bucket',
      checkedAt,
      providerMode: 'legacy',
    }),
    collection: buildFinancialReconciliation({
      summaryTotal: summaryBucket?.collection ?? 0,
      detailTotal: totals.collection,
      detailRowCount: totalRows,
      detailGrain: 'one permission-gated patient rollup for invoice collection in an age-at-service bucket',
      checkedAt,
      providerMode: 'legacy',
    }),
  };

  return {
    period: args.period,
    ageBucket: args.ageBucket,
    view: 'patients',
    rows,
    totals,
    page: args.page,
    pageSize: args.pageSize,
    totalRows,
    hasNextPage: args.page * args.pageSize < totalRows,
    reconciliation,
    warnings: summary.warnings,
  };
}

export const patientAgeAnalyticsWarnings = {
  collectionAttribution: COLLECTION_ATTRIBUTION_WARNING,
  unknownAge: UNKNOWN_AGE_WARNING,
} as const;
