import { getDb } from '../../db';
import type { Env } from '../../types';
import type { ExecutiveDashboardPeriod } from '../../lib/executive-dashboard-period';

export interface DoctorActivityRow {
  eventId: string;
  eventType: string;
  occurredAt: string;
  sourceType: string;
  sourceId: string;
  doctorId: number;
  billId: number | null;
  invoiceNo: string | null;
  patientId: number | null;
  patientName: string | null;
  patientIdentityRedacted: boolean;
  title: string;
  amount: number;
  status: string | null;
  reasonCode: string | null;
}

export interface DoctorActivityResponse {
  period: ExecutiveDashboardPeriod;
  doctorId: number;
  rows: DoctorActivityRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

type DoctorActivityDbRow = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  source_type: string;
  source_id: string | number;
  doctor_id: number;
  bill_id: number | null;
  invoice_no: string | null;
  patient_id: number | null;
  patient_name: string | null;
  title: string;
  amount: number | null;
  status: string | null;
  reason_code: string | null;
  total_rows: number;
};

const DOCTOR_ACTIVITY_SQL = `/* executive_doctor:activity */
  WITH input AS (
    SELECT
      CAST(? AS TEXT) AS tenant_id,
      date(?) AS start_date,
      date(?) AS end_date,
      CAST(? AS INTEGER) AS doctor_id
  ),
  activity_events AS (
    SELECT
      'visit:' || CAST(b.id AS TEXT) AS event_id,
      'visit' AS event_type,
      COALESCE(b.created_at, v.visit_date, b.updated_at) AS occurred_at,
      'bill' AS source_type,
      CAST(b.id AS TEXT) AS source_id,
      input.doctor_id AS doctor_id,
      b.id AS bill_id,
      COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS invoice_no,
      b.patient_id AS patient_id,
      p.name AS patient_name,
      'Doctor visit' AS title,
      ROUND(COALESCE(b.doctor_visit_bill, 0), 2) AS amount,
      b.status AS status,
      NULL AS reason_code
    FROM input
    JOIN bills b ON b.tenant_id = input.tenant_id
    LEFT JOIN visits v
      ON v.tenant_id = b.tenant_id
      AND v.id = b.visit_id
    LEFT JOIN patients p
      ON p.tenant_id = b.tenant_id
      AND p.id = b.patient_id
    WHERE COALESCE(NULLIF(v.doctor_id, 0), NULLIF(b.referring_doctor_id, 0)) = input.doctor_id
      AND date(COALESCE(b.created_at, v.visit_date, b.updated_at)) BETWEEN input.start_date AND input.end_date
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
      'test-referral:' || CAST(lo.id AS TEXT) AS event_id,
      'test_referred' AS event_type,
      COALESCE(lo.order_date, lo.created_at, b.created_at, b.updated_at) AS occurred_at,
      'lab_order' AS source_type,
      CAST(lo.id AS TEXT) AS source_id,
      input.doctor_id AS doctor_id,
      b.id AS bill_id,
      COALESCE(NULLIF(TRIM(b.invoice_no), ''), CASE WHEN b.id IS NOT NULL THEN 'BILL-' || b.id END) AS invoice_no,
      COALESCE(lo.patient_id, b.patient_id) AS patient_id,
      p.name AS patient_name,
      'Referred diagnostic order' AS title,
      0.0 AS amount,
      lo.status AS status,
      NULL AS reason_code
    FROM input
    JOIN lab_orders lo ON lo.tenant_id = input.tenant_id
    LEFT JOIN bills b
      ON b.tenant_id = lo.tenant_id
      AND b.id = lo.bill_id
    LEFT JOIN visits v
      ON v.tenant_id = b.tenant_id
      AND v.id = b.visit_id
    LEFT JOIN patients p
      ON p.tenant_id = lo.tenant_id
      AND p.id = COALESCE(lo.patient_id, b.patient_id)
    WHERE COALESCE(NULLIF(b.referring_doctor_id, 0), NULLIF(v.doctor_id, 0)) = input.doctor_id
      AND date(COALESCE(lo.order_date, lo.created_at, b.created_at, b.updated_at)) BETWEEN input.start_date AND input.end_date
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')

    UNION ALL

    SELECT
      'performer-reserve:' || CAST(r.id AS TEXT) AS event_id,
      CASE
        WHEN LOWER(COALESCE(r.status, 'reserved')) = 'paid' THEN 'performer_reserve_paid'
        WHEN LOWER(COALESCE(r.status, 'reserved')) = 'reversed' THEN 'performer_reserve_reversed'
        WHEN LOWER(COALESCE(r.status, 'reserved')) = 'cancelled' THEN 'performer_reserve_cancelled'
        ELSE 'test_performed'
      END AS event_type,
      COALESCE(r.paid_at, r.reversed_at, r.cancelled_at, r.reserved_at, r.updated_at) AS occurred_at,
      'diagnostic_performer_reserve' AS source_type,
      CAST(r.id AS TEXT) AS source_id,
      input.doctor_id AS doctor_id,
      r.bill_id AS bill_id,
      COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS invoice_no,
      r.patient_id AS patient_id,
      p.name AS patient_name,
      COALESCE(NULLIF(TRIM(r.test_name), ''), 'Performed diagnostic service') AS title,
      ROUND(COALESCE(r.reserved_amount, 0), 2) AS amount,
      r.status AS status,
      CASE
        WHEN LOWER(COALESCE(r.status, 'reserved')) = 'reversed' THEN 'reversal'
        WHEN LOWER(COALESCE(r.status, 'reserved')) = 'cancelled' THEN 'cancelled'
        ELSE NULL
      END AS reason_code
    FROM input
    JOIN diagnostic_performer_reserves r
      ON r.tenant_id = input.tenant_id
      AND NULLIF(r.assigned_doctor_id, 0) = input.doctor_id
    LEFT JOIN bills b
      ON b.tenant_id = r.tenant_id
      AND b.id = r.bill_id
    LEFT JOIN patients p
      ON p.tenant_id = r.tenant_id
      AND p.id = r.patient_id
    WHERE date(COALESCE(r.paid_at, r.reversed_at, r.cancelled_at, r.reserved_at, r.updated_at)) BETWEEN input.start_date AND input.end_date

    UNION ALL

    SELECT
      'commission:' || CAST(a.id AS TEXT) AS event_id,
      CASE
        WHEN LOWER(COALESCE(a.status, 'accrued')) = 'paid' THEN 'commission_paid'
        WHEN LOWER(COALESCE(a.status, 'accrued')) = 'cancelled' THEN 'commission_cancelled'
        ELSE 'commission_accrued'
      END AS event_type,
      COALESCE(a.paid_date, a.accrued_date, a.created_at, a.updated_at) AS occurred_at,
      'doctor_commission_accrual' AS source_type,
      CAST(a.id AS TEXT) AS source_id,
      input.doctor_id AS doctor_id,
      a.bill_id AS bill_id,
      COALESCE(NULLIF(TRIM(b.invoice_no), ''), CASE WHEN b.id IS NOT NULL THEN 'BILL-' || b.id END) AS invoice_no,
      a.patient_id AS patient_id,
      p.name AS patient_name,
      COALESCE(NULLIF(TRIM(a.notes), ''), 'Doctor commission') AS title,
      ROUND(COALESCE(a.payable_commission_amount, a.commission_amount, 0), 2) AS amount,
      a.status AS status,
      a.commission_reason_code AS reason_code
    FROM input
    JOIN doctor_commission_accruals a
      ON a.tenant_id = input.tenant_id
      AND NULLIF(a.doctor_id, 0) = input.doctor_id
    LEFT JOIN bills b
      ON b.tenant_id = a.tenant_id
      AND b.id = a.bill_id
    LEFT JOIN patients p
      ON p.tenant_id = a.tenant_id
      AND p.id = a.patient_id
    WHERE date(COALESCE(a.paid_date, a.accrued_date, a.created_at, a.updated_at)) BETWEEN input.start_date AND input.end_date

    UNION ALL

    SELECT
      'settlement:' || CAST(s.id AS TEXT) AS event_id,
      'commission_settled' AS event_type,
      COALESCE(s.reversed_at, s.settlement_date, s.created_at) AS occurred_at,
      'doctor_commission_settlement' AS source_type,
      CAST(s.id AS TEXT) AS source_id,
      input.doctor_id AS doctor_id,
      NULL AS bill_id,
      NULL AS invoice_no,
      NULL AS patient_id,
      NULL AS patient_name,
      'Commission settlement ' || COALESCE(NULLIF(TRIM(s.settlement_no), ''), CAST(s.id AS TEXT)) AS title,
      ROUND(COALESCE(NULLIF(s.net_paid_amount, 0), s.total_amount, 0), 2) AS amount,
      CASE WHEN s.reversed_at IS NOT NULL THEN 'reversed' ELSE 'paid' END AS status,
      CASE WHEN s.reversed_at IS NOT NULL THEN 'reversal' ELSE NULL END AS reason_code
    FROM input
    JOIN doctor_commission_settlements s
      ON s.tenant_id = input.tenant_id
      AND NULLIF(s.doctor_id, 0) = input.doctor_id
    WHERE date(COALESCE(s.reversed_at, s.settlement_date, s.created_at)) BETWEEN input.start_date AND input.end_date

    UNION ALL

    SELECT
      'accounting:' || CAST(e.id AS TEXT) AS event_id,
      e.event_type AS event_type,
      COALESCE(e.event_date, e.created_at, e.updated_at) AS occurred_at,
      'accounting_posting_event' AS source_type,
      CAST(e.id AS TEXT) AS source_id,
      input.doctor_id AS doctor_id,
      CAST(NULLIF(json_extract(e.payload_json, '$.billId'), '') AS INTEGER) AS bill_id,
      NULL AS invoice_no,
      CAST(NULLIF(json_extract(e.payload_json, '$.patientId'), '') AS INTEGER) AS patient_id,
      NULL AS patient_name,
      REPLACE(e.event_type, '_', ' ') AS title,
      ROUND(COALESCE(CAST(json_extract(e.payload_json, '$.amount') AS REAL), 0), 2) AS amount,
      e.status AS status,
      CASE
        WHEN e.event_type = 'commission_cancelled' THEN 'cancelled'
        WHEN LOWER(COALESCE(json_extract(e.payload_json, '$.reason'), '')) LIKE '%refund%' THEN 'refunded'
        WHEN LOWER(COALESCE(json_extract(e.payload_json, '$.reason'), '')) LIKE '%revers%' THEN 'reversal'
        ELSE NULL
      END AS reason_code
    FROM input
    JOIN accounting_posting_events e ON e.tenant_id = input.tenant_id
    WHERE CAST(NULLIF(json_extract(e.payload_json, '$.doctorId'), '') AS INTEGER) = input.doctor_id
      AND e.event_type IN ('commission_cancelled', 'commission_settled', 'credit_note_issued')
      AND date(COALESCE(e.event_date, e.created_at, e.updated_at)) BETWEEN input.start_date AND input.end_date
  ),
  deduplicated AS (
    SELECT
      activity_events.*,
      ROW_NUMBER() OVER (
        PARTITION BY event_id
        ORDER BY datetime(occurred_at) DESC, source_type ASC
      ) AS duplicate_rank
    FROM activity_events
    WHERE occurred_at IS NOT NULL
  ),
  paginated AS (
    SELECT
      deduplicated.*,
      COUNT(*) OVER () AS total_rows
    FROM deduplicated
    WHERE duplicate_rank = 1
    ORDER BY datetime(occurred_at) DESC, event_id ASC
  )
  SELECT *
  FROM paginated
  LIMIT ? OFFSET ?
`;

function roundMoney(value: unknown): number {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.round((numberValue + Number.EPSILON) * 100) / 100;
}

export async function getDoctorActivity(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  doctorId: number;
  page: number;
  pageSize: number;
  patientIdentityVisible: boolean;
}): Promise<DoctorActivityResponse> {
  const db = getDb(args.dbBinding);
  const offset = (args.page - 1) * args.pageSize;
  const result = await db.$client.prepare(DOCTOR_ACTIVITY_SQL).bind(
    args.tenantId,
    args.period.startDate,
    args.period.endDate,
    args.doctorId,
    args.pageSize,
    offset,
  ).all<DoctorActivityDbRow>();

  const rawRows = result.results ?? [];
  const totalRows = Number(rawRows[0]?.total_rows ?? 0);
  const rows = rawRows.map((row): DoctorActivityRow => {
    const hasPatientIdentity = row.patient_id !== null || Boolean(row.patient_name);
    const patientIdentityRedacted = hasPatientIdentity && !args.patientIdentityVisible;
    return {
      eventId: String(row.event_id),
      eventType: String(row.event_type),
      occurredAt: String(row.occurred_at),
      sourceType: String(row.source_type),
      sourceId: String(row.source_id),
      doctorId: Number(row.doctor_id),
      billId: row.bill_id === null || row.bill_id === undefined ? null : Number(row.bill_id),
      invoiceNo: row.invoice_no ?? null,
      patientId: patientIdentityRedacted || row.patient_id === null || row.patient_id === undefined
        ? null
        : Number(row.patient_id),
      patientName: patientIdentityRedacted ? null : row.patient_name ?? null,
      patientIdentityRedacted,
      title: String(row.title || 'Doctor activity'),
      amount: roundMoney(row.amount),
      status: row.status ?? null,
      reasonCode: row.reason_code ?? null,
    };
  });

  return {
    period: args.period,
    doctorId: args.doctorId,
    rows,
    page: args.page,
    pageSize: args.pageSize,
    totalRows,
    hasNextPage: offset + rows.length < totalRows,
  };
}
