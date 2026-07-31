// ═══════════════════════════════════════════════════════════════════════════════
// FHIR R4 REST Routes — Read + Write facade over HMS-SaaS D1 data
// Mounted at /api/fhir
// ═══════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import {
  toFhirPatient, toFhirPractitioner, toFhirObservations,
  toFhirMedicationRequests, toFhirEncounter, toFhirAppointment,
  toBundle, buildCapabilityStatement, LOINC, BD_FHIR,
} from '../../lib/fhir/mappers';
import { buildSearchClauses, parseCount } from '../../lib/fhir/search';
import { getDb } from '../../db';
import { patientVitals } from '../../db/schema';
import { getNextSequence } from '../../lib/sequence';
import { fhirCreatePatientSchema, fhirCreateObservationSchema, fhirCreateEncounterSchema } from '../../schemas/fhir';
import { requireRole, CLINICAL_ROLES, OPD_ROLES } from '../../middleware/rbac';


const fhirRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// FHIR JSON content type helper — returns a raw Response with application/fhir+json
function fhirResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/fhir+json' },
  });
}

// ─── GET /metadata — CapabilityStatement ─────────────────────────────────────
fhirRoutes.get('/metadata', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return fhirResponse(buildCapabilityStatement(baseUrl));
});

// ═══ PATIENT ═════════════════════════════════════════════════════════════════

fhirRoutes.get('/Patient', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const q = c.req.query();

  const { where, params } = buildSearchClauses(q, {
    name:       { column: 'name', op: 'like' },
    _id:        { column: 'id', op: 'eq' },
    identifier: { column: 'patient_code', op: 'eq' },
    phone:      { column: 'mobile', op: 'like' },
  });

  const limit = parseCount(q);
  const allWhere = ['tenant_id = ?', ...where];
  const allParams: (string | number)[] = [tenantId!, ...params];

  const sql = `SELECT * FROM patients WHERE ${allWhere.join(' AND ')} ORDER BY id DESC LIMIT ?`;
  allParams.push(limit);

  const { results } = await db.$client.prepare(sql).bind(...allParams).all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resources = results.map((r) => toFhirPatient(r as any, baseUrl));
  return fhirResponse(toBundle(resources, baseUrl));
});

fhirRoutes.get('/Patient/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const id = c.req.param('id');

  const row = await db.$client.prepare('SELECT * FROM patients WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first();
  if (!row) throw new HTTPException(404, { message: 'Patient not found' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fhirResponse(toFhirPatient(row as any, baseUrl));
});

// ═══ PRACTITIONER ════════════════════════════════════════════════════════════

fhirRoutes.get('/Practitioner', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const q = c.req.query();

  const { where, params } = buildSearchClauses(q, {
    name:      { column: 'name', op: 'like' },
    _id:       { column: 'id', op: 'eq' },
    specialty: { column: 'specialty', op: 'like' },
  });

  const limit = parseCount(q);
  const allWhere = ['tenant_id = ?', 'is_active = 1', ...where];
  const allParams: (string | number)[] = [tenantId!, ...params];

  const sql = `SELECT * FROM doctors WHERE ${allWhere.join(' AND ')} ORDER BY name LIMIT ?`;
  allParams.push(limit);

  const { results } = await db.$client.prepare(sql).bind(...allParams).all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resources = results.map((r) => toFhirPractitioner(r as any, baseUrl));
  return fhirResponse(toBundle(resources, baseUrl));
});

fhirRoutes.get('/Practitioner/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const id = c.req.param('id');

  const row = await db.$client.prepare('SELECT * FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!row) throw new HTTPException(404, { message: 'Practitioner not found' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fhirResponse(toFhirPractitioner(row as any, baseUrl));
});

// ═══ OBSERVATION (Vitals) ════════════════════════════════════════════════════

fhirRoutes.get('/Observation', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const q = c.req.query();

  const { where, params } = buildSearchClauses(q, {
    patient: { column: 'patient_id', op: 'ref' },
    date:    { column: 'recorded_at', op: 'date' },
  });

  const limit = parseCount(q);
  const allWhere = ['tenant_id = ?', ...where];
  const allParams: (string | number)[] = [tenantId!, ...params];

  const sql = `SELECT * FROM patient_vitals WHERE ${allWhere.join(' AND ')} ORDER BY recorded_at DESC LIMIT ?`;
  allParams.push(limit);

  const { results } = await db.$client.prepare(sql).bind(...allParams).all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resources = results.flatMap((r) => toFhirObservations(r as any, baseUrl));
  // _count applies to FHIR resources (each vital expands into multiple Observations)
  const sliced = resources.slice(0, limit);
  return fhirResponse(toBundle(sliced, baseUrl));
});

fhirRoutes.get('/Observation/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const rawId = c.req.param('id');

  // IDs look like "123-bp" or "123-heart_rate" — extract vital row id
  const vitalId = rawId.split('-')[0];

  const row = await db.$client.prepare('SELECT * FROM patient_vitals WHERE id = ? AND tenant_id = ?')
    .bind(vitalId, tenantId).first();
  if (!row) throw new HTTPException(404, { message: 'Observation not found' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const observations = toFhirObservations(row as any, baseUrl);
  const match = observations.find(o => o.id === rawId);
  if (!match) throw new HTTPException(404, { message: 'Observation not found' });

  return fhirResponse(match);
});

// ═══ MEDICATION REQUEST (Prescriptions) ═══════════════════════════════════════

fhirRoutes.get('/MedicationRequest', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const q = c.req.query();

  const { where, params } = buildSearchClauses(q, {
    patient: { column: 'p.patient_id', op: 'ref' },
    date:    { column: 'p.created_at', op: 'date' },
    status:  { column: 'p.status', op: 'eq' },
  });

  const limit = parseCount(q);
  const allWhere = ['p.tenant_id = ?', ...where];
  const allParams: (string | number)[] = [tenantId!, ...params];

  const sql = `
    SELECT p.*, d.name as doctor_name
    FROM prescriptions p
    LEFT JOIN doctors d ON p.doctor_id = d.id AND d.tenant_id = p.tenant_id
    WHERE ${allWhere.join(' AND ')}
    ORDER BY p.created_at DESC LIMIT ?
  `;
  allParams.push(limit);

  const { results } = await db.$client.prepare(sql).bind(...allParams).all();

  // Batch fetch all prescription items in one round-trip (fixes N+1)
  if (results.length === 0) return fhirResponse(toBundle([], baseUrl));

  const itemBatch = results.map((rx: any) =>
    db.$client.prepare(
      'SELECT pi.* FROM prescription_items pi JOIN prescriptions pr ON pi.prescription_id = pr.id AND pr.tenant_id = ? WHERE pi.prescription_id = ?'
    ).bind(tenantId, rx.id)
  );
  const batchResults = await db.$client.batch(itemBatch);

  const resources = [];
  for (let i = 0; i < results.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rxRow = results[i] as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (batchResults[i] as any).results ?? [];
    resources.push(...toFhirMedicationRequests(rxRow, items, baseUrl));
  }

  return fhirResponse(toBundle(resources, baseUrl));
});

fhirRoutes.get('/MedicationRequest/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const rawId = c.req.param('id');

  // IDs are "rxId" or "rxId-itemIdx"
  const rxId = rawId.split('-')[0];

  const rx = await db.$client.prepare(
    `SELECT p.*, d.name as doctor_name FROM prescriptions p LEFT JOIN doctors d ON p.doctor_id = d.id AND d.tenant_id = p.tenant_id
     WHERE p.id = ? AND p.tenant_id = ?`
  ).bind(rxId, tenantId).first();
  if (!rx) throw new HTTPException(404, { message: 'MedicationRequest not found' });

  const { results: items } = await db.$client.prepare(
    'SELECT pi.* FROM prescription_items pi JOIN prescriptions pr ON pi.prescription_id = pr.id AND pr.tenant_id = ? WHERE pi.prescription_id = ?'
  ).bind(tenantId, rxId).all();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = toFhirMedicationRequests(rx as any, items as any, baseUrl);
  const match = all.find(r => r.id === rawId) ?? all[0];
  return fhirResponse(match);
});

// ═══ ENCOUNTER (Visits) ══════════════════════════════════════════════════════

fhirRoutes.get('/Encounter', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const q = c.req.query();

  const { where, params } = buildSearchClauses(q, {
    patient: { column: 'v.patient_id', op: 'ref' },
    date:    { column: 'v.created_at', op: 'date' },
    type:    { column: 'v.visit_type', op: 'eq' },
  });

  const limit = parseCount(q);
  const allWhere = ['v.tenant_id = ?', ...where];
  const allParams: (string | number)[] = [tenantId!, ...params];

  const sql = `
    SELECT v.*, d.name as doctor_name
    FROM visits v
    LEFT JOIN doctors d ON v.doctor_id = d.id AND d.tenant_id = v.tenant_id
    WHERE ${allWhere.join(' AND ')}
    ORDER BY v.created_at DESC LIMIT ?
  `;
  allParams.push(limit);

  const { results } = await db.$client.prepare(sql).bind(...allParams).all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resources = results.map((r) => toFhirEncounter(r as any, baseUrl));
  return fhirResponse(toBundle(resources, baseUrl));
});

fhirRoutes.get('/Encounter/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const id = c.req.param('id');

  const row = await db.$client.prepare(
    `SELECT v.*, d.name as doctor_name FROM visits v LEFT JOIN doctors d ON v.doctor_id = d.id AND d.tenant_id = v.tenant_id
     WHERE v.id = ? AND v.tenant_id = ?`
  ).bind(id, tenantId).first();
  if (!row) throw new HTTPException(404, { message: 'Encounter not found' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fhirResponse(toFhirEncounter(row as any, baseUrl));
});

// ═══ APPOINTMENT ═════════════════════════════════════════════════════════════

fhirRoutes.get('/Appointment', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const q = c.req.query();

  const { where, params } = buildSearchClauses(q, {
    patient: { column: 'a.patient_id', op: 'ref' },
    date:    { column: 'a.appt_date', op: 'date' },
    status:  { column: 'a.status', op: 'eq' },
  });

  const limit = parseCount(q);
  const allWhere = ['a.tenant_id = ?', ...where];
  const allParams: (string | number)[] = [tenantId!, ...params];

  const sql = `
    SELECT a.*, d.name as doctor_name
    FROM appointments a
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    WHERE ${allWhere.join(' AND ')}
    ORDER BY a.appt_date DESC, a.appt_time DESC LIMIT ?
  `;
  allParams.push(limit);

  const { results } = await db.$client.prepare(sql).bind(...allParams).all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resources = results.map((r) => toFhirAppointment(r as any, baseUrl));
  return fhirResponse(toBundle(resources, baseUrl));
});

fhirRoutes.get('/Appointment/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin;
  const id = c.req.param('id');

  const row = await db.$client.prepare(
    `SELECT a.*, d.name as doctor_name FROM appointments a LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
     WHERE a.id = ? AND a.tenant_id = ?`
  ).bind(id, tenantId).first();
  if (!row) throw new HTTPException(404, { message: 'Appointment not found' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fhirResponse(toFhirAppointment(row as any, baseUrl));
});

// ═══════════════════════════════════════════════════════════════════════════════
// FHIR Write APIs — POST endpoints for creating resources
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Reverse LOINC lookup: code → patient_vitals column ──────────────────────
const LOINC_TO_VITAL_COLUMN: Record<string, string> = {
  [LOINC.systolic.code]: 'systolic',
  [LOINC.diastolic.code]: 'diastolic',
  [LOINC.heart_rate.code]: 'heart_rate',
  [LOINC.temperature.code]: 'temperature',
  [LOINC.spo2.code]: 'spo2',
  [LOINC.respiratory_rate.code]: 'respiratory_rate',
  [LOINC.weight.code]: 'weight',
};

// ─── Clinical vital ranges (matches vitals.ts validation) ──────────────────
const VITAL_RANGES: Record<string, { min: number; max: number; label: string }> = {
  systolic:         { min: 40,  max: 300, label: 'Systolic BP (mmHg)' },
  diastolic:        { min: 20,  max: 200, label: 'Diastolic BP (mmHg)' },
  heart_rate:       { min: 20,  max: 300, label: 'Heart rate (bpm)' },
  temperature:      { min: 30,  max: 45,  label: 'Temperature (°C)' },
  spo2:             { min: 0,   max: 100, label: 'SpO2 (%)' },
  respiratory_rate: { min: 4,   max: 60,  label: 'Respiratory rate (breaths/min)' },
  weight:           { min: 0.1, max: 500, label: 'Weight (kg)' },
};

// ─── POST /fhir/Patient ─────────────────────────────────────────────────────

fhirRoutes.post('/Patient', requireRole(...OPD_ROLES), zValidator('json', fhirCreatePatientSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const baseUrl = new URL(c.req.url).origin;
  const data = c.req.valid('json');

  // Extract name
  const nameEntry = data.name[0];
  const fullName = nameEntry.text
    ?? [
      ...(nameEntry.given ?? []),
      nameEntry.family,
    ].filter(Boolean).join(' ');

  if (!fullName.trim()) {
    throw new HTTPException(400, { message: 'Patient name is required' });
  }

  // Extract phone
  const phone = data.telecom?.find(t => t.system === 'phone')?.value ?? null;

  // Extract NID from identifiers (strict BD NID system match)
  const nidIdentifier = data.identifier?.find(
    i => i.system === BD_FHIR.NID_SYSTEM,
  );
  const nationalId = nidIdentifier?.value ?? null;

  // Extract address
  const addr = data.address?.[0];

  // Map gender
  const gender = data.gender
    ? data.gender.charAt(0).toUpperCase() + data.gender.slice(1)
    : null;

  const patientCode = await getNextSequence(c.env.DB, tenantId, 'patient', 'P');

  const result = await db.$client.prepare(`
    INSERT INTO patients (
      patient_code, name, mobile, gender, date_of_birth, address, national_id, tenant_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
  `).bind(
    patientCode,
    fullName.trim(),
    phone,
    gender,
    data.birthDate ?? null,
    addr?.text ?? null,
    nationalId,
    tenantId,
  ).run();

  const patientId = Number(result.meta.last_row_id);

  // Fetch back and return as FHIR
  const row = await db.$client.prepare('SELECT * FROM patients WHERE id = ? AND tenant_id = ?')
    .bind(patientId, tenantId).first();

  if (!row) throw new HTTPException(500, { message: 'Failed to retrieve created patient' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fhirPatient = toFhirPatient(row as any, baseUrl);

  return new Response(JSON.stringify(fhirPatient), {
    status: 201,
    headers: {
      'Content-Type': 'application/fhir+json',
      'Location': `${baseUrl}/api/fhir/Patient/${patientId}`,
    },
  });
});

// ─── POST /fhir/Observation ─────────────────────────────────────────────────

fhirRoutes.post('/Observation', requireRole(...CLINICAL_ROLES), zValidator('json', fhirCreateObservationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const baseUrl = new URL(c.req.url).origin;
  const data = c.req.valid('json');

  // Extract patient ID from reference
  const patientIdStr = data.subject.reference.replace('Patient/', '');
  const patientId = Number(patientIdStr);
  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient reference' });
  }

  // Verify patient exists
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // Build vitals columns from LOINC codes
  const vitalValues: Record<string, number> = {};

  // Check top-level valueQuantity (single vital)
  const topCode = data.code.coding[0]?.code;
  if (data.valueQuantity?.value != null && topCode) {
    const column = LOINC_TO_VITAL_COLUMN[topCode];
    if (column) {
      vitalValues[column] = data.valueQuantity.value;
    }
  }

  // Check component array (BP panel or multi-value)
  if (data.component) {
    for (const comp of data.component) {
      const compCode = comp.code.coding[0]?.code;
      if (compCode && comp.valueQuantity?.value != null) {
        const column = LOINC_TO_VITAL_COLUMN[compCode];
        if (column) {
          vitalValues[column] = comp.valueQuantity.value;
        }
      }
    }
  }

  if (Object.keys(vitalValues).length === 0) {
    throw new HTTPException(400, { message: 'No recognized LOINC vital codes provided' });
  }

  // C-1 fix: Allowlist assertion — prevent SQL injection via dynamic column names
  const ALLOWED_VITAL_COLUMNS = new Set(['systolic', 'diastolic', 'heart_rate', 'temperature', 'spo2', 'respiratory_rate', 'weight']);
  for (const col of Object.keys(vitalValues)) {
    if (!ALLOWED_VITAL_COLUMNS.has(col)) {
      throw new HTTPException(400, { message: `Unknown vital column: ${col}` });
    }
  }

  // Validate clinical ranges
  for (const [column, value] of Object.entries(vitalValues)) {
    const range = VITAL_RANGES[column];
    if (range && (value < range.min || value > range.max)) {
      throw new HTTPException(400, {
        message: `${range.label}: value ${value} out of clinical range (${range.min}–${range.max})`,
      });
    }
  }

  // Build dynamic INSERT into patient_vitals (matches FHIR GET read table)
  const takenAt = data.effectiveDateTime ?? new Date().toISOString();

  // Map vital columns from snake_case (keys of vitalValues) to camelCase matching Drizzle schema
  const snakeToCamel = (str: string) => str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());

  const dbValues: Record<string, any> = {
    tenantId,
    patientId,
    recordedAt: takenAt,
    recordedBy: userId,
    source: 'imported',
  };

  for (const [key, value] of Object.entries(vitalValues)) {
    dbValues[snakeToCamel(key)] = value;
  }

  const result = await db.insert(patientVitals).values(dbValues as any).returning();

  if (!result || result.length === 0) {
    throw new HTTPException(500, { message: 'Failed to create observation' });
  }

  const row = result[0];
  const vitalId = row.id;

  // Remap Drizzle returned row back to snake_case for toFhirObservations mapper
  const mapperRow: Record<string, any> = { ...row };

  // Convert all camelCase keys in row to snake_case for the mapper
  const camelToSnake = (str: string) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  for (const key of Object.keys(row)) {
    if (key !== camelToSnake(key)) {
      mapperRow[camelToSnake(key)] = (row as any)[key];
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const observations = toFhirObservations(mapperRow as any, baseUrl);
  const firstObs = observations[0];

  const vitalKeys = Object.keys(vitalValues);
  const locationSuffix = (vitalKeys.includes('systolic') || vitalKeys.includes('diastolic')) ? 'bp' : (vitalKeys[0] ?? 'vital');

  return new Response(JSON.stringify(firstObs ?? { resourceType: 'Observation', id: String(vitalId) }), {
    status: 201,
    headers: {
      'Content-Type': 'application/fhir+json',
      'Location': `${baseUrl}/api/fhir/Observation/${vitalId}-${locationSuffix}`,
    },
  });
});

// ─── POST /fhir/Encounter ───────────────────────────────────────────────────

const FHIR_CLASS_TO_VISIT_TYPE: Record<string, string> = {
  AMB: 'opd',
  IMP: 'ipd',
  EMER: 'emergency',
};

fhirRoutes.post('/Encounter', requireRole(...OPD_ROLES), zValidator('json', fhirCreateEncounterSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const baseUrl = new URL(c.req.url).origin;
  const data = c.req.valid('json');

  // Extract patient ID
  const patientIdStr = data.subject.reference.replace('Patient/', '');
  const patientId = Number(patientIdStr);
  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient reference' });
  }

  // Verify patient exists
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // Map FHIR class to visit_type
  const visitType = FHIR_CLASS_TO_VISIT_TYPE[data.class.code] ?? 'opd';

  // Extract doctor from participant
  let doctorId: number | null = null;
  if (data.participant) {
    for (const p of data.participant) {
      const ref = p.individual?.reference;
      if (ref?.startsWith('Practitioner/')) {
        doctorId = Number(ref.replace('Practitioner/', ''));
        if (!Number.isFinite(doctorId)) doctorId = null;
        break;
      }
    }
  }

  // Extract reason/notes
  const notes = data.reasonCode?.map(r => r.text ?? r.coding?.[0]?.display ?? '').filter(Boolean).join('; ') ?? null;

  // Extract ICD codes from reasonCode (ICD-11 preferred, ICD-10 fallback)
  let icd10Code: string | null = null;
  let icd10Description: string | null = null;
  let icd11Code: string | null = null;
  let icd11Description: string | null = null;
  if (data.reasonCode) {
    for (const reason of data.reasonCode) {
      for (const coding of reason.coding ?? []) {
        if (!icd11Code && (coding.system?.includes('icd/release/11') || coding.system === BD_FHIR.ICD11_SYSTEM)) {
          icd11Code = coding.code;
          icd11Description = coding.display ?? null;
        }
        if (!icd10Code && (coding.system?.includes('icd-10') || coding.system?.includes('icd10'))) {
          icd10Code = coding.code;
          icd10Description = coding.display ?? null;
        }
      }
    }
  }

  const visitNo = await getNextSequence(c.env.DB, tenantId, 'visit', 'V');

  const result = await db.$client.prepare(`
    INSERT INTO visits (
      visit_no, patient_id, doctor_id, visit_type, notes,
      icd10_code, icd10_description, icd11_code, icd11_description, tenant_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
  `).bind(
    visitNo, patientId, doctorId, visitType, notes,
    icd10Code, icd10Description, icd11Code, icd11Description, tenantId,
  ).run();

  const visitId = Number(result.meta.last_row_id);

  // Fetch back and return as FHIR
  const row = await db.$client.prepare(
    `SELECT v.*, d.name as doctor_name FROM visits v
     LEFT JOIN doctors d ON v.doctor_id = d.id AND d.tenant_id = v.tenant_id
     WHERE v.id = ? AND v.tenant_id = ?`,
  ).bind(visitId, tenantId).first();

  if (!row) throw new HTTPException(500, { message: 'Failed to retrieve created encounter' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fhirEncounter = toFhirEncounter(row as any, baseUrl);

  return new Response(JSON.stringify(fhirEncounter), {
    status: 201,
    headers: {
      'Content-Type': 'application/fhir+json',
      'Location': `${baseUrl}/api/fhir/Encounter/${visitId}`,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FHIR R4 LAB: DiagnosticReport + Lab Observation + ServiceRequest
// Reference: OpenEMR FhirDiagnosticReportLaboratoryService, FhirObservationLaboratoryService
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /fhir/DiagnosticReport
 * Returns lab orders as FHIR DiagnosticReport resources.
 * Params: patient (patient_id), date, status, _count
 */
fhirRoutes.get('/DiagnosticReport', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin + '/api/fhir';
  const { patient, date, status, _count } = c.req.query();
  const limit = parseInt(_count || '50');

  let query = `
    SELECT lo.*, p.name as patient_name, p.patient_code
    FROM lab_orders lo
    JOIN patients p ON lo.patient_id = p.id
    WHERE lo.tenant_id = ?`;
  const params: (string | number)[] = [tenantId];

  if (patient) { query += ' AND lo.patient_id = ?'; params.push(patient); }
  if (date) { query += ' AND lo.order_date = ?'; params.push(date); }
  if (status) {
    const fhirStatusMap: Record<string, string> = {
      'registered': 'pending', 'preliminary': 'processing',
      'final': 'completed', 'cancelled': 'cancelled',
    };
    const hmsStatus = fhirStatusMap[status] || status;
    query += ' AND lo.status = ?'; params.push(hmsStatus);
  }
  query += ' ORDER BY lo.order_date DESC LIMIT ?';
  params.push(limit);

  const { results: orders } = await db.$client.prepare(query).bind(...params).all() as any;

  const entries = [];
  for (const order of orders || []) {
    // Fetch items for each order
    const { results: items } = await db.$client.prepare(`
      SELECT loi.*, ltc.name as test_name, ltc.code as test_code, ltc.loinc_code
      FROM lab_order_items loi
      JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      WHERE loi.lab_order_id = ?
    `).bind(order.id).all() as any;

    const statusMap: Record<string, string> = {
      'pending': 'registered', 'sample-collected': 'registered',
      'processing': 'preliminary', 'completed': 'final',
      'verified': 'final', 'cancelled': 'cancelled',
    };

    const resource = {
      resourceType: 'DiagnosticReport',
      id: `lab-order-${order.id}`,
      status: statusMap[order.status] || 'unknown',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB', display: 'Laboratory' }] }],
      code: { text: `Lab Order ${order.order_no}` },
      subject: { reference: `${baseUrl}/Patient/${order.patient_id}`, display: order.patient_name },
      effectiveDateTime: order.order_date,
      issued: order.created_at,
      result: (items || []).map((item: any) => ({
        reference: `${baseUrl}/Observation/lab-item-${item.id}`,
        display: item.test_name,
      })),
      conclusion: order.notes || undefined,
    };

    entries.push({ fullUrl: `${baseUrl}/DiagnosticReport/${resource.id}`, resource });
  }

  return c.json({
    resourceType: 'Bundle', type: 'searchset',
    total: entries.length, entry: entries,
  });
});

/** GET /fhir/DiagnosticReport/:id */
fhirRoutes.get('/DiagnosticReport/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin + '/api/fhir';
  const id = c.req.param('id').replace('lab-order-', '');

  const order = await db.$client.prepare(
    `SELECT lo.*, p.name as patient_name FROM lab_orders lo
     JOIN patients p ON lo.patient_id = p.id WHERE lo.id = ? AND lo.tenant_id = ?`
  ).bind(id, tenantId).first() as any;
  if (!order) throw new HTTPException(404, { message: 'DiagnosticReport not found' });

  const { results: items } = await db.$client.prepare(`
    SELECT loi.*, ltc.name as test_name, ltc.loinc_code
    FROM lab_order_items loi JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    WHERE loi.lab_order_id = ?
  `).bind(id).all() as any;

  const statusMap: Record<string, string> = {
    'pending': 'registered', 'processing': 'preliminary',
    'completed': 'final', 'verified': 'final', 'cancelled': 'cancelled',
  };

  return c.json({
    resourceType: 'DiagnosticReport',
    id: `lab-order-${order.id}`,
    status: statusMap[order.status] || 'unknown',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB' }] }],
    code: { text: `Lab Order ${order.order_no}` },
    subject: { reference: `${baseUrl}/Patient/${order.patient_id}`, display: order.patient_name },
    effectiveDateTime: order.order_date,
    issued: order.created_at,
    result: (items || []).map((item: any) => ({
      reference: `${baseUrl}/Observation/lab-item-${item.id}`,
      display: item.test_name,
    })),
  });
});

/**
 * GET /fhir/Observation/lab-item-:id
 * Returns a lab result as FHIR Observation (laboratory category).
 */
fhirRoutes.get('/Observation/lab-item-:itemId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin + '/api/fhir';
  const itemId = c.req.param('itemId');

  const item = await db.$client.prepare(`
    SELECT loi.*, ltc.name as test_name, ltc.code as test_code, ltc.loinc_code,
           ltc.unit, ltc.normal_range, lo.patient_id, lo.order_date,
           p.name as patient_name
    FROM lab_order_items loi
    JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    JOIN patients p ON lo.patient_id = p.id
    WHERE loi.id = ? AND lo.tenant_id = ?
  `).bind(itemId, tenantId).first() as any;
  if (!item) throw new HTTPException(404, { message: 'Lab Observation not found' });

  const statusMap: Record<string, string> = {
    'pending': 'registered', 'collected': 'registered',
    'processing': 'preliminary', 'completed': 'final',
    'verified': 'final', 'cancelled': 'cancelled',
  };

  const abnormalMap: Record<string, { code: string; display: string }> = {
    'normal': { code: 'N', display: 'Normal' },
    'high': { code: 'H', display: 'High' },
    'low': { code: 'L', display: 'Low' },
    'critical': { code: 'HH', display: 'Critical high' },
  };

  // Parse reference range
  let refRange: any = undefined;
  if (item.normal_range) {
    const match = item.normal_range.match(/^([\d.]+)-([\d.]+)$/);
    if (match) {
      refRange = [{ low: { value: parseFloat(match[1]), unit: item.unit || '' }, high: { value: parseFloat(match[2]), unit: item.unit || '' } }];
    } else {
      refRange = [{ text: item.normal_range }];
    }
  }

  const obs: any = {
    resourceType: 'Observation',
    id: `lab-item-${item.id}`,
    status: statusMap[item.status] || 'unknown',
    category: [{ coding: [
      { system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' },
    ]}],
    code: {
      coding: item.loinc_code ? [
        { system: 'http://loinc.org', code: item.loinc_code, display: item.test_name },
        { system: 'http://local', code: item.test_code, display: item.test_name },
      ] : [
        { system: 'http://local', code: item.test_code, display: item.test_name },
      ],
      text: item.test_name,
    },
    subject: { reference: `${baseUrl}/Patient/${item.patient_id}`, display: item.patient_name },
    effectiveDateTime: item.completed_at || item.order_date,
  };

  // Value
  if (item.result_numeric != null) {
    obs.valueQuantity = { value: item.result_numeric, unit: item.unit || '', system: 'http://unitsofmeasure.org' };
  } else if (item.result) {
    obs.valueString = item.result;
  }

  // Interpretation
  const flag = abnormalMap[item.abnormal_flag];
  if (flag) {
    obs.interpretation = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: flag.code, display: flag.display }] }];
  }

  if (refRange) obs.referenceRange = refRange;

  return c.json(obs);
});

/**
 * GET /fhir/ServiceRequest
 * Returns lab orders as FHIR ServiceRequest resources (order intent).
 */
fhirRoutes.get('/ServiceRequest', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const baseUrl = new URL(c.req.url).origin + '/api/fhir';
  const { patient, _count } = c.req.query();
  const limit = parseInt(_count || '50');

  let query = `SELECT lo.*, p.name as patient_name FROM lab_orders lo
    JOIN patients p ON lo.patient_id = p.id WHERE lo.tenant_id = ?`;
  const params: (string | number)[] = [tenantId];
  if (patient) { query += ' AND lo.patient_id = ?'; params.push(patient); }
  query += ' ORDER BY lo.order_date DESC LIMIT ?';
  params.push(limit);

  const { results: orders } = await db.$client.prepare(query).bind(...params).all() as any;

  const entries = (orders || []).map((order: any) => {
    const statusMap: Record<string, string> = {
      'pending': 'active', 'processing': 'active',
      'completed': 'completed', 'verified': 'completed', 'cancelled': 'revoked',
    };
    const priorityMap: Record<string, string> = {
      'routine': 'routine', 'urgent': 'urgent', 'stat': 'stat', 'asap': 'asap',
    };

    return {
      fullUrl: `${baseUrl}/ServiceRequest/lab-order-${order.id}`,
      resource: {
        resourceType: 'ServiceRequest',
        id: `lab-order-${order.id}`,
        status: statusMap[order.status] || 'unknown',
        intent: 'order',
        priority: priorityMap[order.priority] || 'routine',
        category: [{ coding: [{ system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' }] }],
        subject: { reference: `${baseUrl}/Patient/${order.patient_id}`, display: order.patient_name },
        authoredOn: order.created_at,
        occurrenceDateTime: order.order_date,
        note: order.clinical_history ? [{ text: order.clinical_history }] : undefined,
      },
    };
  });

  return c.json({ resourceType: 'Bundle', type: 'searchset', total: entries.length, entry: entries });
});

export default fhirRoutes;
