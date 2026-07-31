import type { D1Database } from '@cloudflare/workers-types';
import { HTTPException } from 'hono/http-exception';

export interface DoctorLabInboxSummary {
  total_reports: number;
  pending: number;
  abnormal: number;
  critical: number;
  needs_review: number;
}

export interface DoctorLabResultRow {
  id: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  test_name: string;
  result_value: string | null;
  unit: string | null;
  abnormal_flag: string | null;
  status: string;
  order_id: number;
  order_no: string | null;
  collected_at: string | null;
  ordered_at: string | null;
  is_acknowledged: number;
}

const ABNORMAL_FLAGS = new Set(['high', 'low', 'critical', 'critical_high', 'critical_low', 'abnormal']);
const CRITICAL_FLAGS = new Set(['critical', 'critical_high', 'critical_low']);

function doctorScopeSql(alias = 'lo'): string {
  return `(
    EXISTS (
      SELECT 1 FROM prescriptions pr
      WHERE pr.id = ${alias}.prescription_id
        AND pr.doctor_id = ?
        AND pr.tenant_id = ${alias}.tenant_id
    )
    OR ${alias}.ordered_by = ?
    OR EXISTS (
      SELECT 1 FROM appointments ap
      WHERE ap.patient_id = ${alias}.patient_id
        AND ap.doctor_id = ?
        AND ap.tenant_id = ${alias}.tenant_id
        AND ap.appt_date >= date('now', '-90 days')
    )
  )`;
}

function abnormalFlagFilter(flags: string[]): string {
  const normalized = flags.map((flag) => flag.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return '';
  const placeholders = normalized.map(() => '?').join(', ');
  return `AND COALESCE(loi.abnormal_flag, '') IN (${placeholders})`;
}

export async function fetchDoctorLabInboxSummary(
  db: D1Database,
  tenantId: string,
  doctorId: number,
  userId: string,
): Promise<DoctorLabInboxSummary> {
  const scope = doctorScopeSql('lo');
  const row = await db.prepare(`
    SELECT
      SUM(CASE WHEN loi.status IN ('completed', 'verified') AND COALESCE(loi.result, '') != '' THEN 1 ELSE 0 END) AS total_reports,
      SUM(CASE WHEN loi.status NOT IN ('completed', 'verified', 'cancelled') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN COALESCE(loi.abnormal_flag, '') IN ('high', 'low', 'abnormal') THEN 1 ELSE 0 END) AS abnormal,
      SUM(CASE WHEN COALESCE(loi.abnormal_flag, '') IN ('critical', 'critical_high', 'critical_low') THEN 1 ELSE 0 END) AS critical,
      SUM(CASE
        WHEN COALESCE(loi.abnormal_flag, '') IN ('high', 'low', 'critical', 'critical_high', 'critical_low', 'abnormal')
          AND COALESCE((
            SELECT COUNT(*) FROM lab_critical_acknowledgements lca
            WHERE lca.lab_order_item_id = loi.id AND lca.tenant_id = lo.tenant_id
          ), 0) = 0
        THEN 1 ELSE 0 END) AS needs_review
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
    WHERE lo.tenant_id = ?
      AND COALESCE(loi.result_status, '') <> 'retracted'
      AND ${scope}
  `).bind(tenantId, doctorId, userId, doctorId).first<{
    total_reports: number | null;
    pending: number | null;
    abnormal: number | null;
    critical: number | null;
    needs_review: number | null;
  }>();

  return {
    total_reports: Number(row?.total_reports ?? 0),
    pending: Number(row?.pending ?? 0),
    abnormal: Number(row?.abnormal ?? 0),
    critical: Number(row?.critical ?? 0),
    needs_review: Number(row?.needs_review ?? 0),
  };
}

export async function fetchDoctorLabResults(
  db: D1Database,
  options: {
    tenantId: string;
    doctorId: number;
    userId: string;
    limit?: number;
    status?: string | null;
    abnormalFlags?: string[] | null;
    search?: string | null;
    needsReviewOnly?: boolean;
  },
): Promise<DoctorLabResultRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const params: Array<string | number> = [options.tenantId, options.doctorId, options.userId, options.doctorId];
  const scope = doctorScopeSql('lo');

  let statusClause = '';
  if (options.status === 'pending') {
    statusClause = "AND loi.status NOT IN ('completed', 'verified', 'cancelled')";
  } else if (options.status === 'completed') {
    statusClause = "AND loi.status IN ('completed', 'verified')";
  }

  let abnormalClause = '';
  if (options.abnormalFlags?.length) {
    abnormalClause = abnormalFlagFilter(options.abnormalFlags);
    params.push(...options.abnormalFlags);
  }

  let reviewClause = '';
  if (options.needsReviewOnly) {
    reviewClause = `
      AND COALESCE(loi.abnormal_flag, '') IN ('high', 'low', 'critical', 'critical_high', 'critical_low', 'abnormal')
      AND COALESCE((
        SELECT COUNT(*) FROM lab_critical_acknowledgements lca
        WHERE lca.lab_order_item_id = loi.id AND lca.tenant_id = lo.tenant_id
      ), 0) = 0`;
  }

  let searchClause = '';
  if (options.search?.trim()) {
    searchClause = 'AND (p.name LIKE ? OR ltc.name LIKE ? OR p.patient_code LIKE ?)';
    const term = `%${options.search.trim()}%`;
    params.push(term, term, term);
  }

  params.push(limit);

  const { results } = await db.prepare(`
    SELECT
      loi.id,
      lo.patient_id,
      p.name AS patient_name,
      p.patient_code,
      COALESCE(ltc.name, 'Lab test') AS test_name,
      loi.result AS result_value,
      ltc.unit,
      loi.abnormal_flag,
      loi.status,
      lo.id AS order_id,
      lo.order_no,
      loi.completed_at AS collected_at,
      COALESCE(lo.order_date, lo.created_at) AS ordered_at,
      COALESCE((
        SELECT COUNT(*) FROM lab_critical_acknowledgements lca
        WHERE lca.lab_order_item_id = loi.id AND lca.tenant_id = lo.tenant_id
      ), 0) AS is_acknowledged
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
    JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
    LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = loi.tenant_id
    WHERE lo.tenant_id = ?
      AND COALESCE(loi.result_status, '') <> 'retracted'
      AND ${scope}
      ${statusClause}
      ${abnormalClause}
      ${reviewClause}
      ${searchClause}
    ORDER BY
      CASE COALESCE(loi.abnormal_flag, '') WHEN 'critical' THEN 0 WHEN 'critical_high' THEN 0 WHEN 'critical_low' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      COALESCE(loi.completed_at, lo.order_date, lo.created_at) DESC,
      loi.id DESC
    LIMIT ?
  `).bind(...params).all<DoctorLabResultRow>();

  return results ?? [];
}

export async function canDoctorAccessPatientLabResults(
  db: D1Database,
  tenantId: string,
  patientId: number,
  doctorId: number,
  userId: string,
): Promise<boolean> {
  const scope = doctorScopeSql('lo');
  const row = await db.prepare(`
    SELECT 1 AS allowed
    FROM lab_orders lo
    WHERE lo.tenant_id = ?
      AND lo.patient_id = ?
      AND ${scope}
    LIMIT 1
  `).bind(tenantId, patientId, doctorId, userId, doctorId).first<{ allowed: number }>();

  return row?.allowed === 1;
}

export function isAbnormalLabFlag(flag?: string | null): boolean {
  return ABNORMAL_FLAGS.has(String(flag ?? '').toLowerCase());
}

export function isCriticalLabFlag(flag?: string | null): boolean {
  return CRITICAL_FLAGS.has(String(flag ?? '').toLowerCase());
}

export async function resolveLinkedDoctorId(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<number | null> {
  const direct = await db.prepare(
    'SELECT id FROM doctors WHERE user_id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1',
  ).bind(userId, tenantId).first<{ id: number }>();
  if (direct?.id) return Number(direct.id);

  const viaStaff = await db.prepare(`
    SELECT d.id
    FROM staff s
    JOIN doctors d ON d.id = s.doctor_id AND d.tenant_id = s.tenant_id
    WHERE s.user_id = ? AND s.tenant_id = ? AND d.is_active = 1
    LIMIT 1
  `).bind(userId, tenantId).first<{ id: number }>();
  return viaStaff?.id ? Number(viaStaff.id) : null;
}

export async function requireLinkedDoctorId(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<number> {
  const doctorId = await resolveLinkedDoctorId(db, tenantId, userId);
  if (!doctorId) {
    throw new HTTPException(403, { message: 'Active doctor profile is required' });
  }
  return doctorId;
}
