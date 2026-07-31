import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getNextSequence } from '../../lib/sequence';
import { getTodayGMT6 } from '../../lib/date-utils';
import { createPrescriptionSchema, updatePrescriptionSchema } from '../../schemas/clinical';
import { getDb } from '../../db';
import { prescriptions, prescriptionItems } from '../../db/schema';
import { enforcePrescriptionDrugSafety } from '../../lib/prescription-safety';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireRole } from '../../middleware/rbac';
import { buildPrescriptionUsageStatsStatements } from '../../lib/prescription-usage-stats';
import { ensurePendingPrescriptionLabOrder } from '../../lib/prescription-lab-orders';
import { resolveOrderingClinicianDoctorId } from '../../lib/lab-order-attribution';


const app = new Hono<{ Bindings: Env; Variables: Variables }>();
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
const PRESCRIPTION_READ_ROLES = ['doctor', 'md', 'nurse', 'pharmacist', 'reception', 'hospital_admin'] as const;

function isNonEditableClinicalPrescription(status: string | null | undefined): boolean {
  return ['final', 'dispensed', 'completed', 'cancelled'].includes(status ?? '');
}

function isPrescriptionItemSchemaDrift(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such (table|column)|has no column named/i.test(message);
}

function isUniqueConstraintError(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && !seen.has(current)) {
    seen.add(current);
    messages.push(current instanceof Error ? current.message : String(current));
    current = typeof current === 'object' && current !== null && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null;
  }

  return /unique constraint|constraint failed|already exists/i.test(messages.join(' '));
}

async function replacePrescriptionItemsForTenant(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  prescriptionId: number,
  items: NonNullable<z.infer<typeof updatePrescriptionSchema>['items']>,
) {
  try {
    await db.$client.prepare(
      "UPDATE prescription_items SET status = 'replaced', updated_at = datetime('now', '+6 hours') WHERE prescription_id = ? AND prescription_id IN (SELECT id FROM prescriptions WHERE tenant_id = ?)"
    ).bind(prescriptionId, tenantId).run();
  } catch (error) {
    if (!isPrescriptionItemSchemaDrift(error)) throw error;
    await db.$client.prepare(
      'DELETE FROM prescription_items WHERE prescription_id = ? AND prescription_id IN (SELECT id FROM prescriptions WHERE tenant_id = ?)'
    ).bind(prescriptionId, tenantId).run();
  }

  if (items.length === 0) return;
  const itemStmts = items.map((item) =>
    db.insert(prescriptionItems)
      .values({
        prescriptionId,
        medicineName: item.medicine_name,
        dosage: item.dosage ?? null,
        frequency: item.frequency ?? null,
        duration: item.duration ?? null,
        instructions: item.instructions ?? null,
        sortOrder: item.sort_order ?? 0,
        quantity: item.quantity ?? 0,
        medicineId: item.medicineId ?? null,
      })
  );
  await db.batch(itemStmts as [typeof itemStmts[0], ...typeof itemStmts]);
}

async function getPrescriptionItemsForMedicationSync(
  db: ReturnType<typeof getDb>,
  prescriptionId: number,
) {
  try {
    const { results } = await db.$client.prepare(
      "SELECT medicine_name, dosage, frequency, duration FROM prescription_items WHERE prescription_id = ? AND COALESCE(status, 'active') != 'replaced'"
    ).bind(prescriptionId).all<{ medicine_name: string; dosage: string | null; frequency: string | null; duration: string | null }>();
    return results ?? [];
  } catch (error) {
    if (!isPrescriptionItemSchemaDrift(error)) throw error;
    const { results } = await db.$client.prepare(
      'SELECT medicine_name, dosage, frequency, duration FROM prescription_items WHERE prescription_id = ?'
    ).bind(prescriptionId).all<{ medicine_name: string; dosage: string | null; frequency: string | null; duration: string | null }>();
    return results ?? [];
  }
}

async function getStoredPrescriptionSnapshot(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  prescriptionId: number,
  status: string,
  items: Array<{ medicine_name: string; dosage?: string | null; frequency?: string | null; duration?: string | null }>,
  patch: Record<string, unknown> = {},
) {
  const row = await db.$client.prepare(
    `SELECT * FROM prescriptions WHERE id = ? AND tenant_id = ? LIMIT 1`
  ).bind(prescriptionId, tenantId).first<Record<string, unknown>>();
  if (!row) {
    throw new HTTPException(404, { message: 'Prescription not found' });
  }
  return { ...row, ...patch, status, items };
}

async function resolveDoctorIdForPrescriptionWrite(
  c: AppContext,
  db: ReturnType<typeof getDb>,
  tenantId: string,
  assignedDoctorId: number | null | undefined,
): Promise<number | null> {
  if (c.get('role') !== 'doctor') return assignedDoctorId ?? null;

  const linkedDoctor = await db.$client.prepare(
    `SELECT id FROM doctors WHERE user_id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(requireUserId(c), tenantId).first<{ id: number }>();
  if (!linkedDoctor) {
    throw new HTTPException(403, { message: 'Active doctor profile is required to write prescriptions' });
  }
  if (assignedDoctorId != null && Number(assignedDoctorId) !== Number(linkedDoctor.id)) {
    throw new HTTPException(403, { message: 'Cannot write a prescription assigned to another doctor' });
  }
  return Number(linkedDoctor.id);
}

async function resolveDoctorIdForFrequentReads(
  c: AppContext,
  db: ReturnType<typeof getDb>,
  tenantId: string,
): Promise<number | null> {
  const queryDoctorId = c.req.query('doctorId');
  if (queryDoctorId) {
    const parsed = Number(queryDoctorId);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const role = c.get('role');
    if (role === 'doctor') {
      const linkedDoctor = await resolveLinkedDoctorId(c, db, tenantId);
      if (!linkedDoctor || linkedDoctor !== parsed) {
        throw new HTTPException(403, { message: 'Cannot read another doctor frequent tests' });
      }
    } else if (!['hospital_admin', 'md'].includes(String(role ?? ''))) {
      throw new HTTPException(403, { message: 'Cannot query another doctor frequent tests' });
    }
    return parsed;
  }

  return resolveLinkedDoctorId(c, db, tenantId);
}

async function resolveLinkedDoctorId(
  c: AppContext,
  db: ReturnType<typeof getDb>,
  tenantId: string,
): Promise<number | null> {
  const userId = c.get('userId');
  if (!userId) return null;
  const linkedDoctor = await db.$client.prepare(
    `SELECT id FROM doctors WHERE user_id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(userId, tenantId).first<{ id: number }>();
  return linkedDoctor?.id ? Number(linkedDoctor.id) : null;
}

async function assertPrescriptionRecordAccess(
  c: AppContext,
  db: ReturnType<typeof getDb>,
  tenantId: string,
  rx: Record<string, unknown>,
  action = 'read this prescription',
): Promise<void> {
  const role = c.get('role');
  if (role === 'hospital_admin' || role === 'md') return;

  if (role === 'doctor') {
    const linkedDoctorId = await resolveLinkedDoctorId(c, db, tenantId);
    const prescriptionDoctorId = Number(rx.doctor_id ?? rx.doctorId ?? 0);
    if (linkedDoctorId && prescriptionDoctorId && linkedDoctorId === prescriptionDoctorId) return;
  }

  throw new HTTPException(403, { message: `Not authorized to ${action}` });
}

async function finalizeIssuedPrescription(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  prescriptionId: number,
  userId: string,
  patientId: number,
  doctorId: number | null,
  snapshot: unknown,
  items: Array<{ medicine_name: string; dosage?: string | null; frequency?: string | null }>,
  labTests: string[] = [],
) {
  const statements: D1PreparedStatement[] = [
    db.$client.prepare(`
      UPDATE prescriptions
      SET status = 'final', updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = 'draft'
    `).bind(prescriptionId, tenantId),
    db.$client.prepare(`
    INSERT INTO prescription_versions (prescription_id, version_number, snapshot, edited_by, edit_reason, tenant_id)
    SELECT ?, COALESCE(MAX(version_number), 0) + 1, ?, ?, 'Initial finalization', ?
    FROM prescription_versions WHERE prescription_id = ?
  `).bind(prescriptionId, JSON.stringify(snapshot), userId, tenantId, prescriptionId),
    ...items.map((item) =>
    db.$client.prepare(`
      INSERT OR IGNORE INTO patient_active_medications
        (patient_id, medication_name, dosage, frequency, source, prescribed_by, status, tenant_id)
      VALUES (?, ?, ?, ?, 'prescribed', ?, 'active', ?)
    `).bind(patientId, item.medicine_name, item.dosage ?? null, item.frequency ?? null, doctorId, tenantId)
    ),
    ...buildPrescriptionUsageStatsStatements(db.$client, tenantId, doctorId, items, labTests),
  ];
  await db.$client.batch(statements);

  await ensurePendingPrescriptionLabOrder(db.$client, tenantId, {
    prescriptionId,
    patientId,
    orderedBy: userId,
    orderingClinicianDoctorId: doctorId,
    labTests,
  });
}

// ─── GET /api/prescriptions?status=&patient= — list prescriptions ────────────
app.get('/', requireRole(...PRESCRIPTION_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const status = c.req.query('status');
  const patientId = c.req.query('patient');

  // Multi-table JOIN with subquery + dynamic filters → raw SQL
  let query = `
    SELECT p.*, pt.name AS patient_name, pt.patient_code,
           d.name AS doctor_name,
           (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = p.id) AS item_count,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM prescription_items pi
               WHERE pi.prescription_id = p.id
                 AND COALESCE(pi.quantity, 0) > COALESCE(pi.dispensed_qty, 0)
             ) AND EXISTS (
               SELECT 1 FROM medication_orders mo
               WHERE mo.prescription_id = p.id
                 AND mo.tenant_id = p.tenant_id
                 AND mo.status IN ('confirmed', 'partially_fulfilled', 'fulfilled')
             ) THEN 'partial'
             WHEN EXISTS (
               SELECT 1 FROM medication_orders mo
               WHERE mo.prescription_id = p.id
                 AND mo.tenant_id = p.tenant_id
                 AND mo.status IN ('confirmed', 'partially_fulfilled', 'fulfilled')
             ) THEN 'dispensed'
             ELSE COALESCE(p.dispense_status, 'pending')
           END AS fulfilment_status
    FROM prescriptions p
    LEFT JOIN patients pt ON p.patient_id = pt.id AND pt.tenant_id = p.tenant_id
    LEFT JOIN doctors d ON p.doctor_id = d.id AND d.tenant_id = p.tenant_id
    WHERE p.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (status)    { query += ' AND p.status = ?';      params.push(status); }
  if (patientId) { query += ' AND p.patient_id = ?';  params.push(Number(patientId)); }
  query += ' ORDER BY p.created_at DESC LIMIT 100';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ prescriptions: results });
});

// ─── GET /api/prescriptions/history — lightweight prescription history ───────
app.get('/history', requireRole(...PRESCRIPTION_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const patientId = c.req.query('patientId');
  if (!patientId) {
    throw new HTTPException(400, { message: 'patientId is required' });
  }

  const { results } = await db.$client.prepare(`
    SELECT p.id, p.rx_no, p.created_at, p.status, p.diagnosis, p.chief_complaint,
           p.advice, p.follow_up_date,
           d.name as doctor_name
    FROM prescriptions p
    LEFT JOIN doctors d ON p.doctor_id = d.id
    WHERE p.tenant_id = ? AND p.patient_id = ?
    ORDER BY p.created_at DESC
    LIMIT 20
  `).bind(tenantId, Number(patientId)).all();

  return c.json({ prescriptions: results ?? [] });
});

// ─── GET /api/prescriptions/frequent-lab-tests — doctor quick-pick tests ─────
app.get('/frequent-lab-tests', requireRole(...PRESCRIPTION_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 10), 1), 20);
  const doctorId = await resolveDoctorIdForFrequentReads(c, db, tenantId);
  if (!doctorId) return c.json({ tests: [] });

  const { results } = await db.$client.prepare(`
    SELECT test_name, usage_count
    FROM prescription_lab_test_usage_stats
    WHERE tenant_id = ? AND doctor_id = ?
    ORDER BY usage_count DESC, last_used_at DESC, test_name ASC
    LIMIT ?
  `).bind(tenantId, doctorId, limit).all<{ test_name: string; usage_count: number }>();

  return c.json({
    tests: (results ?? []).map((row) => ({
      name: row.test_name,
      usage_count: row.usage_count,
      source: 'doctor_usage',
    })),
  });
});

// ─── GET /api/prescriptions/:id — single prescription with items ─────────────
app.get('/:id', requireRole(...PRESCRIPTION_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = Number(c.req.param('id'));

  // Multi-table JOIN → raw SQL
  const rx = await db.$client.prepare(
    `SELECT p.*, pt.name AS patient_name, pt.patient_code,
            d.name AS doctor_name
     FROM prescriptions p
     LEFT JOIN patients pt ON p.patient_id = pt.id AND pt.tenant_id = p.tenant_id
     LEFT JOIN doctors d ON p.doctor_id = d.id AND d.tenant_id = p.tenant_id
     WHERE p.id = ? AND p.tenant_id = ?`
  ).bind(id, tenantId).first();

  if (!rx) throw new HTTPException(404, { message: 'Prescription not found' });
  await assertPrescriptionRecordAccess(c, db, tenantId, rx as Record<string, unknown>);

  // Items query → Drizzle ORM
  const items = await db.select()
    .from(prescriptionItems)
    .where(eq(prescriptionItems.prescriptionId, id))
    .orderBy(prescriptionItems.sortOrder);
  const normalizedItems = items.map((item) => ({
    ...item,
    prescription_id: item.prescriptionId,
    medicine_name: item.medicineName,
    sort_order: item.sortOrder,
    dispensed_qty: item.dispensedQty,
    medicine_id: item.medicineId,
  }));

  return c.json({ ...rx, items: normalizedItems });
});

// ─── GET /api/prescriptions/:id/print — rich print data ──────────────────────
app.get('/:id/print', requireRole(...PRESCRIPTION_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = Number(c.req.param('id'));

  // Multi-table JOIN with extended columns → raw SQL
  const rx = await db.$client.prepare(`
    SELECT p.*,
           pt.name AS patient_name, pt.patient_code, pt.date_of_birth, pt.gender, pt.address,
           d.name AS doctor_name, d.specialty, d.bmdc_reg_no, d.qualifications, d.visiting_hours
    FROM prescriptions p
    LEFT JOIN patients pt ON p.patient_id = pt.id AND pt.tenant_id = p.tenant_id
    LEFT JOIN doctors d ON p.doctor_id = d.id AND d.tenant_id = p.tenant_id
    WHERE p.id = ? AND p.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!rx) throw new HTTPException(404, { message: 'Prescription not found' });
  await assertPrescriptionRecordAccess(c, db, tenantId, rx as Record<string, unknown>, 'print this prescription');

  // Items query → Drizzle ORM
  const items = await db.select()
    .from(prescriptionItems)
    .where(eq(prescriptionItems.prescriptionId, id))
    .orderBy(prescriptionItems.sortOrder);
  const normalizedItems = items.map((item) => ({
    ...item,
    prescription_id: item.prescriptionId,
    medicine_name: item.medicineName,
    sort_order: item.sortOrder,
    dispensed_qty: item.dispensedQty,
    medicine_id: item.medicineId,
  }));

  // Get hospital name from settings
  const setting = await db.$client.prepare(
    `SELECT value FROM settings WHERE tenant_id = ? AND key = 'hospital_name'`
  ).bind(tenantId).first<{ value: string }>();

  return c.json({
    prescription: {
      ...rx,
      suggested_tests: (rx as Record<string, unknown>).lab_tests, // alias for frontend
      hospital_name: setting?.value ?? 'Hospital',
      items: normalizedItems,
    },
  });
});

// ─── POST /api/prescriptions — create prescription ────────────────────────────
app.post('/', zValidator('json', createPrescriptionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor', 'md', 'hospital_admin'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to create prescriptions' });
  }

  const userId = requireUserId(c);
  const body = c.req.valid('json');
  const requestedStatus = body.status ?? 'draft';

  // ─── P0-11: Tenant-ownership check for patient + doctor + appointment ─────
  // These queries intentionally return 404 (not 403) for cross-tenant IDs to
  // avoid leaking existence of records that belong to another hospital.
  const patientRow = await db.$client.prepare(
    `SELECT id FROM patients WHERE id = ? AND tenant_id = ? LIMIT 1`,
  ).bind(body.patientId, tenantId).first<{ id: number }>();
  if (!patientRow) {
    throw new HTTPException(404, { message: 'Patient not found' });
  }
  if (body.doctorId != null) {
    const doctorRow = await db.$client.prepare(
      `SELECT id FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`,
    ).bind(body.doctorId, tenantId).first<{ id: number }>();
    if (!doctorRow) {
      throw new HTTPException(404, { message: 'Doctor not found' });
    }
  }
  if (body.appointmentId != null) {
    const apptRow = await db.$client.prepare(
      `SELECT id FROM appointments WHERE id = ? AND tenant_id = ? LIMIT 1`,
    ).bind(body.appointmentId, tenantId).first<{ id: number }>();
    if (!apptRow) {
      throw new HTTPException(404, { message: 'Appointment not found' });
    }
  }

  if (body.admissionId != null) {
    const admission = await db.$client.prepare(`
      SELECT id, patient_id, admission_no, admission_date, discharge_date, status
      FROM admissions
      WHERE id = ? AND tenant_id = ? AND patient_id = ?
      LIMIT 1
    `).bind(body.admissionId, tenantId, body.patientId).first<{
      id: number;
      patient_id: number;
      admission_no: string | null;
      admission_date: string;
      discharge_date: string | null;
      status: string;
    }>();
    if (!admission) {
      throw new HTTPException(404, { message: 'Admission not found for patient' });
    }
  }

  if (body.sourceReconciliationId != null) {
    const reconciliation = await db.$client.prepare(`
      SELECT mr.id
      FROM cln_medication_reconciliation mr
      JOIN visits v
        ON v.id = mr.visit_id
       AND v.tenant_id = mr.tenant_id
       AND v.patient_id = mr.patient_id
      JOIN admissions a
        ON a.id = ?
       AND a.tenant_id = mr.tenant_id
       AND a.patient_id = mr.patient_id
      WHERE mr.id = ?
        AND mr.tenant_id = ?
        AND mr.patient_id = ?
        AND mr.reconciliation_type = 'discharge'
        AND mr.status = 'completed'
        AND mr.is_active = 1
        AND (
          (v.admission_no IS NOT NULL AND v.admission_no = a.admission_no)
          OR (
            COALESCE(v.admission_flag, 0) = 1
            AND COALESCE(v.created_at, v.visit_date) >= a.admission_date
            AND (a.discharge_date IS NULL OR COALESCE(v.created_at, v.visit_date) <= a.discharge_date)
          )
        )
      LIMIT 1
    `).bind(
      body.admissionId,
      body.sourceReconciliationId,
      tenantId,
      body.patientId,
    ).first<{ id: number }>();
    if (!reconciliation) {
      throw new HTTPException(409, {
        message: 'Completed discharge medication reconciliation not found for this admission',
      });
    }

    const existingPrescription = await db.$client.prepare(`
      SELECT id, rx_no, status
      FROM prescriptions
      WHERE tenant_id = ? AND source_reconciliation_id = ?
      LIMIT 1
    `).bind(tenantId, body.sourceReconciliationId).first<{
      id: number;
      rx_no: string;
      status: string;
    }>();
    if (existingPrescription) {
      throw new HTTPException(409, {
        message: `A prescription already exists for this medication reconciliation (${existingPrescription.rx_no})`,
      });
    }
  }

  // ─── Safety Check: shared medication safety engine ────────────────────────
  if (body.items?.length && body.patientId) {
    await enforcePrescriptionDrugSafety(db, tenantId, body.patientId, body.items, {
      safetyCheckId: body.safetyCheckId,
      safetyOverrideReason: body.safetyOverrideReason,
    });
  }

  const doctorId = await resolveDoctorIdForPrescriptionWrite(c, db, tenantId, body.doctorId);

  // ✅ Use sequence-based rx_no (no more COUNT(*) race condition)
  const rxNo = await getNextSequence(c.env.DB, tenantId, 'prescription', 'RX');

  // ─── Step 1: Insert prescription using Drizzle ORM with .returning() ────
  let rxResult: { id: number };
  try {
    [rxResult] = await db.insert(prescriptions)
      .values({
        rxNo,
        patientId: body.patientId,
        doctorId,
        appointmentId: body.appointmentId ?? null,
        admissionId: body.admissionId ?? null,
        sourceReconciliationId: body.sourceReconciliationId ?? null,
        bp: body.bp ?? null,
        temperature: body.temperature ?? null,
        weight: body.weight ?? null,
        spo2: body.spo2 ?? null,
        chiefComplaint: body.chiefComplaint ?? null,
        diagnosis: body.diagnosis ?? null,
        examinationNotes: body.examinationNotes ?? null,
        advice: body.advice ?? null,
        labTests: body.labTests ? JSON.stringify(body.labTests) : null,
        followUpDate: body.followUpDate ?? null,
        status: requestedStatus === 'final' ? 'draft' : requestedStatus,
        createdBy: Number(userId) ?? 0,
        tenantId: String(tenantId),
      })
      .returning({ id: prescriptions.id });
  } catch (error) {
    if (body.sourceReconciliationId != null && isUniqueConstraintError(error)) {
      throw new HTTPException(409, {
        message: 'A prescription already exists for this medication reconciliation',
      });
    }
    throw error;
  }

  const rxId = rxResult.id;

  // ─── Step 2: Batch insert items using Drizzle batch ─────────────────────
  if (body.items?.length) {
    const itemStmts = body.items.map((item) =>
      db.insert(prescriptionItems)
        .values({
          prescriptionId: rxId,
          medicineName: item.medicine_name,
          dosage: item.dosage ?? null,
          frequency: item.frequency ?? null,
          duration: item.duration ?? null,
          instructions: item.instructions ?? null,
          sortOrder: item.sort_order ?? 0,
          quantity: item.quantity ?? 0,
          medicineId: item.medicineId ?? null,
        })
    );
    await db.batch(itemStmts as [typeof itemStmts[0], ...typeof itemStmts]);
  }

  if (requestedStatus === 'final') {
    await finalizeIssuedPrescription(db, tenantId, rxId, String(userId), body.patientId, doctorId, {
      id: rxId,
      rxNo,
      ...body,
      doctorId,
    }, body.items ?? [], body.labTests ?? []);
  }

  return c.json({ id: rxId, rxNo }, 201);
});

// ─── POST /api/prescriptions/:id/auto-save — lightweight draft auto-save ──────
const autoSaveSchema = z.object({
  chiefComplaint: z.string().optional(),
  diagnosis: z.string().optional(),
  examinationNotes: z.string().optional(),
  advice: z.string().optional(),
  bp: z.string().optional(),
  temperature: z.string().optional(),
  weight: z.string().optional(),
  spo2: z.string().optional(),
  labTests: z.array(z.string()).optional(),
  followUpDate: z.string().optional(),
  items: z.array(z.object({
    medicine_name: z.string(),
    dosage: z.string().optional(),
    frequency: z.string().optional(),
    duration: z.string().optional(),
    instructions: z.string().optional(),
    sort_order: z.number().int().optional(),
    quantity: z.number().int().positive().optional(),
    medicineId: z.number().int().positive().optional(),
  })).optional(),
});

app.post('/:id/auto-save', zValidator('json', autoSaveSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor', 'md', 'hospital_admin'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to auto-save prescriptions' });
  }

  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');

  // Fetch current prescription status and lock state
  const existing = await db.$client.prepare(
    `SELECT id, status, is_locked, doctor_id FROM prescriptions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: number; status: string; is_locked: number; doctor_id: number | null }>();
  if (!existing) throw new HTTPException(404, { message: 'Prescription not found' });

  // Only draft prescriptions can be auto-saved
  if (existing.status !== 'draft' || existing.is_locked === 1) {
    throw new HTTPException(400, { message: 'Auto-save only works on draft prescriptions' });
  }

  await resolveDoctorIdForPrescriptionWrite(c, db, tenantId, existing.doctor_id);

  // Build dynamic update — only set fields that are provided
  const updateData: Record<string, unknown> = {
    updatedAt: sql`datetime('now', '+6 hours')`,
  };
  if (body.chiefComplaint !== undefined)   updateData.chiefComplaint = body.chiefComplaint;
  if (body.diagnosis !== undefined)        updateData.diagnosis = body.diagnosis;
  if (body.examinationNotes !== undefined) updateData.examinationNotes = body.examinationNotes;
  if (body.advice !== undefined)           updateData.advice = body.advice;
  if (body.bp !== undefined)               updateData.bp = body.bp;
  if (body.temperature !== undefined)      updateData.temperature = body.temperature;
  if (body.weight !== undefined)           updateData.weight = body.weight;
  if (body.spo2 !== undefined)             updateData.spo2 = body.spo2;
  if (body.labTests !== undefined)         updateData.labTests = JSON.stringify(body.labTests);
  if (body.followUpDate !== undefined)     updateData.followUpDate = body.followUpDate;

  await db.update(prescriptions)
    .set(updateData)
    .where(and(eq(prescriptions.id, id), eq(prescriptions.tenantId, String(tenantId))));

  // Replace items if provided
  if (body.items) {
    await replacePrescriptionItemsForTenant(db, tenantId, id, body.items);
  }

  const timestamp = new Date().toISOString();
  return c.json({ saved: true, timestamp });
});

// ─── PUT /api/prescriptions/:id — update prescription ─────────────────────────
app.put('/:id', zValidator('json', updatePrescriptionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const role = c.get('role');
  const clinicalRoles = ['doctor', 'md', 'hospital_admin'];
  if (!role || !clinicalRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update prescriptions' });
  }

  // Fetch current prescription for state validation
  const existing = await db.$client.prepare(
    `SELECT id, status, patient_id, doctor_id, is_locked FROM prescriptions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: number; status: string; patient_id: number; doctor_id: number | null; is_locked: number }>();
  if (!existing) throw new HTTPException(404, { message: 'Prescription not found' });

  // Lock check — locked prescriptions cannot have their clinical content edited
  if (existing.is_locked === 1) {
    throw new HTTPException(403, { message: 'Locked prescriptions cannot be edited' });
  }

  if (isNonEditableClinicalPrescription(existing.status)) {
    throw new HTTPException(409, { message: 'Finalized prescriptions cannot be edited directly' });
  }

  await resolveDoctorIdForPrescriptionWrite(c, db, tenantId, existing.doctor_id);

  if (body.items?.length) {
    await enforcePrescriptionDrugSafety(db, tenantId, existing.patient_id, body.items, {
      safetyCheckId: body.safetyCheckId,
      safetyOverrideReason: body.safetyOverrideReason,
    });
  }

  // Enforce status transition rules
  if (body.status !== undefined) {
    const validTransitions: Record<string, string[]> = {
      draft: ['final', 'cancelled'],
      final: [],
      dispensed: [],
      completed: [],
      cancelled: [],
    };
    const currentStatus = existing.status || 'draft';
    const allowed = validTransitions[currentStatus] || [];
    if (body.status !== currentStatus && !allowed.includes(body.status)) {
      throw new HTTPException(400, {
        message: `Invalid status transition: ${currentStatus} → ${body.status}. Allowed: ${allowed.join(', ') || 'none'}`,
      });
    }
  }

  // Build dynamic update object for Drizzle
  const updateData: Record<string, unknown> = {
    updatedAt: sql`datetime('now', '+6 hours')`,
  };
  if (body.bp !== undefined)               updateData.bp = body.bp;
  if (body.temperature !== undefined)      updateData.temperature = body.temperature;
  if (body.weight !== undefined)           updateData.weight = body.weight;
  if (body.spo2 !== undefined)             updateData.spo2 = body.spo2;
  if (body.chiefComplaint !== undefined)   updateData.chiefComplaint = body.chiefComplaint;
  if (body.diagnosis !== undefined)        updateData.diagnosis = body.diagnosis;
  if (body.examinationNotes !== undefined) updateData.examinationNotes = body.examinationNotes;
  if (body.advice !== undefined)           updateData.advice = body.advice;
  if (body.labTests !== undefined)         updateData.labTests = JSON.stringify(body.labTests);
  if (body.followUpDate !== undefined)     updateData.followUpDate = body.followUpDate;
  if (body.status !== undefined && body.status !== 'final') updateData.status = body.status;

  await db.update(prescriptions)
    .set(updateData)
    .where(and(eq(prescriptions.id, id), eq(prescriptions.tenantId, String(tenantId))));

  // Replace draft items; fall back to delete+insert on older D1 schemas without item status columns.
  if (body.items) {
    await replacePrescriptionItemsForTenant(db, tenantId, id, body.items);
  }

  // Create version snapshot on finalization
  if (body.status === 'final' && existing.status !== 'final') {
    const rxItems = await getPrescriptionItemsForMedicationSync(db, id);
    const snapshot = await getStoredPrescriptionSnapshot(db, tenantId, id, 'final', rxItems, body);
    await finalizeIssuedPrescription(
      db,
      tenantId,
      id,
      String(requireUserId(c)),
      existing.patient_id,
      existing.doctor_id ?? null,
      snapshot,
      rxItems,
      body.labTests ?? [],
    );
  }

  return c.json({ success: true });
});

// ─── POST /api/prescriptions/:id/lock — lock prescription ────────────────────
app.post('/:id/lock', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor', 'md', 'hospital_admin'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to lock prescriptions' });
  }

  const id = Number(c.req.param('id'));
  const userId = requireUserId(c);

  const existing = await db.$client.prepare(
    `SELECT id, status, is_locked, doctor_id FROM prescriptions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: number; status: string; is_locked: number; doctor_id: number | null }>();
  if (!existing) throw new HTTPException(404, { message: 'Prescription not found' });

  if (existing.status !== 'final') {
    throw new HTTPException(400, { message: 'Only finalized prescriptions can be locked' });
  }

  if (existing.is_locked === 1) {
    throw new HTTPException(409, { message: 'Prescription is already locked' });
  }

  await resolveDoctorIdForPrescriptionWrite(c, db, tenantId, existing.doctor_id);

  await db.update(prescriptions)
    .set({
      isLocked: 1,
      lockedAt: sql`datetime('now', '+6 hours')`,
      lockedBy: Number(userId),
    })
    .where(and(eq(prescriptions.id, id), eq(prescriptions.tenantId, String(tenantId))));

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'prescriptions', id, null, {
    operation: 'lock',
    status: existing.status,
    locked_at: new Date().toISOString(),
  });

  return c.json({ success: true, message: 'Prescription locked' });
});

// ─── GET /api/prescriptions/:id/versions — version history ───────────────────
app.get('/:id/versions', requireRole(...PRESCRIPTION_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    `SELECT id, doctor_id FROM prescriptions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: number; doctor_id: number | null }>();
  if (!existing) throw new HTTPException(404, { message: 'Prescription not found' });
  await assertPrescriptionRecordAccess(c, db, tenantId, existing as unknown as Record<string, unknown>, 'view prescription versions');

  const { results } = await db.$client.prepare(`
    SELECT id, prescription_id, version_number, snapshot, edited_by, edit_reason, created_at
    FROM prescription_versions
    WHERE prescription_id = ? AND tenant_id = ?
    ORDER BY version_number ASC
    LIMIT 50
  `).bind(id, tenantId).all();

  return c.json({ versions: results ?? [] });
});

// ─── POST /api/prescriptions/override-safety — override safety check ─────────
app.post('/override-safety', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to override safety checks' });
  }

  const body = await c.req.json<{
    prescription_id: number;
    patient_id: number;
    doctor_id: number;
    override_type: string;
    allergen: string;
    severity?: string;
    reason: string;
  }>();

  // Validate
  if (!body.reason || body.reason.trim().length < 10) {
    throw new HTTPException(400, { message: 'Reason must be at least 10 characters' });
  }
  if (!body.allergen || body.allergen.trim().length === 0) {
    throw new HTTPException(400, { message: 'Allergen is required' });
  }
  const validTypes = ['allergy', 'interaction', 'duplicate'];
  if (!body.override_type || !validTypes.includes(body.override_type)) {
    throw new HTTPException(400, { message: `override_type must be one of: ${validTypes.join(', ')}` });
  }

  // Verify prescription exists and get its patient_id
  const rx = await db.$client.prepare(
    `SELECT id, patient_id, doctor_id FROM prescriptions WHERE id = ? AND tenant_id = ?`
  ).bind(body.prescription_id, tenantId).first<{ id: number; patient_id: number; doctor_id: number | null }>();
  if (!rx) throw new HTTPException(404, { message: 'Prescription not found' });

  const doctorId = await resolveDoctorIdForPrescriptionWrite(c, db, tenantId, rx.doctor_id);

  // Derive patient and clinician attribution from server-side records.
  const result = await db.$client.prepare(`
    INSERT INTO prescription_overrides (prescription_id, patient_id, doctor_id, override_type, allergen, severity, reason, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(body.prescription_id, rx.patient_id, doctorId, body.override_type, body.allergen, body.severity ?? null, body.reason.trim(), tenantId).run();

  return c.json({ success: true, override_id: result.meta?.last_row_id }, 201);
});

// ─── GET /api/prescriptions/:id/overrides — get overrides for prescription ───
app.get('/:id/overrides', requireRole(...PRESCRIPTION_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    `SELECT id, doctor_id FROM prescriptions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: number; doctor_id: number | null }>();
  if (!existing) throw new HTTPException(404, { message: 'Prescription not found' });
  await assertPrescriptionRecordAccess(c, db, tenantId, existing as unknown as Record<string, unknown>, 'view prescription overrides');

  const { results } = await db.$client.prepare(`
    SELECT id, prescription_id, patient_id, doctor_id, override_type, allergen, severity, reason, created_at
    FROM prescription_overrides
    WHERE prescription_id = ? AND tenant_id = ?
    ORDER BY created_at DESC
  `).bind(id, tenantId).all();

  return c.json({ overrides: results ?? [] });
});

// ─── POST /api/prescriptions/:id/share — generate share token ─────────────────
app.post('/:id/share', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const role = c.get('role');
  const allowedRoles = ['doctor', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to share prescriptions' });
  }

  const id = Number(c.req.param('id'));

  // Verify prescription exists for this tenant
  const rx = await db.$client.prepare(
    `SELECT id, doctor_id FROM prescriptions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: number; doctor_id: number | null }>();
  if (!rx) throw new HTTPException(404, { message: 'Prescription not found' });
  await assertPrescriptionRecordAccess(c, db, tenantId, rx as unknown as Record<string, unknown>, 'share this prescription');

  // Generate a cryptographically random token
  const token = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  // Update using Drizzle
  await db.update(prescriptions)
    .set({ shareToken: token, shareExpiresAt: expiresAt })
    .where(and(eq(prescriptions.id, id), eq(prescriptions.tenantId, String(tenantId))));

  return c.json({
    token,
    expiresAt,
    url: `/api/rx/${token}`,
  });
});

// ─── POST /api/prescriptions/:id/order-delivery — place delivery order ────────
const orderDeliverySchema = z.object({
  address: z.string().min(5).max(500),
  phone:   z.string().min(6).max(20),
});

app.post('/:id/order-delivery', zValidator('json', orderDeliverySchema), async (c) => {
  const role = c.get('role');
  const allowedRoles = ['pharmacist', 'hospital_admin', 'reception', 'doctor', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to order delivery' });
  }
  throw new HTTPException(410, {
    message: 'Prescription delivery requests are retired; use a separate patient-selected medication order workflow',
  });
});

// ─── PUT /api/prescriptions/:id/delivery-status — retired legacy mutation ────
app.put('/:id/delivery-status', async (c) => {
  const role = c.get('role');
  const allowedRoles = ['hospital_admin', 'pharmacist'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update delivery status' });
  }
  throw new HTTPException(410, {
    message: 'Prescription delivery status is retired; use a separate medication fulfilment order workflow',
  });
});

// ─── GET /api/prescriptions/:id/repeat — copy prescription for returning patient ─
app.get('/:id/repeat', requireRole(...PRESCRIPTION_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = Number(c.req.param('id'));

  const rx = await db.$client.prepare(
    `SELECT p.id, p.rx_no, p.patient_id, p.doctor_id, p.diagnosis, p.chief_complaint,
            p.advice, p.follow_up_date, p.status
     FROM prescriptions p
     WHERE p.id = ? AND p.tenant_id = ?`
  ).bind(id, tenantId).first();

  if (!rx) throw new HTTPException(404, { message: 'Prescription not found' });
  await assertPrescriptionRecordAccess(c, db, tenantId, rx as Record<string, unknown>, 'repeat this prescription');

  const { results: items } = await db.$client.prepare(
    `SELECT medicine_name, dosage, frequency, duration, instructions, sort_order
     FROM prescription_items
     WHERE prescription_id = ?
     ORDER BY sort_order ASC`
  ).bind(id).all();

  return c.json({
    prescription: rx,
    items: items ?? [],
  });
});

// ─── POST /api/prescriptions/:id/create-lab-order — create lab order from Rx ──
app.post('/:id/create-lab-order', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });
  const role = c.get('role');
  if (!role || !['doctor', 'md', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to create lab orders from prescriptions' });
  }

  const id = Number(c.req.param('id'));

  const rx = await db.$client.prepare(
    `SELECT id, patient_id, doctor_id, lab_tests FROM prescriptions WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: number; patient_id: number; doctor_id: number | null; lab_tests: string | null }>();

  if (!rx) throw new HTTPException(404, { message: 'Prescription not found' });
  await assertPrescriptionRecordAccess(c, db, tenantId, rx as unknown as Record<string, unknown>, 'create lab orders from this prescription');

  if (!rx.lab_tests) {
    throw new HTTPException(400, { message: 'No lab tests on this prescription' });
  }

  let tests: string[];
  try {
    const parsedTests = JSON.parse(rx.lab_tests);
    if (!Array.isArray(parsedTests) || parsedTests.length === 0) {
      throw new Error('empty');
    }
    tests = parsedTests.map((test) => typeof test === 'string' ? test.trim() : '').filter(Boolean);
    if (tests.length === 0) throw new Error('empty');
  } catch {
    throw new HTTPException(400, { message: 'No lab tests on this prescription' });
  }

  const catalogRows = await db.$client.prepare(
    `SELECT id, name, price FROM lab_test_catalog WHERE tenant_id = ? AND is_active = 1`
  ).bind(tenantId).all<{ id: number; name: string; price: number | null }>();

  const catalogMap = new Map((catalogRows.results ?? []).map((r) => [r.name.trim().toLowerCase(), r]));
  const unmappedTests = tests.filter((testName) => !catalogMap.has(testName.toLowerCase()));
  if (unmappedTests.length > 0) {
    throw new HTTPException(400, {
      message: `Lab test(s) not found in catalog: ${unmappedTests.join(', ')}`,
    });
  }

  const orderNo = await getNextSequence(c.env.DB, tenantId, 'lab_order', 'LO');
  const orderDate = getTodayGMT6();
  const userId = requireUserId(c);
  const orderingClinicianDoctorId = await resolveOrderingClinicianDoctorId(c.env.DB, tenantId, {
    enteredByUserId: userId,
    explicitDoctorId: rx.doctor_id,
  });

  const orderResult = await db.$client.prepare(`
    INSERT INTO lab_orders (
      order_no, patient_id, ordered_by, ordering_clinician_doctor_id,
      order_date, prescription_id, status, billing_status, tenant_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending', 'not_required', ?, datetime('now', '+6 hours'))
  `).bind(orderNo, rx.patient_id, userId, orderingClinicianDoctorId, orderDate, rx.id, tenantId).run();

  const orderId = orderResult.meta.last_row_id;

  for (const testName of tests) {
    const test = catalogMap.get(testName.toLowerCase());
    const price = Number(test?.price ?? 0);
    await db.$client.prepare(`
      INSERT INTO lab_order_items (lab_order_id, lab_test_id, test_name, unit_price, discount, line_total, status, tenant_id, source, created_at)
      VALUES (?, ?, ?, ?, 0, ?, 'pending', ?, 'prescription', datetime('now', '+6 hours'))
    `).bind(orderId, test?.id, testName, price, price, tenantId).run();
  }

  return c.json({ orderId, orderNo, message: `Lab order ${orderNo} created with ${tests.length} test(s)` }, 201);
});

export default app;
