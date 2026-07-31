import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { createVisitSchema, updateVisitSchema, dischargeSchema } from '../../schemas/visit';
import { getNextSequence } from '../../lib/sequence';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import { normalizeConsultationFee } from '../../lib/doctor-fees';
import { formatDoctorName } from '../../lib/doctor-display';
import { assertNoSameDoctorVisitToday } from '../../lib/visit-guards';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requirePermission } from '../../middleware/rbac';
import { auditRequestMetadata, prepareMasterDataAudit } from '../../lib/master-data-audit';
import {
  completeRouteEncounter,
  createEncounterVisitSourceKey,
  findEncounterVisitBySourceKey,
  prepareStartRouteEncounterBatch,
  replaceRouteEncounterParticipant,
  reserveEncounterVisitId,
  resolveEncounterRouteContext,
  startRouteEncounter,
  type EncounterVisitSnapshot,
} from '../../lib/canonical/encounter-route-integration';
import {
  prepareAcceptedServiceRouteBatch,
  prepareProtectedConsultationService,
} from '../../lib/canonical/service-delivery-route-integration';
import { resolveAppointmentRoutePractitioner } from '../../lib/canonical/appointment-route-integration';
import { createDeterministicSourceId } from '../../lib/canonical/source-mapping';

const visitRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

interface VisitServiceRouteRow {
  id: number;
  doctor_id: number | null;
  amount: number;
  total_amount: number;
  quantity: number;
  description: string | null;
  status: string;
  canonical_source_key: string | null;
}

interface VisitRow {
  id: number;
  patient_id: number;
  visit_no: string | null;
  doctor_id: number | null;
  visit_type: string;
  admission_flag: number;
  admission_no: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  notes: string | null;
  tenant_id: string;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
  icd10_code: string | null;
  icd10_description: string | null;
  icd11_code: string | null;
  icd11_description: string | null;
  branch_id: number | null;
  visit_date: string | null;
  status: string | null;
  appointment_id: number | null;
  canonical_source_key: string | null;
}

function visitSnapshot(row: VisitRow): EncounterVisitSnapshot {
  return {
    visitId: Number(row.id),
    patientId: Number(row.patient_id),
    doctorId: row.doctor_id == null ? null : Number(row.doctor_id),
    visitType: String(row.visit_type),
    visitDate: String(row.visit_date ?? ''),
    status: String(row.status ?? 'initiated'),
    appointmentId: row.appointment_id == null ? null : Number(row.appointment_id),
    canonicalSourceKey: row.canonical_source_key?.trim() || null,
  };
}

function suppliedIdempotencyKey(request: { header(name: string): string | undefined }): string | null {
  return request.header('Idempotency-Key')?.trim() || null;
}

function localDateTimeToUtc(date: string, endOfDay = false): string {
  const time = endOfDay ? '23:59:59' : '00:00:00';
  const value = new Date(`${date}T${time}+06:00`);
  if (Number.isNaN(value.getTime())) throw new RangeError('visit date is invalid');
  return value.toISOString();
}

function legacyCreatedAtToUtc(value: string | null, visitDate: string): string {
  if (!value) return localDateTimeToUtc(visitDate);
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? new Date(normalized)
    : new Date(`${normalized}+06:00`);
  if (Number.isNaN(parsed.getTime())) return localDateTimeToUtc(visitDate);
  return parsed.toISOString();
}

async function consultationServiceSourceKey(tenantId: string, visitSourceKey: string): Promise<string> {
  return createDeterministicSourceId(
    'vissvcsrc', tenantId, 'visit_consultation_service', visitSourceKey,
  );
}

async function readVisitServiceBySourceKey(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  sourceKey: string,
): Promise<VisitServiceRouteRow | null> {
  return db.$client.prepare(`
    SELECT id,doctor_id,amount,total_amount,quantity,description,status,canonical_source_key
    FROM visit_services
    WHERE tenant_id=? AND canonical_source_key=?
    LIMIT 1
  `).bind(tenantId, sourceKey).first<VisitServiceRouteRow>();
}

async function reserveVisitServiceId(
  db: ReturnType<typeof getDb>,
  tenantId: string,
): Promise<number> {
  const row = await db.$client.prepare(`
    SELECT COALESCE(MAX(id),0)+1 AS next_id
    FROM visit_services
    WHERE tenant_id=?
  `).bind(tenantId).first<{ next_id: number }>();
  const nextId = Number(row?.next_id ?? 0);
  if (!Number.isSafeInteger(nextId) || nextId <= 0) {
    throw new Error('Unable to reserve visit service identity');
  }
  return nextId;
}

async function readVisit(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  id: number,
): Promise<VisitRow | null> {
  return db.$client.prepare(`
    SELECT id,patient_id,visit_no,doctor_id,visit_type,admission_flag,admission_no,
           admission_date,discharge_date,notes,tenant_id,created_by,created_at,updated_at,
           icd10_code,icd10_description,icd11_code,icd11_description,branch_id,visit_date,
           status,appointment_id,canonical_source_key
    FROM visits
    WHERE id=? AND tenant_id=?
    LIMIT 1
  `).bind(id, tenantId).first<VisitRow>();
}

// GET /api/visits — list visits with filters
visitRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, doctorId, type, date } = c.req.query();

  try {
    let query = `
      SELECT v.*, p.name as patient_name, p.patient_code, p.mobile as patient_mobile,
             d.name as doctor_name, d.specialty as doctor_specialty
      FROM visits v
      JOIN patients p ON v.patient_id = p.id
      LEFT JOIN doctors d ON v.doctor_id = d.id
      WHERE v.tenant_id = ?`;
    const params: (string | number)[] = [tenantId];
    if (patientId) { query += ' AND v.patient_id = ?'; params.push(patientId); }
    if (doctorId) { query += ' AND v.doctor_id = ?'; params.push(doctorId); }
    if (type) { query += ' AND v.visit_type = ?'; params.push(type); }
    if (date) { query += ' AND v.visit_date = ?'; params.push(date); }
    query += ' ORDER BY v.created_at DESC LIMIT 100';
    const visitResults = await db.$client.prepare(query).bind(...params).all();
    return c.json({ visits: visitResults.results });
  } catch (error) {
    console.error('[visits] GET list error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch visits' });
  }
});

// GET /api/visits/:id — single visit detail
visitRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  try {
    const visit = await db.$client.prepare(`
      SELECT v.*, p.name as patient_name, p.patient_code, p.mobile as patient_mobile,
             d.name as doctor_name, d.specialty
      FROM visits v
      JOIN patients p ON v.patient_id = p.id
      LEFT JOIN doctors d ON v.doctor_id = d.id
      WHERE v.id = ? AND v.tenant_id = ?
    `).bind(id, tenantId).first();
    if (!visit) throw new HTTPException(404, { message: 'Visit not found' });
    return c.json({ visit });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch visit' });
  }
});

// POST /api/visits — create new OPD or IPD visit
visitRoutes.post('/', requirePermission('appointments:write'), zValidator('json', createVisitSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const suppliedKey = suppliedIdempotencyKey(c.req);
    const sourceKey = await createEncounterVisitSourceKey(tenantId, suppliedKey);
    const existingByKey = suppliedKey
      ? await findEncounterVisitBySourceKey(c.env.DB, tenantId, sourceKey)
      : null;
    const existingVisit = existingByKey
      ? await readVisit(db, tenantId, existingByKey.id)
      : null;
    if (existingByKey && !existingVisit) {
      throw new Error('idempotent visit source exists without its legacy visit row');
    }
    const today = String(existingVisit?.visit_date ?? getTodayGMT6());
    const serviceSourceKey = await consultationServiceSourceKey(tenantId, sourceKey);
    const existingConsultationService = suppliedKey
      ? await readVisitServiceBySourceKey(db, tenantId, serviceSourceKey)
      : null;
    if (!existingVisit) {
      await assertNoSameDoctorVisitToday(c.env.DB, {
        tenantId,
        patientId: data.patientId,
        doctorId: data.doctorId ?? null,
        visitDate: today,
      });
    }

    let consultationDoctorName: string | null = existingConsultationService?.description ?? null;
    let consultationFee = existingConsultationService
      ? normalizeConsultationFee(existingConsultationService.total_amount || existingConsultationService.amount)
      : 0;
    if (data.doctorId && !existingVisit) {
      const doctor = await db.$client.prepare(
        'SELECT name,consultation_fee FROM doctors WHERE id=? AND tenant_id=?',
      ).bind(data.doctorId, tenantId).first<{ name: string; consultation_fee: number }>();
      if (doctor) {
        consultationDoctorName = doctor.name;
        consultationFee = normalizeConsultationFee(doctor.consultation_fee);
      }
    }
    if (consultationFee > 0) {
      await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Visit consultation fee creation');
    }

    const visitNo = existingVisit?.visit_no
      || await getNextSequence(c.env.DB, tenantId, 'visit', 'V');
    const visitId = existingVisit?.id
      || await reserveEncounterVisitId(c.env.DB, tenantId);
    const visitServiceId = consultationFee > 0
      ? (existingConsultationService?.id ?? await reserveVisitServiceId(db, tenantId))
      : null;
    const consultationDescription = consultationFee > 0
      ? (existingConsultationService?.description
          ?? `Consultation - ${formatDoctorName(consultationDoctorName)}`)
      : null;
    const admissionNo = existingVisit?.admission_no
      ?? (data.visitType === 'ipd'
        ? await getNextSequence(c.env.DB, tenantId, 'admission', 'ADM')
        : null);
    const createdAtUtc = existingVisit
      ? (await resolveEncounterRouteContext(c.env.DB, {
          tenantId,
          visit: visitSnapshot(existingVisit),
        })).startedAtUtc
      : new Date().toISOString();
    const sourceEvidence = {
      boundary: 'visit_create',
      sourceKey,
      visitId,
      visitNo,
      patientId: data.patientId,
      doctorId: data.doctorId ?? null,
      visitType: data.visitType,
      admissionFlag: Boolean(data.admissionFlag),
      admissionNo,
      admissionDate: data.admissionDate ?? null,
      visitDate: today,
      notes: data.notes ?? null,
      icd10Code: data.icd10Code ?? null,
      icd11Code: data.icd11Code ?? null,
    };
    const authoritativeStatements = existingByKey ? [] : [
      db.$client.prepare(`
        INSERT INTO visits (
          id,patient_id,visit_no,doctor_id,visit_type,admission_flag,admission_no,
          admission_date,visit_date,notes,icd10_code,icd10_description,icd11_code,
          icd11_description,tenant_id,created_by,canonical_source_key
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        visitId,
        data.patientId,
        visitNo,
        data.doctorId ?? null,
        data.visitType,
        data.admissionFlag ? 1 : 0,
        admissionNo,
        data.admissionDate ?? null,
        today,
        data.notes ?? null,
        data.icd10Code ?? null,
        data.icd10Description ?? null,
        data.icd11Code ?? null,
        data.icd11Description ?? null,
        tenantId,
        Number(userId),
        sourceKey,
      ),
      prepareMasterDataAudit(c.env.DB, {
        tenantId,
        userId,
        action: 'CREATE',
        tableName: 'visits',
        recordId: visitId,
        newValue: { ...sourceEvidence, canonicalSourceKey: sourceKey },
        ...auditRequestMetadata(c),
      }),
    ];
    const encounterPrepared = await prepareStartRouteEncounterBatch(c.env.DB, {
      tenantId,
      visitId,
      patientId: data.patientId,
      doctorId: data.doctorId ?? null,
      visitType: data.visitType,
      startedAtUtc: createdAtUtc,
      sourceEvidence,
      idempotencyKey: suppliedKey
        ? `route:visit-create:${suppliedKey}`
        : `route:visit-create:${sourceKey}`,
      businessDate: today,
      authoritativeStatements,
    });

    if (visitServiceId && data.doctorId && consultationDescription) {
      const consultationService = await prepareProtectedConsultationService(c.env.DB, tenantId);
      const practitionerPublicId = await resolveAppointmentRoutePractitioner(
        c.env.DB,
        tenantId,
        data.doctorId,
      );
      if (!practitionerPublicId) {
        throw new Error('visit consultation service requires one exact practitioner mapping');
      }
      const visitServiceStatements = existingConsultationService ? [] : [
        db.$client.prepare(`
          INSERT INTO visit_services (
            id,tenant_id,visit_id,patient_id,service_type,description,doctor_id,amount,
            discount_amount,quantity,total_amount,status,created_by,created_at,canonical_source_key
          ) VALUES (?,?,?,?,'doctor_visit',?,?,?,0,1,?,'pending',?,datetime('now','+6 hours'),?)
        `).bind(
          visitServiceId,
          tenantId,
          visitId,
          data.patientId,
          consultationDescription,
          data.doctorId,
          consultationFee,
          consultationFee,
          Number(userId),
          serviceSourceKey,
        ),
      ];
      const servicePrepared = await prepareAcceptedServiceRouteBatch(c.env.DB, {
        tenantId,
        legacyPatientId: data.patientId,
        encounterPublicId: encounterPrepared.result.encounterPublicId,
        servicePublicId: consultationService.servicePublicId,
        sourceType: 'legacy_visit_service',
        sourcePublicId: String(visitServiceId),
        sourceTable: 'visit_services',
        quantity: 1,
        occurredAtUtc: createdAtUtc,
        sourceEvidence: {
          boundary: 'visit_consultation_service_acceptance',
          visitServiceId,
          serviceSourceKey,
          visitId,
          patientId: data.patientId,
          doctorId: data.doctorId,
          amountMinor: Math.round(consultationFee * 100),
          quantity: 1,
          status: 'pending',
        },
        participant: {
          practitionerPublicId,
          role: 'performing',
          evidenceType: 'legacy_consultation_doctor',
        },
        idempotencyKey: suppliedKey
          ? `route:visit-service:${suppliedKey}`
          : `route:visit-service:${serviceSourceKey}`,
        businessDate: today,
        preparedEncounter: encounterPrepared.status === 'prepared'
          ? {
              encounterPublicId: encounterPrepared.result.encounterPublicId,
              legacyPatientId: data.patientId,
            }
          : null,
        preparedService: consultationService.statements.length > 0
          ? {
              servicePublicId: consultationService.servicePublicId,
              sourceEvidenceSha256: consultationService.sourceEvidenceSha256,
            }
          : null,
        authoritativeStatements: [
          ...consultationService.statements,
          ...(encounterPrepared.status === 'prepared' ? encounterPrepared.statements : []),
          ...visitServiceStatements,
        ],
      });
      if (servicePrepared.status === 'prepared') {
        await c.env.DB.batch([...servicePrepared.statements] as D1PreparedStatement[]);
      }
    } else if (encounterPrepared.status === 'prepared') {
      await c.env.DB.batch([...encounterPrepared.statements] as D1PreparedStatement[]);
    }
    return c.json({ message: 'Visit created', id: visitId, visitNo }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('[visits] POST create error:', error);
    throw new HTTPException(500, { message: 'Failed to create visit' });
  }
});

// PUT /api/visits/:id — update notes, doctor
visitRoutes.put('/:id', zValidator('json', updateVisitSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  try {
    if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid visit id' });
    const existing = await readVisit(db, tenantId, id);
    if (!existing) throw new HTTPException(404, { message: 'Visit not found' });
    const nextDoctorId = data.doctorId ?? existing.doctor_id ?? null;
    const sourceKey = existing.canonical_source_key?.trim()
      || await createEncounterVisitSourceKey(tenantId, `legacy:${id}`);
    const next = {
      doctorId: nextDoctorId,
      notes: data.notes !== undefined ? data.notes : existing.notes ?? null,
      icd10Code: data.icd10Code !== undefined ? data.icd10Code : existing.icd10_code ?? null,
      icd10Description: data.icd10Description !== undefined ? data.icd10Description : existing.icd10_description ?? null,
      icd11Code: data.icd11Code !== undefined ? data.icd11Code : existing.icd11_code ?? null,
      icd11Description: data.icd11Description !== undefined ? data.icd11Description : existing.icd11_description ?? null,
    };
    const now = new Date().toISOString();
    const authoritativeStatements = [
      db.$client.prepare(`
        UPDATE visits
        SET doctor_id=?,notes=?,icd10_code=?,icd10_description=?,icd11_code=?,
            icd11_description=?,canonical_source_key=COALESCE(canonical_source_key,?),
            updated_at=datetime('now','+6 hours')
        WHERE id=? AND tenant_id=?
      `).bind(
        next.doctorId,
        next.notes,
        next.icd10Code,
        next.icd10Description,
        next.icd11Code,
        next.icd11Description,
        sourceKey,
        id,
        tenantId,
      ),
      prepareMasterDataAudit(c.env.DB, {
        tenantId,
        userId,
        action: 'UPDATE',
        tableName: 'visits',
        recordId: id,
        oldValue: existing,
        newValue: { ...next, canonicalSourceKey: sourceKey },
        ...auditRequestMetadata(c),
      }),
    ];
    let context;
    try {
      context = await resolveEncounterRouteContext(c.env.DB, {
        tenantId,
        visit: visitSnapshot(existing),
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('exact Canonical encounter mapping')) throw error;
      await startRouteEncounter(c.env.DB, {
        tenantId,
        visitId: id,
        patientId: Number(existing.patient_id),
        doctorId: next.doctorId == null ? null : Number(next.doctorId),
        visitType: existing.visit_type,
        startedAtUtc: legacyCreatedAtToUtc(existing.created_at, String(existing.visit_date ?? getTodayGMT6())),
        sourceEvidence: { boundary: 'visit_update_bootstrap', visitId: id, existing, next },
        idempotencyKey: `route:visit-update-bootstrap:${id}`,
        businessDate: String(existing.visit_date ?? getTodayGMT6()),
        authoritativeStatements,
      });
      return c.json({ message: 'Visit updated' });
    }
    if (next.doctorId !== existing.doctor_id && next.doctorId != null) {
      const suppliedKey = suppliedIdempotencyKey(c.req);
      await replaceRouteEncounterParticipant(c.env.DB, context, {
        doctorId: Number(next.doctorId),
        changedAtUtc: now,
        sourceEvidence: { boundary: 'visit_doctor_replace', visitId: id, from: existing.doctor_id, to: next.doctorId },
        idempotencyKey: suppliedKey
          ? `route:visit-doctor-replace:${suppliedKey}`
          : `route:visit-doctor-replace:${id}:${String(next.doctorId)}:${context.encounterVersion}`,
        businessDate: getTodayGMT6(),
        authoritativeStatements,
      });
    } else {
      await db.$client.batch(authoritativeStatements);
    }
    return c.json({ message: 'Visit updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('[visits] PUT update error:', error);
    throw new HTTPException(500, { message: 'Failed to update visit' });
  }
});

// POST /api/visits/:id/discharge — mark IPD discharge
visitRoutes.post('/:id/discharge', zValidator('json', dischargeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  try {
    if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid visit id' });
    const existing = await readVisit(db, tenantId, id);
    if (!existing || existing.visit_type !== 'ipd') {
      throw new HTTPException(404, { message: 'IPD visit not found' });
    }
    const context = await resolveEncounterRouteContext(c.env.DB, {
      tenantId,
      visit: visitSnapshot(existing),
    });
    const sourceKey = existing.canonical_source_key?.trim()
      || await createEncounterVisitSourceKey(tenantId, `legacy:${id}`);
    const next = {
      dischargeDate: data.dischargeDate,
      notes: data.notes ?? existing.notes,
      icd10Code: data.icd10Code !== undefined ? data.icd10Code : existing.icd10_code,
      icd10Description: data.icd10Description !== undefined ? data.icd10Description : existing.icd10_description,
      icd11Code: data.icd11Code !== undefined ? data.icd11Code : existing.icd11_code,
      icd11Description: data.icd11Description !== undefined ? data.icd11Description : existing.icd11_description,
    };
    const authoritativeStatements = [
      db.$client.prepare(`
        UPDATE visits
        SET discharge_date=?,notes=?,icd10_code=?,icd10_description=?,icd11_code=?,
            icd11_description=?,status='completed',
            canonical_source_key=COALESCE(canonical_source_key,?),updated_at=datetime('now','+6 hours')
        WHERE id=? AND tenant_id=? AND visit_type='ipd'
      `).bind(
        next.dischargeDate,
        next.notes,
        next.icd10Code,
        next.icd10Description,
        next.icd11Code,
        next.icd11Description,
        sourceKey,
        id,
        tenantId,
      ),
      prepareMasterDataAudit(c.env.DB, {
        tenantId,
        userId,
        action: 'UPDATE',
        tableName: 'visits',
        recordId: id,
        oldValue: existing,
        newValue: { action: 'discharge', ...next, canonicalSourceKey: sourceKey },
        ...auditRequestMetadata(c),
      }),
    ];
    const suppliedKey = suppliedIdempotencyKey(c.req);
    await completeRouteEncounter(c.env.DB, context, {
      completedAtUtc: localDateTimeToUtc(data.dischargeDate, true),
      sourceEvidence: { boundary: 'visit_discharge', visitId: id, dischargeDate: data.dischargeDate },
      idempotencyKey: suppliedKey
        ? `route:visit-discharge:${suppliedKey}`
        : `route:visit-discharge:${id}:${data.dischargeDate}`,
      businessDate: data.dischargeDate,
      authoritativeStatements,
    });
    return c.json({ message: 'Patient discharged', dischargeDate: data.dischargeDate });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to discharge patient' });
  }
});

export default visitRoutes;
