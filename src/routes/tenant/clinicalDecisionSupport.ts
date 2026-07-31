import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const cdsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: 'minor' | 'moderate' | 'major';
  description: string;
}

// Common drug interactions database (simplified)
const DRUG_INTERACTIONS: DrugInteraction[] = [
  { drug1: 'warfarin', drug2: 'aspirin', severity: 'major', description: 'Increased risk of bleeding' },
  { drug1: 'warfarin', drug2: 'ibuprofen', severity: 'major', description: 'Increased risk of bleeding' },
  { drug1: 'lisinopril', drug2: 'spironolactone', severity: 'major', description: 'Risk of hyperkalemia' },
  { drug1: 'metformin', drug2: 'alcohol', severity: 'moderate', description: 'Risk of lactic acidosis' },
  { drug1: 'simvastatin', drug2: 'erythromycin', severity: 'major', description: 'Increased risk of rhabdomyolysis' },
  { drug1: 'digoxin', drug2: 'furosemide', severity: 'moderate', description: 'Risk of digoxin toxicity' },
  { drug1: 'warfarin', drug2: 'acetaminophen', severity: 'moderate', description: 'Increased warfarin effect' },
  { drug1: 'lithium', drug2: 'ibuprofen', severity: 'major', description: 'Lithium toxicity risk' },
  { drug1: 'clonidine', drug2: 'propranolol', severity: 'moderate', description: 'Risk of rebound hypertension' },
];

interface AllergyCheck {
  allergen: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe';
}

async function readJsonObject<T extends Record<string, unknown>>(c: { req: { json: <R = unknown>() => Promise<R> } }): Promise<T> {
  const body = await c.req.json<unknown>();
  if (typeof body === 'string') {
    return JSON.parse(body) as T;
  }
  return body as T;
}

/**
 * POST /api/cds/drug-interaction-check
 * Check for drug-drug interactions (Epic CDS pattern)
 */
cdsRoutes.post('/drug-interaction-check', async (c) => {
  const tenantId = requireTenantId(c);
  const { medications } = await readJsonObject<{ medications: string[] }>(c);

  if (!medications || medications.length < 2) {
    return c.json({ interactions: [], message: 'At least 2 medications required' });
  }

  const interactions: (DrugInteraction & { drugs: string[] })[] = [];

  // Check all pairs
  for (let i = 0; i < medications.length; i++) {
    for (let j = i + 1; j < medications.length; j++) {
      const med1 = medications[i].toLowerCase();
      const med2 = medications[j].toLowerCase();

      const interaction = DRUG_INTERACTIONS.find(
        (d) =>
          (d.drug1.includes(med1) && d.drug2.includes(med2)) ||
          (d.drug1.includes(med2) && d.drug2.includes(med1))
      );

      if (interaction) {
        interactions.push({ ...interaction, drugs: [medications[i], medications[j]] });
      }
    }
  }

  return c.json({
    interactions,
    severity: interactions.some((i) => i.severity === 'major')
      ? 'major'
      : interactions.some((i) => i.severity === 'moderate')
      ? 'moderate'
      : 'low',
    recommendation: interactions.length > 0
      ? 'Review drug interactions before prescribing. Consider alternatives or monitor closely.'
      : 'No known interactions detected.',
  });
});

/**
 * POST /api/cds/allergy-check
 * Check if patient has allergies to prescribed medications (Epic CDS pattern)
 */
cdsRoutes.post('/allergy-check', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, medications } = await readJsonObject<{ patientId: number; medications: string[] }>(c);

  if (!patientId || !medications || medications.length === 0) {
    throw new HTTPException(400, { message: 'patientId and medications required' });
  }

  try {
    // Verify patient exists
    const patientCheck = await db.$client.prepare(
      'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
    ).bind(patientId, tenantId).first<{ id: number }>();

    if (!patientCheck) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    // Get patient allergies
    const allergies = await db.$client.prepare(`
      SELECT allergen, reaction FROM allergies
      WHERE patient_id = ? AND tenant_id = ?
    `).bind(patientId, tenantId).all<AllergyCheck>();

    const alerts: (AllergyCheck & { medication: string; match: boolean })[] = [];

    medications.forEach((med) => {
      const medLower = med.toLowerCase();
      allergies.results?.forEach((allergy) => {
        const allergenLower = allergy.allergen.toLowerCase();
        // Simple match - in real system would use médical ontology
        if (medLower.includes(allergenLower) || allergenLower.includes(medLower)) {
          alerts.push({
            ...allergy,
            medication: med,
            match: true,
          });
        }
      });
    });

    return c.json({
      alerts,
      hasAlerts: alerts.length > 0,
      severity: alerts.some((a) => a.severity === 'severe')
        ? 'severe'
        : alerts.some((a) => a.severity === 'moderate')
        ? 'moderate'
        : 'low',
      recommendation: alerts.length > 0
        ? 'Patient has known allergies that may interact with prescribed medications. Review and consider alternatives.'
        : 'No allergy conflicts detected.',
    });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    console.error('[cds]', e);
    throw new HTTPException(500, { message: 'Failed to check allergies' });
  }
});

/**
 * GET /api/cds/dosing-guidance/:patientId
 * Get dosing guidance based on patient factors (Epic CDS pattern)
 */
cdsRoutes.get('/dosing-guidance/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const drug = c.req.query('drug') || '';
  const ageParam = c.req.query('age') || '';
  const weightParam = c.req.query('weight') || '';

  try {
    // Get patient info
    const patient = await db.$client.prepare(`
      SELECT date_of_birth, weight, kidney_function, liver_function
      FROM patients WHERE id = ? AND tenant_id = ?
    `).bind(patientId, tenantId).first<{
      date_of_birth: string;
      weight: number;
      kidney_function: string;
      liver_function: string;
    }>();

    if (!patient) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    const age = ageParam
      ? parseInt(ageParam)
      : patient.date_of_birth
      ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000))
      : 50;

    const weight = weightParam ? parseFloat(weightParam) : patient.weight || 70;

    const guidance: string[] = [];
    const warnings: string[] = [];

    // Age-based dosing
    if (age < 12) {
      warnings.push('Pediatric dosing required - verify weight-based calculations');
      guidance.push('Use pediatric formulation and weight-based dosing');
    } else if (age > 65) {
      guidance.push('Consider reduced initial dose due to age-related changes in metabolism');
      warnings.push('Elderly patient - monitor for adverse effects');
    }

    // Weight-based adjustments
    if (weight < 50) {
      guidance.push('Low body weight - consider dose reduction');
    }

    // Kidney function
    if (patient.kidney_function === 'impaired' || patient.kidney_function === 'failure') {
      warnings.push('Impaired renal function - adjust dose or extend interval');
      guidance.push('Use renal dosing guidelines - check creatinine clearance');
    }

    // Liver function
    if (patient.liver_function === 'impaired' || patient.liver_function === 'failure') {
      warnings.push('Impaired hepatic function - reduce dose');
      guidance.push('Monitor liver function tests regularly');
    }

    // Drug-specific warnings
    const drugLower = drug.toLowerCase();
    if (drugLower.includes('warfarin')) {
      guidance.push('Monitor INR closely - target 2-3 for most indications');
      warnings.push('High bleeding risk - avoid NSAIDs');
    }
    if (drugLower.includes('metformin')) {
      guidance.push('eGFR <30 - contraindicated');
      warnings.push('Risk of lactic acidosis');
    }
    if (drugLower.includes('nsaid')) {
      guidance.push('Avoid in heart failure, CKD, or on warfarin');
    }

    return c.json({
      patientAge: age,
      patientWeight: weight,
      kidneyFunction: patient.kidney_function,
      liverFunction: patient.liver_function,
      guidance,
      warnings,
      recommendation: warnings.length > 0
        ? 'Proceed with caution - review warnings and consider dose adjustments'
        : 'Standard dosing appropriate for this patient',
    });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    console.error('[cds]', e);
    throw new HTTPException(500, { message: 'Failed to get dosing guidance' });
  }
});

/**
 * GET /api/cds/clinical-alerts/:patientId
 * Get all clinical alerts for a patient (Epic CDS pattern)
 */
cdsRoutes.get('/clinical-alerts/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');

  try {
    const exists = await patientExists(c.env.DB, tenantId, Number(patientId));
    if (!exists) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    const alerts: { type: string; severity: 'low' | 'medium' | 'high'; message: string; recommendation: string }[] = [];

    // Check for missing vitals
    const recentVitals = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM vitals
      WHERE patient_id = ? AND tenant_id = ? AND measured_at >= datetime('now', '-48 hours')
    `).bind(patientId, tenantId).first<{ count: number }>();

    if (!recentVitals || recentVitals.count === 0) {
      alerts.push({
        type: 'vitals',
        severity: 'medium',
        message: 'No vitals recorded in last 48 hours',
        recommendation: 'Record vital signs at next visit',
      });
    }

    // Check for pending labs
    const pendingLabs = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM lab_orders
      WHERE patient_id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(patientId, tenantId).first<{ count: number }>();

    if (pendingLabs && pendingLabs.count > 0) {
      alerts.push({
        type: 'labs',
        severity: 'medium',
        message: `${pendingLabs.count} pending lab orders`,
        recommendation: 'Review and process pending lab orders',
      });
    }

    // Check for overdue follow-ups
    const overdueFollowUps = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM prescriptions
      WHERE patient_id = ? AND tenant_id = ? AND follow_up_date < date('now', '+6 hours') AND status = 'active'
    `).bind(patientId, tenantId).first<{ count: number }>();

    if (overdueFollowUps && overdueFollowUps.count > 0) {
      alerts.push({
        type: 'followup',
        severity: 'high',
        message: `${overdueFollowUps.count} overdue follow-up(s)`,
        recommendation: 'Contact patient to schedule follow-up appointment',
      });
    }

    // Check for multiple active medications
    const activeMeds = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM prescriptions
      WHERE patient_id = ? AND tenant_id = ? AND status = 'active'
    `).bind(patientId, tenantId).first<{ count: number }>();

    if (activeMeds && activeMeds.count > 10) {
      alerts.push({
        type: 'polypharmacy',
        severity: 'medium',
        message: `Patient on ${activeMeds.count} active medications`,
        recommendation: 'Review medication list for duplications and interactions',
      });
    }

    // Check for allergies
    const allergyCount = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM allergies
      WHERE patient_id = ? AND tenant_id = ?
    `).bind(patientId, tenantId).first<{ count: number }>();

    if (allergyCount && allergyCount.count > 0) {
      alerts.push({
        type: 'allergies',
        severity: 'low',
        message: `Patient has ${allergyCount.count} known allergies`,
        recommendation: 'Verify no allergins in prescribed medications',
      });
    }

    return c.json({
      alerts,
      alertCount: alerts.length,
      highPriorityCount: alerts.filter((a) => a.severity === 'high').length,
      recommendation: alerts.some((a) => a.severity === 'high')
        ? 'Address high-priority alerts before proceeding'
        : alerts.length > 0
        ? 'Review alerts and address as needed'
        : 'No clinical alerts at this time',
    });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    console.error('[cds]', e);
    throw new HTTPException(500, { message: 'Failed to get clinical alerts' });
  }
});

/**
 * Helper: Check if patient exists
 */
async function patientExists(db: D1Database, tenantId: string, patientId: number): Promise<boolean> {
  const result = await db.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ id: number }>();
  return result !== null;
}

export default cdsRoutes;
