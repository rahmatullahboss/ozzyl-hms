/**
 * CCDA Export Routes
 *
 * GET /api/ccda/export/:patientId — Export patient record as C-CDA XML
 * GET /api/ccda/sections            — List available CCDA sections
 *
 * Auth: tenant JWT (staff access)
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import {
  buildCCDADocument,
  CCDA_SECTION_CODES,
  type CCDADocument,
  type CCDAPatient,
  type CCDAAllergy,
  type CCDAMedication,
  type CCDAVital,
  type CCDAProblem,
  type CCDALabResult,
  type CCDAProcedure,
} from '../../lib/ccda';

const ccdaRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /export/:patientId — generate C-CDA XML
ccdaRoutes.get('/export/:patientId', async (c) => {
  const tenantId = requireTenantId(c);
  requireUserId(c);
  const patientId = parseInt(c.req.param('patientId'), 10);
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  const db = getDb(c.env.DB);
  const raw = db.$client;

  // 1. Patient demographics
  const patient = await raw.prepare(
    'SELECT id, name, mobile AS phone, national_id AS nid, gender, date_of_birth, blood_group, address FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<CCDAPatient>();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // 2. Allergies
  const allergies = await raw.prepare(
    'SELECT allergen, reaction_type, severity, onset_date FROM patient_allergies WHERE patient_id = ? AND tenant_id = ? ORDER BY onset_date DESC'
  ).bind(patientId, tenantId).all<CCDAAllergy>();

  // 3. Medications
  const medications = await raw.prepare(
    `SELECT medication_name, dose, frequency, start_date, end_date, status
     FROM patient_medications WHERE patient_id = ? AND tenant_id = ? ORDER BY start_date DESC LIMIT 200`
  ).bind(patientId, tenantId).all<CCDAMedication>();

  // 4. Vitals
  const vitals = await raw.prepare(
    `SELECT type, value, unit, recorded_at
     FROM patient_vitals WHERE patient_id = ? AND tenant_id = ? ORDER BY recorded_at DESC LIMIT 200`
  ).bind(patientId, tenantId).all<CCDAVital>();

  // 5. Problems
  const problems = await raw.prepare(
    `SELECT diagnosis, icd_code, status, onset_date
     FROM patient_problems WHERE patient_id = ? AND tenant_id = ? ORDER BY onset_date DESC`
  ).bind(patientId, tenantId).all<CCDAProblem>();

  // 6. Lab results
  const labResults = await raw.prepare(
    `SELECT test_name, value, unit, reference_range, result_date, status
     FROM lab_results
     WHERE patient_id = ? AND tenant_id = ?
       AND COALESCE(result_status, '') <> 'retracted'
     ORDER BY result_date DESC LIMIT 200`
  ).bind(patientId, tenantId).all<CCDALabResult>();

  // 7. Procedures
  const procedures = await raw.prepare(
    `SELECT name, date, status, notes
     FROM patient_procedures WHERE patient_id = ? AND tenant_id = ? ORDER BY date DESC LIMIT 100`
  ).bind(patientId, tenantId).all<CCDAProcedure>();

  // Get hospital name for author
  const hospital = await raw.prepare(
    'SELECT name FROM hospitals WHERE tenant_id = ? LIMIT 1'
  ).bind(tenantId).first<{ name: string }>();

  const doc: CCDADocument = {
    patient,
    allergies: allergies.results ?? [],
    medications: medications.results ?? [],
    vitals: vitals.results ?? [],
    problems: problems.results ?? [],
    labResults: labResults.results ?? [],
    procedures: procedures.results ?? [],
    author: {
      name: 'OzzyLife HMS',
      organization: hospital?.name ?? 'OzzyLife HMS',
    },
    generatedAt: new Date().toISOString(),
  };

  const xml = buildCCDADocument(doc);
  const format = c.req.query('format');

  if (format === 'download') {
    const filename = `ccda-${patientId}-${new Date().toISOString().slice(0, 10)}.xml`;
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('Content-Type', 'application/xml');
    return c.body(xml);
  }

  c.header('Content-Type', 'application/xml');
  return c.body(xml);
});

// GET /sections — list available sections
ccdaRoutes.get('/sections', async (c) => {
  const sections = Object.entries(CCDA_SECTION_CODES).map(([key, val]) => ({
    key,
    loinc_code: val.code,
    title: val.title,
  }));
  return c.json({ sections });
});

export default ccdaRoutes;
