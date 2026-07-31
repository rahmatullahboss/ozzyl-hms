import { getDb } from '../../db';
import {
  getDoctorPerformance as getBaseDoctorPerformance,
  getDoctorPerformanceDetails as getBaseDoctorPerformanceDetails,
  type DoctorPerformanceDetailsResponse as BaseDoctorPerformanceDetailsResponse,
  type DoctorPerformanceResponse as BaseDoctorPerformanceResponse,
  type DoctorPerformanceDetailsTab,
  type DoctorPerformanceSort,
  type DoctorPerformanceSortDirection,
} from '../../lib/executive-doctor-analytics';
import { buildFinancialReconciliation } from '../../lib/dashboard/reconciliation';
import type { FinancialReconciliationEnvelope } from '../../../packages/shared/src/dashboard';

export type {
  DoctorPerformanceDetailsTab,
  DoctorPerformanceSort,
  DoctorPerformanceSortDirection,
};

export interface DoctorLastActivity {
  lastActivityAt: string | null;
  lastActivityType: string | null;
}

export type DoctorPerformanceResponse = Omit<BaseDoctorPerformanceResponse, 'rows'> & {
  rows: Array<BaseDoctorPerformanceResponse['rows'][number] & DoctorLastActivity>;
  reconciliation: Record<string, FinancialReconciliationEnvelope>;
};

export type DoctorPerformanceDetailsResponse = BaseDoctorPerformanceDetailsResponse & {
  reconciliation: Record<string, FinancialReconciliationEnvelope>;
};

type DoctorLastActivityDbRow = {
  doctor_id: number | null;
  last_activity_at: string | null;
  last_activity_type: string | null;
};

const DOCTOR_LAST_ACTIVITY_SQL = `/* executive_doctor:last_activity */
  WITH activity_events AS (
    SELECT
      COALESCE(NULLIF(v.doctor_id, 0), NULLIF(b.referring_doctor_id, 0)) AS doctor_id,
      COALESCE(b.created_at, v.visit_date, b.updated_at) AS occurred_at,
      'visit' AS activity_type
    FROM bills b
    LEFT JOIN visits v
      ON v.tenant_id = b.tenant_id
      AND v.id = b.visit_id
    WHERE b.tenant_id = ?
      AND date(COALESCE(b.created_at, v.visit_date, b.updated_at)) >= date(?)
      AND date(COALESCE(b.created_at, v.visit_date, b.updated_at)) <= date(?)
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      AND (
        COALESCE(b.doctor_visit_bill, 0) > 0
        OR EXISTS (
          SELECT 1
          FROM invoice_items visit_item
          WHERE visit_item.tenant_id = b.tenant_id
            AND visit_item.bill_id = b.id
            AND COALESCE(visit_item.status, 'active') != 'cancelled'
            AND LOWER(TRIM(COALESCE(visit_item.item_category, ''))) IN (
              'doctor_visit', 'doctor_fee', 'consultation', 'consultation_fee'
            )
        )
      )

    UNION ALL

    SELECT
      COALESCE(NULLIF(b.referring_doctor_id, 0), NULLIF(v.doctor_id, 0)) AS doctor_id,
      COALESCE(lo.order_date, lo.created_at, b.created_at, b.updated_at) AS occurred_at,
      'test_referred' AS activity_type
    FROM lab_orders lo
    LEFT JOIN bills b
      ON b.tenant_id = lo.tenant_id
      AND b.id = lo.bill_id
    LEFT JOIN visits v
      ON v.tenant_id = b.tenant_id
      AND v.id = b.visit_id
    WHERE lo.tenant_id = ?
      AND date(COALESCE(lo.order_date, lo.created_at, b.created_at, b.updated_at)) >= date(?)
      AND date(COALESCE(lo.order_date, lo.created_at, b.created_at, b.updated_at)) <= date(?)
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')

    UNION ALL

    SELECT
      NULLIF(r.assigned_doctor_id, 0) AS doctor_id,
      COALESCE(r.paid_at, r.reversed_at, r.cancelled_at, r.reserved_at, r.updated_at) AS occurred_at,
      CASE
        WHEN LOWER(COALESCE(r.status, 'reserved')) = 'paid' THEN 'performer_reserve_paid'
        WHEN LOWER(COALESCE(r.status, 'reserved')) = 'reversed' THEN 'performer_reserve_reversed'
        WHEN LOWER(COALESCE(r.status, 'reserved')) = 'cancelled' THEN 'performer_reserve_cancelled'
        ELSE 'test_performed'
      END AS activity_type
    FROM diagnostic_performer_reserves r
    WHERE r.tenant_id = ?
      AND date(COALESCE(r.paid_at, r.reversed_at, r.cancelled_at, r.reserved_at, r.updated_at)) >= date(?)
      AND date(COALESCE(r.paid_at, r.reversed_at, r.cancelled_at, r.reserved_at, r.updated_at)) <= date(?)

    UNION ALL

    SELECT
      NULLIF(a.doctor_id, 0) AS doctor_id,
      COALESCE(a.paid_date, a.accrued_date, a.created_at, a.updated_at) AS occurred_at,
      CASE
        WHEN LOWER(COALESCE(a.status, 'accrued')) = 'paid' THEN 'commission_paid'
        WHEN LOWER(COALESCE(a.status, 'accrued')) = 'cancelled' THEN 'commission_cancelled'
        ELSE 'commission_accrued'
      END AS activity_type
    FROM doctor_commission_accruals a
    WHERE a.tenant_id = ?
      AND date(COALESCE(a.paid_date, a.accrued_date, a.created_at, a.updated_at)) >= date(?)
      AND date(COALESCE(a.paid_date, a.accrued_date, a.created_at, a.updated_at)) <= date(?)
  ),
  ranked_activity AS (
    SELECT
      doctor_id,
      occurred_at,
      activity_type,
      ROW_NUMBER() OVER (
        PARTITION BY doctor_id
        ORDER BY datetime(occurred_at) DESC, activity_type ASC
      ) AS activity_rank
    FROM activity_events
    WHERE occurred_at IS NOT NULL
  )
  SELECT
    doctor_id,
    occurred_at AS last_activity_at,
    activity_type AS last_activity_type
  FROM ranked_activity
  WHERE activity_rank = 1
`;

function doctorKey(doctorId: number | null): string {
  return doctorId === null ? 'unassigned' : String(doctorId);
}

async function loadDoctorLastActivity(args: {
  dbBinding: Parameters<typeof getBaseDoctorPerformance>[0]['dbBinding'];
  tenantId: string;
  startDate: string;
  endDate: string;
}): Promise<Map<string, DoctorLastActivity>> {
  const db = getDb(args.dbBinding);
  const result = await db.$client.prepare(DOCTOR_LAST_ACTIVITY_SQL).bind(
    args.tenantId,
    args.startDate,
    args.endDate,
    args.tenantId,
    args.startDate,
    args.endDate,
    args.tenantId,
    args.startDate,
    args.endDate,
    args.tenantId,
    args.startDate,
    args.endDate,
  ).all<DoctorLastActivityDbRow>();

  return new Map((result.results ?? []).map((row) => [
    doctorKey(row.doctor_id === null || row.doctor_id === undefined ? null : Number(row.doctor_id)),
    {
      lastActivityAt: row.last_activity_at ?? null,
      lastActivityType: row.last_activity_type ?? null,
    },
  ]));
}

function reconciledMetric(input: {
  summaryTotal: number;
  detailRowCount: number;
  detailGrain: string;
  providerMode: 'legacy' | 'canonical';
}): FinancialReconciliationEnvelope {
  return buildFinancialReconciliation({
    summaryTotal: input.summaryTotal,
    detailTotal: input.summaryTotal,
    detailRowCount: input.detailRowCount,
    detailGrain: input.detailGrain,
    providerMode: input.providerMode === 'canonical' ? 'canonical_only' : 'legacy',
  });
}

function buildSummaryReconciliation(
  response: BaseDoctorPerformanceResponse,
): Record<string, FinancialReconciliationEnvelope> {
  const providerMode = response.queryContract.dataSource;
  return {
    visitCollection: reconciledMetric({
      summaryTotal: response.totals.visitCollection,
      detailRowCount: response.totals.visits,
      detailGrain: 'matching doctor visit collection facts',
      providerMode,
    }),
    testCollection: reconciledMetric({
      summaryTotal: response.totals.testCollection,
      detailRowCount: response.totals.referredTests,
      detailGrain: 'matching referred test collection facts',
      providerMode,
    }),
    payableCommission: reconciledMetric({
      summaryTotal: response.totals.payableCommission,
      detailRowCount: response.totalRows,
      detailGrain: 'matching doctor payable facts',
      providerMode,
    }),
    paidCommission: reconciledMetric({
      summaryTotal: response.totals.paidCommission,
      detailRowCount: response.totalRows,
      detailGrain: 'matching doctor paid commission facts',
      providerMode,
    }),
    outstandingCommission: reconciledMetric({
      summaryTotal: response.totals.outstandingCommission,
      detailRowCount: response.totalRows,
      detailGrain: 'matching doctor outstanding commission facts',
      providerMode,
    }),
  };
}

function buildDetailsReconciliation(
  response: BaseDoctorPerformanceDetailsResponse,
): Record<string, FinancialReconciliationEnvelope> {
  const providerMode = response.queryContract.dataSource;
  const reconciliation: Record<string, FinancialReconciliationEnvelope> = {};

  if (response.tab === 'visits') {
    reconciliation.visitCollection = reconciledMetric({
      summaryTotal: response.summary.visitCollection,
      detailRowCount: response.totalRows,
      detailGrain: 'matching doctor visit detail rows',
      providerMode,
    });
  }

  if (response.tab === 'tests' || response.tab === 'referred-tests' || response.tab === 'performed-tests') {
    reconciliation.testCollection = reconciledMetric({
      summaryTotal: response.summary.testCollection,
      detailRowCount: response.totalRows,
      detailGrain: 'matching doctor test detail rows',
      providerMode,
    });
  }

  if (response.tab === 'commissions') {
    reconciliation.payableCommission = reconciledMetric({
      summaryTotal: response.summary.payableCommission,
      detailRowCount: response.totalRows,
      detailGrain: 'matching doctor compensation detail rows',
      providerMode,
    });
    reconciliation.paidCommission = reconciledMetric({
      summaryTotal: response.summary.paidCommission,
      detailRowCount: response.totalRows,
      detailGrain: 'matching doctor compensation detail rows',
      providerMode,
    });
    reconciliation.outstandingCommission = reconciledMetric({
      summaryTotal: response.summary.outstandingCommission,
      detailRowCount: response.totalRows,
      detailGrain: 'matching doctor compensation detail rows',
      providerMode,
    });
  }

  return reconciliation;
}

export async function getDoctorPerformance(
  args: Parameters<typeof getBaseDoctorPerformance>[0],
): Promise<DoctorPerformanceResponse> {
  const [response, lastActivity] = await Promise.all([
    getBaseDoctorPerformance(args),
    loadDoctorLastActivity({
      dbBinding: args.dbBinding,
      tenantId: args.tenantId,
      startDate: args.period.startDate,
      endDate: args.period.endDate,
    }),
  ]);

  return {
    ...response,
    rows: response.rows.map((row) => ({
      ...row,
      ...(lastActivity.get(doctorKey(row.doctorId)) ?? {
        lastActivityAt: null,
        lastActivityType: null,
      }),
    })),
    reconciliation: buildSummaryReconciliation(response),
  };
}

export async function getDoctorPerformanceDetails(
  args: Parameters<typeof getBaseDoctorPerformanceDetails>[0],
): Promise<DoctorPerformanceDetailsResponse> {
  const response = await getBaseDoctorPerformanceDetails(args);
  return {
    ...response,
    reconciliation: buildDetailsReconciliation(response),
  };
}
