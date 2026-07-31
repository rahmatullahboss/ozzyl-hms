import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import type { Env, Variables } from '../../types';

type CertificateEnv = { Bindings: Env; Variables: Variables };
type CertificateContext = Context<CertificateEnv>;
const doctorCertificateRoutes = new Hono<CertificateEnv>();

const createCertificateSchema = z.object({
  patientId: z.number().int().positive(),
  doctorId: z.number().int().positive().optional(),
  certificateType: z.enum(['medical', 'fitness', 'sick_leave', 'work_rest']),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  recommendation: z.string().trim().min(3).max(2000),
  restDays: z.number().int().min(0).max(365).optional(),
  purpose: z.string().trim().max(300).optional(),
});

const cancelCertificateSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

async function linkedDoctorId(c: CertificateContext): Promise<number> {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const doctor = await c.env.DB.prepare(
    'SELECT id FROM doctors WHERE tenant_id = ? AND user_id = ? AND is_active = 1 LIMIT 1',
  ).bind(tenantId, userId).first<{ id: number }>();
  if (!doctor) {
    throw new HTTPException(403, { message: 'No active doctor profile linked to this account' });
  }
  return Number(doctor.id);
}

doctorCertificateRoutes.use('*', requireRole('doctor', 'md', 'hospital_admin'));

doctorCertificateRoutes.get('/', async (c) => {
  const tenantId = String(requireTenantId(c));
  const role = c.get('role');
  const patientId = c.req.query('patientId');
  const values: Array<string | number> = [tenantId];
  let query = `
    SELECT dc.*, p.name AS patient_name, p.patient_code, d.name AS doctor_name, d.bmdc_reg_no
    FROM doctor_certificates dc
    LEFT JOIN patients p ON p.id = dc.patient_id AND p.tenant_id = dc.tenant_id
    LEFT JOIN doctors d ON d.id = dc.doctor_id AND d.tenant_id = dc.tenant_id
    WHERE dc.tenant_id = ?
  `;
  if (role === 'doctor') {
    query += ' AND dc.doctor_id = ?';
    values.push(await linkedDoctorId(c));
  }
  if (patientId) {
    query += ' AND dc.patient_id = ?';
    values.push(Number(patientId));
  }
  query += ' ORDER BY dc.created_at DESC LIMIT 100';
  const { results } = await c.env.DB.prepare(query).bind(...values).all();
  return c.json({ certificates: results ?? [] });
});

doctorCertificateRoutes.get('/:id', async (c) => {
  const tenantId = String(requireTenantId(c));
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: 'Invalid certificate id' });
  }
  const role = c.get('role');
  const values: Array<string | number> = [id, tenantId];
  let query = `
    SELECT dc.*, p.name AS patient_name, p.patient_code, p.gender, p.age,
           d.name AS doctor_name, d.specialty, d.qualifications, d.bmdc_reg_no
    FROM doctor_certificates dc
    LEFT JOIN patients p ON p.id = dc.patient_id AND p.tenant_id = dc.tenant_id
    LEFT JOIN doctors d ON d.id = dc.doctor_id AND d.tenant_id = dc.tenant_id
    WHERE dc.id = ? AND dc.tenant_id = ?
  `;
  if (role === 'doctor') {
    query += ' AND dc.doctor_id = ?';
    values.push(await linkedDoctorId(c));
  }
  const certificate = await c.env.DB.prepare(query).bind(...values).first();
  if (!certificate) throw new HTTPException(404, { message: 'Certificate not found' });
  return c.json({ certificate });
});

doctorCertificateRoutes.post(
  '/',
  requireRole('doctor', 'md', 'hospital_admin'),
  zValidator('json', createCertificateSchema),
  async (c) => {
    const tenantId = String(requireTenantId(c));
    const userId = String(requireUserId(c));
    const role = c.get('role');
    // Only the 'doctor' role is required to be linked to a doctors row.
    // md / hospital_admin act on behalf and may issue/cancel without a provider row.
    const doctorId = role === 'doctor' ? await linkedDoctorId(c) : null;
    const data = c.req.valid('json');
    if (doctorId === null) {
      // admin/md path: require an explicit doctorId in the payload
      if (typeof data.doctorId !== 'number') {
        throw new HTTPException(400, { message: 'doctorId is required for admin/md certificate issuance' });
      }
    }
    const finalDoctorId = doctorId ?? data.doctorId;
    const patient = await c.env.DB.prepare(
      'SELECT id FROM patients WHERE id = ? AND tenant_id = ? LIMIT 1',
    ).bind(data.patientId, tenantId).first<{ id: number }>();
    if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

    const certificateNo = `MED-${data.issueDate.slice(0, 4)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const result = await c.env.DB.prepare(`
      INSERT INTO doctor_certificates (
        tenant_id, patient_id, doctor_id, certificate_no, certificate_type,
        issue_date, valid_from, valid_until, recommendation, rest_days, purpose,
        status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'final', ?)
    `).bind(
      tenantId,
      data.patientId,
      finalDoctorId,
      certificateNo,
      data.certificateType,
      data.issueDate,
      data.validFrom ?? null,
      data.validUntil ?? null,
      data.recommendation,
      data.restDays ?? null,
      data.purpose ?? null,
      userId,
    ).run();
    const id = Number(result.meta.last_row_id);
    await createAuditLog(c.env, tenantId, userId, 'CREATE', 'doctor_certificates', id, null, {
      certificate_no: certificateNo,
      certificate_type: data.certificateType,
      status: 'final',
    });
    return c.json({ id, certificateNo, status: 'final' }, 201);
  },
);

doctorCertificateRoutes.post(
  '/:id/cancel',
  requireRole('doctor', 'md', 'hospital_admin'),
  zValidator('json', cancelCertificateSchema),
  async (c) => {
    const tenantId = String(requireTenantId(c));
    const userId = String(requireUserId(c));
    const role = c.get('role');
    const id = Number(c.req.param('id'));
    const { reason } = c.req.valid('json');

    // For 'doctor' role, scope the cancel to their own linked doctor row.
    // md / hospital_admin can cancel any certificate in the tenant.
    let doctorFilter = '';
    const values: Array<string | number> = [id, tenantId];
    if (role === 'doctor') {
      const linkedId = await linkedDoctorId(c);
      doctorFilter = ' AND doctor_id = ?';
      values.push(linkedId);
    }
    const existing = await c.env.DB.prepare(
      `SELECT id, status FROM doctor_certificates WHERE id = ? AND tenant_id = ?${doctorFilter} AND status = 'final'`,
    ).bind(...values).first<{ id: number; status: string }>();
    if (!existing) throw new HTTPException(404, { message: 'Final certificate not found' });

    const updateValues: Array<string | number> = [reason, userId];
    let updateFilter = 'id = ? AND tenant_id = ?';
    const updateWhereValues: Array<string | number> = [id, tenantId];
    if (role === 'doctor') {
      updateFilter += ' AND doctor_id = ?';
      updateWhereValues.push((await linkedDoctorId(c)));
    }
    updateValues.push(...updateWhereValues);
    updateFilter += " AND status = 'final'";

    await c.env.DB.prepare(`
      UPDATE doctor_certificates
      SET status = 'cancelled', cancellation_reason = ?, cancelled_at = datetime('now', '+6 hours'), cancelled_by = ?
      WHERE ${updateFilter}
    `).bind(...updateValues).run();
    await createAuditLog(c.env, tenantId, userId, 'CANCEL', 'doctor_certificates', id, existing, {
      status: 'cancelled',
      cancellation_recorded: true,
    });
    return c.json({ id, status: 'cancelled' });
  },
);

export default doctorCertificateRoutes;
