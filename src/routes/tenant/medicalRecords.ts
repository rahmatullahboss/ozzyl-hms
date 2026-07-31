import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, like, or, sql, desc, gte, lte, count } from 'drizzle-orm';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import {
  icd10ReportingGroups,
  icd10DiseaseGroups,
  icd10Codes,
  medicalRecords,
  babyBirthDetails,
  deathDetails,
  finalDiagnosis,
  documentRecords,
  patients,
} from '../../db/schema';
import {
  createMedicalRecordSchema,
  updateMedicalRecordSchema,
  createBirthSchema,
  updateBirthSchema,
  createDeathSchema,
  updateDeathSchema,
  createDiagnosisBulkSchema,
  createDocumentRecordSchema,
} from '../../schemas/medicalRecords';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Parse and validate integer ID from URL params
// ═══════════════════════════════════════════════════════════════════════════════

function parseId(value: string, label = 'ID'): number {
  const id = parseInt(value, 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: `Invalid ${label}: must be a positive integer` });
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Escape LIKE wildcards in user-provided search strings (F-03)
// ═══════════════════════════════════════════════════════════════════════════════

function escapeLike(value: string): string {
  return value.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RBAC — Role groups for Medical Records (F-07)
// ═══════════════════════════════════════════════════════════════════════════════

const MR_READ_ROLES = ['hospital_admin', 'doctor', 'md', 'nurse', 'reception'];
const MR_WRITE_ROLES = ['hospital_admin', 'doctor', 'md'];
const BIRTH_DEATH_ROLES = ['hospital_admin', 'doctor', 'md', 'nurse'];
const MRD_LEGAL_ROLES = ['hospital_admin', 'doctor', 'md'];

const chartCompletionSchema = z.object({
  medical_record_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  admission_id: z.number().int().positive().optional(),
  task_type: z.enum(['chart_review', 'icd_coding', 'discharge_summary', 'doctor_signature', 'nurse_notes', 'billing_clearance', 'other']),
  status: z.enum(['pending', 'in_progress', 'completed', 'waived']).default('pending'),
  assigned_to: z.number().int().positive().optional(),
  due_date: z.string().optional(),
  remarks: z.string().max(1000).optional(),
});

const updateChartCompletionSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'waived']).optional(),
  assigned_to: z.number().int().positive().optional(),
  due_date: z.string().optional(),
  remarks: z.string().max(1000).optional(),
});

const dischargeArchiveSchema = z.object({
  medical_record_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  discharge_summary_no: z.string().max(100).optional(),
  discharge_date: z.string().optional(),
  file_key: z.string().min(1).max(500),
  file_name: z.string().max(255).optional(),
  file_size: z.number().int().min(0).optional(),
  mime_type: z.string().max(100).optional(),
  version: z.number().int().positive().default(1),
  remarks: z.string().max(1000).optional(),
});

const medicoLegalFileSchema = z.object({
  medical_record_id: z.number().int().positive().optional(),
  patient_id: z.number().int().positive(),
  mlc_case_id: z.number().int().positive().optional(),
  file_type: z.enum(['police_requisition', 'injury_report', 'sample_chain', 'court_order', 'final_opinion', 'other']),
  file_key: z.string().max(500).optional(),
  file_name: z.string().max(255).optional(),
  file_size: z.number().int().min(0).optional(),
  mime_type: z.string().max(100).optional(),
  status: z.enum(['active', 'sealed', 'released', 'archived']).default('active'),
  custodian_staff_id: z.number().int().positive().optional(),
  released_to: z.string().max(200).optional(),
  released_on: z.string().optional(),
  remarks: z.string().max(1000).optional(),
});

const updateMedicoLegalFileSchema = medicoLegalFileSchema.partial();

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Ensure ICD-10 seed data is cloned to tenant on first use (F-04 fixed)
// ═══════════════════════════════════════════════════════════════════════════════

async function ensureIcd10SeedData(db: ReturnType<typeof getDb>, tenantId: string): Promise<void> {
  const [existing] = await db
    .select({ cnt: count() })
    .from(icd10Codes)
    .where(eq(icd10Codes.tenantId, tenantId));

  if (existing && existing.cnt > 0) return;

  // F-04 FIX: Clone with proper FK remapping using subqueries
  // Step 1: Clone reporting groups
  await db.$client.prepare(`
    INSERT OR IGNORE INTO icd10_reporting_groups (tenant_id, name, description, is_active)
    SELECT ?, name, description, is_active
    FROM icd10_reporting_groups WHERE tenant_id = '__seed__'
  `).bind(tenantId).run();

  // Step 2: Clone disease groups with FK remapping
  await db.$client.prepare(`
    INSERT OR IGNORE INTO icd10_disease_groups (tenant_id, name, reporting_group_id, is_active)
    SELECT ?, dg.name,
      (SELECT rg2.id FROM icd10_reporting_groups rg2
       INNER JOIN icd10_reporting_groups rg_seed ON rg_seed.id = dg.reporting_group_id
       WHERE rg2.tenant_id = ? AND rg2.name = rg_seed.name LIMIT 1),
      dg.is_active
    FROM icd10_disease_groups dg WHERE dg.tenant_id = '__seed__'
  `).bind(tenantId, tenantId).run();

  // Step 3: Clone ICD-10 codes with FK remapping
  await db.$client.prepare(`
    INSERT OR IGNORE INTO icd10_codes (tenant_id, code, description, disease_group_id, is_active)
    SELECT ?, ic.code, ic.description,
      (SELECT dg2.id FROM icd10_disease_groups dg2
       INNER JOIN icd10_disease_groups dg_seed ON dg_seed.id = ic.disease_group_id
       WHERE dg2.tenant_id = ? AND dg2.name = dg_seed.name LIMIT 1),
      ic.is_active
    FROM icd10_codes ic WHERE ic.tenant_id = '__seed__'
  `).bind(tenantId, tenantId).run();
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Validate patient exists and belongs to tenant (F-09)
// ═══════════════════════════════════════════════════════════════════════════════

async function validatePatientExists(db: ReturnType<typeof getDb>, patientId: number, tenantId: string): Promise<void> {
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.tenantId, tenantId)))
    .limit(1);

  if (!patient) {
    throw new HTTPException(404, { message: `Patient #${patientId} not found in this tenant` });
  }
}

async function validateMedicalRecordForMrd(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  medicalRecordId: number,
  patientId?: number,
): Promise<{ id: number; patient_id: number; visit_id: number | null; admission_id: number | null }> {
  const record = await db.$client.prepare(`
    SELECT id, patient_id, visit_id, admission_id
    FROM medical_records
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(medicalRecordId, tenantId).first<{ id: number; patient_id: number; visit_id: number | null; admission_id: number | null }>();

  if (!record) throw new HTTPException(404, { message: 'Medical record not found' });
  if (patientId && Number(record.patient_id) !== Number(patientId)) {
    throw new HTTPException(400, { message: 'Patient does not match medical record' });
  }
  return record;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Generate unique certificate number with retry (F-01 fix)
// ═══════════════════════════════════════════════════════════════════════════════

async function generateCertNumber(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  prefix: 'BIRTH' | 'DEATH',
  dateStr: string,
  table: typeof babyBirthDetails | typeof deathDetails,
  certColumn: typeof babyBirthDetails.certificateNumber | typeof deathDetails.certificateNumber,
): Promise<string> {
  const dateCompact = dateStr.replace(/-/g, '');
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const [countResult] = await db
      .select({ cnt: count() })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), like(certColumn, `${prefix}-${dateCompact}%`)));
    const seq = (countResult?.cnt ?? 0) + 1 + attempt;
    const certNum = `${prefix}-${dateCompact}-${String(seq).padStart(3, '0')}`;

    // Try to verify it doesn't already exist
    const [existing] = await db
      .select({ cnt: count() })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(certColumn, certNum)));

    if (!existing || existing.cnt === 0) {
      return certNum;
    }
  }

  // Fallback: append timestamp for guaranteed uniqueness
  const dateCompactFallback = dateStr.replace(/-/g, '');
  return `${prefix}-${dateCompactFallback}-${Date.now().toString(36).toUpperCase()}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEDICAL RECORDS — LIST & CREATE (named routes FIRST — F-02 fix)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records
app.get('/', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const offset = (page - 1) * limit;

  const patientIdFilter = c.req.query('patient_id');
  const dischargeTypeFilter = c.req.query('discharge_type');
  const search = c.req.query('search');

  try {
    const conditions = [
      eq(medicalRecords.tenantId, tenantId),
      eq(medicalRecords.isActive, 1),
    ];

    if (patientIdFilter) {
      conditions.push(eq(medicalRecords.patientId, Number(patientIdFilter)));
    }
    if (dischargeTypeFilter) {
      conditions.push(eq(medicalRecords.dischargeType, dischargeTypeFilter));
    }
    if (search) {
      const escaped = escapeLike(search);
      conditions.push(
        or(
          like(medicalRecords.fileNumber, `%${escaped}%`),
          like(medicalRecords.remarks, `%${escaped}%`),
        )!,
      );
    }

    const [totalResult] = await db
      .select({ total: count() })
      .from(medicalRecords)
      .where(and(...conditions));
    const total = totalResult?.total ?? 0;

    const results = await db
      .select({
        id: medicalRecords.id,
        patientId: medicalRecords.patientId,
        patientName: patients.name,
        visitId: medicalRecords.visitId,
        fileNumber: medicalRecords.fileNumber,
        dischargeType: medicalRecords.dischargeType,
        dischargeCondition: medicalRecords.dischargeCondition,
        isOperationConducted: medicalRecords.isOperationConducted,
        referredTo: medicalRecords.referredTo,
        referredDate: medicalRecords.referredDate,
        remarks: medicalRecords.remarks,
        createdAt: medicalRecords.createdAt,
      })
      .from(medicalRecords)
      .leftJoin(patients, and(eq(medicalRecords.patientId, patients.id), eq(patients.tenantId, tenantId)))
      .where(and(...conditions))
      .orderBy(desc(medicalRecords.id))
      .limit(limit)
      .offset(offset);

    return c.json({
      records: results,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page < Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('medical-records list error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch medical records' });
  }
});

// POST /api/medical-records
app.post('/', requireRole(...MR_WRITE_ROLES), zValidator('json', createMedicalRecordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    // F-09: Validate patient exists in this tenant
    await validatePatientExists(db, data.patient_id, tenantId);

    const [inserted] = await db
      .insert(medicalRecords)
      .values({
        tenantId,
        patientId: data.patient_id,
        visitId: data.visit_id ?? null,
        admissionId: data.admission_id ?? null,
        doctorId: data.doctor_id ?? null,
        fileNumber: data.file_number ?? null,
        dischargeType: data.discharge_type ?? null,
        dischargeCondition: data.discharge_condition ?? null,
        isOperationConducted: data.is_operation_conducted ? 1 : 0,
        operationDate: data.operation_date ?? null,
        operationDiagnosis: data.operation_diagnosis ?? null,
        gestationalWeek: data.gestational_week ?? null,
        gestationalDay: data.gestational_day ?? null,
        numberOfBabies: data.number_of_babies ?? null,
        bloodLostMl: data.blood_lost_ml ?? null,
        gravita: data.gravita ?? null,
        referredDate: data.referred_date ?? null,
        referredTime: data.referred_time ?? null,
        referredTo: data.referred_to ?? null,
        referredReason: data.referred_reason ?? null,
        remarks: data.remarks ?? null,
        createdBy: userId,
        createdAt: sql`datetime('now', '+6 hours')`,
      })
      .returning({ id: medicalRecords.id });

    return c.json({ id: inserted.id, message: 'Medical record created' }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('medical-records create error:', error);
    throw new HTTPException(500, { message: 'Failed to create medical record' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BIRTH REGISTRATION (all named routes before /:id — F-02)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records/births
app.get('/births', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const offset = (page - 1) * limit;
  const fromDate = c.req.query('from_date');
  const toDate = c.req.query('to_date');

  try {
    const conditions = [eq(babyBirthDetails.tenantId, tenantId), eq(babyBirthDetails.isActive, 1)];
    if (fromDate) conditions.push(gte(babyBirthDetails.birthDate, fromDate));
    if (toDate) conditions.push(lte(babyBirthDetails.birthDate, toDate));

    const [totalResult] = await db.select({ total: count() }).from(babyBirthDetails).where(and(...conditions));
    const total = totalResult?.total ?? 0;

    const results = await db
      .select({
        id: babyBirthDetails.id,
        certificateNumber: babyBirthDetails.certificateNumber,
        babyName: babyBirthDetails.babyName,
        sex: babyBirthDetails.sex,
        weightKg: babyBirthDetails.weightKg,
        birthDate: babyBirthDetails.birthDate,
        birthTime: babyBirthDetails.birthTime,
        birthType: babyBirthDetails.birthType,
        birthCondition: babyBirthDetails.birthCondition,
        deliveryType: babyBirthDetails.deliveryType,
        fatherName: babyBirthDetails.fatherName,
        motherName: babyBirthDetails.motherName,
        patientId: babyBirthDetails.patientId,
        patientName: patients.name,
        printCount: babyBirthDetails.printCount,
        createdAt: babyBirthDetails.createdAt,
      })
      .from(babyBirthDetails)
      .leftJoin(patients, and(eq(babyBirthDetails.patientId, patients.id), eq(patients.tenantId, tenantId)))
      .where(and(...conditions))
      .orderBy(desc(babyBirthDetails.birthDate))
      .limit(limit)
      .offset(offset);

    return c.json({
      births: results,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page < Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('births list error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch birth records' });
  }
});

// POST /api/medical-records/births
app.post('/births', requireRole(...BIRTH_DEATH_ROLES), zValidator('json', createBirthSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    // F-09: Validate patient exists
    await validatePatientExists(db, data.patient_id, tenantId);

    // F-01 FIX: Use retry-safe cert generation
    const certNum = data.certificate_number ??
      await generateCertNumber(db, tenantId, 'BIRTH', data.birth_date, babyBirthDetails, babyBirthDetails.certificateNumber);

    const [inserted] = await db
      .insert(babyBirthDetails)
      .values({
        tenantId,
        medicalRecordId: data.medical_record_id ?? null,
        patientId: data.patient_id,
        visitId: data.visit_id ?? null,
        certificateNumber: certNum,
        babyName: data.baby_name ?? null,
        sex: data.sex ?? null,
        weightKg: data.weight_kg ?? null,
        birthDate: data.birth_date,
        birthTime: data.birth_time ?? null,
        birthType: data.birth_type ?? null,
        birthCondition: data.birth_condition ?? null,
        deliveryType: data.delivery_type ?? null,
        birthOrder: data.birth_order ?? null,
        fatherName: data.father_name ?? null,
        motherName: data.mother_name ?? null,
        issuedBy: data.issued_by ?? null,
        certifiedBy: data.certified_by ?? null,
        createdBy: userId,
        createdAt: sql`datetime('now', '+6 hours')`,
      })
      .returning({ id: babyBirthDetails.id });

    return c.json({ id: inserted.id, certificate_number: certNum, message: 'Birth record created' }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('birth create error:', error);
    throw new HTTPException(500, { message: 'Failed to create birth record' });
  }
});

// PUT /api/medical-records/births/:id
app.put('/births/:id', requireRole(...BIRTH_DEATH_ROLES), zValidator('json', updateBirthSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Birth ID');
  const data = c.req.valid('json');

  try {
    const [existing] = await db
      .select({ id: babyBirthDetails.id })
      .from(babyBirthDetails)
      .where(and(eq(babyBirthDetails.id, id), eq(babyBirthDetails.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new HTTPException(404, { message: 'Birth record not found' });

    await db
      .update(babyBirthDetails)
      .set({
        ...(data.baby_name !== undefined && { babyName: data.baby_name }),
        ...(data.sex !== undefined && { sex: data.sex }),
        ...(data.weight_kg !== undefined && { weightKg: data.weight_kg }),
        ...(data.birth_type !== undefined && { birthType: data.birth_type }),
        ...(data.birth_condition !== undefined && { birthCondition: data.birth_condition }),
        ...(data.delivery_type !== undefined && { deliveryType: data.delivery_type }),
        ...(data.father_name !== undefined && { fatherName: data.father_name }),
        ...(data.mother_name !== undefined && { motherName: data.mother_name }),
        ...(data.print_count !== undefined && { printCount: data.print_count }),
        ...(data.printed_on !== undefined && { printedOn: data.printed_on }),
        updatedAt: sql`datetime('now', '+6 hours')`,
      })
      .where(and(eq(babyBirthDetails.id, id), eq(babyBirthDetails.tenantId, tenantId)));

    return c.json({ success: true, message: 'Birth record updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update birth record' });
  }
});

// DELETE /api/medical-records/births/:id (F-06: Soft delete for births)
app.delete('/births/:id', requireRole(...BIRTH_DEATH_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Birth ID');

  try {
    const result = await db
      .update(babyBirthDetails)
      .set({ isActive: 0, updatedAt: sql`datetime('now', '+6 hours')` })
      .where(and(eq(babyBirthDetails.id, id), eq(babyBirthDetails.tenantId, tenantId)));

    if (!result.meta.changes) throw new HTTPException(404, { message: 'Birth record not found' });

    return c.json({ success: true, message: 'Birth record deactivated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to delete birth record' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEATH REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records/deaths
app.get('/deaths', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const offset = (page - 1) * limit;
  const fromDate = c.req.query('from_date');
  const toDate = c.req.query('to_date');

  try {
    const conditions = [eq(deathDetails.tenantId, tenantId), eq(deathDetails.isActive, 1)];
    if (fromDate) conditions.push(gte(deathDetails.deathDate, fromDate));
    if (toDate) conditions.push(lte(deathDetails.deathDate, toDate));

    const [totalResult] = await db.select({ total: count() }).from(deathDetails).where(and(...conditions));
    const total = totalResult?.total ?? 0;

    const results = await db
      .select({
        id: deathDetails.id,
        certificateNumber: deathDetails.certificateNumber,
        deathDate: deathDetails.deathDate,
        deathTime: deathDetails.deathTime,
        causeOfDeath: deathDetails.causeOfDeath,
        mannerOfDeath: deathDetails.mannerOfDeath,
        placeOfDeath: deathDetails.placeOfDeath,
        ageAtDeath: deathDetails.ageAtDeath,
        patientId: deathDetails.patientId,
        patientName: patients.name,
        printCount: deathDetails.printCount,
        createdAt: deathDetails.createdAt,
      })
      .from(deathDetails)
      .leftJoin(patients, and(eq(deathDetails.patientId, patients.id), eq(patients.tenantId, tenantId)))
      .where(and(...conditions))
      .orderBy(desc(deathDetails.deathDate))
      .limit(limit)
      .offset(offset);

    return c.json({
      deaths: results,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page < Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('deaths list error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch death records' });
  }
});

// POST /api/medical-records/deaths
app.post('/deaths', requireRole(...BIRTH_DEATH_ROLES), zValidator('json', createDeathSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    // F-09: Validate patient exists
    await validatePatientExists(db, data.patient_id, tenantId);

    // F-01 FIX: Use retry-safe cert generation
    const certNum = data.certificate_number ??
      await generateCertNumber(db, tenantId, 'DEATH', data.death_date, deathDetails, deathDetails.certificateNumber);

    const [inserted] = await db
      .insert(deathDetails)
      .values({
        tenantId,
        medicalRecordId: data.medical_record_id ?? null,
        patientId: data.patient_id,
        visitId: data.visit_id ?? null,
        certificateNumber: certNum,
        deathDate: data.death_date,
        deathTime: data.death_time ?? null,
        causeOfDeath: data.cause_of_death ?? null,
        secondaryCause: data.secondary_cause ?? null,
        mannerOfDeath: data.manner_of_death ?? null,
        placeOfDeath: data.place_of_death ?? null,
        ageAtDeath: data.age_at_death ?? null,
        fatherName: data.father_name ?? null,
        motherName: data.mother_name ?? null,
        spouseName: data.spouse_name ?? null,
        certifiedBy: data.certified_by ?? null,
        createdBy: userId,
        createdAt: sql`datetime('now', '+6 hours')`,
      })
      .returning({ id: deathDetails.id });

    return c.json({ id: inserted.id, certificate_number: certNum, message: 'Death record created' }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('death create error:', error);
    throw new HTTPException(500, { message: 'Failed to create death record' });
  }
});

// PUT /api/medical-records/deaths/:id
app.put('/deaths/:id', requireRole(...BIRTH_DEATH_ROLES), zValidator('json', updateDeathSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Death ID');
  const data = c.req.valid('json');

  try {
    const [existing] = await db
      .select({ id: deathDetails.id })
      .from(deathDetails)
      .where(and(eq(deathDetails.id, id), eq(deathDetails.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new HTTPException(404, { message: 'Death record not found' });

    await db
      .update(deathDetails)
      .set({
        ...(data.cause_of_death !== undefined && { causeOfDeath: data.cause_of_death }),
        ...(data.secondary_cause !== undefined && { secondaryCause: data.secondary_cause }),
        ...(data.manner_of_death !== undefined && { mannerOfDeath: data.manner_of_death }),
        ...(data.place_of_death !== undefined && { placeOfDeath: data.place_of_death }),
        ...(data.certified_by !== undefined && { certifiedBy: data.certified_by }),
        ...(data.print_count !== undefined && { printCount: data.print_count }),
        ...(data.printed_on !== undefined && { printedOn: data.printed_on }),
        updatedAt: sql`datetime('now', '+6 hours')`,
      })
      .where(and(eq(deathDetails.id, id), eq(deathDetails.tenantId, tenantId)));

    return c.json({ success: true, message: 'Death record updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update death record' });
  }
});

// DELETE /api/medical-records/deaths/:id (F-06: Soft delete for deaths)
app.delete('/deaths/:id', requireRole(...BIRTH_DEATH_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Death ID');

  try {
    const result = await db
      .update(deathDetails)
      .set({ isActive: 0, updatedAt: sql`datetime('now', '+6 hours')` })
      .where(and(eq(deathDetails.id, id), eq(deathDetails.tenantId, tenantId)));

    if (!result.meta.changes) throw new HTTPException(404, { message: 'Death record not found' });

    return c.json({ success: true, message: 'Death record deactivated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to delete death record' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL DIAGNOSIS (ICD-10 linked) — F-05 FIX: Atomic batch insert
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/medical-records/diagnosis (bulk)
app.post('/diagnosis', requireRole(...MR_WRITE_ROLES), zValidator('json', createDiagnosisBulkSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const items = c.req.valid('json');

  try {
    // F-05 FIX: Use batch for atomic insert
    const stmts = items.map((item) =>
      db.insert(finalDiagnosis).values({
        tenantId,
        patientId: item.patient_id,
        visitId: item.visit_id ?? null,
        medicalRecordId: item.medical_record_id ?? null,
        icd10Id: item.icd10_id,
        isPrimary: item.is_primary ? 1 : 0,
        notes: item.notes ?? null,
        source: 'clinician',
        createdBy: userId,
        createdAt: sql`datetime('now', '+6 hours')`,
      }).returning({ id: finalDiagnosis.id }),
    );

    const batchResults = await db.batch(stmts as any);

    const ids = batchResults.flatMap((r: any) => r.map((row: any) => row.id));

    return c.json({ ids, count: ids.length, message: 'Diagnoses created' }, 201);
  } catch (error) {
    console.error('diagnosis create error:', error);
    throw new HTTPException(500, { message: 'Failed to create diagnoses' });
  }
});

// GET /api/medical-records/diagnosis/:visitId
app.get('/diagnosis/:visitId', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const visitId = parseId(c.req.param('visitId'), 'Visit ID');

  try {
    const results = await db
      .select({
        id: finalDiagnosis.id,
        patientId: finalDiagnosis.patientId,
        visitId: finalDiagnosis.visitId,
        medicalRecordId: finalDiagnosis.medicalRecordId,
        icd10Id: finalDiagnosis.icd10Id,
        isPrimary: finalDiagnosis.isPrimary,
        notes: finalDiagnosis.notes,
        code: icd10Codes.code,
        description: icd10Codes.description,
        createdAt: finalDiagnosis.createdAt,
      })
      .from(finalDiagnosis)
      .leftJoin(icd10Codes, eq(finalDiagnosis.icd10Id, icd10Codes.id))
      .where(and(eq(finalDiagnosis.visitId, visitId), eq(finalDiagnosis.tenantId, tenantId), eq(finalDiagnosis.isActive, 1)))
      .orderBy(desc(finalDiagnosis.isPrimary));

    return c.json({ diagnoses: results });
  } catch (error) {
    console.error('diagnosis get error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch diagnoses' });
  }
});

// DELETE /api/medical-records/diagnosis/:id (F-06: Soft delete for diagnosis)
app.delete('/diagnosis/:id', requireRole(...MR_WRITE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Diagnosis ID');

  try {
    const result = await db
      .update(finalDiagnosis)
      .set({ isActive: 0 })
      .where(and(eq(finalDiagnosis.id, id), eq(finalDiagnosis.tenantId, tenantId)));

    if (!result.meta.changes) throw new HTTPException(404, { message: 'Diagnosis not found' });

    return c.json({ success: true, message: 'Diagnosis deactivated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to delete diagnosis' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ICD-10 CODE SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records/icd10
app.get('/icd10', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const search = c.req.query('search') || '';
  const limitParam = Math.min(100, parseInt(c.req.query('limit') ?? '50', 10) || 50);

  try {
    // Ensure seed data cloned
    await ensureIcd10SeedData(db, tenantId);

    const conditions = [eq(icd10Codes.tenantId, tenantId), eq(icd10Codes.isActive, 1)];

    if (search) {
      const escaped = escapeLike(search);
      conditions.push(
        or(
          like(icd10Codes.code, `%${escaped}%`),
          like(icd10Codes.description, `%${escaped}%`),
        )!,
      );
    }

    const results = await db
      .select({
        id: icd10Codes.id,
        code: icd10Codes.code,
        description: icd10Codes.description,
        diseaseGroupId: icd10Codes.diseaseGroupId,
      })
      .from(icd10Codes)
      .where(and(...conditions))
      .orderBy(icd10Codes.code)
      .limit(limitParam);

    return c.json({ codes: results });
  } catch (error) {
    console.error('icd10 search error:', error);
    throw new HTTPException(500, { message: 'Failed to search ICD-10 codes' });
  }
});

// GET /api/medical-records/master-data
app.get('/master-data', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    await ensureIcd10SeedData(db, tenantId);

    // ⚡ BOLT OPTIMIZATION:
    // Replaced Promise.all() with db.batch() for master data fetch.
    // Why: Promise.all() sends 2 separate HTTP network requests to Cloudflare D1.
    //      db.batch() sends a single network request containing both queries.
    // Impact: Eliminates 1 network round-trip, reducing latency when fetching master data.
    const [reportingGroups, diseaseGroups] = await db.batch([
      db.select().from(icd10ReportingGroups)
        .where(and(eq(icd10ReportingGroups.tenantId, tenantId), eq(icd10ReportingGroups.isActive, 1)))
        .orderBy(icd10ReportingGroups.name),
      db.select().from(icd10DiseaseGroups)
        .where(and(eq(icd10DiseaseGroups.tenantId, tenantId), eq(icd10DiseaseGroups.isActive, 1)))
        .orderBy(icd10DiseaseGroups.name),
    ]);

    return c.json({ reportingGroups, diseaseGroups });
  } catch (error) {
    console.error('master-data error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch master data' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/medical-records/documents
app.post('/documents', requireRole(...MR_WRITE_ROLES), zValidator('json', createDocumentRecordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const [inserted] = await db
      .insert(documentRecords)
      .values({
        tenantId,
        patientId: data.patient_id,
        medicalRecordId: data.medical_record_id ?? null,
        documentType: data.document_type,
        title: data.title,
        description: data.description ?? null,
        fileKey: data.file_key ?? null,
        fileName: data.file_name ?? null,
        fileSize: data.file_size ?? null,
        mimeType: data.mime_type ?? null,
        uploadedBy: userId,
        createdAt: sql`datetime('now', '+6 hours')`,
      })
      .returning({ id: documentRecords.id });

    return c.json({ id: inserted.id, message: 'Document record created' }, 201);
  } catch (error) {
    console.error('document create error:', error);
    throw new HTTPException(500, { message: 'Failed to create document record' });
  }
});

// DELETE /api/medical-records/documents/:id (F-06: Soft delete for documents)
app.delete('/documents/:id', requireRole(...MR_WRITE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Document ID');

  try {
    const result = await db
      .update(documentRecords)
      .set({ isActive: 0 })
      .where(and(eq(documentRecords.id, id), eq(documentRecords.tenantId, tenantId)));

    if (!result.meta.changes) throw new HTTPException(404, { message: 'Document record not found' });

    return c.json({ success: true, message: 'Document record deactivated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to delete document record' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MRD CHART COMPLETION TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records/chart-completion
app.get('/chart-completion', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const status = c.req.query('status');
  const medicalRecordId = c.req.query('medical_record_id');

  const conditions = ['tenant_id = ?'];
  const params: (string | number)[] = [tenantId];
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (medicalRecordId) {
    conditions.push('medical_record_id = ?');
    params.push(Number(medicalRecordId));
  }

  const { results } = await db.$client.prepare(`
    SELECT * FROM mrd_chart_completion_tasks
    WHERE ${conditions.join(' AND ')}
    ORDER BY due_date ASC, id DESC
    LIMIT 100
  `).bind(...params).all();

  return c.json({ tasks: results });
});

// POST /api/medical-records/chart-completion
app.post('/chart-completion', requireRole(...MR_WRITE_ROLES), zValidator('json', chartCompletionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const record = await validateMedicalRecordForMrd(db, tenantId, data.medical_record_id, data.patient_id);

  const result = await db.$client.prepare(`
    INSERT INTO mrd_chart_completion_tasks (
      tenant_id, medical_record_id, patient_id, visit_id, admission_id, task_type,
      status, assigned_to, due_date, completed_by, completed_on, remarks, created_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    data.medical_record_id,
    data.patient_id,
    data.visit_id ?? record.visit_id ?? null,
    data.admission_id ?? record.admission_id ?? null,
    data.task_type,
    data.status,
    data.assigned_to || null,
    data.due_date || null,
    data.status === 'completed' ? userId : null,
    data.status === 'completed' ? new Date().toISOString() : null,
    data.remarks || null,
    userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Chart completion task created' }, 201);
});

// PATCH /api/medical-records/chart-completion/:id
app.patch('/chart-completion/:id', requireRole(...MR_WRITE_ROLES), zValidator('json', updateChartCompletionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param('id'), 'Chart completion task ID');
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM mrd_chart_completion_tasks WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Chart completion task not found' });

  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  const fields: Record<string, unknown> = {
    status: data.status,
    assigned_to: data.assigned_to,
    due_date: data.due_date,
    remarks: data.remarks,
  };
  for (const [column, value] of Object.entries(fields)) {
    if (value !== undefined) {
      updates.push(`${column} = ?`);
      params.push(value as string | number | null);
    }
  }
  if (data.status === 'completed') {
    updates.push('completed_by = ?', 'completed_on = ?');
    params.push(userId, new Date().toISOString());
  }
  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  updates.push("updated_at = datetime('now', '+6 hours')");
  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE mrd_chart_completion_tasks SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();

  return c.json({ success: true, message: 'Chart completion task updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DISCHARGE SUMMARY ARCHIVAL
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records/discharge-archives
app.get('/discharge-archives', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const medicalRecordId = c.req.query('medical_record_id');
  const patientId = c.req.query('patient_id');
  const conditions = ['tenant_id = ?', 'is_active = 1'];
  const params: (string | number)[] = [tenantId];
  if (medicalRecordId) {
    conditions.push('medical_record_id = ?');
    params.push(Number(medicalRecordId));
  }
  if (patientId) {
    conditions.push('patient_id = ?');
    params.push(Number(patientId));
  }

  const { results } = await db.$client.prepare(`
    SELECT * FROM mrd_discharge_summary_archives
    WHERE ${conditions.join(' AND ')}
    ORDER BY archived_at DESC, version DESC
    LIMIT 100
  `).bind(...params).all();

  return c.json({ archives: results });
});

// POST /api/medical-records/discharge-archives
app.post('/discharge-archives', requireRole(...MR_WRITE_ROLES), zValidator('json', dischargeArchiveSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const record = await validateMedicalRecordForMrd(db, tenantId, data.medical_record_id, data.patient_id);

  const result = await db.$client.prepare(`
    INSERT INTO mrd_discharge_summary_archives (
      tenant_id, medical_record_id, patient_id, visit_id, discharge_summary_no,
      discharge_date, file_key, file_name, file_size, mime_type, archived_by,
      archived_at, version, is_active, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), ?, 1, ?)
  `).bind(
    tenantId,
    data.medical_record_id,
    data.patient_id,
    data.visit_id ?? record.visit_id ?? null,
    data.discharge_summary_no || null,
    data.discharge_date || null,
    data.file_key,
    data.file_name || null,
    data.file_size || null,
    data.mime_type || null,
    userId,
    data.version,
    data.remarks || null,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Discharge summary archived' }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════════
// MRD MEDICO-LEGAL FILE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records/medico-legal-files
app.get('/medico-legal-files', requireRole(...MRD_LEGAL_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');
  const mlcCaseId = c.req.query('mlc_case_id');
  const status = c.req.query('status');
  const conditions = ['tenant_id = ?'];
  const params: (string | number)[] = [tenantId];
  if (patientId) {
    conditions.push('patient_id = ?');
    params.push(Number(patientId));
  }
  if (mlcCaseId) {
    conditions.push('mlc_case_id = ?');
    params.push(Number(mlcCaseId));
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const { results } = await db.$client.prepare(`
    SELECT * FROM mrd_medico_legal_files
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `).bind(...params).all();

  return c.json({ files: results });
});

// POST /api/medical-records/medico-legal-files
app.post('/medico-legal-files', requireRole(...MRD_LEGAL_ROLES), zValidator('json', medicoLegalFileSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  if (data.medical_record_id) {
    await validateMedicalRecordForMrd(db, tenantId, data.medical_record_id, data.patient_id);
  } else {
    await validatePatientExists(db, data.patient_id, tenantId);
  }

  if (data.mlc_case_id) {
    const mlcCase = await db.$client.prepare(
      'SELECT id, patient_id FROM mlc_cases WHERE id = ? AND tenant_id = ?'
    ).bind(data.mlc_case_id, tenantId).first<{ id: number; patient_id: number }>();
    if (!mlcCase) throw new HTTPException(400, { message: 'MLC case not found' });
    if (Number(mlcCase.patient_id) !== Number(data.patient_id)) {
      throw new HTTPException(400, { message: 'MLC patient does not match file patient' });
    }
  }

  const result = await db.$client.prepare(`
    INSERT INTO mrd_medico_legal_files (
      tenant_id, medical_record_id, patient_id, mlc_case_id, file_type, file_key,
      file_name, file_size, mime_type, status, custodian_staff_id, released_to,
      released_on, remarks, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    data.medical_record_id || null,
    data.patient_id,
    data.mlc_case_id || null,
    data.file_type,
    data.file_key || null,
    data.file_name || null,
    data.file_size || null,
    data.mime_type || null,
    data.status,
    data.custodian_staff_id || null,
    data.released_to || null,
    data.released_on || null,
    data.remarks || null,
    userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Medico-legal file tracked' }, 201);
});

// PATCH /api/medical-records/medico-legal-files/:id
app.patch('/medico-legal-files/:id', requireRole(...MRD_LEGAL_ROLES), zValidator('json', updateMedicoLegalFileSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Medico-legal file ID');
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM mrd_medico_legal_files WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Medico-legal file not found' });

  const fields: Record<string, unknown> = {
    file_type: data.file_type,
    file_key: data.file_key,
    file_name: data.file_name,
    file_size: data.file_size,
    mime_type: data.mime_type,
    status: data.status,
    custodian_staff_id: data.custodian_staff_id,
    released_to: data.released_to,
    released_on: data.released_on,
    remarks: data.remarks,
  };
  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value !== undefined) {
      updates.push(`${column} = ?`);
      params.push(value as string | number | null);
    }
  }
  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  updates.push("updated_at = datetime('now', '+6 hours')");
  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE mrd_medico_legal_files SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();

  return c.json({ success: true, message: 'Medico-legal file updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REFERRALS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records/referrals
app.get('/referrals', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const conditions = [
      eq(medicalRecords.tenantId, tenantId),
      eq(medicalRecords.isActive, 1),
      eq(medicalRecords.dischargeType, 'referred'),
    ];

    const [totalResult] = await db.select({ total: count() }).from(medicalRecords).where(and(...conditions));
    const total = totalResult?.total ?? 0;

    const results = await db
      .select({
        id: medicalRecords.id,
        patientId: medicalRecords.patientId,
        patientName: patients.name,
        referredTo: medicalRecords.referredTo,
        referredDate: medicalRecords.referredDate,
        referredTime: medicalRecords.referredTime,
        referredReason: medicalRecords.referredReason,
        fileNumber: medicalRecords.fileNumber,
        createdAt: medicalRecords.createdAt,
      })
      .from(medicalRecords)
      .leftJoin(patients, and(eq(medicalRecords.patientId, patients.id), eq(patients.tenantId, tenantId)))
      .where(and(...conditions))
      .orderBy(desc(medicalRecords.referredDate))
      .limit(limit)
      .offset(offset);

    return c.json({
      referrals: results,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page < Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('referrals list error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch referrals' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records/stats
app.get('/stats', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    // ⚡ BOLT OPTIMIZATION:
    // Replaced Promise.all() with db.batch() for medical record stats.
    // Why: Promise.all() sends 5 separate HTTP network requests to Cloudflare D1.
    //      db.batch() sends a single network request containing all 5 queries.
    // Impact: Eliminates 4 network round-trips, significantly reducing latency and
    //         making the stats load much faster, while retaining Drizzle ORM type safety.
    const [recordCount, birthCount, deathCount, diagnosisCount, referralCount] = await db.batch([
      db.select({ cnt: count() }).from(medicalRecords)
        .where(and(eq(medicalRecords.tenantId, tenantId), eq(medicalRecords.isActive, 1))),
      db.select({ cnt: count() }).from(babyBirthDetails)
        .where(and(eq(babyBirthDetails.tenantId, tenantId), eq(babyBirthDetails.isActive, 1))),
      db.select({ cnt: count() }).from(deathDetails)
        .where(and(eq(deathDetails.tenantId, tenantId), eq(deathDetails.isActive, 1))),
      db.select({ cnt: count() }).from(finalDiagnosis)
        .where(and(eq(finalDiagnosis.tenantId, tenantId), eq(finalDiagnosis.isActive, 1))),
      db.select({ cnt: count() }).from(medicalRecords)
        .where(and(eq(medicalRecords.tenantId, tenantId), eq(medicalRecords.isActive, 1), eq(medicalRecords.dischargeType, 'referred'))),
    ]);

    return c.json({
      total_records: recordCount[0]?.cnt ?? 0,
      total_births: birthCount[0]?.cnt ?? 0,
      total_deaths: deathCount[0]?.cnt ?? 0,
      total_diagnoses: diagnosisCount[0]?.cnt ?? 0,
      total_referrals: referralCount[0]?.cnt ?? 0,
    });
  } catch (error) {
    console.error('stats error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch stats' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE RECORD BY ID — MUST be after all named routes (F-02 fix)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/medical-records/:id
app.get('/:id', requireRole(...MR_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Medical Record ID');

  try {
    const [record] = await db
      .select()
      .from(medicalRecords)
      .where(and(eq(medicalRecords.id, id), eq(medicalRecords.tenantId, tenantId)))
      .limit(1);

    if (!record) throw new HTTPException(404, { message: 'Medical record not found' });

    // ⚡ BOLT OPTIMIZATION:
    // Replaced Promise.all() with db.batch() for fetching medical record details.
    // Why: Promise.all() sends 4 separate HTTP network requests to Cloudflare D1.
    //      db.batch() sends a single network request containing all 4 queries.
    // Impact: Eliminates 3 network round-trips, significantly reducing latency and
    //         making the record details load much faster.
    const [diagnoses, births, deaths, docs] = await db.batch([
      db.select({
        id: finalDiagnosis.id,
        icd10Id: finalDiagnosis.icd10Id,
        isPrimary: finalDiagnosis.isPrimary,
        notes: finalDiagnosis.notes,
        code: icd10Codes.code,
        description: icd10Codes.description,
      })
        .from(finalDiagnosis)
        .leftJoin(icd10Codes, eq(finalDiagnosis.icd10Id, icd10Codes.id))
        .where(and(eq(finalDiagnosis.medicalRecordId, id), eq(finalDiagnosis.tenantId, tenantId), eq(finalDiagnosis.isActive, 1))),

      db.select().from(babyBirthDetails)
        .where(and(eq(babyBirthDetails.medicalRecordId, id), eq(babyBirthDetails.tenantId, tenantId), eq(babyBirthDetails.isActive, 1))),

      db.select().from(deathDetails)
        .where(and(eq(deathDetails.medicalRecordId, id), eq(deathDetails.tenantId, tenantId), eq(deathDetails.isActive, 1))),

      db.select().from(documentRecords)
        .where(and(eq(documentRecords.medicalRecordId, id), eq(documentRecords.tenantId, tenantId), eq(documentRecords.isActive, 1))),
    ]);

    return c.json({ record, diagnoses, births, deaths, documents: docs });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('medical-records get error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch medical record' });
  }
});

// PUT /api/medical-records/:id (F-07: Added missing update fields)
app.put('/:id', requireRole(...MR_WRITE_ROLES), zValidator('json', updateMedicalRecordSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Medical Record ID');
  const data = c.req.valid('json');

  try {
    const [existing] = await db
      .select()
      .from(medicalRecords)
      .where(and(eq(medicalRecords.id, id), eq(medicalRecords.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new HTTPException(404, { message: 'Medical record not found' });

    await db
      .update(medicalRecords)
      .set({
        ...(data.patient_id !== undefined && { patientId: data.patient_id }),
        ...(data.visit_id !== undefined && { visitId: data.visit_id }),
        ...(data.doctor_id !== undefined && { doctorId: data.doctor_id }),
        ...(data.file_number !== undefined && { fileNumber: data.file_number }),
        ...(data.discharge_type !== undefined && { dischargeType: data.discharge_type }),
        ...(data.discharge_condition !== undefined && { dischargeCondition: data.discharge_condition }),
        ...(data.is_operation_conducted !== undefined && { isOperationConducted: data.is_operation_conducted ? 1 : 0 }),
        ...(data.operation_date !== undefined && { operationDate: data.operation_date }),
        ...(data.operation_diagnosis !== undefined && { operationDiagnosis: data.operation_diagnosis }),
        // F-07 FIX: Previously missing gestational/obstetric/referral fields
        ...(data.gestational_week !== undefined && { gestationalWeek: data.gestational_week }),
        ...(data.gestational_day !== undefined && { gestationalDay: data.gestational_day }),
        ...(data.number_of_babies !== undefined && { numberOfBabies: data.number_of_babies }),
        ...(data.blood_lost_ml !== undefined && { bloodLostMl: data.blood_lost_ml }),
        ...(data.gravita !== undefined && { gravita: data.gravita }),
        ...(data.referred_time !== undefined && { referredTime: data.referred_time }),
        ...(data.remarks !== undefined && { remarks: data.remarks }),
        ...(data.referred_to !== undefined && { referredTo: data.referred_to }),
        ...(data.referred_date !== undefined && { referredDate: data.referred_date }),
        ...(data.referred_reason !== undefined && { referredReason: data.referred_reason }),
        ...(data.is_file_cleared !== undefined && { isFileCleared: data.is_file_cleared ? 1 : 0 }),
        updatedAt: sql`datetime('now', '+6 hours')`,
      })
      .where(and(eq(medicalRecords.id, id), eq(medicalRecords.tenantId, tenantId)));

    return c.json({ success: true, message: 'Medical record updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update medical record' });
  }
});

// DELETE /api/medical-records/:id (F-08: Soft delete)
app.delete('/:id', requireRole(...MR_WRITE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Medical Record ID');

  try {
    const result = await db
      .update(medicalRecords)
      .set({ isActive: 0, updatedAt: sql`datetime('now', '+6 hours')` })
      .where(and(eq(medicalRecords.id, id), eq(medicalRecords.tenantId, tenantId)));

    if (!result.meta.changes) throw new HTTPException(404, { message: 'Medical record not found' });

    return c.json({ success: true, message: 'Medical record deactivated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to delete medical record' });
  }
});

export default app;
