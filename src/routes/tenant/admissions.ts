import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  createAdmissionSchema,
  updateAdmissionSchema,
  createBedSchema,
  updateBedSchema,
  transferBedSchema,
  cancelAdmissionSchema,
  cancelDischargeSchema,
  provisionalDischargeSchema,
  undoProvisionalDischargeSchema,
  bedFeatureSchema,
  bedFeatureMapSchema,
  bedReservationSchema,
  updateReservationSchema,
  reasonSchema,
  remarkSchema,
  doctorUpdateSchema,
  procedureUpdateSchema,
  policeCaseSchema,
  hemodialysisReportSchema,
  autoBillingItemSchema,
  depositSettingSchema,
  schemePriceMapSchema,
  birthDetailSchema,
} from '../../schemas/admission';
import { getNextSequence } from '../../lib/sequence';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';
import { assertNoPendingDischargeBilling } from '../../lib/discharge-billing-guards';
import { ensureLiveAdmissionContinuity, normalizeLegacyAdmissionStartedAtUtc } from '../../lib/canonical/live-admission-continuity';
import { normalizeLegacyAdmissionInstantUtc } from '../../lib/admission-time';
import {
  reserveBed as reserveBedRow,
  releaseBedToAvailable,
  lockBedForTransfer,
  assertBedAllocationOk,
  type DbExecutor,
} from '../../lib/bed-allocation';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyReplay,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const IPD_ADMIN_CONFIG_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

function withCanonicalAdmissionTime<T extends Record<string, unknown>>(row: T): T & { admitted_at_utc: string | null } {
  const admissionDate = row.admission_date ?? row.admitted_date;
  if (!admissionDate) return { ...row, admitted_at_utc: null };

  try {
    return {
      ...row,
      admitted_at_utc: normalizeLegacyAdmissionInstantUtc({
        admissionDate: String(admissionDate),
        createdAt: row.created_at ? String(row.created_at) : null,
        naiveSemantics: 'infer',
      }),
    };
  } catch {
    return { ...row, admitted_at_utc: null };
  }
}
const IPD_DEPOSIT_CONFIG_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;
const IPD_CLINICAL_RECORD_ROLES = ['doctor', 'nurse', 'hospital_admin', 'md'] as const;

function assertIpdRole(c: any, allowedRoles: readonly string[], message: string): void {
  const role = c.get('role');
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message });
  }
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).bind(tableName).first<{ name: string }>();
  return Boolean(row);
}

// GET /api/admissions?status=all|admitted|discharged|...&search=&page=&perPage=
app.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const status = c.req.query('status') || 'all';
  const search = c.req.query('search') || '';
  const doctorId = c.req.query('doctorId');
  const parsedPage = parseInt(c.req.query('page') || '1', 10);
  const parsedPerPage = parseInt(c.req.query('perPage') || '20', 10);
  const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
  const perPage = Number.isFinite(parsedPerPage) ? Math.min(100, Math.max(10, parsedPerPage)) : 20;
  const offset = (page - 1) * perPage;

  const finalBillDepositAdjustedExpression = `COALESCE((
    SELECT SUM(COALESCE(bd.amount, 0))
    FROM billing_deposits bd
    WHERE bd.tenant_id = bill.tenant_id
      AND bd.reference_bill_id = bill.id
      AND bd.transaction_type = 'adjustment'
      AND COALESCE(bd.is_active, 1) = 1
  ), 0)`;
  const finalBillSettledAmountExpression = `(COALESCE(bill.paid, 0) + ${finalBillDepositAdjustedExpression})`;
  const finalBillCalculatedDueExpression = `MAX(0, COALESCE(bill.total, 0) - ${finalBillSettledAmountExpression})`;
  const finalBillDueExpression = `MIN(MAX(0, COALESCE(bill.due, ${finalBillCalculatedDueExpression})), ${finalBillCalculatedDueExpression})`;

  let sql = `
    SELECT a.*, p.name AS patient_name, p.patient_code, p.mobile AS patient_mobile,
           b.ward_name, b.bed_number, b.bed_type,
           d.name AS doctor_name,
           bill.id AS final_bill_id, bill.invoice_no AS final_invoice_no, bill.status AS final_bill_status,
           bill.total AS final_bill_total_amount,
           ${finalBillSettledAmountExpression} AS final_bill_paid_amount,
           ${finalBillDepositAdjustedExpression} AS final_bill_deposit_adjusted_amount,
           ${finalBillDueExpression} AS final_bill_due_amount
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    LEFT JOIN bills bill ON bill.id = (
      SELECT b2.id FROM bills b2
      WHERE b2.tenant_id = a.tenant_id
        AND b2.patient_id = a.patient_id
        AND COALESCE(b2.status, '') NOT IN ('cancelled', 'refunded', 'draft')
        AND (
          b2.admission_id = a.id
          OR EXISTS (
            SELECT 1
            FROM billing_provisional_items bpi
            WHERE bpi.tenant_id = b2.tenant_id
              AND bpi.admission_id = a.id
              AND bpi.billed_bill_id = b2.id
              AND COALESCE(bpi.is_active, 1) = 1
              AND bpi.bill_status IN ('finalized', 'billed')
          )
          OR EXISTS (
            SELECT 1
            FROM patient_bed_infos pbi
            WHERE pbi.tenant_id = b2.tenant_id
              AND pbi.admission_id = a.id
              AND pbi.billed_bill_id = b2.id
              AND pbi.is_billed = 1
          )
        )
      ORDER BY b2.created_at DESC, b2.id DESC
      LIMIT 1
    )
    WHERE a.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (status !== 'all') { sql += ' AND a.status = ?'; params.push(status); }
  if (doctorId && !isNaN(Number(doctorId))) { sql += ' AND a.doctor_id = ?'; params.push(Number(doctorId)); }
  if (search) {
    sql += ` AND (p.name LIKE ? OR p.patient_code LIKE ? OR a.admission_no LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  // Count total from the same filtered admission set. Keep this as a wrapper so
  // adding dashboard/print helper columns above does not break the count query.
  const countSql = `SELECT COUNT(*) as total FROM (${sql}) admission_count`;
  const countParams = [...params];
  const countRow = await db.$client.prepare(countSql).bind(...countParams).first<{ total: number }>();

  if (status === 'all') {
    sql += " ORDER BY CASE WHEN a.status IN ('admitted', 'critical') THEN 0 ELSE 1 END ASC, a.admission_date DESC LIMIT ? OFFSET ?";
  } else {
    sql += ' ORDER BY a.admission_date DESC LIMIT ? OFFSET ?';
  }
  params.push(perPage, offset);

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ admissions: results, total: countRow?.total ?? 0, page, perPage });
});

// GET /api/admissions/stats
app.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const today = getTodayGMT6();

  // ⚡ BOLT OPTIMIZATION: batch all independent queries in a single round-trip
  const batchResults = await db.$client.batch([
    // [0] Bed status counts (for stats + ward map)
    db.$client.prepare(
      `SELECT status, COUNT(*) AS cnt FROM beds WHERE tenant_id = ? GROUP BY status`
    ).bind(tenantId),
    // [1] Total beds count
    db.$client.prepare(
      `SELECT COUNT(*) AS cnt FROM beds WHERE tenant_id = ?`
    ).bind(tenantId),
    // [2] Discharges today
    db.$client.prepare(
      `SELECT COUNT(*) AS cnt FROM admissions WHERE tenant_id = ? AND status = 'discharged' AND DATE(discharge_date) = ?`
    ).bind(tenantId, today),
    // [3] Average stay days
    db.$client.prepare(
      `SELECT AVG(julianday(discharge_date) - julianday(admission_date)) AS avg_days FROM admissions WHERE tenant_id = ? AND discharge_date IS NOT NULL`
    ).bind(tenantId),
    // [4] Bed map by ward with patient names
    db.$client.prepare(
      `SELECT id, bed_number, ward_name, status,
         (SELECT name FROM patients WHERE id = (
           SELECT patient_id FROM admissions
           WHERE bed_id = beds.id AND tenant_id = ? AND status IN ('admitted','critical')
           ORDER BY admission_date DESC LIMIT 1
         )) AS patient_name
       FROM beds WHERE tenant_id = ? ORDER BY ward_name, bed_number`
    ).bind(tenantId, tenantId),
    // [5] Active admissions for patient list
    db.$client.prepare(
      `SELECT a.id, p.name AS patient_name, b.bed_number, b.ward_name,
         COALESCE(d.name, '—') AS doctor_name, a.admission_date, a.provisional_diagnosis AS diagnosis,
         CAST(julianday('now') - julianday(a.admission_date) AS INTEGER) AS days_admitted
       FROM admissions a
       JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
       LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
       LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
       WHERE a.tenant_id = ? AND a.status IN ('admitted','critical')
       ORDER BY a.admission_date DESC
       LIMIT 100`
    ).bind(tenantId),
    // [6] Discharge pending
    db.$client.prepare(
      `SELECT a.id, p.name AS patient_name, b.bed_number, b.ward_name,
         COALESCE(d.name, '—') AS doctor_name, a.discharge_approved,
         CASE WHEN a.id IN (SELECT DISTINCT admission_id FROM billing_provisional_items WHERE tenant_id = ? AND bill_status = 'provisional' AND COALESCE(is_active, 1) = 1) THEN 1 ELSE 0 END AS pending_bill
       FROM admissions a
       JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
       LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
       LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
       WHERE a.tenant_id = ? AND a.discharge_initiated = 1
       ORDER BY a.discharge_initiated_at DESC
       LIMIT 50`
    ).bind(tenantId, tenantId),
  ]);

  const [
    bedStatusBatch,
    totalBedsBatch,
    dischTodayBatch,
    avgStayBatch,
    wardRowsBatch,
    admRowsBatch,
    dischPendingBatch,
  ] = batchResults;

  // Compute derived values from batch results
  const statusMap: Record<string, number> = {};
  for (const row of (bedStatusBatch.results || []) as Array<{ status: string; cnt: number }>) {
    statusMap[row.status] = row.cnt;
  }
  const totalBeds = (totalBedsBatch.results?.[0] as { cnt: number } | undefined)?.cnt ?? 0;
  const occupied = (statusMap.occupied ?? 0) + (statusMap.critical ?? 0);
  const available = statusMap.available ?? 0;
  const cleaning = statusMap.cleaning ?? 0;
  const maintenance = statusMap.maintenance ?? 0;
  const reserved = statusMap.reserved ?? 0;
  const occupancyPercentage = totalBeds > 0 ? Math.round((occupied / totalBeds) * 100) : 0;
  const dischargesToday = (dischTodayBatch.results?.[0] as { cnt: number } | undefined)?.cnt ?? 0;
  const avgStayDays = Math.round(((avgStayBatch.results?.[0] as { avg_days: number } | undefined)?.avg_days ?? 0) * 100) / 100;

  // Bed map by ward
  const wardMap = new Map<string, Array<{ id: string; number: string; status: string; patientName: string | null }>>();
  for (const b of (wardRowsBatch.results || []) as Array<{ id: number; bed_number: string; ward_name: string; status: string; patient_name: string | null }>) {
    const wardName = b.ward_name || 'Unassigned';
    if (!wardMap.has(wardName)) wardMap.set(wardName, []);
    wardMap.get(wardName)!.push({
      id: String(b.id),
      number: b.bed_number,
      status: b.status,
      patientName: b.patient_name,
    });
  }
  const wards = Array.from(wardMap.entries()).map(([name, beds]) => ({ name, beds }));

  // Active admissions
  const admissions = ((admRowsBatch.results || []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    patientName: r.patient_name as string,
    bedNumber: (r.bed_number as string) ?? '—',
    wardName: (r.ward_name as string) ?? '—',
    doctorName: r.doctor_name as string,
    admissionDate: r.admission_date as string,
    diagnosis: (r.diagnosis as string) ?? '—',
    daysAdmitted: (r.days_admitted as number) ?? 0,
  }));

  // Discharge pending
  const dischargePending = ((dischPendingBatch.results || []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    patientName: r.patient_name as string,
    bedNumber: (r.bed_number as string) ?? '—',
    wardName: (r.ward_name as string) ?? '—',
    doctorName: r.doctor_name as string,
    dischargeApproved: Boolean(r.discharge_approved),
    pendingBill: Boolean(r.pending_bill),
  }));

  return c.json({
    stats: {
      totalBeds,
      occupied,
      available,
      cleaning,
      maintenance,
      reserved,
      occupancyPercentage,
      dischargesToday,
      avgStayDays,
    },
    wards,
    admissions,
    dischargePending,
  });
});

// GET /api/admissions/occupancy — bed occupancy rates by ward
app.get('/occupancy', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  try {
    const wards = await db.$client.prepare(`
      SELECT
        ward_name,
        COUNT(*) as total_beds,
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied_beds,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_beds
      FROM beds
      WHERE tenant_id = ?
      GROUP BY ward_name
      ORDER BY ward_name
    `).bind(tenantId).all<{
      ward_name: string; total_beds: number; occupied_beds: number; available_beds: number;
    }>();

    const wardStats = (wards.results || []).map((w) => ({
      ward: w.ward_name,
      total: w.total_beds,
      occupied: w.occupied_beds,
      available: w.available_beds,
      occupancyRate: w.total_beds > 0 ? Math.round((w.occupied_beds / w.total_beds) * 100) : 0,
    }));

    const totalBeds = wardStats.reduce((s, w) => s + w.total, 0);
    const totalOccupied = wardStats.reduce((s, w) => s + w.occupied, 0);

    return c.json({
      wards: wardStats,
      overall: {
        totalBeds,
        occupied: totalOccupied,
        available: totalBeds - totalOccupied,
        occupancyRate: totalBeds > 0 ? Math.round((totalOccupied / totalBeds) * 100) : 0,
      },
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch occupancy rates' });
  }
});

// GET /api/admissions/discharge-conditions — lookup
app.get('/discharge-conditions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const { results } = await db.$client.prepare(`
    SELECT id, name, description FROM discharge_condition_types
    WHERE (tenant_id = ? OR tenant_id = 0) AND is_active = 1
    ORDER BY display_order
  `).bind(tenantId).all();

  return c.json({ conditions: results });
});

app.get('/death-types', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const { results } = await db.$client.prepare(`
    SELECT * FROM death_types
    WHERE (tenant_id = ? OR tenant_id = '0') AND is_active = 1
    ORDER BY display_order, name
  `).bind(String(tenantId)).all();
  return c.json({ death_types: results });
});

app.get('/birth-conditions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const { results } = await db.$client.prepare(`
    SELECT * FROM baby_birth_conditions
    WHERE (tenant_id = ? OR tenant_id = '0') AND is_active = 1
    ORDER BY display_order, name
  `).bind(String(tenantId)).all();
  return c.json({ birth_conditions: results });
});

// GET /api/admissions/beds?status=available
app.get('/beds', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const status = c.req.query('status');
  let sql = 'SELECT * FROM beds WHERE tenant_id = ?';
  const params: (string | number)[] = [tenantId];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY ward_name, bed_number';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ beds: results });
});

// GET /api/admissions/beds/:id — single bed with feature_ids
app.get('/beds/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const bedId = Number(c.req.param('id'));

  const bed = await db.$client.prepare(
    'SELECT * FROM beds WHERE id = ? AND tenant_id = ?'
  ).bind(bedId, tenantId).first();

  if (!bed) throw new HTTPException(404, { message: 'Bed not found' });

  const { results: features } = await db.$client.prepare(
    'SELECT feature_id FROM bed_feature_map WHERE bed_id = ? AND tenant_id = ?'
  ).bind(bedId, tenantId).all();

  return c.json({
    bed: { ...bed, feature_ids: features.map((f: any) => f.feature_id) }
  });
});

// POST /api/admissions/beds — add a new bed (Zod validated)
app.post('/beds', zValidator('json', createBedSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['hospital_admin', 'director', 'md', 'reception'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to create beds' });
  }

  const data = c.req.valid('json');

  await db.$client.prepare(
    `INSERT INTO beds (tenant_id, ward_name, bed_number, bed_type, rate_per_day, floor, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    tenantId, data.ward_name, data.bed_number,
    data.bed_type, data.rate_per_day ?? 0, data.floor ?? null, data.notes ?? null
  ).run();

  return c.json({ success: true }, 201);
});

// PUT /api/admissions/beds/:id — update bed status (Zod validated)
app.put('/beds/:id', zValidator('json', updateBedSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['hospital_admin', 'director', 'md', 'reception'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update beds' });
  }

  const id = c.req.param('id');
  const data = c.req.valid('json');

  // Reception can only update status
  if (role === 'reception') {
    const allowedFields = ['status'];
    const requestedFields = Object.keys(data).filter(k => data[k as keyof typeof data] !== undefined);
    const hasDisallowedFields = requestedFields.some(f => !allowedFields.includes(f));
    if (hasDisallowedFields) {
      throw new HTTPException(403, { message: 'Reception can only update bed status' });
    }
  }

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (data.ward_name !== undefined) { sets.push('ward_name = ?'); vals.push(data.ward_name); }
  if (data.bed_number !== undefined) { sets.push('bed_number = ?'); vals.push(data.bed_number); }
  if (data.bed_type !== undefined) { sets.push('bed_type = ?'); vals.push(data.bed_type); }
  if (data.floor !== undefined) { sets.push('floor = ?'); vals.push(data.floor); }
  if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status); }
  if (data.rate_per_day !== undefined) { sets.push('rate_per_day = ?'); vals.push(data.rate_per_day); }
  if (data.notes !== undefined) { sets.push('notes = ?'); vals.push(data.notes); }
  if (sets.length === 0) return c.json({ success: true });

  await db.$client.prepare(
    `UPDATE beds SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals, id, tenantId).run();

  return c.json({ success: true });
});

// PUT /api/admissions/beds/:id/clear-cleaning — mark bed as available after cleaning
app.put('/beds/:id/clear-cleaning', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['hospital_admin', 'director', 'md', 'nurse'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update bed status' });
  }

  const id = c.req.param('id');
  const bed = await db.$client.prepare(
    `SELECT status FROM beds WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ status: string }>();

  if (!bed) throw new HTTPException(404, { message: 'Bed not found' });
  if (bed.status !== 'cleaning') {
    throw new HTTPException(400, { message: `Bed is not in cleaning status (current: ${bed.status})` });
  }

  await db.$client.prepare(
    `UPDATE beds SET status = 'available' WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).run();

  return c.json({ success: true });
});

// GET /api/admissions/wards — list distinct ward names with bed status counts
app.get('/wards', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const { results } = await db.$client.prepare(`
    SELECT
      ward_name,
      COUNT(*) as total_beds,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
      SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance,
      SUM(CASE WHEN status = 'cleaning' THEN 1 ELSE 0 END) as cleaning,
      SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved
    FROM beds
    WHERE tenant_id = ?
    GROUP BY ward_name
    ORDER BY ward_name
  `).bind(String(tenantId)).all();

  return c.json({ wards: results });
});

// PUT /api/admissions/wards/:name — rename a ward (bulk update beds)
app.put('/wards/:name', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['hospital_admin', 'director', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to rename wards' });
  }

  const oldName = c.req.param('name');
  const body = await c.req.json<{ new_name?: string; name?: string }>();
  const requestedName = body.new_name ?? body.name;
  if (!requestedName || !requestedName.trim()) {
    throw new HTTPException(400, { message: 'new_name is required' });
  }

  const userId = requireUserId(c);
  const newName = requestedName.trim();

  const existing = await db.$client.prepare(
    `SELECT COUNT(*) as cnt FROM beds WHERE ward_name = ? AND tenant_id = ?`
  ).bind(oldName, tenantId).first<{ cnt: number }>();

  if (!existing || existing.cnt === 0) {
    throw new HTTPException(404, { message: 'Ward not found' });
  }

  await db.$client.prepare(
    `UPDATE beds SET ward_name = ? WHERE ward_name = ? AND tenant_id = ?`
  ).bind(newName, oldName, tenantId).run();

  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'beds', 0, { ward_name: oldName }, { ward_name: newName });

  return c.json({ success: true, renamed: existing.cnt });
});

// DELETE /api/admissions/wards/:name — delete a ward (only if no beds assigned)
app.delete('/wards/:name', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['hospital_admin', 'director', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to delete wards' });
  }

  const name = c.req.param('name');

  const bedCount = await db.$client.prepare(
    `SELECT COUNT(*) as cnt FROM beds WHERE ward_name = ? AND tenant_id = ?`
  ).bind(name, tenantId).first<{ cnt: number }>();

  if (bedCount && bedCount.cnt > 0) {
    throw new HTTPException(400, { message: 'Cannot delete ward with beds assigned. Remove or reassign beds first.' });
  }

  return c.json({ success: true });
});

// DELETE /api/admissions/beds/:id — delete a bed (only if not occupied)
app.delete('/beds/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['hospital_admin', 'director', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to delete beds' });
  }

  const id = c.req.param('id');
  const bed = await db.$client.prepare(
    `SELECT id, status, ward_name, bed_number FROM beds WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: number; status: string; ward_name: string; bed_number: string }>();

  if (!bed) throw new HTTPException(404, { message: 'Bed not found' });
  if (bed.status === 'occupied') {
    throw new HTTPException(400, { message: 'Cannot delete an occupied bed. Discharge or transfer the patient first.' });
  }

  const userId = requireUserId(c);

  await db.$client.prepare(
    `DELETE FROM beds WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).run();

  await createAuditLog(c.env, tenantId, userId ?? 'system', 'DELETE', 'beds', Number(id), bed, null);

  return c.json({ success: true });
});

// GET /api/admissions/bed-features — Danphe-style bed feature catalog
app.get('/bed-features', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const { results } = await db.$client.prepare(`
    SELECT * FROM bed_features
    WHERE (tenant_id = ? OR tenant_id = '0') AND is_active = 1
    ORDER BY name
  `).bind(String(tenantId)).all();

  return c.json({ features: results });
});

app.post('/bed-features', zValidator('json', bedFeatureSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['hospital_admin', 'director', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to manage bed features' });
  }
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO bed_features (tenant_id, name, description, rate_per_day, is_active)
    VALUES (?, ?, ?, ?, ?)
  `).bind(String(tenantId), data.name, data.description ?? null, data.rate_per_day ?? 0, data.is_active ?? 1).run();

  return c.json({ id: result.meta.last_row_id }, 201);
});

app.put('/bed-features/:id', zValidator('json', bedFeatureSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['hospital_admin', 'director', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to manage bed features' });
  }
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.description !== undefined) { sets.push('description = ?'); vals.push(data.description); }
  if (data.rate_per_day !== undefined) { sets.push('rate_per_day = ?'); vals.push(data.rate_per_day); }
  if (data.is_active !== undefined) { sets.push('is_active = ?'); vals.push(data.is_active); }
  if (sets.length === 0) return c.json({ success: true });

  await db.$client.prepare(`UPDATE bed_features SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
    .bind(...vals, id, String(tenantId)).run();
  return c.json({ success: true });
});

// GET/PUT /api/admissions/beds/:id/features — map features to a bed
app.get('/beds/:id/features', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = Number(c.req.param('id'));
  const { results } = await db.$client.prepare(`
    SELECT bf.*
    FROM bed_feature_map bfm
    JOIN bed_features bf ON bf.id = bfm.feature_id
    WHERE bfm.tenant_id = ? AND bfm.bed_id = ? AND bf.is_active = 1
    ORDER BY bf.name
  `).bind(String(tenantId), id).all();
  return c.json({ features: results });
});

app.put('/beds/:id/features', zValidator('json', bedFeatureMapSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['hospital_admin', 'director', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to manage bed features' });
  }
  const bedId = Number(c.req.param('id'));
  const { feature_ids } = c.req.valid('json');
  const stmts: D1PreparedStatement[] = [
    db.$client.prepare('DELETE FROM bed_feature_map WHERE tenant_id = ? AND bed_id = ?').bind(String(tenantId), bedId),
  ];
  for (const featureId of feature_ids) {
    stmts.push(db.$client.prepare(
      'INSERT OR IGNORE INTO bed_feature_map (tenant_id, bed_id, feature_id) VALUES (?, ?, ?)'
    ).bind(String(tenantId), bedId, featureId));
  }
  await db.$client.batch(stmts);
  return c.json({ success: true });
});

// GET /api/admissions/available-beds-with-pricing — grouped selector data
app.get('/available-beds-with-pricing', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const { results } = await db.$client.prepare(`
    SELECT b.*,
      GROUP_CONCAT(bf.name, ', ') AS feature_names,
      COALESCE(MAX(NULLIF(bf.rate_per_day, 0)), b.rate_per_day, 0) AS effective_rate
    FROM beds b
    LEFT JOIN bed_feature_map bfm ON bfm.bed_id = b.id AND bfm.tenant_id = b.tenant_id
    LEFT JOIN bed_features bf ON bf.id = bfm.feature_id
    WHERE b.tenant_id = ? AND b.status = 'available'
    GROUP BY b.id
    ORDER BY b.ward_name, b.bed_number
  `).bind(tenantId).all();

  const grouped = (results || []).reduce<Record<string, Record<string, unknown>[]>>((acc, row: any) => {
    const key = `${row.ward_name || 'Ward'} / ${row.feature_names || row.bed_type || 'General'}`;
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {});

  return c.json({ beds: results, grouped });
});

// Bed reservations
app.get('/bed-reservations', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const status = c.req.query('status') || 'reserved';

  await db.$client.prepare(`
    UPDATE bed_reservations SET status = 'expired', updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND status = 'reserved' AND reserved_to IS NOT NULL AND reserved_to < datetime('now', '+6 hours')
  `).bind(String(tenantId)).run();

  let sql = `
    SELECT br.*, p.name AS patient_name, p.patient_code, b.ward_name, b.bed_number
    FROM bed_reservations br
    JOIN patients p ON p.id = br.patient_id AND p.tenant_id = br.tenant_id
    JOIN beds b ON b.id = br.bed_id AND b.tenant_id = br.tenant_id
    WHERE br.tenant_id = ?
  `;
  const params: (string | number)[] = [String(tenantId)];
  if (status !== 'all') { sql += ' AND br.status = ?'; params.push(status); }
  sql += ' ORDER BY br.reserved_from DESC LIMIT 100';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ reservations: results });
});

app.post('/bed-reservations', zValidator('json', bedReservationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const data = c.req.valid('json');

  // Atomic reserve: fail with 404/409 if the bed is not currently available
  // (P0-25). This replaces the previous read-then-update pattern.
  const reserveResult = await reserveBedRow(db.$client as unknown as DbExecutor, {
    tenantId,
    bedId: data.bed_id,
  });
  assertBedAllocationOk(reserveResult, `Bed ${data.bed_id}`, 'reservation');

  const result = await db.$client.batch([
    db.$client.prepare(`
      INSERT INTO bed_reservations (tenant_id, patient_id, bed_id, reserved_from, reserved_to, remarks, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(String(tenantId), data.patient_id, data.bed_id, data.reserved_from, data.reserved_to ?? null, data.remarks ?? null, userId ?? 'system'),
  ]);

  return c.json({ id: result[0].meta.last_row_id }, 201);
});

app.put('/bed-reservations/:id', zValidator('json', updateReservationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const reservation = await db.$client.prepare(
    'SELECT bed_id, status FROM bed_reservations WHERE id = ? AND tenant_id = ?'
  ).bind(id, String(tenantId)).first<{ bed_id: number; status: string }>();
  if (!reservation) throw new HTTPException(404, { message: 'Reservation not found' });

  const stmts: D1PreparedStatement[] = [
    db.$client.prepare(`
      UPDATE bed_reservations SET status = ?, remarks = COALESCE(?, remarks), updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(data.status, data.remarks ?? null, id, String(tenantId)),
  ];
  if (['cancelled', 'expired'].includes(data.status)) {
    stmts.push(db.$client.prepare("UPDATE beds SET status = 'available' WHERE id = ? AND tenant_id = ?")
      .bind(reservation.bed_id, tenantId));
  }
  await db.$client.batch(stmts);
  return c.json({ success: true });
});

// GET /api/admissions/check/:patientId — active admission guard
app.get('/check/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const patientId = Number(c.req.param('patientId'));
  const admission = await db.$client.prepare(`
    SELECT a.*, b.ward_name, b.bed_number
    FROM admissions a
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status IN ('admitted','critical','transferred')
    ORDER BY a.admission_date DESC LIMIT 1
  `).bind(tenantId, patientId).first();
  return c.json({ is_admitted: !!admission, admission: admission ?? null });
});

// GET /api/admissions/history/:patientId — past admissions
app.get('/history/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const patientId = Number(c.req.param('patientId'));
  const { results } = await db.$client.prepare(`
    SELECT a.*, b.ward_name, b.bed_number, d.name AS doctor_name
    FROM admissions a
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.patient_id = ?
    ORDER BY a.admission_date DESC
  `).bind(tenantId, patientId).all();
  return c.json({ admissions: results });
});

// GET /api/admissions/ward-bed-overview — visual bed map source
app.get('/ward-bed-overview', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const { results } = await db.$client.prepare(`
    SELECT b.id AS bed_id, b.ward_name, b.bed_number, b.bed_type, b.status, b.floor,
           b.rate_per_day,
           a.id AS admission_id, a.admission_no, a.patient_id, a.status AS admission_status,
           a.admission_date, a.doctor_id, a.discharge_initiated, a.discharge_approved,
           p.name AS patient_name, p.patient_code, p.age AS patient_age, p.gender AS patient_gender,
           p.mobile AS patient_mobile, p.blood_group AS patient_blood_group,
           d.name AS doctor_name,
           GROUP_CONCAT(bf.name, ', ') AS feature_names,
           COALESCE(MAX(NULLIF(bf.rate_per_day, 0)), b.rate_per_day, 0) AS effective_rate
    FROM beds b
    LEFT JOIN admissions a ON a.bed_id = b.id AND a.tenant_id = b.tenant_id AND a.status IN ('admitted','critical','transferred')
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    LEFT JOIN bed_feature_map bfm ON bfm.bed_id = b.id AND bfm.tenant_id = b.tenant_id
    LEFT JOIN bed_features bf ON bf.id = bfm.feature_id
    WHERE b.tenant_id = ?
    GROUP BY b.id
    ORDER BY b.ward_name, b.bed_number
  `).bind(tenantId).all();

  const bedRows = (results || []) as Record<string, unknown>[];
  if (await tableExists(c.env.DB, 'bed_equipment_map')) {
    const { results: issueRows } = await db.$client.prepare(`
      SELECT bed_id,
             COUNT(*) AS equipment_count,
             SUM(CASE WHEN status IN ('faulty','maintenance','missing') THEN 1 ELSE 0 END) AS equipment_issue_count
      FROM bed_equipment_map
      WHERE tenant_id = ? AND is_active = 1
      GROUP BY bed_id
    `).bind(String(tenantId)).all<Record<string, unknown>>();
    const issueMap = new Map(issueRows.map((row) => [Number(row.bed_id), row]));
    for (const bed of bedRows) {
      const stats = issueMap.get(Number(bed.bed_id));
      bed.equipment_count = Number(stats?.equipment_count ?? 0);
      bed.equipment_issue_count = Number(stats?.equipment_issue_count ?? 0);
    }
  } else {
    for (const bed of bedRows) {
      bed.equipment_count = 0;
      bed.equipment_issue_count = 0;
    }
  }

  const wards = bedRows.reduce<Record<string, Record<string, unknown>[]>>((acc, row: any) => {
    acc[row.ward_name] = acc[row.ward_name] || [];
    acc[row.ward_name].push(row);
    return acc;
  }, {});

  return c.json({ beds: bedRows, wards });
});

// GET /api/admissions/beds/:id/command-detail — selected-bed drawer data
app.get('/beds/:id/command-detail', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const bedId = Number(c.req.param('id'));
  if (!Number.isFinite(bedId) || bedId <= 0) {
    throw new HTTPException(400, { message: 'Valid bed id required' });
  }

  const bed = await db.$client.prepare(
    `SELECT * FROM beds WHERE id = ? AND tenant_id = ?`
  ).bind(bedId, tenantId).first<Record<string, unknown>>();

  if (!bed) throw new HTTPException(404, { message: 'Bed not found' });

  const activeAdmission = await db.$client.prepare(`
    SELECT a.*, p.name AS patient_name, p.patient_code, p.age AS patient_age,
           p.gender AS patient_gender, p.mobile AS patient_mobile,
           p.blood_group AS patient_blood_group, p.date_of_birth,
           d.name AS doctor_name
    FROM admissions a
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.bed_id = ? AND a.status IN ('admitted','critical','transferred')
    ORDER BY a.admission_date DESC LIMIT 1
  `).bind(tenantId, bedId).first<Record<string, unknown>>();

  const { results: features } = await db.$client.prepare(`
    SELECT bf.id, bf.name, bf.description, bf.rate_per_day
    FROM bed_feature_map bfm
    JOIN bed_features bf ON bf.id = bfm.feature_id
    WHERE bfm.tenant_id = ? AND bfm.bed_id = ? AND bf.is_active = 1
    ORDER BY bf.name
  `).bind(String(tenantId), bedId).all<Record<string, unknown>>();

  let housekeeping: Record<string, unknown> | null = null;
  if (await tableExists(c.env.DB, 'housekeeping_tasks')) {
    housekeeping = await db.$client.prepare(`
      SELECT id, task_number, task_type, priority, status, scheduled_date, scheduled_time,
             assigned_to, description, completed_at, verified_at, updated_at
      FROM housekeeping_tasks
      WHERE tenant_id = ? AND bed_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(String(tenantId), bedId).first<Record<string, unknown>>();
  }

  const timeline = [
    { label: 'Bed configured', at: bed.created_at ?? null, type: 'bed' },
    activeAdmission ? { label: 'Patient admitted', at: activeAdmission.admission_date ?? null, type: 'admission' } : null,
    activeAdmission ? { label: 'Assigned to bed', at: activeAdmission.admission_date ?? null, type: 'bed_assignment' } : null,
    activeAdmission?.discharge_initiated ? { label: 'Discharge initiated', at: activeAdmission.discharge_initiated_at ?? null, type: 'discharge' } : null,
    housekeeping ? { label: `Housekeeping ${housekeeping.status ?? 'task'}`, at: housekeeping.updated_at ?? housekeeping.completed_at ?? null, type: 'housekeeping' } : null,
  ].filter(Boolean);

  let equipment: Record<string, unknown>[] = (features || []).map((feature) => ({
    name: feature.name,
    equipment_name: feature.name,
    source: 'bed_feature',
    status: 'available',
    description: feature.description ?? null,
  }));

  if (await tableExists(c.env.DB, 'bed_equipment_map')) {
    const { results: mappedEquipment } = await db.$client.prepare(`
      SELECT bem.id, bem.bed_id, bem.fixed_asset_stock_id, bem.equipment_name, bem.required_qty, bem.status,
             bem.last_checked_at, bem.checked_by, bem.notes, bem.created_at, bem.updated_at,
             I.ItemName AS asset_name, I.ItemCode AS asset_code,
             A.BarCodeNumber AS asset_barcode, A.serial_number AS asset_serial
      FROM bed_equipment_map bem
      LEFT JOIN InventoryFixedAssetStock A ON A.FixedAssetStockId = bem.fixed_asset_stock_id AND A.tenant_id = bem.tenant_id
      LEFT JOIN InventoryItem I ON I.ItemId = A.ItemId AND I.tenant_id = A.tenant_id
      WHERE bem.tenant_id = ? AND bem.bed_id = ? AND bem.is_active = 1
      ORDER BY bem.equipment_name
    `).bind(String(tenantId), bedId).all<Record<string, unknown>>();

    if (mappedEquipment.length > 0) {
      equipment = mappedEquipment.map((item) => ({ ...item, name: item.equipment_name, source: 'bed_equipment_map' }));
    }
  }

  let maintenanceLogs: Record<string, unknown>[] = [];
  if (await tableExists(c.env.DB, 'bed_equipment_map') && await tableExists(c.env.DB, 'asset_maintenance_log')) {
    const { results: maintenanceResults } = await db.$client.prepare(`
      SELECT M.id, M.asset_stock_id, M.maintenance_type, M.description, M.performed_by,
             M.performed_date, M.next_due_date, M.cost, M.status, M.created_at,
             I.ItemName AS asset_name, I.ItemCode AS asset_code,
             A.BarCodeNumber AS asset_barcode, A.serial_number AS asset_serial
      FROM asset_maintenance_log M
      JOIN bed_equipment_map bem ON bem.fixed_asset_stock_id = M.asset_stock_id AND bem.tenant_id = M.tenant_id
      LEFT JOIN InventoryFixedAssetStock A ON A.FixedAssetStockId = M.asset_stock_id AND A.tenant_id = M.tenant_id
      LEFT JOIN InventoryItem I ON I.ItemId = A.ItemId AND I.tenant_id = A.tenant_id
      WHERE M.tenant_id = ? AND bem.bed_id = ? AND bem.is_active = 1
      ORDER BY COALESCE(M.created_at, M.performed_date) DESC
      LIMIT 10
    `).bind(String(tenantId), bedId).all<Record<string, unknown>>();
    maintenanceLogs = maintenanceResults;
  }

  const augmentedTimeline = [
    ...timeline,
    ...maintenanceLogs.map((log) => ({
      label: `Maintenance ${log.maintenance_type ?? 'logged'}${log.asset_name ? ` — ${log.asset_name}` : ''}`,
      at: log.created_at ?? log.performed_date ?? null,
      type: 'maintenance',
      reference_id: log.id,
    })),
  ].sort((a: any, b: any) => {
    const left = a.at ? new Date(a.at).getTime() : 0;
    const right = b.at ? new Date(b.at).getTime() : 0;
    return right - left;
  });

  return c.json({ bed, activeAdmission: activeAdmission ?? null, features, housekeeping, timeline: augmentedTimeline, equipment, maintenanceLogs });
});

// GET /api/admissions/beds/:id/equipment — real bedside equipment map
app.get('/beds/:id/equipment', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const bedId = Number(c.req.param('id'));
  if (!Number.isFinite(bedId) || bedId <= 0) {
    throw new HTTPException(400, { message: 'Valid bed id required' });
  }

  const bed = await db.$client.prepare('SELECT id FROM beds WHERE id = ? AND tenant_id = ?').bind(bedId, tenantId).first<{ id: number }>();
  if (!bed) throw new HTTPException(404, { message: 'Bed not found' });

  if (!await tableExists(c.env.DB, 'bed_equipment_map')) {
    return c.json({ equipment: [] });
  }

  const { results } = await db.$client.prepare(`
    SELECT bem.id, bem.bed_id, bem.fixed_asset_stock_id, bem.equipment_name, bem.required_qty, bem.status,
           bem.last_checked_at, bem.checked_by, bem.notes, bem.created_at, bem.updated_at,
           I.ItemName AS asset_name, I.ItemCode AS asset_code,
           A.BarCodeNumber AS asset_barcode, A.serial_number AS asset_serial
    FROM bed_equipment_map bem
    LEFT JOIN InventoryFixedAssetStock A ON A.FixedAssetStockId = bem.fixed_asset_stock_id AND A.tenant_id = bem.tenant_id
    LEFT JOIN InventoryItem I ON I.ItemId = A.ItemId AND I.tenant_id = A.tenant_id
    WHERE bem.tenant_id = ? AND bem.bed_id = ? AND bem.is_active = 1
    ORDER BY bem.equipment_name
  `).bind(String(tenantId), bedId).all<Record<string, unknown>>();

  return c.json({ equipment: results });
});

// PUT /api/admissions/beds/:id/equipment — replace bedside equipment map
app.put('/beds/:id/equipment', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const bedId = Number(c.req.param('id'));
  if (!Number.isFinite(bedId) || bedId <= 0) {
    throw new HTTPException(400, { message: 'Valid bed id required' });
  }

  if (!await tableExists(c.env.DB, 'bed_equipment_map')) {
    throw new HTTPException(503, { message: 'bed_equipment_map migration is required' });
  }

  const bed = await db.$client.prepare('SELECT id FROM beds WHERE id = ? AND tenant_id = ?').bind(bedId, tenantId).first<{ id: number }>();
  if (!bed) throw new HTTPException(404, { message: 'Bed not found' });

  const userId = requireUserId(c);
  const body = await c.req.json<{ equipment?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }>();
  const items = body.equipment ?? body.items ?? [];
  if (!Array.isArray(items)) {
    throw new HTTPException(400, { message: 'equipment must be an array' });
  }

  const allowedStatuses = new Set(['available', 'in_use', 'faulty', 'maintenance', 'missing']);
  const cleaned = items.map((item) => {
    const equipmentName = String(item.equipment_name ?? item.name ?? '').trim();
    const status = String(item.status ?? 'available');
    const requiredQty = Number(item.required_qty ?? item.requiredQty ?? 1);
    if (!equipmentName) throw new HTTPException(400, { message: 'equipment_name is required' });
    if (!allowedStatuses.has(status)) throw new HTTPException(400, { message: 'Invalid equipment status' });
    return {
      equipmentName,
      status,
      requiredQty: Number.isFinite(requiredQty) && requiredQty > 0 ? Math.floor(requiredQty) : 1,
      fixedAssetStockId: item.fixed_asset_stock_id == null || item.fixed_asset_stock_id === '' ? null : Number(item.fixed_asset_stock_id),
      notes: item.notes == null ? null : String(item.notes),
    };
  });

  const now = new Date().toISOString();
  await db.$client.prepare(
    'UPDATE bed_equipment_map SET is_active = 0, updated_at = ? WHERE tenant_id = ? AND bed_id = ? AND is_active = 1'
  ).bind(now, String(tenantId), bedId).run();

  for (const item of cleaned) {
    await db.$client.prepare(`
      INSERT INTO bed_equipment_map
        (tenant_id, bed_id, fixed_asset_stock_id, equipment_name, required_qty, status,
         last_checked_at, checked_by, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(
      String(tenantId),
      bedId,
      item.fixedAssetStockId,
      item.equipmentName,
      item.requiredQty,
      item.status,
      now,
      String(userId),
      item.notes,
      now,
      now,
    ).run();
  }

  const { results } = await db.$client.prepare(`
    SELECT bem.id, bem.bed_id, bem.fixed_asset_stock_id, bem.equipment_name, bem.required_qty, bem.status,
           bem.last_checked_at, bem.checked_by, bem.notes, bem.created_at, bem.updated_at,
           I.ItemName AS asset_name, I.ItemCode AS asset_code,
           A.BarCodeNumber AS asset_barcode, A.serial_number AS asset_serial
    FROM bed_equipment_map bem
    LEFT JOIN InventoryFixedAssetStock A ON A.FixedAssetStockId = bem.fixed_asset_stock_id AND A.tenant_id = bem.tenant_id
    LEFT JOIN InventoryItem I ON I.ItemId = A.ItemId AND I.tenant_id = A.tenant_id
    WHERE bem.tenant_id = ? AND bem.bed_id = ? AND bem.is_active = 1
    ORDER BY bem.equipment_name
  `).bind(String(tenantId), bedId).all<Record<string, unknown>>();

  await createAuditLog(c.env, String(tenantId), String(userId), 'update_bed_equipment', 'bed', bedId, null, { count: results.length }, c.req.header('CF-Connecting-IP'), c.req.header('User-Agent'));
  return c.json({ equipment: results });
});

// POST /api/admissions — create admission (Zod validated + atomic batch + sequence)
app.post('/', zValidator('json', createAdmissionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['reception', 'receptionist', 'doctor', 'nurse', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to create admissions' });
  }

  const data = c.req.valid('json');
  const mutationType = 'ipd_admission_create';
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ ...data, idempotencyKey: undefined })
    : null;
  let idempotencyReserved = false;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different IPD admission request',
      conflictMessage: 'IPD admission request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);

    const reservedReplay = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: requireUserId(c),
      mismatchMessage: 'Idempotency key was already used for a different IPD admission request',
      conflictMessage: 'IPD admission request is already being processed. Please retry shortly.',
    });
    if (reservedReplay) return c.json({ ...reservedReplay.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  try {
    const patient = await db.$client.prepare(
      'SELECT id FROM patients WHERE id = ? AND tenant_id = ?',
    ).bind(data.patient_id, tenantId).first<{ id: number }>();
    if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

    const activeAdmission = await db.$client.prepare(
      `SELECT id, admission_no FROM admissions
       WHERE tenant_id = ? AND patient_id = ? AND status IN ('admitted','critical','transferred')
       ORDER BY admission_date DESC LIMIT 1`
    ).bind(tenantId, data.patient_id).first<{ id: number; admission_no: string }>();
    if (activeAdmission) {
      throw new HTTPException(409, { message: `Patient is already admitted (${activeAdmission.admission_no})` });
    }

    if (data.bed_id) {
      const hasBedReservations = await tableExists(c.env.DB, 'bed_reservations');
      const bedStatus = await db.$client.prepare(
        hasBedReservations
          ? `SELECT b.status,
              br.id AS reservation_id,
              br.patient_id AS reserved_patient_id
             FROM beds b
             LEFT JOIN bed_reservations br ON br.bed_id = b.id AND br.tenant_id = b.tenant_id AND br.status = 'reserved'
             WHERE b.id = ? AND b.tenant_id = ?`
          : `SELECT b.status,
              NULL AS reservation_id,
              NULL AS reserved_patient_id
             FROM beds b
             WHERE b.id = ? AND b.tenant_id = ?`
      ).bind(data.bed_id, tenantId).first<{ status: string; reservation_id?: number; reserved_patient_id?: number }>();
      if (!bedStatus) throw new HTTPException(404, { message: 'Bed not found' });
      const reservedForThisPatient = bedStatus.status === 'reserved' && bedStatus.reserved_patient_id === data.patient_id;
      if (bedStatus.status !== 'available' && !reservedForThisPatient) {
        throw new HTTPException(409, { message: `Bed is ${bedStatus.status}` });
      }
    }

    if (data.doctor_id) {
      const doctor = await db.$client.prepare(
        'SELECT id FROM doctors WHERE id = ? AND tenant_id = ?',
      ).bind(data.doctor_id, tenantId).first<{ id: number }>();
      if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });
    }

    // ✅ Use sequence-based admission number (no more COUNT(*) race condition)
    const admNo = await getNextSequence(c.env.DB, tenantId, 'admission', 'ADM');
    const admitSource = data.admit_source
      ?? (data.admission_type === 'emergency' ? 'emergency'
        : data.admission_type === 'transfer' ? 'transfer'
          : 'planned');
    const emergencyFlag = data.is_emergency ?? data.admission_type === 'emergency';

    // ✅ Atomic batch: admission insert + bed status update in one transaction
    const admissionDate = data.admission_date || new Date(Date.now() + 6 * 3600_000).toISOString().replace('T', ' ').substring(0, 19);
    const admissionFee = data.admission_fee ?? 0;
    const billingMode = data.billing_mode ?? 'regular';
    const packageId = data.package_id ?? null;
    const batchStmts: D1PreparedStatement[] = [
      db.$client.prepare(
        `INSERT INTO admissions (tenant_id, admission_no, patient_id, bed_id, doctor_id, admission_type, admit_source, referral_doctor, admission_reason, is_emergency, provisional_diagnosis, notes, care_of_name, care_of_phone, care_of_relation, admission_date, department, admission_fee, billing_mode, package_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM admissions active
           WHERE active.tenant_id = ?
             AND active.patient_id = ?
             AND active.status IN ('admitted','critical','transferred')
         )
         AND (
           ? IS NULL
           OR EXISTS (
             SELECT 1
             FROM beds b
             WHERE b.id = ?
               AND b.tenant_id = ?
               AND b.status IN ('available', 'reserved')
           )
         )`
      ).bind(
        tenantId, admNo, data.patient_id, data.bed_id ?? null,
        data.doctor_id ?? null, data.admission_type,
        admitSource, data.referral_doctor ?? null,
        data.admission_reason ?? null, emergencyFlag ? 1 : 0,
        data.provisional_diagnosis ?? null, data.notes ?? null,
        data.care_of_name ?? null, data.care_of_phone ?? null, data.care_of_relation ?? null,
        admissionDate, data.department ?? null, admissionFee, billingMode, packageId,
        tenantId, data.patient_id,
        data.bed_id ?? null, data.bed_id ?? null, tenantId,
      ),
    ];

    // Mark bed as occupied atomically with admission
    if (data.bed_id) {
      const hasBedReservations = await tableExists(c.env.DB, 'bed_reservations');
      batchStmts.push(
        db.$client.prepare(
          `UPDATE beds SET status = 'occupied'
           WHERE id = ? AND tenant_id = ?
             AND EXISTS (
               SELECT 1 FROM admissions a
               WHERE a.tenant_id = ?
                 AND a.admission_no = ?
                 AND a.bed_id = beds.id
             )`
        ).bind(data.bed_id, tenantId, tenantId, admNo)
      );
      if (hasBedReservations) {
        batchStmts.push(
          db.$client.prepare(`
            UPDATE bed_reservations SET status = 'admitted', updated_at = datetime('now', '+6 hours')
            WHERE tenant_id = ? AND bed_id = ? AND patient_id = ? AND status = 'reserved'
              AND EXISTS (
                SELECT 1 FROM admissions a
                WHERE a.tenant_id = ?
                  AND a.admission_no = ?
                  AND a.bed_id = bed_reservations.bed_id
              )
          `).bind(String(tenantId), data.bed_id, data.patient_id, tenantId, admNo)
        );
      }
    }

    // Also insert patient_bed_infos if bed assigned. The SELECT keeps admission_id real inside the batch.
    if (data.bed_id) {
      const bed = await db.$client.prepare(
        `SELECT ward_name, bed_number, bed_type, rate_per_day FROM beds WHERE id = ? AND tenant_id = ?`
      ).bind(data.bed_id, tenantId).first<any>();
      if (bed) {
        batchStmts.push(
          db.$client.prepare(
            `INSERT INTO patient_bed_infos (tenant_id, patient_id, admission_id, bed_id, ward_name, bed_number, bed_type, rate_per_day, started_on)
             SELECT ?, ?, a.id, ?, ?, ?, ?, ?, ?
             FROM admissions a
             WHERE a.tenant_id = ? AND a.admission_no = ?`
          ).bind(
            tenantId, data.patient_id, data.bed_id,
            bed.ward_name, bed.bed_number, bed.bed_type, bed.rate_per_day ?? 0,
            admissionDate,
            tenantId, admNo,
          )
        );
      }
    }

    await db.$client.batch(batchStmts);

    const createdAdmission = await db.$client.prepare(
      `SELECT id FROM admissions WHERE admission_no = ? AND tenant_id = ?`
    ).bind(admNo, tenantId).first<{ id: number }>();

    if (!createdAdmission?.id) {
      const duplicateAdmission = await db.$client.prepare(
        `SELECT id, admission_no FROM admissions
         WHERE tenant_id = ? AND patient_id = ? AND status IN ('admitted','critical','transferred')
         ORDER BY admission_date DESC LIMIT 1`
      ).bind(tenantId, data.patient_id).first<{ id: number; admission_no: string }>();
      if (duplicateAdmission) {
        throw new HTTPException(409, { message: `Patient is already admitted (${duplicateAdmission.admission_no})` });
      }
      if (data.bed_id) {
        const latestBed = await db.$client.prepare(
          `SELECT status FROM beds WHERE id = ? AND tenant_id = ?`
        ).bind(data.bed_id, tenantId).first<{ status: string }>();
        if (!latestBed) throw new HTTPException(404, { message: 'Bed not found' });
        throw new HTTPException(409, { message: `Bed is ${latestBed.status || 'not available'}` });
      }
      throw new HTTPException(409, { message: 'Admission could not be created because patient status changed. Please refresh and try again.' });
    }

    // Add admission fee as a provisional billing charge
    if (admissionFee > 0 && createdAdmission?.id) {
      await db.$client.prepare(`
        INSERT INTO billing_provisional_items (tenant_id, patient_id, admission_id, item_category, item_name, department, unit_price, quantity, discount_percent, discount_amount, total_amount, bill_status, is_active, created_by, created_at)
        VALUES (?, ?, ?, 'admission', 'Admission Fee', 'Reception', ?, 1, 0, 0, ?, 'provisional', 1, ?, datetime('now', '+6 hours'))
      `).bind(tenantId, data.patient_id, createdAdmission.id, admissionFee, admissionFee, requireUserId(c)).run();
    }
    const responseBody = {
      admission_no: admNo,
      admission_id: createdAdmission?.id ?? null,
    };

    await createAuditLog(c.env, tenantId, requireUserId(c), 'CREATE', 'admissions', createdAdmission?.id ?? 0, null, {
      admissionNo: admNo,
      patientId: data.patient_id,
      bedId: data.bed_id ?? null,
      doctorId: data.doctor_id ?? null,
      admissionType: data.admission_type,
      admitSource,
      isEmergency: emergencyFlag,
      admissionFee: data.admission_fee ?? 0,
    });

    await ensureLiveAdmissionContinuity(c.env.DB, {
      tenantId: String(tenantId),
      legacyAdmissionId: Number(createdAdmission.id),
      admissionNo: admNo,
      legacyPatientId: data.patient_id,
      admissionType: data.admission_type,
      startedAtUtc: normalizeLegacyAdmissionStartedAtUtc(admissionDate),
    });

    if (data.idempotencyKey && idempotencyReserved) {
      await completeMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
        sourceId: createdAdmission?.id ?? admNo,
        responseBody,
      });
    }

    return c.json(responseBody, 201);
  } catch (error) {
    if (data.idempotencyKey && idempotencyReserved) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
      });
    }
    throw error;
  }
});

// PUT /api/admissions/:id/transfer — transfer patient to another bed
app.put('/:id/transfer', zValidator('json', transferBedSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['reception', 'receptionist', 'doctor', 'nurse', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to transfer beds' });
  }

  const id = c.req.param('id');
  const data = c.req.valid('json');
  const userId = requireUserId(c);

  const adm = await db.$client.prepare(
    `SELECT patient_id, bed_id FROM admissions WHERE id = ? AND tenant_id = ? AND status = 'admitted'`
  ).bind(id, tenantId).first<{ patient_id: number; bed_id: number | null }>();
  if (!adm) throw new HTTPException(404, { message: 'Active admission not found' });
  if (adm.bed_id === data.new_bed_id) throw new HTTPException(400, { message: 'Patient is already on this bed' });

  const newBed = await db.$client.prepare(
    `SELECT ward_name, bed_number, bed_type, rate_per_day, status FROM beds WHERE id = ? AND tenant_id = ?`
  ).bind(data.new_bed_id, tenantId).first<any>();
  if (!newBed) throw new HTTPException(404, { message: 'New bed not found' });
  if (newBed.status !== 'available') {
    throw new HTTPException(409, { message: `Bed ${data.new_bed_id} is not available for transfer` });
  }

  if (data.pending_receive) {
    // Atomic reserve: only succeeds if the bed is currently 'available'.
    // (P0-25) — fixes the previous read-then-update race.
    const transferResult = await lockBedForTransfer(db.$client as unknown as DbExecutor, {
      tenantId,
      newBedId: data.new_bed_id,
    });
    assertBedAllocationOk(transferResult, `Bed ${data.new_bed_id}`, 'transfer');

    await db.$client.batch([
      db.$client.prepare(`
        UPDATE admissions
        SET previous_bed_id = ?, bed_id = ?, status = 'transferred', transfer_status = 'pending_receive',
            transfer_requested_on = datetime('now', '+6 hours'), transfer_remark = ?, updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ?
      `).bind(adm.bed_id ?? null, data.new_bed_id, data.reason ?? null, id, tenantId),
    ]);

    await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, {
      bed_id: adm.bed_id ?? null,
      transfer_status: null,
    }, {
      bed_id: data.new_bed_id,
      transfer_status: 'pending_receive',
      reason: data.reason ?? null,
    });

    return c.json({ success: true, message: 'Transfer requested; receiving ward must confirm' });
  }

  // Lock new bed atomically before completing the transfer to avoid double allocation races.
  const transferResult = await lockBedForTransfer(db.$client as unknown as DbExecutor, {
    tenantId,
    newBedId: data.new_bed_id,
  });
  assertBedAllocationOk(transferResult, `Bed ${data.new_bed_id}`, 'transfer');

  // Atomic batch: close old bed info + update admission + occupy new bed + insert new bed info
  const batchStmts: D1PreparedStatement[] = [
    // Close current patient_bed_infos
    db.$client.prepare(
      `UPDATE patient_bed_infos SET ended_on = datetime('now', '+6 hours'),
        days = MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1),
        charge_amount = rate_per_day * MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1)
       WHERE tenant_id = ? AND admission_id = ? AND bed_id = ? AND ended_on IS NULL`
    ).bind(tenantId, id, adm.bed_id ?? 0),
    // Update admission bed
    db.$client.prepare(
      `UPDATE admissions SET previous_bed_id = ?, bed_id = ?, transfer_status = NULL, transfer_remark = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(adm.bed_id ?? null, data.new_bed_id, data.reason ?? null, id, tenantId),
    // Free old bed
    db.$client.prepare(
      `UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?`
    ).bind(adm.bed_id ?? 0, tenantId),
    // Occupy new bed
    db.$client.prepare(
      `UPDATE beds SET status = 'occupied' WHERE id = ? AND tenant_id = ?`
    ).bind(data.new_bed_id, tenantId),
    // Insert new patient_bed_infos
    db.$client.prepare(
      `INSERT INTO patient_bed_infos (tenant_id, patient_id, admission_id, bed_id, ward_name, bed_number, bed_type, rate_per_day, started_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))`
    ).bind(tenantId, adm.patient_id, id, data.new_bed_id, newBed.ward_name, newBed.bed_number, newBed.bed_type, newBed.rate_per_day ?? 0),
  ];

  await db.$client.batch(batchStmts);

  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, {
    bed_id: adm.bed_id ?? null,
    transfer_status: null,
  }, {
    bed_id: data.new_bed_id,
    transfer_status: 'completed',
    reason: data.reason ?? null,
  });

  return c.json({ success: true, message: 'Bed transfer completed' });
});

// GET /api/admissions/:id/previous-bed-available — guard for undo transfer
app.get('/:id/previous-bed-available', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = c.req.param('id');
  const adm = await db.$client.prepare(
    `SELECT previous_bed_id FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ previous_bed_id: number | null }>();
  if (!adm?.previous_bed_id) return c.json({ available: false, reason: 'No previous bed found' });
  const bed = await db.$client.prepare(
    `SELECT id, status, ward_name, bed_number FROM beds WHERE id = ? AND tenant_id = ?`
  ).bind(adm.previous_bed_id, tenantId).first<{ status: string }>();
  return c.json({ available: bed?.status === 'available', bed: bed ?? null });
});

// PUT /api/admissions/:id/undo-transfer — move patient back to previous bed
app.put('/:id/undo-transfer', zValidator('json', reasonSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['nurse', 'doctor', 'hospital_admin', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to undo transfers' });
  }
  const id = c.req.param('id');
  const { reason } = c.req.valid('json');
  const adm = await db.$client.prepare(
    `SELECT patient_id, bed_id, previous_bed_id, status, transfer_status
     FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ patient_id: number; bed_id: number | null; previous_bed_id: number | null; status: string; transfer_status: string | null }>();
  if (!adm || !adm.previous_bed_id) throw new HTTPException(404, { message: 'Previous transfer not found' });

  const prevBed = await db.$client.prepare(
    `SELECT ward_name, bed_number, bed_type, rate_per_day, status FROM beds WHERE id = ? AND tenant_id = ?`
  ).bind(adm.previous_bed_id, tenantId).first<any>();
  if (!prevBed) throw new HTTPException(404, { message: 'Previous bed not found' });
  if (prevBed.status === 'occupied') {
    throw new HTTPException(409, { message: 'Previous bed is occupied by another patient' });
  }
  if (prevBed.status !== 'available' && adm.transfer_status !== 'pending_receive') {
    throw new HTTPException(409, { message: 'Previous bed is not available' });
  }

  const stmts: D1PreparedStatement[] = [
    db.$client.prepare(`
      UPDATE admissions
      SET bed_id = previous_bed_id, previous_bed_id = ?, status = 'admitted',
          transfer_status = NULL, transfer_remark = ?, updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(adm.bed_id ?? null, reason, id, tenantId),
    db.$client.prepare("UPDATE beds SET status = 'occupied' WHERE id = ? AND tenant_id = ?")
      .bind(adm.previous_bed_id, tenantId),
  ];
  if (adm.bed_id) {
    stmts.push(db.$client.prepare("UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?")
      .bind(adm.bed_id, tenantId));
  }
  await db.$client.batch(stmts);
  return c.json({ success: true, message: 'Transfer undone' });
});

// PUT /api/admissions/:id/receive-transfer — receiving ward confirms transfer
app.put('/:id/receive-transfer', zValidator('json', reasonSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['nurse', 'doctor', 'hospital_admin', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to receive transfers' });
  }
  const id = c.req.param('id');
  const { reason } = c.req.valid('json');
  const adm = await db.$client.prepare(
    `SELECT patient_id, bed_id, previous_bed_id, transfer_status
     FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ patient_id: number; bed_id: number; previous_bed_id: number | null; transfer_status: string | null }>();
  if (!adm || adm.transfer_status !== 'pending_receive') {
    throw new HTTPException(400, { message: 'No pending transfer to receive' });
  }
  const newBed = await db.$client.prepare(
    `SELECT ward_name, bed_number, bed_type, rate_per_day FROM beds WHERE id = ? AND tenant_id = ?`
  ).bind(adm.bed_id, tenantId).first<any>();
  if (!newBed) throw new HTTPException(404, { message: 'Receiving bed not found' });

  const stmts: D1PreparedStatement[] = [
    db.$client.prepare(`
      UPDATE patient_bed_infos SET ended_on = datetime('now', '+6 hours'),
        days = MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1),
        charge_amount = rate_per_day * MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1)
       WHERE tenant_id = ? AND admission_id = ? AND bed_id = ? AND ended_on IS NULL
    `).bind(tenantId, id, adm.previous_bed_id ?? 0),
    db.$client.prepare(`
      UPDATE admissions SET status = 'admitted', transfer_status = NULL,
        transfer_received_on = datetime('now', '+6 hours'), transfer_remark = COALESCE(?, transfer_remark), updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(reason ?? null, id, tenantId),
    db.$client.prepare("UPDATE beds SET status = 'occupied' WHERE id = ? AND tenant_id = ?")
      .bind(adm.bed_id, tenantId),
    db.$client.prepare(`
      INSERT INTO patient_bed_infos (tenant_id, patient_id, admission_id, bed_id, ward_name, bed_number, bed_type, rate_per_day, started_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(tenantId, adm.patient_id, id, adm.bed_id, newBed.ward_name, newBed.bed_number, newBed.bed_type, newBed.rate_per_day ?? 0),
  ];
  if (adm.previous_bed_id) {
    stmts.push(db.$client.prepare("UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?")
      .bind(adm.previous_bed_id, tenantId));
  }
  await db.$client.batch(stmts);
  return c.json({ success: true, message: 'Transfer received' });
});

// GET /api/admissions/pending-transfers
app.get('/pending-transfers', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const { results } = await db.$client.prepare(`
    SELECT a.*, p.name AS patient_name, p.patient_code,
           nb.ward_name AS receiving_ward, nb.bed_number AS receiving_bed,
           ob.ward_name AS previous_ward, ob.bed_number AS previous_bed
    FROM admissions a
    JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds nb ON nb.id = a.bed_id AND nb.tenant_id = a.tenant_id
    LEFT JOIN beds ob ON ob.id = a.previous_bed_id AND ob.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.transfer_status = 'pending_receive'
    ORDER BY a.transfer_requested_on DESC
  `).bind(tenantId).all();
  return c.json({ transfers: results });
});

// PUT /api/admissions/:id/cancel — cancel admission (frees bed, requires reason)
app.put('/:id/cancel', zValidator('json', cancelAdmissionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to cancel admissions' });
  }

  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { reason } = c.req.valid('json');

  const adm = await db.$client.prepare(
    `SELECT bed_id, status FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ bed_id: number | null; status: string }>();

  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });
  if (adm.status === 'cancelled') throw new HTTPException(400, { message: 'Admission already cancelled' });
  if (adm.status === 'discharged') throw new HTTPException(400, { message: 'Cannot cancel a discharged admission' });

  const batchStmts: D1PreparedStatement[] = [
    db.$client.prepare(
      `UPDATE admissions SET status = 'cancelled', cancelled_on = datetime('now', '+6 hours'), cancelled_by = ?, cancelled_remark = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(userId ?? 'system', reason, id, tenantId),
    db.$client.prepare(
      `UPDATE patient_bed_infos SET ended_on = datetime('now', '+6 hours'),
        days = MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1),
        charge_amount = rate_per_day * MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1)
       WHERE tenant_id = ? AND admission_id = ? AND ended_on IS NULL`
    ).bind(tenantId, id),
  ];

  if (adm.bed_id) {
    batchStmts.push(
      db.$client.prepare(
        `UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?`
      ).bind(adm.bed_id, tenantId)
    );
  }

  await db.$client.batch(batchStmts);

  return c.json({ success: true, message: 'Admission cancelled' });
});

// PUT /api/admissions/:id/cancel-discharge — undo accidental discharge (re-admits patient, re-occupies bed)
app.put('/:id/cancel-discharge', zValidator('json', cancelDischargeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to cancel discharge' });
  }

  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { reason } = c.req.valid('json');

  const adm = await db.$client.prepare(
    `SELECT bed_id, status FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ bed_id: number | null; status: string }>();

  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });
  if (adm.status !== 'discharged') throw new HTTPException(400, { message: 'Admission is not discharged' });

  // Check if bed is still available
  if (adm.bed_id) {
    const bed = await db.$client.prepare(
      `SELECT status FROM beds WHERE id = ? AND tenant_id = ?`
    ).bind(adm.bed_id, tenantId).first<{ status: string }>();
    if (bed && bed.status !== 'available') {
      throw new HTTPException(409, { message: 'Previous bed is no longer available. Please transfer to a new bed after re-admission.' });
    }
  }

  const batchStmts: D1PreparedStatement[] = [
    db.$client.prepare(
      `UPDATE admissions SET status = 'admitted', discharge_date = NULL, is_provisional_discharge = 0, provisional_discharge_on = NULL, provisional_discharge_by = NULL, provisional_discharge_note = NULL, discharge_cancelled_on = datetime('now', '+6 hours'), discharge_cancelled_by = ?, discharge_cancel_remark = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(userId ?? 'system', reason, id, tenantId),
  ];

  if (adm.bed_id) {
    batchStmts.push(
      db.$client.prepare(
        `UPDATE beds SET status = 'occupied' WHERE id = ? AND tenant_id = ?`
      ).bind(adm.bed_id, tenantId)
    );
    batchStmts.push(
      db.$client.prepare(
        `INSERT INTO patient_bed_infos (tenant_id, patient_id, admission_id, bed_id, ward_name, bed_number, bed_type, rate_per_day, started_on)
         SELECT ?, a.patient_id, a.id, a.bed_id, b.ward_name, b.bed_number, b.bed_type, b.rate_per_day, datetime('now', '+6 hours')
         FROM admissions a JOIN beds b ON a.bed_id = b.id
         WHERE a.id = ? AND a.tenant_id = ?`
      ).bind(tenantId, id, tenantId)
    );
  }

  await db.$client.batch(batchStmts);

  return c.json({ success: true, message: 'Discharge cancelled, patient re-admitted' });
});

// PUT/POST /api/admissions/:id/provisional-discharge — mark patient as ready for discharge
app.on(['PUT', 'POST'], '/:id/provisional-discharge', zValidator('json', provisionalDischargeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor', 'nurse', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to mark provisional discharge' });
  }

  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { note } = c.req.valid('json');

  const adm = await db.$client.prepare(
    `SELECT status, is_provisional_discharge FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ status: string; is_provisional_discharge: number }>();

  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });
  if (adm.status !== 'admitted' && adm.status !== 'critical') {
    throw new HTTPException(400, { message: 'Only admitted/critical patients can be marked for provisional discharge' });
  }
  if (adm.is_provisional_discharge) {
    throw new HTTPException(400, { message: 'Patient is already marked for provisional discharge' });
  }

  await db.$client.batch([
    db.$client.prepare(
      `UPDATE admissions SET is_provisional_discharge = 1, provisional_discharge_on = datetime('now', '+6 hours'), provisional_discharge_by = ?, provisional_discharge_note = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(userId ?? 'system', note ?? null, id, tenantId),
    db.$client.prepare(`
      INSERT INTO provisional_discharges (tenant_id, admission_id, patient_id, status, billing_status, discharged_by, note)
      SELECT ?, id, patient_id, 'pending_clearance', 'pending', ?, ?
      FROM admissions WHERE id = ? AND tenant_id = ?
      ON CONFLICT(tenant_id, admission_id) DO UPDATE SET
        status = 'pending_clearance', billing_status = 'pending', discharged_by = excluded.discharged_by,
        note = excluded.note, updated_at = datetime('now', '+6 hours')
    `).bind(String(tenantId), userId ?? 'system', note ?? null, id, tenantId),
  ]);

  return c.json({ success: true, message: 'Patient marked for provisional discharge' });
});

// GET /api/admissions/provisional-discharges — pending clearance list
app.get('/provisional-discharges', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const { results } = await db.$client.prepare(`
    SELECT pd.*, a.admission_no, a.admission_date, p.name AS patient_name, p.patient_code,
           b.ward_name, b.bed_number
    FROM provisional_discharges pd
    JOIN admissions a ON a.id = pd.admission_id AND a.tenant_id = pd.tenant_id
    JOIN patients p ON p.id = pd.patient_id AND p.tenant_id = pd.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    WHERE pd.tenant_id = ? AND pd.status = 'pending_clearance'
    ORDER BY pd.created_at DESC
  `).bind(String(tenantId)).all();
  return c.json({ provisional_discharges: results });
});

// PUT /api/admissions/:id/clear-provisional — billing clears provisional discharge
app.put('/:id/clear-provisional', zValidator('json', reasonSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['accountant', 'hospital_admin', 'md', 'director'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to clear provisional discharge' });
  }
  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { reason } = c.req.valid('json');
  const admission = await db.$client.prepare(
    `SELECT patient_id, admission_date
     FROM admissions
     WHERE id = ? AND tenant_id = ? AND status IN ('admitted','critical')`
  ).bind(id, tenantId).first<{ patient_id: number; admission_date: string | null }>();
  if (!admission) throw new HTTPException(404, { message: 'Active admission not found' });
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Provisional discharge clearance');
  await assertNoPendingDischargeBilling(db.$client, tenantId, id, admission.patient_id, admission.admission_date);

  await db.$client.batch([
    db.$client.prepare(`
      UPDATE provisional_discharges
      SET status = 'cleared', billing_status = 'cleared', cleared_by = ?, clearance_note = ?,
          cleared_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND admission_id = ?
    `).bind(userId ?? 'system', reason ?? null, String(tenantId), id),
    db.$client.prepare(`
      UPDATE admissions SET discharge_due_cleared_on = datetime('now', '+6 hours'), discharge_due_cleared_by = ?, updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND id = ?
    `).bind(userId ?? 'system', tenantId, id),
  ]);
  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, null, {
    action: 'clear_provisional_discharge',
    reason: reason ?? null,
    checked_on: today,
  });

  return c.json({ success: true, message: 'Provisional discharge cleared' });
});

// PUT /api/admissions/:id/undo-provisional-discharge — undo provisional discharge
app.put('/:id/undo-provisional-discharge', zValidator('json', undoProvisionalDischargeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized' });
  }

  const id = c.req.param('id');

  const adm = await db.$client.prepare(
    `SELECT is_provisional_discharge FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ is_provisional_discharge: number }>();

  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });
  if (!adm.is_provisional_discharge) {
    throw new HTTPException(400, { message: 'Patient is not marked for provisional discharge' });
  }

  await db.$client.batch([
    db.$client.prepare(
      `UPDATE admissions SET is_provisional_discharge = 0, provisional_discharge_on = NULL, provisional_discharge_by = NULL, provisional_discharge_note = NULL, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId),
    db.$client.prepare(`
      UPDATE provisional_discharges SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND admission_id = ? AND status = 'pending_clearance'
    `).bind(String(tenantId), id),
  ]);

  return c.json({ success: true, message: 'Provisional discharge undone' });
});

// PUT /api/admissions/:id/clear-due — billing due cleared marker
app.put('/:id/clear-due', zValidator('json', reasonSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['accountant', 'hospital_admin', 'md', 'director'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to clear dues' });
  }
  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { reason } = c.req.valid('json');
  const adm = await db.$client.prepare(
    `SELECT patient_id, admission_date
     FROM admissions
     WHERE id = ? AND tenant_id = ? AND status IN ('admitted','critical')`
  ).bind(id, tenantId).first<{ patient_id: number; admission_date: string | null }>();
  if (!adm) throw new HTTPException(404, { message: 'Active admission not found' });
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Admission due clearance');
  await assertNoPendingDischargeBilling(db.$client, tenantId, id, adm.patient_id, adm.admission_date);
  await db.$client.prepare(`
    UPDATE admissions SET discharge_due_cleared_on = datetime('now', '+6 hours'), discharge_due_cleared_by = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(userId ?? 'system', id, tenantId).run();
  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, null, {
    action: 'clear_discharge_due_marker',
    reason: reason ?? null,
    checked_on: today,
  });
  return c.json({ success: true, message: 'Discharge due clearance confirmed' });
});

// PUT /api/admissions/:id/billing-discharge — billing-side discharge request
app.put('/:id/billing-discharge', zValidator('json', reasonSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['accountant', 'hospital_admin', 'md', 'director'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized for billing discharge' });
  }
  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { reason } = c.req.valid('json');
  const adm = await db.$client.prepare(
    `SELECT bed_id, patient_id, admission_date FROM admissions WHERE id = ? AND tenant_id = ? AND status IN ('admitted','critical')`
  ).bind(id, tenantId).first<{ bed_id: number | null; patient_id: number; admission_date: string | null }>();
  if (!adm) throw new HTTPException(404, { message: 'Active admission not found' });
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Billing discharge');
  await assertNoPendingDischargeBilling(db.$client, tenantId, id, adm.patient_id, adm.admission_date);

  const stmts: D1PreparedStatement[] = [
    db.$client.prepare(`
      UPDATE admissions SET status = 'discharged', discharge_date = datetime('now', '+6 hours'),
        billing_discharge_on = datetime('now', '+6 hours'), billing_discharge_by = ?, discharge_type = 'billing',
        updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(userId ?? 'system', id, tenantId),
    db.$client.prepare(`
      UPDATE patient_bed_infos SET ended_on = datetime('now', '+6 hours'),
        days = MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1),
        charge_amount = rate_per_day * MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1)
      WHERE tenant_id = ? AND admission_id = ? AND ended_on IS NULL
    `).bind(tenantId, id),
  ];
  if (adm.bed_id) {
    stmts.push(db.$client.prepare("UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?")
      .bind(adm.bed_id, tenantId));
  }
  await db.$client.batch(stmts);
  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, null, {
    action: 'billing_discharge',
    reason: reason ?? null,
    checked_on: today,
  });
  return c.json({ success: true, message: 'Billing discharge completed' });
});

// Admission remarks
app.get('/:id/remarks', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = c.req.param('id');
  const { results } = await db.$client.prepare(`
    SELECT ar.*, u.name AS created_by_name
    FROM admission_remarks ar
    LEFT JOIN users u ON u.id = ar.created_by AND u.tenant_id = ar.tenant_id
    WHERE ar.tenant_id = ? AND ar.admission_id = ?
    ORDER BY ar.created_at DESC
  `).bind(String(tenantId), id).all();
  return c.json({ remarks: results });
});

app.post('/:id/remark', zValidator('json', remarkSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = c.req.param('id');
  const { remark } = c.req.valid('json');
  const adm = await db.$client.prepare(
    'SELECT patient_id FROM admissions WHERE tenant_id = ? AND id = ?'
  ).bind(tenantId, id).first<{ patient_id: number }>();
  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });
  const result = await db.$client.prepare(`
    INSERT INTO admission_remarks (tenant_id, admission_id, patient_id, remark, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).bind(String(tenantId), id, adm.patient_id, remark, userId ?? 'system').run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.put('/:id/doctor', zValidator('json', doctorUpdateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['doctor', 'hospital_admin', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update admitting doctor' });
  }
  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { doctor_id } = c.req.valid('json');
  const admission = await db.$client.prepare(
    `SELECT doctor_id FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ doctor_id: number | null }>();
  if (!admission) throw new HTTPException(404, { message: 'Admission not found' });
  const doctor = await db.$client.prepare(
    `SELECT id FROM doctors WHERE id = ? AND tenant_id = ?`
  ).bind(doctor_id, tenantId).first<{ id: number }>();
  if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });
  await db.$client.prepare(
    `UPDATE admissions SET doctor_id = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(doctor_id, id, tenantId).run();
  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, {
    doctor_id: admission.doctor_id ?? null,
  }, {
    doctor_id,
  });
  return c.json({ success: true });
});

app.put('/:id/procedure', zValidator('json', procedureUpdateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['doctor', 'hospital_admin', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update IPD procedure type' });
  }
  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { procedure_type } = c.req.valid('json');
  const admission = await db.$client.prepare(
    `SELECT procedure_type FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ procedure_type: string | null }>();
  if (!admission) throw new HTTPException(404, { message: 'Admission not found' });
  await db.$client.prepare(
    `UPDATE admissions SET procedure_type = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(procedure_type, id, tenantId).run();
  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, {
    procedure_type: admission.procedure_type ?? null,
  }, {
    procedure_type,
  });
  return c.json({ success: true });
});

app.put('/:id/police-case', zValidator('json', policeCaseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['doctor', 'hospital_admin', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update police-case flag' });
  }
  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { is_police_case } = c.req.valid('json');
  const admission = await db.$client.prepare(
    `SELECT is_police_case FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ is_police_case: number | null }>();
  if (!admission) throw new HTTPException(404, { message: 'Admission not found' });
  await db.$client.prepare(
    `UPDATE admissions SET is_police_case = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(is_police_case ? 1 : 0, id, tenantId).run();
  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, {
    is_police_case: Number(admission.is_police_case ?? 0),
  }, {
    is_police_case: is_police_case ? 1 : 0,
  });
  return c.json({ success: true });
});

// Birth details for maternity IPD
app.get('/:id/birth-details', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = c.req.param('id');
  const { results } = await db.$client.prepare(`
    SELECT bbd.*, bbc.name AS birth_condition_name
    FROM baby_birth_details bbd
    LEFT JOIN baby_birth_conditions bbc ON bbc.id = bbd.birth_condition_id
    WHERE bbd.tenant_id = ? AND bbd.admission_id = ? AND bbd.is_active = 1
    ORDER BY bbd.birth_date DESC, bbd.birth_time DESC
  `).bind(String(tenantId), id).all();
  return c.json({ birth_details: results });
});

app.post('/:id/birth-details', zValidator('json', birthDetailSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['nurse', 'doctor', 'hospital_admin', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to record birth details' });
  }
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const admission = await db.$client.prepare(
    'SELECT patient_id FROM admissions WHERE tenant_id = ? AND id = ?'
  ).bind(tenantId, id).first<{ patient_id: number }>();
  if (!admission) throw new HTTPException(404, { message: 'Admission not found' });
  const result = await db.$client.prepare(`
    INSERT INTO baby_birth_details
      (tenant_id, admission_id, patient_id, baby_name, sex, weight_kg, birth_date, birth_time,
       birth_type, birth_condition_id, birth_condition, delivery_type, father_name, mother_name,
       apgar_score, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT name FROM baby_birth_conditions WHERE id = ?), ?, ?, ?, ?, ?, ?)
  `).bind(
    String(tenantId), id, data.patient_id || admission.patient_id,
    data.baby_name ?? null, data.sex ?? null, data.weight_kg ?? null,
    data.birth_date, data.birth_time ?? null, data.birth_type ?? null,
    data.birth_condition_id ?? null, data.birth_condition_id ?? null,
    data.delivery_type ?? null, data.father_name ?? null, data.mother_name ?? null,
    data.apgar_score ?? null, data.remarks ?? null, userId ?? 'system',
  ).run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

// Hemodialysis reports
app.get('/hemodialysis-reports', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  assertIpdRole(c, IPD_CLINICAL_RECORD_ROLES, 'Not authorized to read hemodialysis reports');
  const patientId = c.req.query('patient_id');
  const latest = c.req.query('latest') === '1';
  let sql = `SELECT * FROM hemodialysis_reports WHERE tenant_id = ?`;
  const params: (string | number)[] = [String(tenantId)];
  if (patientId) { sql += ' AND patient_id = ?'; params.push(Number(patientId)); }
  sql += ` ORDER BY report_date DESC, created_at DESC LIMIT ${latest ? 1 : 100}`;
  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ reports: results, latest: latest ? results?.[0] ?? null : undefined });
});

app.post('/hemodialysis-reports', zValidator('json', hemodialysisReportSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  assertIpdRole(c, IPD_CLINICAL_RECORD_ROLES, 'Not authorized to create hemodialysis reports');
  const data = c.req.valid('json');
  const result = await db.$client.prepare(`
    INSERT INTO hemodialysis_reports
      (tenant_id, admission_id, patient_id, report_date, pre_weight, post_weight, pre_bp, post_bp,
       dialysis_duration_min, access_type, dialyzer, blood_flow_rate, dialysate_flow_rate,
       ultrafiltration, heparin_dose, complications, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    String(tenantId), data.admission_id ?? null, data.patient_id, data.report_date ?? new Date().toISOString().split('T')[0],
    data.pre_weight ?? null, data.post_weight ?? null, data.pre_bp ?? null, data.post_bp ?? null,
    data.dialysis_duration_min ?? null, data.access_type ?? null, data.dialyzer ?? null,
    data.blood_flow_rate ?? null, data.dialysate_flow_rate ?? null, data.ultrafiltration ?? null,
    data.heparin_dose ?? null, data.complications ?? null, data.notes ?? null, userId ?? 'system',
  ).run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.put('/hemodialysis-reports/:reportId', zValidator('json', hemodialysisReportSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  assertIpdRole(c, IPD_CLINICAL_RECORD_ROLES, 'Not authorized to update hemodialysis reports');
  const reportId = Number(c.req.param('reportId'));
  const data = c.req.valid('json');
  const allowed = ['admission_id','patient_id','report_date','pre_weight','post_weight','pre_bp','post_bp','dialysis_duration_min','access_type','dialyzer','blood_flow_rate','dialysate_flow_rate','ultrafiltration','heparin_dose','complications','notes'] as const;
  const sets = ["updated_at = datetime('now', '+6 hours')"];
  const vals: (string | number | null)[] = [];
  for (const key of allowed) {
    if (data[key] !== undefined) { sets.push(`${key} = ?`); vals.push(data[key] as string | number | null); }
  }
  await db.$client.prepare(`UPDATE hemodialysis_reports SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
    .bind(...vals, reportId, String(tenantId)).run();
  return c.json({ success: true });
});

// ADT configuration
app.get('/adt/auto-billing-items', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  assertIpdRole(c, IPD_ADMIN_CONFIG_ROLES, 'Not authorized to read IPD billing configuration');
  const { results } = await db.$client.prepare(`
    SELECT abi.*, bf.name AS bed_feature_name
    FROM adt_auto_billing_items abi
    LEFT JOIN bed_features bf ON bf.id = abi.bed_feature_id
    WHERE abi.tenant_id = ?
    ORDER BY bf.name, abi.item_name
  `).bind(String(tenantId)).all();
  return c.json({ items: results });
});

app.post('/adt/auto-billing-items', zValidator('json', autoBillingItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  assertIpdRole(c, IPD_ADMIN_CONFIG_ROLES, 'Not authorized to manage IPD billing configuration');
  const data = c.req.valid('json');
  const result = await db.$client.prepare(`
    INSERT INTO adt_auto_billing_items (tenant_id, bed_feature_id, billing_item_id, item_name, price, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(String(tenantId), data.bed_feature_id, data.billing_item_id ?? null, data.item_name ?? null, data.price, data.is_active ?? 1).run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.get('/adt/deposit-settings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  assertIpdRole(c, IPD_DEPOSIT_CONFIG_ROLES, 'Not authorized to read IPD deposit configuration');
  const { results } = await db.$client.prepare('SELECT * FROM adt_deposit_settings WHERE tenant_id = ? ORDER BY admission_type')
    .bind(String(tenantId)).all();
  return c.json({ settings: results });
});

app.post('/adt/deposit-settings', zValidator('json', depositSettingSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  assertIpdRole(c, IPD_DEPOSIT_CONFIG_ROLES, 'Not authorized to manage IPD deposit configuration');
  const data = c.req.valid('json');
  const result = await db.$client.prepare(`
    INSERT INTO adt_deposit_settings (tenant_id, admission_type, bed_feature_id, min_deposit_amount, is_mandatory, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(String(tenantId), data.admission_type, data.bed_feature_id ?? null, data.min_deposit_amount, data.is_mandatory ? 1 : 0, data.is_active ?? 1).run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.get('/adt/scheme-price-maps', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  assertIpdRole(c, IPD_ADMIN_CONFIG_ROLES, 'Not authorized to read IPD scheme pricing configuration');
  const { results } = await db.$client.prepare('SELECT * FROM adt_bed_feature_scheme_price_category_map WHERE tenant_id = ? ORDER BY bed_feature_id')
    .bind(String(tenantId)).all();
  return c.json({ maps: results });
});

app.post('/adt/scheme-price-maps', zValidator('json', schemePriceMapSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  assertIpdRole(c, IPD_ADMIN_CONFIG_ROLES, 'Not authorized to manage IPD scheme pricing configuration');
  const data = c.req.valid('json');
  const result = await db.$client.prepare(`
    INSERT INTO adt_bed_feature_scheme_price_category_map (tenant_id, bed_feature_id, scheme_id, price_category_id, price, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(String(tenantId), data.bed_feature_id, data.scheme_id ?? null, data.price_category_id ?? null, data.price, data.is_active ?? 1).run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

// GET /api/admissions/:id — single admission by id
app.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = c.req.param('id');

  const adm = await db.$client.prepare(`
    SELECT a.*, p.name AS patient_name, p.patient_code, p.gender, p.mobile, p.blood_group,
           p.date_of_birth, p.address AS patient_address,
           b.ward_name, b.bed_number, b.bed_type,
           d.name AS doctor_name, d.name AS admitting_doctor
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    WHERE a.id = ? AND a.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });

  return c.json({ admission: withCanonicalAdmissionTime(adm as Record<string, unknown>) });
});

// GET /api/admissions/:id/detail — single admission with all fields
app.get('/:id/detail', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = c.req.param('id');

  const adm = await db.$client.prepare(`
    SELECT a.*, p.name AS patient_name, p.patient_code, p.gender, p.mobile, p.blood_group,
           p.date_of_birth, p.address AS patient_address,
           b.ward_name, b.bed_number, b.bed_type,
           d.name AS doctor_name, d.name AS admitting_doctor,
           COALESCE(
             (SELECT v.id FROM visits v
              WHERE v.tenant_id = a.tenant_id AND v.patient_id = a.patient_id
                AND v.admission_no = a.admission_no
              ORDER BY v.id DESC LIMIT 1),
             (SELECT v.id FROM visits v
              WHERE v.tenant_id = a.tenant_id AND v.patient_id = a.patient_id
                AND COALESCE(v.admission_flag, 0) = 1
                AND COALESCE(v.created_at, v.visit_date) >= a.admission_date
              ORDER BY COALESCE(v.created_at, v.visit_date) DESC, v.id DESC LIMIT 1)
           ) AS ipd_visit_id -- transition-of-care workflows need the actual clinical visit
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    WHERE a.id = ? AND a.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });

  return c.json({ admission: withCanonicalAdmissionTime(adm as Record<string, unknown>) });
});

// GET /api/admissions/:id/transfers — transfer history for an admission
app.get('/:id/transfers', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = c.req.param('id');

  const { results } = await db.$client.prepare(`
    SELECT *
    FROM patient_bed_infos
    WHERE tenant_id = ? AND admission_id = ?
    ORDER BY started_on ASC
  `).bind(String(tenantId), id).all();

  return c.json({ transfers: results });
});

// PUT /api/admissions/:id — update admission (Zod validated + atomic discharge)
app.put('/:id', zValidator('json', updateAdmissionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['reception', 'receptionist', 'doctor', 'nurse', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to discharge' });
  }

  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { status, discharge_condition_id, discharge_type } = c.req.valid('json');

  if (status === 'discharged') {
    // Free the bed atomically with discharge
    const adm = await db.$client.prepare(
      `SELECT bed_id, patient_id, admission_date
       FROM admissions
       WHERE id = ? AND tenant_id = ? AND status IN ('admitted','critical')`
    ).bind(id, tenantId).first<{ bed_id: number | null; patient_id: number; admission_date: string | null }>();
    if (!adm) throw new HTTPException(404, { message: 'Active admission not found' });
    await assertAccountingPeriodOpen(c.env.DB, tenantId, getTodayGMT6(), 'Admission discharge');
    await assertNoPendingDischargeBilling(db.$client, tenantId, id, adm.patient_id, adm.admission_date);

    // ✅ Atomic batch: discharge + bed free + close bed info in one transaction
    const batchStmts: D1PreparedStatement[] = [
      db.$client.prepare(
        `UPDATE admissions SET status = 'discharged', discharge_date = datetime('now', '+6 hours'), discharge_condition_id = ?, discharge_type = ?, bill_status_on_discharge = 'cleared', updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
      ).bind(discharge_condition_id, discharge_type ?? null, id, tenantId),
      // Close current patient_bed_infos
      db.$client.prepare(
        `UPDATE patient_bed_infos SET ended_on = datetime('now', '+6 hours'),
          days = MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1),
          charge_amount = rate_per_day * MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1)
         WHERE tenant_id = ? AND admission_id = ? AND ended_on IS NULL`
      ).bind(tenantId, id),
    ];

    if (adm.bed_id) {
      batchStmts.push(
        db.$client.prepare(
          `UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?`
        ).bind(adm.bed_id, tenantId)
      );
    }

    await db.$client.batch(batchStmts);
    await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, null, {
      action: 'clinical_discharge',
      discharge_type: discharge_type ?? null,
      discharge_condition_id: discharge_condition_id ?? null,
      checked_on: getTodayGMT6(),
    });
  } else {
    if (status === 'transferred' || status === 'lama') {
      throw new HTTPException(400, { message: 'Use the dedicated transfer or discharge workflow for this admission status' });
    }
    if (!['doctor', 'hospital_admin', 'md'].includes(role)) {
      throw new HTTPException(403, { message: 'Only doctor/admin can change IPD clinical status' });
    }

    const existing = await db.$client.prepare(
      `SELECT status FROM admissions WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first<{ status: string }>();
    if (!existing) throw new HTTPException(404, { message: 'Admission not found' });
    if (!['admitted', 'critical'].includes(existing.status) || !['admitted', 'critical'].includes(status)) {
      throw new HTTPException(400, { message: 'Invalid admission status transition' });
    }

    await db.$client.prepare(
      `UPDATE admissions SET status = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(status, id, tenantId).run();
    await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, {
      status: existing.status,
    }, {
      status,
    });
  }

  return c.json({ success: true });
});

// PUT /api/admissions/:id/credit-discharge — discharge with pending bills marked as credit
app.put('/:id/credit-discharge', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['hospital_admin', 'md', 'director', 'accountant'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to perform credit discharge' });
  }

  const id = c.req.param('id');
  const userId = requireUserId(c);
  const body = await c.req.json<{ discharge_condition_id?: number; discharge_type?: string }>();
  const { discharge_condition_id, discharge_type } = body;

  const adm = await db.$client.prepare(
    `SELECT bed_id, patient_id, admission_date
     FROM admissions
     WHERE id = ? AND tenant_id = ? AND status IN ('admitted','critical')`
  ).bind(id, tenantId).first<{ bed_id: number | null; patient_id: number; admission_date: string | null }>();
  if (!adm) throw new HTTPException(404, { message: 'Active admission not found' });

  await assertAccountingPeriodOpen(c.env.DB, tenantId, getTodayGMT6(), 'Credit discharge');

  // Atomic batch: credit discharge + bed free + close bed info
  const batchStmts: D1PreparedStatement[] = [
    db.$client.prepare(
      `UPDATE admissions SET status = 'discharged', discharge_date = datetime('now', '+6 hours'), discharge_condition_id = ?, discharge_type = ?, bill_status_on_discharge = 'credit', updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(discharge_condition_id ?? null, discharge_type ?? null, id, tenantId),
    db.$client.prepare(
      `UPDATE patient_bed_infos SET ended_on = datetime('now', '+6 hours'),
        days = MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1),
        charge_amount = rate_per_day * MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1)
       WHERE tenant_id = ? AND admission_id = ? AND ended_on IS NULL`
    ).bind(tenantId, id),
  ];

  if (adm.bed_id) {
    batchStmts.push(
      db.$client.prepare(
        `UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?`
      ).bind(adm.bed_id, tenantId)
    );
  }

  await db.$client.batch(batchStmts);
  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'admissions', Number(id) || 0, null, {
    action: 'credit_discharge',
    discharge_type: discharge_type ?? null,
    discharge_condition_id: discharge_condition_id ?? null,
    checked_on: getTodayGMT6(),
  });

  return c.json({ success: true });
});

// GET /api/admissions/:id/billing-status — pending billing breakdown for an admission
app.get('/:id/billing-status', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = c.req.param('id');

  const adm = await db.$client.prepare(
    `SELECT id, patient_id, admission_date, bill_status_on_discharge
     FROM admissions
     WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: number; patient_id: number; admission_date: string | null; bill_status_on_discharge: string | null }>();
  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });

  const { getPendingDischargeBilling } = await import('../../lib/discharge-billing-guards');
  const { getPatientDepositBalance } = await import('../../lib/patient-deposits');
  const [pending, depositBalance] = await Promise.all([
    getPendingDischargeBilling(db.$client, tenantId, id, adm.patient_id, adm.admission_date),
    getPatientDepositBalance(db.$client, tenantId, adm.patient_id),
  ]);

  const totalPending = pending.provisionalAmount + pending.pendingServiceAmount + pending.dueAmount;

  return c.json({
    bill_status_on_discharge: adm.bill_status_on_discharge ?? 'pending',
    pending: {
      provisional_amount: pending.provisionalAmount,
      pending_service_amount: pending.pendingServiceAmount,
      due_amount: pending.dueAmount,
      total: totalPending,
    },
    deposit_balance: depositBalance,
    net_payable: Math.max(0, totalPending - depositBalance),
  });
});

// GET /api/admissions/:id/slip — admission slip HTML for printing
app.get('/:id/slip', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = c.req.param('id');

  const adm = await db.$client.prepare(`
    SELECT a.*, p.name AS patient_name, p.patient_code, p.gender, p.mobile, p.date_of_birth, p.blood_group, p.address,
           b.ward_name, b.bed_number, b.bed_type,
           d.name AS doctor_name, d.specialty AS doctor_specialization,
           (
             SELECT u.name
             FROM audit_logs al
             LEFT JOIN users u ON u.id = al.user_id AND u.tenant_id = al.tenant_id
             WHERE al.tenant_id = a.tenant_id
               AND al.table_name = 'admissions'
               AND al.record_id = a.id
               AND al.action = 'CREATE'
             ORDER BY al.id ASC
             LIMIT 1
           ) AS created_by_name
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    WHERE a.id = ? AND a.tenant_id = ?
  `).bind(id, tenantId).first<Record<string, unknown>>();

  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });

  return c.json({ slip: adm });
});

// GET /api/admissions/:id/wristband — wristband printable data with barcode payload
app.get('/:id/wristband', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = c.req.param('id');
  const row = await db.$client.prepare(`
    SELECT a.id, a.admission_no, a.admission_date, p.name AS patient_name, p.patient_code,
           p.gender, p.date_of_birth, p.blood_group, b.ward_name, b.bed_number,
           GROUP_CONCAT(pa.allergen || COALESCE(' (' || pa.severity || ')', ''), ', ') AS allergies
    FROM admissions a
    JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    LEFT JOIN patient_allergies pa ON pa.patient_id = p.id AND pa.tenant_id = p.tenant_id AND pa.is_active = 1
    WHERE a.id = ? AND a.tenant_id = ?
    GROUP BY a.id
  `).bind(id, tenantId).first<Record<string, unknown>>();
  if (!row) throw new HTTPException(404, { message: 'Admission not found' });
  return c.json({ wristband: { ...row, barcode: `ADM:${row.admission_no}:PAT:${row.patient_code}` } });
});

// GET /api/admissions/:id/sticker — admission chart sticker data
app.get('/:id/sticker', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = c.req.param('id');
  const row = await db.$client.prepare(`
    SELECT a.admission_no, a.admission_date, a.provisional_diagnosis,
           p.name AS patient_name, p.patient_code, p.gender, p.mobile, p.blood_group,
           b.ward_name, b.bed_number, d.name AS doctor_name
    FROM admissions a
    JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    WHERE a.id = ? AND a.tenant_id = ?
  `).bind(id, tenantId).first<Record<string, unknown>>();
  if (!row) throw new HTTPException(404, { message: 'Admission not found' });
  return c.json({ sticker: row });
});

// GET /api/admissions/:id/birth-certificate — latest birth certificate for admission
app.get('/:id/birth-certificate', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = c.req.param('id');
  const record = await db.$client.prepare(`
    SELECT bbd.*, p.name AS mother_patient_name, p.patient_code AS mother_patient_code,
           a.admission_no
    FROM baby_birth_details bbd
    LEFT JOIN patients p ON p.id = bbd.patient_id AND p.tenant_id = bbd.tenant_id
    LEFT JOIN admissions a ON a.id = bbd.admission_id AND a.tenant_id = bbd.tenant_id
    WHERE bbd.tenant_id = ? AND bbd.admission_id = ? AND bbd.is_active = 1
    ORDER BY bbd.created_at DESC LIMIT 1
  `).bind(String(tenantId), id).first<Record<string, unknown>>();
  if (!record) throw new HTTPException(404, { message: 'Birth record not found' });
  return c.json({ certificate: record });
});

// GET /api/admissions/:id/death-certificate — death certificate for admission
app.get('/:id/death-certificate', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const id = c.req.param('id');
  const record = await db.$client.prepare(`
    SELECT dd.*, p.name AS patient_name, p.patient_code, p.gender, p.date_of_birth, p.address,
           a.admission_no, a.admission_date, b.ward_name, b.bed_number
    FROM death_details dd
    LEFT JOIN patients p ON p.id = dd.patient_id AND p.tenant_id = dd.tenant_id
    LEFT JOIN admissions a ON a.id = dd.admission_id AND a.tenant_id = dd.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    WHERE dd.tenant_id = ? AND dd.admission_id = ?
    ORDER BY dd.created_at DESC LIMIT 1
  `).bind(String(tenantId), id).first<Record<string, unknown>>();
  if (!record) throw new HTTPException(404, { message: 'Death record not found' });
  return c.json({ certificate: record });
});

export default app;
