import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const predictiveRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/predictive/sepsis-risk/:patientId
 * Returns sepsis risk score based on vitals + labs (Epic Cogito pattern)
 */
predictiveRoutes.get('/sepsis-risk/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');

  try {
    // Verify patient exists - query with tenant isolation
    const patient = await db.$client.prepare(
      'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
    ).bind(patientId, tenantId).first<{ id: number }>();

    if (!patient) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    // Get latest vitals
    const vitals = await db.$client.prepare(`
      SELECT vital_type, value FROM vitals
      WHERE patient_id = ? AND tenant_id = ?
      ORDER BY measured_at DESC
      LIMIT 20
    `).bind(patientId, tenantId).all<{ vital_type: string; value: string }>();

    // Get recent lab results
    const labs = await db.$client.prepare(`
      SELECT lr.result, lo.test_name FROM lab_results lr
      JOIN lab_orders lo ON lr.order_id = lo.id
      WHERE lo.patient_id = ? AND lo.tenant_id = ?
      AND COALESCE(lr.result_status, '') <> 'retracted'
      AND lr.created_at >= datetime('now', '-24 hours')
      ORDER BY lr.created_at DESC
      LIMIT 10
    `).bind(patientId, tenantId).all<{ result: string; test_name: string }>();

    // Calculate sepsis risk score (simplified SIRS criteria)
    let sepsisScore = 0;
    const riskFactors: string[] = [];
    const vitalsMap: Record<string, number> = {};

    vitals.results?.forEach(v => {
      vitalsMap[v.vital_type] = parseFloat(v.value) || 0;
    });

    // Temperature <36 or >38
    if (vitalsMap['temperature']) {
      if (vitalsMap['temperature'] < 36 || vitalsMap['temperature'] > 38) {
        sepsisScore++;
        riskFactors.push(`Temperature: ${vitalsMap['temperature']}°C`);
      }
    }

    // Heart rate >90
    if (vitalsMap['heart_rate'] && vitalsMap['heart_rate'] > 90) {
      sepsisScore++;
      riskFactors.push(`HR: ${vitalsMap['heart_rate']} bpm`);
    }

    // Respiratory rate >20
    if (vitalsMap['respiratory_rate'] && vitalsMap['respiratory_rate'] > 20) {
      sepsisScore++;
      riskFactors.push(`RR: ${vitalsMap['respiratory_rate']}/min`);
    }

    // WBC >12,000 or <4,000
    const wbc = labs.results?.find(l => l.test_name.toLowerCase().includes('white blood cell'));
    if (wbc && (parseFloat(wbc.result) > 12 || parseFloat(wbc.result) < 4)) {
      sepsisScore++;
      riskFactors.push(`WBC: ${wbc.result}`);
    }

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (sepsisScore >= 3) riskLevel = 'high';
    else if (sepsisScore >= 2) riskLevel = 'medium';

    return c.json({
      sepsisScore,
      riskLevel,
      riskFactors,
      vitalsChecked: Object.keys(vitalsMap).length,
      recommendation: riskLevel === 'high'
        ? 'URGENT: Consider sepsis protocol, blood cultures, broad-spectrum antibiotics'
        : riskLevel === 'medium'
        ? 'Monitor closely, consider labs, watch for deterioration'
        : 'Low risk, continue routine monitoring',
    });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    console.error('[predictive-analytics]', e);
    throw new HTTPException(500, { message: 'Failed to calculate sepsis risk' });
  }
});

/**
 * GET /api/predictive/los-prediction/:patientId
 * Predicts Length of Stay based on patient data (Epic Cogito pattern)
 */
predictiveRoutes.get('/los-prediction/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');

  try {
    // Get patient age, comorbidities, past LOS
    const patient = await db.$client.prepare(`
      SELECT date_of_birth, gender FROM patients
      WHERE id = ? AND tenant_id = ?
    `).bind(patientId, tenantId).first<{ date_of_birth: string; gender: string }>();

    if (!patient) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    // Count active diagnoses
    const diagnosisCount = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM diagnoses
      WHERE patient_id = ? AND tenant_id = ?
    `).bind(patientId, tenantId).first<{ count: number }>();

    // Count active medications
    const medCount = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM prescriptions
      WHERE patient_id = ? AND tenant_id = ? AND status = 'active'
    `).bind(patientId, tenantId).first<{ count: number }>();

    // Simple LOS prediction model
    const age = patient.date_of_birth
      ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000))
      : 50;

    let predictedLOS = 3; // base

    if (age > 65) predictedLOS += 2;
    if ((diagnosisCount?.count ?? 0) > 2) predictedLOS += 1;
    if ((medCount?.count ?? 0) > 5) predictedLOS += 1;
    if (patient.gender === 'Female') predictedLOS -= 0.5;

    return c.json({
      predictedLOS: Math.max(1, Math.round(predictedLOS)),
      factors: {
        age,
        diagnosisCount: diagnosisCount?.count || 0,
        activeMeds: medCount?.count || 0,
        gender: patient.gender,
      },
      confidence: 'medium',
      recommendation: `Expected LOS: ${Math.max(1, Math.round(predictedLOS))} days. Monitor for early discharge readiness.`,
    });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    console.error('[predictive-analytics]', e);
    throw new HTTPException(500, { message: 'Failed to predict LOS' });
  }
});

/**
 * GET /api/predictive/patient-risk/:patientId
 * Comprehensive risk assessment (Epic Cogito pattern)
 */
predictiveRoutes.get('/patient-risk/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');

  try {
    // Verify patient exists
    const patient = await db.$client.prepare(
      'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
    ).bind(patientId, tenantId).first<{ id: number }>();

    if (!patient) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    // Get recent vitals trend
    const vitalsTrend = await db.$client.prepare(`
      SELECT vital_type, value, measured_at FROM vitals
      WHERE patient_id = ? AND tenant_id = ?
      AND measured_at >= datetime('now', '-7 days')
      ORDER BY measured_at DESC
    `).bind(patientId, tenantId).all<{ vital_type: string; value: string; measured_at: string }>();

    // Get pending labs
    const pendingLabs = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM lab_orders
      WHERE patient_id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(patientId, tenantId).first<{ count: number }>();

    // Get recent admissions
    const recentAdmissions = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM admissions
      WHERE patient_id = ? AND tenant_id = ?
      AND admission_date >= datetime('now', '-90 days')
    `).bind(patientId, tenantId).first<{ count: number }>();

    // Calculate risk score
    let riskScore = 0;
    if ((pendingLabs?.count ?? 0) > 0) riskScore += 1;
    if ((recentAdmissions?.count ?? 0) > 0) riskScore += 2;

    // Check vital stability
    const vitalTypes = new Set(vitalsTrend.results?.map(v => v.vital_type));
    if (vitalTypes.size < 3) riskScore += 1; // Not monitoring enough vitals

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (riskScore >= 3) riskLevel = 'high';
    else if (riskScore >= 1) riskLevel = 'medium';

    return c.json({
      riskScore,
      riskLevel,
      pendingLabs: pendingLabs?.count || 0,
      recentAdmissions: recentAdmissions?.count || 0,
      vitalsMonitored: vitalTypes.size,
      recommendation: riskLevel === 'high'
        ? 'High risk: Coordinate care, review treatment plan, consider specialist referral'
        : riskLevel === 'medium'
        ? 'Medium risk: Monitor closely, ensure follow-up scheduled'
        : 'Low risk: Continue routine care',
    });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    console.error('[predictive-analytics]', e);
    throw new HTTPException(500, { message: 'Failed to assess risk' });
  }
});

export default predictiveRoutes;
