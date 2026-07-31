import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  createVaccineSchema,
  updateVaccineSchema,
  createPatientVaccinationSchema,
  updatePatientVaccinationSchema,
  vaccinationQuerySchema,
  vaccinationReportQuerySchema,
  dueVaccinationsQuerySchema,
} from '../../schemas/vaccination';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const vaccinationRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

// ─── Vaccine Catalog ──────────────────────────────────────────────────────

/** GET /api/vaccinations/vaccines — List vaccine catalog */
vaccinationRoutes.get('/vaccines', zValidator('query', vaccinationQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { search, is_active } = c.req.valid('query');
  const db = getDb(c.env.DB);

  let query = 'SELECT * FROM vaccine_master WHERE (tenant_id = ? OR tenant_id = 0)';
  const params: (string | number)[] = [tenantId];

  if (is_active !== undefined) {
    query += ' AND is_active = ?';
    params.push(is_active);
  }
  if (search) {
    query += ' AND (name LIKE ? OR code LIKE ? OR name_bn LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY name ASC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ vaccines: results });
});

/** GET /api/vaccinations/vaccines/:id — Get vaccine by ID */
vaccinationRoutes.get('/vaccines/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) throw new HTTPException(400, { message: 'Invalid vaccine ID' });

  const db = getDb(c.env.DB);
  const vaccine = await db.$client.prepare(
    'SELECT * FROM vaccine_master WHERE id = ? AND (tenant_id = ? OR tenant_id = 0)'
  ).bind(id, tenantId).first();
  if (!vaccine) throw new HTTPException(404, { message: 'Vaccine not found' });

  return c.json({ vaccine });
});

/** POST /api/vaccinations/vaccines — Create vaccine */
vaccinationRoutes.post('/vaccines', zValidator('json', createVaccineSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const db = getDb(c.env.DB);

  // Check for duplicate code
  const existing = await db.$client.prepare(
    'SELECT id FROM vaccine_master WHERE tenant_id = ? AND code = ?'
  ).bind(tenantId, data.code).first();
  if (existing) throw new HTTPException(409, { message: `Vaccine code "${data.code}" already exists` });

  const result = await db.$client.prepare(`
    INSERT INTO vaccine_master (tenant_id, code, name, name_bn, description, number_of_doses, dose_interval_days, target_age_group, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.code, data.name, data.name_bn ?? null,
    data.description ?? null, data.number_of_doses, data.dose_interval_days ?? null,
    data.target_age_group ?? null, data.is_active, userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Vaccine created' }, 201);
});

/** PUT /api/vaccinations/vaccines/:id — Update vaccine */
vaccinationRoutes.put('/vaccines/:id', zValidator('json', updateVaccineSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) throw new HTTPException(400, { message: 'Invalid vaccine ID' });

  const data = c.req.valid('json');
  const db = getDb(c.env.DB);

  const existing = await db.$client.prepare(
    'SELECT id FROM vaccine_master WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Vaccine not found' });

  // Check for duplicate code if changing
  if (data.code) {
    const dup = await db.$client.prepare(
      'SELECT id FROM vaccine_master WHERE tenant_id = ? AND code = ? AND id != ?'
    ).bind(tenantId, data.code, id).first();
    if (dup) throw new HTTPException(409, { message: `Vaccine code "${data.code}" already exists` });
  }

  const allowedFields = ['code', 'name', 'name_bn', 'description', 'number_of_doses', 'dose_interval_days', 'target_age_group', 'is_active'];
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (allowedFields.includes(key) && val !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(val ?? null);
    }
  }
  if (sets.length === 0) return c.json({ message: 'No fields to update' });

  sets.push("updated_at = datetime('now', '+6 hours')");
  vals.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE vaccine_master SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ message: 'Vaccine updated' });
});

/** DELETE /api/vaccinations/vaccines/:id — Soft-delete (deactivate) vaccine */
vaccinationRoutes.delete('/vaccines/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) throw new HTTPException(400, { message: 'Invalid vaccine ID' });

  const db = getDb(c.env.DB);
  const existing = await db.$client.prepare(
    'SELECT id FROM vaccine_master WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Vaccine not found' });

  await db.$client.prepare(
    "UPDATE vaccine_master SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();

  return c.json({ message: 'Vaccine deactivated' });
});

// ─── Patient Vaccination Records ──────────────────────────────────────────

/** GET /api/vaccinations/patient/:patientId — Patient's vaccination history */
vaccinationRoutes.get('/patient/:patientId', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  if (Number.isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  const db = getDb(c.env.DB);

  // Verify patient exists
  const patient = await db.$client.prepare(
    'SELECT id, name, date_of_birth, gender FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const { results } = await db.$client.prepare(`
    SELECT pv.*, vm.code AS vaccine_code, vm.name AS vaccine_name, vm.name_bn AS vaccine_name_bn,
           vm.number_of_doses AS total_doses
    FROM patient_vaccinations pv
    JOIN vaccine_master vm ON pv.vaccine_id = vm.id
    WHERE pv.tenant_id = ? AND pv.patient_id = ?
    ORDER BY pv.administered_date DESC
  `).bind(tenantId, patientId).all();

  return c.json({ patient, vaccinations: results });
});

/** POST /api/vaccinations — Record a vaccination */
vaccinationRoutes.post('/', zValidator('json', createPatientVaccinationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const db = getDb(c.env.DB);

  // Verify patient
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(data.patient_id, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // Verify vaccine and get dose info
  const vaccine = await db.$client.prepare(
    'SELECT id, number_of_doses, dose_interval_days FROM vaccine_master WHERE id = ? AND (tenant_id = ? OR tenant_id = 0)'
  ).bind(data.vaccine_id, tenantId).first<{ id: number; number_of_doses: number; dose_interval_days: number | null }>();
  if (!vaccine) throw new HTTPException(404, { message: 'Vaccine not found' });

  // Validate dose_number doesn't exceed vaccine's total doses
  if (data.dose_number > vaccine.number_of_doses) {
    throw new HTTPException(400, {
      message: `This vaccine only has ${vaccine.number_of_doses} dose(s). Cannot record dose ${data.dose_number}.`,
    });
  }

  // Check that previous dose exists (dose 2 needs dose 1 completed)
  if (data.dose_number > 1) {
    const prevDose = await db.$client.prepare(
      "SELECT id FROM patient_vaccinations WHERE tenant_id = ? AND patient_id = ? AND vaccine_id = ? AND dose_number = ? AND status = 'completed'"
    ).bind(tenantId, data.patient_id, data.vaccine_id, data.dose_number - 1).first();
    if (!prevDose) {
      throw new HTTPException(400, {
        message: `Dose ${data.dose_number - 1} must be completed before recording dose ${data.dose_number}.`,
      });
    }
  }

  // Check for duplicate (same patient + vaccine + dose_number that isn't cancelled)
  const duplicate = await db.$client.prepare(
    "SELECT id FROM patient_vaccinations WHERE tenant_id = ? AND patient_id = ? AND vaccine_id = ? AND dose_number = ? AND status != 'cancelled'"
  ).bind(tenantId, data.patient_id, data.vaccine_id, data.dose_number).first();
  if (duplicate) {
    throw new HTTPException(409, {
      message: `Dose ${data.dose_number} of this vaccine is already recorded for this patient.`,
    });
  }

  // Auto-calculate next_dose_date if not provided and more doses remain
  let nextDoseDate = data.next_dose_date ?? null;
  if (!nextDoseDate && data.status === 'completed' && data.dose_number < vaccine.number_of_doses && vaccine.dose_interval_days) {
    const adminDate = new Date(data.administered_date);
    adminDate.setDate(adminDate.getDate() + vaccine.dose_interval_days);
    nextDoseDate = adminDate.toISOString().split('T')[0];
  }

  const result = await db.$client.prepare(`
    INSERT INTO patient_vaccinations (
      tenant_id, patient_id, vaccine_id, dose_number, administered_date,
      administered_by, batch_number, manufacturer, route, administration_site,
      adverse_effects, remarks, next_dose_date, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.vaccine_id, data.dose_number, data.administered_date,
    data.administered_by ?? userId, data.batch_number ?? null, data.manufacturer ?? null,
    data.route ?? null, data.administration_site ?? null,
    data.adverse_effects ?? null, data.remarks ?? null,
    nextDoseDate, data.status, userId,
  ).run();

  // Auto-schedule next dose if completed and more doses remain
  if (data.status === 'completed' && data.dose_number < vaccine.number_of_doses && nextDoseDate) {
    // Create a 'scheduled' record for the next dose
    await db.$client.prepare(`
      INSERT OR IGNORE INTO patient_vaccinations (
        tenant_id, patient_id, vaccine_id, dose_number, administered_date,
        next_dose_date, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)
    `).bind(
      tenantId, data.patient_id, data.vaccine_id, data.dose_number + 1,
      nextDoseDate, null, userId,
    ).run();
  }

  return c.json({ id: result.meta.last_row_id, next_dose_date: nextDoseDate, message: 'Vaccination recorded' }, 201);
});

/** PUT /api/vaccinations/:id — Update vaccination record */
vaccinationRoutes.put('/:id', zValidator('json', updatePatientVaccinationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) throw new HTTPException(400, { message: 'Invalid vaccination ID' });

  const data = c.req.valid('json');
  const db = getDb(c.env.DB);

  const existing = await db.$client.prepare(
    'SELECT id FROM patient_vaccinations WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Vaccination record not found' });

  const allowedFields = [
    'vaccine_id', 'dose_number', 'administered_date', 'administered_by',
    'batch_number', 'manufacturer', 'route', 'administration_site',
    'adverse_effects', 'remarks', 'next_dose_date', 'status',
  ];
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (allowedFields.includes(key) && val !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(val ?? null);
    }
  }
  if (sets.length === 0) return c.json({ message: 'No fields to update' });

  sets.push("updated_at = datetime('now', '+6 hours')");
  vals.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE patient_vaccinations SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ message: 'Vaccination record updated' });
});

/** DELETE /api/vaccinations/:id — Delete vaccination record */
vaccinationRoutes.delete('/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) throw new HTTPException(400, { message: 'Invalid vaccination ID' });

  const db = getDb(c.env.DB);
  const existing = await db.$client.prepare(
    'SELECT id FROM patient_vaccinations WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Vaccination record not found' });

  await db.$client.prepare(
    'DELETE FROM patient_vaccinations WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();

  return c.json({ message: 'Vaccination record deleted' });
});

// ─── Reports ──────────────────────────────────────────────────────────────

/** GET /api/vaccinations/due — Due and overdue vaccinations */
vaccinationRoutes.get('/due', zValidator('query', dueVaccinationsQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { from_date, to_date, vaccine_id } = c.req.valid('query');
  const db = getDb(c.env.DB);

  // Auto-mark overdue: scheduled vaccinations past their next_dose_date → missed
  await db.$client.prepare(`
    UPDATE patient_vaccinations SET status = 'missed', updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND status = 'scheduled' AND next_dose_date < date('now', '+6 hours') AND next_dose_date IS NOT NULL
  `).bind(tenantId).run();

  let query = `
    SELECT pv.*, p.name AS patient_name, p.mobile AS patient_mobile, p.date_of_birth,
           vm.name AS vaccine_name, vm.name_bn AS vaccine_name_bn, vm.code AS vaccine_code
    FROM patient_vaccinations pv
    JOIN patients p ON pv.patient_id = p.id AND pv.tenant_id = p.tenant_id
    JOIN vaccine_master vm ON pv.vaccine_id = vm.id
    WHERE pv.tenant_id = ? AND pv.status IN ('scheduled', 'missed')
      AND pv.next_dose_date IS NOT NULL
  `;
  const params: (string | number)[] = [tenantId];

  if (from_date) {
    query += ' AND pv.next_dose_date >= ?';
    params.push(from_date);
  }
  if (to_date) {
    query += ' AND pv.next_dose_date <= ?';
    params.push(to_date);
  }
  if (vaccine_id) {
    query += ' AND pv.vaccine_id = ?';
    params.push(vaccine_id);
  }
  query += ' ORDER BY pv.next_dose_date ASC';

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Also get overdue count (next_dose_date < today and still scheduled)
  const overdueResult = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM patient_vaccinations
    WHERE tenant_id = ? AND status = 'scheduled' AND next_dose_date < date('now', '+6 hours') AND next_dose_date IS NOT NULL
  `).bind(tenantId).first<{ count: number }>();

  // Due today
  const dueTodayResult = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM patient_vaccinations
    WHERE tenant_id = ? AND status = 'scheduled' AND next_dose_date = date('now', '+6 hours')
  `).bind(tenantId).first<{ count: number }>();

  return c.json({
    records: results,
    stats: {
      total: results?.length ?? 0,
      overdue: overdueResult?.count ?? 0,
      due_today: dueTodayResult?.count ?? 0,
    },
  });
});

/** GET /api/vaccinations/report — Date range report */
vaccinationRoutes.get('/report', zValidator('query', vaccinationReportQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { from_date, to_date, vaccine_id, status } = c.req.valid('query');
  const db = getDb(c.env.DB);

  let query = `
    SELECT pv.*, p.name AS patient_name, p.mobile AS patient_mobile, p.gender, p.date_of_birth,
           vm.name AS vaccine_name, vm.code AS vaccine_code
    FROM patient_vaccinations pv
    JOIN patients p ON pv.patient_id = p.id AND pv.tenant_id = p.tenant_id
    JOIN vaccine_master vm ON pv.vaccine_id = vm.id
    WHERE pv.tenant_id = ? AND pv.administered_date BETWEEN ? AND ?
  `;
  const params: (string | number)[] = [tenantId, from_date, to_date];

  if (vaccine_id) {
    query += ' AND pv.vaccine_id = ?';
    params.push(vaccine_id);
  }
  if (status) {
    query += ' AND pv.status = ?';
    params.push(status);
  }
  query += ' ORDER BY pv.administered_date DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Summary stats
  const summaryResult = await db.$client.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN pv.status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN pv.status = 'missed' THEN 1 ELSE 0 END) as missed,
           COUNT(DISTINCT pv.patient_id) as unique_patients
    FROM patient_vaccinations pv
    WHERE pv.tenant_id = ? AND pv.administered_date BETWEEN ? AND ?
  `).bind(tenantId, from_date, to_date).first<{ total: number; completed: number; missed: number; unique_patients: number }>();

  return c.json({
    records: results,
    summary: summaryResult ?? { total: 0, completed: 0, missed: 0, unique_patients: 0 },
  });
});

/** GET /api/vaccinations/stats — Dashboard KPIs */
vaccinationRoutes.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  // Replaced Promise.all() with db.$client.batch() for dashboard stats.
  // Why: Promise.all() sends 5 separate HTTP network requests to Cloudflare D1.
  const batchResults = await db.$client.batch([
    db.$client.prepare('SELECT COUNT(*) as count FROM vaccine_master WHERE (tenant_id = ? OR tenant_id = 0) AND is_active = 1').bind(tenantId),
    db.$client.prepare('SELECT COUNT(*) as count FROM patient_vaccinations WHERE tenant_id = ?').bind(tenantId),
    db.$client.prepare("SELECT COUNT(*) as count FROM patient_vaccinations WHERE tenant_id = ? AND status = 'scheduled' AND next_dose_date = date('now', '+6 hours')").bind(tenantId),
    db.$client.prepare("SELECT COUNT(*) as count FROM patient_vaccinations WHERE tenant_id = ? AND status = 'scheduled' AND next_dose_date < date('now', '+6 hours') AND next_dose_date IS NOT NULL").bind(tenantId),
    db.$client.prepare("SELECT COUNT(*) as count FROM patient_vaccinations WHERE tenant_id = ? AND status = 'completed' AND administered_date >= date('now', 'start of month')").bind(tenantId),
  ]);

  const totalVaccines = batchResults[0]?.results?.[0] as { count: number } | undefined;
  const totalRecords = batchResults[1]?.results?.[0] as { count: number } | undefined;
  const dueToday = batchResults[2]?.results?.[0] as { count: number } | undefined;
  const overdue = batchResults[3]?.results?.[0] as { count: number } | undefined;
  const thisMonth = batchResults[4]?.results?.[0] as { count: number } | undefined;

  return c.json({
    total_vaccines: totalVaccines?.count ?? 0,
    total_records: totalRecords?.count ?? 0,
    due_today: dueToday?.count ?? 0,
    overdue: overdue?.count ?? 0,
    this_month: thisMonth?.count ?? 0,
  });
});

export default vaccinationRoutes;
