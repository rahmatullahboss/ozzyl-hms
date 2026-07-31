import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../../types';
import { requireTenantId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

const generateSchema = z.object({
  ward: z.string().min(1),
  shift: z.enum(['morning', 'evening', 'night']),
});

export const aiHandoverRoutes = new Hono<NursingEnv>();

aiHandoverRoutes.post('/generate', zValidator('json', generateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { ward, shift } = c.req.valid('json');

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const shiftLabel = shift.charAt(0).toUpperCase() + shift.slice(1);

  // 1. Critical patients (abnormal vitals in last 4h)
  const criticalPatients = await db.$client.prepare(`
    SELECT p.name, b.bed_number, v.systolic, v.diastolic, v.heart_rate, v.spo2, v.temperature
    FROM patient_vitals v
    JOIN patients p ON p.id = v.patient_id AND p.tenant_id = v.tenant_id
    JOIN admissions a ON a.patient_id = v.patient_id AND a.tenant_id = v.tenant_id AND a.status = 'admitted'
    LEFT JOIN beds b ON b.id = a.bed_id
    WHERE v.tenant_id = ?
      AND v.recorded_at >= datetime('now', '-4 hours')
      AND (
        (v.systolic IS NOT NULL AND (v.systolic > 180 OR v.systolic < 90))
        OR (v.diastolic IS NOT NULL AND (v.diastolic > 120 OR v.diastolic < 60))
        OR (v.heart_rate IS NOT NULL AND (v.heart_rate > 120 OR v.heart_rate < 50))
        OR (v.spo2 IS NOT NULL AND v.spo2 < 90)
        OR (v.temperature IS NOT NULL AND (v.temperature > 103 OR v.temperature < 95))
      )
    GROUP BY v.patient_id
    ORDER BY v.recorded_at DESC
    LIMIT 10
  `).bind(tenantId).all<{ name: string; bed_number: string | null; systolic: number | null; diastolic: number | null; heart_rate: number | null; spo2: number | null; temperature: number | null }>();

  // 2. Pending medications (due but not administered)
  const pendingMeds = await db.$client.prepare(`
    SELECT p.name, m.medication_name, m.scheduled_time
    FROM nur_medication_admin m
    JOIN patients p ON p.id = m.patient_id AND p.tenant_id = m.tenant_id
    JOIN admissions a ON a.patient_id = m.patient_id AND a.tenant_id = m.tenant_id AND a.status = 'admitted'
    WHERE m.tenant_id = ?
      AND m.status = 'pending'
      AND m.scheduled_time <= datetime('now', '+2 hours')
    ORDER BY m.scheduled_time ASC
    LIMIT 15
  `).bind(tenantId).all<{ name: string; medication_name: string; scheduled_time: string }>();

  // 3. Pending doctor orders
  const pendingOrders = await db.$client.prepare(`
    SELECT p.name, o.order_description
    FROM nur_orders o
    JOIN patients p ON p.id = o.patient_id AND p.tenant_id = o.tenant_id
    JOIN admissions a ON a.patient_id = o.patient_id AND a.tenant_id = o.tenant_id AND a.status = 'admitted'
    WHERE o.tenant_id = ?
      AND o.status = 'pending'
    ORDER BY o.created_at DESC
    LIMIT 10
  `).bind(tenantId).all<{ name: string; order_description: string }>();

  // 4. New admissions (today)
  const newAdmissions = await db.$client.prepare(`
    SELECT p.name, b.bed_number, a.admission_date
    FROM admissions a
    JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id
    WHERE a.tenant_id = ?
      AND a.status = 'admitted'
      AND a.admission_date >= date('now')
    ORDER BY a.admission_date DESC
    LIMIT 10
  `).bind(tenantId).all<{ name: string; bed_number: string | null; admission_date: string }>();

  // 5. Discharge planned patients
  const dischargePlanned = await db.$client.prepare(`
    SELECT p.name, b.bed_number
    FROM admissions a
    JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id
    WHERE a.tenant_id = ?
      AND a.status = 'admitted'
      AND a.discharge_date IS NOT NULL
    ORDER BY a.discharge_date ASC
    LIMIT 10
  `).bind(tenantId).all<{ name: string; bed_number: string | null }>();

  // 6. Fall risk / isolation patients
  const specialPatients = await db.$client.prepare(`
    SELECT p.name, b.bed_number,
      CASE
        WHEN cp.risk_level = 'high' THEN 'fall_risk'
        WHEN cp.isolation_type IS NOT NULL THEN 'isolation'
        ELSE 'other'
      END AS flag_type,
      cp.isolation_type
    FROM care_plans cp
    JOIN patients p ON p.id = cp.patient_id AND p.tenant_id = cp.tenant_id
    JOIN admissions a ON a.patient_id = cp.patient_id AND a.tenant_id = cp.tenant_id AND a.status = 'admitted'
    LEFT JOIN beds b ON b.id = a.bed_id
    WHERE cp.tenant_id = ?
      AND cp.status = 'active'
      AND (cp.risk_level = 'high' OR cp.isolation_type IS NOT NULL)
    GROUP BY cp.patient_id
    LIMIT 10
  `).bind(tenantId).all<{ name: string; bed_number: string | null; flag_type: string; isolation_type: string | null }>();

  // Build summary
  const lines: string[] = [];
  lines.push(`SHIFT HANDOVER SUMMARY - ${ward} - ${dateStr}`);
  lines.push('='.repeat(50));
  lines.push(`Shift: ${shiftLabel}`);
  lines.push('');

  // Critical Alerts
  lines.push('CRITICAL ALERTS:');
  if (criticalPatients.results.length === 0) {
    lines.push('  None');
  } else {
    for (const p of criticalPatients.results) {
      const bed = p.bed_number ? ` (Bed ${p.bed_number})` : '';
      const issues: string[] = [];
      if (p.systolic && p.systolic > 180) issues.push(`High BP: ${p.systolic}`);
      if (p.systolic && p.systolic < 90) issues.push(`Low BP: ${p.systolic}`);
      if (p.heart_rate && p.heart_rate > 120) issues.push(`High HR: ${p.heart_rate}`);
      if (p.heart_rate && p.heart_rate < 50) issues.push(`Low HR: ${p.heart_rate}`);
      if (p.spo2 && p.spo2 < 90) issues.push(`Low SpO2: ${p.spo2}%`);
      if (p.temperature && p.temperature > 103) issues.push(`High Temp: ${p.temperature}°F`);
      if (p.temperature && p.temperature < 95) issues.push(`Low Temp: ${p.temperature}°F`);
      lines.push(`  - ${p.name}${bed}: ${issues.join(', ')}`);
    }
  }
  lines.push('');

  // Pending Medications
  lines.push('PENDING MEDICATIONS:');
  if (pendingMeds.results.length === 0) {
    lines.push('  None');
  } else {
    for (const m of pendingMeds.results) {
      const time = m.scheduled_time ? ` due at ${m.scheduled_time}` : '';
      lines.push(`  - ${m.name}: ${m.medication_name}${time}`);
    }
  }
  lines.push('');

  // Pending Orders
  lines.push('PENDING ORDERS:');
  if (pendingOrders.results.length === 0) {
    lines.push('  None');
  } else {
    for (const o of pendingOrders.results) {
      lines.push(`  - ${o.name}: ${o.order_description}`);
    }
  }
  lines.push('');

  // New Admissions
  lines.push('NEW ADMISSIONS:');
  if (newAdmissions.results.length === 0) {
    lines.push('  None');
  } else {
    for (const a of newAdmissions.results) {
      const bed = a.bed_number ? ` to Bed ${a.bed_number}` : '';
      lines.push(`  - ${a.name} admitted${bed}`);
    }
  }
  lines.push('');

  // Discharge Planned
  lines.push('DISCHARGE PLANNED:');
  if (dischargePlanned.results.length === 0) {
    lines.push('  None');
  } else {
    for (const d of dischargePlanned.results) {
      const bed = d.bed_number ? ` (Bed ${d.bed_number})` : '';
      lines.push(`  - ${d.name}${bed} - pending clearance`);
    }
  }
  lines.push('');

  // Special Notes
  lines.push('SPECIAL NOTES:');
  const fallRisk = specialPatients.results.filter(p => p.flag_type === 'fall_risk');
  const isolation = specialPatients.results.filter(p => p.flag_type === 'isolation');

  if (fallRisk.length > 0) {
    lines.push('  Fall Risk:');
    for (const p of fallRisk) {
      const bed = p.bed_number ? ` (Bed ${p.bed_number})` : '';
      lines.push(`    - ${p.name}${bed}`);
    }
  }

  if (isolation.length > 0) {
    lines.push('  Isolation:');
    for (const p of isolation) {
      const bed = p.bed_number ? ` (Bed ${p.bed_number})` : '';
      const type = p.isolation_type ? ` (${p.isolation_type})` : '';
      lines.push(`    - ${p.name}${bed}${type}`);
    }
  }

  if (fallRisk.length === 0 && isolation.length === 0) {
    lines.push('  None');
  }

  return c.json({ summary: lines.join('\n') });
});
