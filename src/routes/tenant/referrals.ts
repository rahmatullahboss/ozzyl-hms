import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireRole } from '../../middleware/rbac';
import type { Env, Variables } from '../../types';
import { getNextSequence } from '../../lib/sequence';
import {
  buildLocalSyncOutboxStatement,
  buildLocalSyncPatientCreateOutboxStatement,
} from '../../lib/local-sync-outbox';
import { buildLocalSyncPatientPayload } from '../../lib/local-sync-patient-payload';

const referralRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function buildReferralHealthLinkOutboxStatement(env: Env, input: {
  tenantId: string;
  patientId: number;
  uhid: string;
  nationalId?: string | null;
  hospitalName?: string | null;
}): Promise<D1PreparedStatement | null> {
  return buildLocalSyncOutboxStatement(env, {
    tenantId: input.tenantId,
    entityType: 'patient_health_links',
    entityId: `${input.tenantId}:${input.patientId}:${input.uhid}`,
    operation: 'upsert',
    payload: {
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      uhid: input.uhid,
      national_id: input.nationalId ?? input.uhid,
      hospital_name: input.hospitalName ?? null,
    },
  });
}

referralRoutes.use('*', requireRole('doctor', 'md', 'hospital_admin'));

// ─── POST /api/v1/referrals ─ Create a cross-hospital referral ─────────────
referralRoutes.post('/', async (c) => {
  const fromTenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const body = await c.req.json<{
    to_tenant_id: string;
    patient_global_id: string;
    from_local_patient_id?: number;
    referring_doctor_id?: number;
    receiving_doctor_id?: number;
    urgency?: 'routine' | 'urgent' | 'emergency';
    reason?: string;
    clinical_notes?: string;
    documents?: Array<{
      document_type: string;
      title?: string;
      storage_key?: string;
      document_url?: string;
    }>;
  }>();

  if (!body.to_tenant_id || !body.patient_global_id) {
    throw new HTTPException(400, { message: 'to_tenant_id and patient_global_id required' });
  }

  if (body.to_tenant_id === fromTenantId) {
    throw new HTTPException(400, { message: 'Cannot refer to same hospital' });
  }

  try {
    // Verify receiving hospital exists
    const receivingHospital = await c.env.DB.prepare(
      `SELECT id, name FROM tenants WHERE id = ? AND is_published = 1`
    ).bind(body.to_tenant_id).first<{ id: string; name: string }>();

    if (!receivingHospital) {
      throw new HTTPException(404, { message: 'Receiving hospital not found or not published' });
    }

    // Verify patient identity exists
    const patientIdentity = await c.env.DB.prepare(
      `SELECT primary_name FROM global_patient_identity WHERE uhid = ?`
    ).bind(body.patient_global_id).first<{ primary_name: string }>();

    if (!patientIdentity) {
      throw new HTTPException(404, { message: 'Patient identity not found' });
    }

    let referringDoctorId = body.referring_doctor_id ?? null;
    if (c.get('role') === 'doctor' || c.get('role') === 'md') {
      const linkedDoctor = await c.env.DB.prepare(
        'SELECT id FROM doctors WHERE tenant_id = ? AND user_id = ? AND is_active = 1 LIMIT 1',
      ).bind(fromTenantId, userId).first<{ id: number }>();
      if (!linkedDoctor) {
        throw new HTTPException(403, { message: 'No active doctor profile linked to this account' });
      }
      referringDoctorId = Number(linkedDoctor.id);
    } else if (referringDoctorId) {
      const referringDoctor = await c.env.DB.prepare(
        'SELECT id FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1',
      ).bind(referringDoctorId, fromTenantId).first<{ id: number }>();
      if (!referringDoctor) {
        throw new HTTPException(400, { message: 'Referring doctor is not active in this hospital' });
      }
    }

    const receivingDoctorId = body.receiving_doctor_id ?? null;
    if (receivingDoctorId) {
      const receivingDoctor = await c.env.DB.prepare(
        'SELECT id FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1',
      ).bind(receivingDoctorId, body.to_tenant_id).first<{ id: number }>();
      if (!receivingDoctor) {
        throw new HTTPException(400, { message: 'Receiving doctor is not active in the receiving hospital' });
      }
    }

    // Create referral
    const result = await c.env.DB.prepare(`
      INSERT INTO cross_hospital_referrals
        (from_tenant_id, to_tenant_id, patient_global_id, from_local_patient_id,
         referring_doctor_id, receiving_doctor_id, urgency, reason, clinical_notes, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '+6 hours'))
    `).bind(
      fromTenantId, body.to_tenant_id, body.patient_global_id,
      body.from_local_patient_id ?? null, referringDoctorId,
      receivingDoctorId, body.urgency ?? 'routine',
      body.reason ?? null, body.clinical_notes ?? null,
    ).run();

    const referralId = result.meta.last_row_id;

    // Attach documents if provided
    if (body.documents && body.documents.length > 0) {
      for (const doc of body.documents) {
        await c.env.DB.prepare(`
          INSERT INTO referral_documents (referral_id, document_type, title, storage_key, document_url, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now', '+6 hours'))
        `).bind(referralId, doc.document_type, doc.title ?? null, doc.storage_key ?? null, doc.document_url ?? null).run();
      }
    }

    void createAuditLog(c.env, fromTenantId, userId, 'CREATE', 'cross_hospital_referrals', referralId, null, {
      action: 'create_referral', to_tenant_id: body.to_tenant_id, urgency: body.urgency ?? 'routine',
    });

    return c.json({ message: 'Referral created', referral_id: referralId }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to create referral' });
  }
});

// ─── GET /api/v1/referrals ─ List referrals (sent or received) ─────────────
referralRoutes.get('/', async (c) => {
  const tenantId = String(requireTenantId(c));
  const { direction = 'incoming', status, page = '1', limit = '20' } = c.req.query();
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const isIncoming = direction === 'incoming';

    let query = `
      SELECT
        r.id,
        r.from_tenant_id,
        r.to_tenant_id,
        r.patient_global_id,
        r.from_local_patient_id,
        r.to_local_patient_id,
        r.referring_doctor_id,
        r.receiving_doctor_id,
        r.urgency,
        r.reason,
        r.clinical_notes,
        r.status,
        r.decline_reason,
        r.accepted_at,
        r.completed_at,
        r.created_at,
        r.updated_at,
        from_t.name as from_hospital_name,
        to_t.name as to_hospital_name,
        g.primary_name as patient_name,
        g.primary_phone as patient_phone,
        g.date_of_birth as patient_dob,
        g.gender as patient_gender,
        g.blood_group as patient_blood_group,
        rd.name as referring_doctor_name,
        rc.name as receiving_doctor_name
      FROM cross_hospital_referrals r
      LEFT JOIN tenants from_t ON from_t.id = r.from_tenant_id
      LEFT JOIN tenants to_t ON to_t.id = r.to_tenant_id
      LEFT JOIN global_patient_identity g ON g.uhid = r.patient_global_id
      LEFT JOIN doctors rd ON rd.id = r.referring_doctor_id AND rd.tenant_id = r.from_tenant_id
      LEFT JOIN doctors rc ON rc.id = r.receiving_doctor_id AND rc.tenant_id = r.to_tenant_id
      WHERE ${isIncoming ? 'r.to_tenant_id = ?' : 'r.from_tenant_id = ?'}
    `;
    const binds: (string | number)[] = [tenantId];

    if (status) { query += ' AND r.status = ?'; binds.push(status); }

    query += ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
    binds.push(Number(limit), offset);

    const { results } = await c.env.DB.prepare(query).bind(...binds).all();

    // Count total
    let countQuery = `SELECT COUNT(*) as total FROM cross_hospital_referrals WHERE ${isIncoming ? 'to_tenant_id = ?' : 'from_tenant_id = ?'}`;
    const countBinds: (string | number)[] = [tenantId];
    if (status) { countQuery += ' AND status = ?'; countBinds.push(status); }

    const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first<{ total: number }>();

    // Fetch documents for each referral
    const referralIds = (results as any[]).map(r => r.id);
    let documents: Record<number, any[]> = {};
    if (referralIds.length > 0) {
      const placeholders = referralIds.map(() => '?').join(',');
      const docResults = await c.env.DB.prepare(
        `SELECT * FROM referral_documents WHERE referral_id IN (${placeholders})`
      ).bind(...referralIds).all();
      for (const doc of (docResults.results ?? [])) {
        const rid = (doc as any).referral_id;
        if (!documents[rid]) documents[rid] = [];
        documents[rid].push(doc);
      }
    }

    return c.json({
      data: (results as any[]).map(r => ({ ...r, documents: documents[r.id] ?? [] })),
      pagination: { page: Number(page), limit: Number(limit), total: countResult?.total ?? 0 },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch referrals' });
  }
});

// ─── GET /api/v1/referrals/:id ─ Single referral details ───────────────────
referralRoutes.get('/:id', async (c) => {
  const tenantId = String(requireTenantId(c));
  const referralId = Number(c.req.param('id'));

  try {
    const referral = await c.env.DB.prepare(`
      SELECT
        r.*,
        from_t.name as from_hospital_name,
        to_t.name as to_hospital_name,
        g.primary_name as patient_name,
        g.primary_phone as patient_phone,
        g.date_of_birth as patient_dob,
        g.gender as patient_gender,
        g.blood_group as patient_blood_group,
        g.national_id as patient_national_id,
        rd.name as referring_doctor_name,
        rc.name as receiving_doctor_name
      FROM cross_hospital_referrals r
      LEFT JOIN tenants from_t ON from_t.id = r.from_tenant_id
      LEFT JOIN tenants to_t ON to_t.id = r.to_tenant_id
      LEFT JOIN global_patient_identity g ON g.uhid = r.patient_global_id
      LEFT JOIN doctors rd ON rd.id = r.referring_doctor_id AND rd.tenant_id = r.from_tenant_id
      LEFT JOIN doctors rc ON rc.id = r.receiving_doctor_id AND rc.tenant_id = r.to_tenant_id
      WHERE r.id = ? AND (r.from_tenant_id = ? OR r.to_tenant_id = ?)
    `).bind(referralId, tenantId, tenantId).first();

    if (!referral) throw new HTTPException(404, { message: 'Referral not found' });

    const docs = await c.env.DB.prepare(
      `SELECT * FROM referral_documents WHERE referral_id = ?`
    ).bind(referralId).all();

    return c.json({ data: { ...referral, documents: docs.results ?? [] } });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch referral' });
  }
});

// ─── PUT /api/v1/referrals/:id/status ─ Update referral status ─────────────
referralRoutes.put('/:id/status', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const referralId = Number(c.req.param('id'));
  const body = await c.req.json<{
    status: 'accepted' | 'declined' | 'completed' | 'cancelled';
    decline_reason?: string;
  }>();

  const validStatuses = ['accepted', 'declined', 'completed', 'cancelled'];
  if (!body.status || !validStatuses.includes(body.status)) {
    throw new HTTPException(400, { message: 'Invalid status' });
  }

  try {
    const referral = await c.env.DB.prepare(
      `SELECT * FROM cross_hospital_referrals WHERE id = ?`
    ).bind(referralId).first<Record<string, unknown>>();

    if (!referral) throw new HTTPException(404, { message: 'Referral not found' });

    const isSender = referral.from_tenant_id === tenantId;
    const isReceiver = referral.to_tenant_id === tenantId;

    if (!isSender && !isReceiver) {
      throw new HTTPException(403, { message: 'Not authorized' });
    }

    // Status transition rules
    const currentStatus = String(referral.status);
    const allowedTransitions: Record<string, string[]> = {
      pending: ['accepted', 'declined', 'cancelled'],
      accepted: ['accepted', 'completed', 'cancelled'],
      declined: [],
      completed: [],
      cancelled: [],
    };

    if (!allowedTransitions[currentStatus]?.includes(body.status)) {
      throw new HTTPException(400, { message: `Cannot transition from ${currentStatus} to ${body.status}` });
    }

    // Only receiver can accept/decline; only sender can cancel from pending
    if ((body.status === 'accepted' || body.status === 'declined') && !isReceiver) {
      throw new HTTPException(403, { message: 'Only receiving hospital can accept or decline' });
    }
    if (body.status === 'cancelled' && currentStatus === 'accepted' && !isReceiver && !isSender) {
      throw new HTTPException(403, { message: 'Not authorized to cancel' });
    }

    // Build the status mutation first, but do not execute acceptance until
    // patient linkage is ready. D1 batch then commits the full acceptance
    // state atomically.
    const sets: string[] = ['status = ?', 'updated_at = datetime(\'now\')'];
    const binds: (string | number | null)[] = [body.status];

    if (body.status === 'accepted') {
      sets.push('accepted_at = datetime(\'now\')');
    }
    if (body.status === 'completed') {
      sets.push('completed_at = datetime(\'now\')');
    }
    if (body.status === 'declined' && body.decline_reason) {
      sets.push('decline_reason = ?');
      binds.push(body.decline_reason);
    }

    binds.push(referralId);
    const statusUpdateStatement = c.env.DB.prepare(
      `UPDATE cross_hospital_referrals SET ${sets.join(', ')} WHERE id = ?`
    ).bind(...binds);

    if (body.status === 'accepted') {
      const patientUhid = String(referral.patient_global_id ?? '').trim();
      if (!patientUhid) {
        throw new HTTPException(409, { message: 'Referral has no global patient identity' });
      }

      const existingLink = await c.env.DB.prepare(`
        SELECT patient_id, national_id, hospital_name
        FROM patient_health_links
        WHERE uhid = ? AND tenant_id = ? AND is_active = 1
        ORDER BY id ASC
        LIMIT 1
      `).bind(patientUhid, tenantId).first<{
        patient_id: number;
        national_id: string | null;
        hospital_name: string | null;
      }>();

      if (existingLink?.patient_id) {
        const attachExistingPatientStatement = c.env.DB.prepare(`
          UPDATE cross_hospital_referrals
          SET to_local_patient_id = ?
          WHERE id = ?
        `).bind(existingLink.patient_id, referralId);
        const existingLinkStatements: D1PreparedStatement[] = [
          statusUpdateStatement,
          attachExistingPatientStatement,
        ];
        const healthLinkOutbox = await buildReferralHealthLinkOutboxStatement(c.env, {
          tenantId,
          patientId: existingLink.patient_id,
          uhid: patientUhid,
          nationalId: existingLink.national_id,
          hospitalName: existingLink.hospital_name,
        });
        if (healthLinkOutbox) existingLinkStatements.push(healthLinkOutbox);
        await c.env.DB.batch(existingLinkStatements);
      } else {
        const identity = await c.env.DB.prepare(`
          SELECT id, uhid, primary_name, primary_phone, primary_email,
                 national_id, blood_group, date_of_birth, gender
          FROM global_patient_identity
          WHERE uhid = ?
          LIMIT 1
        `).bind(patientUhid).first<Record<string, unknown>>();
        if (!identity) {
          throw new HTTPException(409, { message: 'Global patient identity is unavailable for referral acceptance' });
        }

        const patientCode = await getNextSequence(c.env.DB, tenantId, 'patient', 'P');
        const patientName = typeof identity.primary_name === 'string' && identity.primary_name.trim()
          ? identity.primary_name.trim()
          : 'UNKNOWN';
        const identityNationalId = typeof identity.national_id === 'string' && identity.national_id.trim()
          ? identity.national_id.trim()
          : null;
        const healthLinkNationalId = identityNationalId ?? patientUhid;
        const hospital = await c.env.DB.prepare(
          'SELECT name FROM tenants WHERE id = ?'
        ).bind(tenantId).first<{ name: string | null }>();
        const patientPayload = buildLocalSyncPatientPayload({
          tenantId,
          name: patientName,
          fatherHusband: '',
          address: '',
          mobile: typeof identity.primary_phone === 'string' ? identity.primary_phone : null,
          email: typeof identity.primary_email === 'string' ? identity.primary_email : null,
          patientCode,
          uhid: patientUhid,
          nationalId: identityNationalId,
          dateOfBirth: typeof identity.date_of_birth === 'string' ? identity.date_of_birth : null,
          gender: typeof identity.gender === 'string' ? identity.gender : null,
        });
        const patientInsertStatement = c.env.DB.prepare(`
          INSERT INTO patients (
            tenant_id, name, father_husband, address, mobile, email,
            national_id, blood_group, date_of_birth, gender, source,
            patient_code, uhid, global_identity_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'referral', ?, ?, ?, datetime('now', '+6 hours'))
        `).bind(
          tenantId,
          patientName,
          '',
          '',
          typeof identity.primary_phone === 'string' ? identity.primary_phone : null,
          typeof identity.primary_email === 'string' ? identity.primary_email : null,
          identityNationalId,
          typeof identity.blood_group === 'string' ? identity.blood_group : null,
          typeof identity.date_of_birth === 'string' ? identity.date_of_birth : null,
          typeof identity.gender === 'string' ? identity.gender : null,
          patientCode,
          patientUhid,
          identity.id ?? null,
        );
        const acceptanceStatements: D1PreparedStatement[] = [patientInsertStatement];
        const patientOutboxStatement = await buildLocalSyncPatientCreateOutboxStatement(c.env, {
          tenantId,
          patientCode,
          payload: patientPayload,
        });
        if (patientOutboxStatement) acceptanceStatements.push(patientOutboxStatement);
        acceptanceStatements.push(
          c.env.DB.prepare(`
            INSERT OR IGNORE INTO patient_health_links (
              national_id, tenant_id, patient_id, hospital_name, uhid, is_active, linked_at
            )
            SELECT ?, ?, p.id, ?, ?, 1, datetime('now', '+6 hours')
            FROM patients p
            WHERE p.tenant_id = ? AND p.patient_code = ?
            LIMIT 1
          `).bind(
            healthLinkNationalId,
            tenantId,
            hospital?.name ?? null,
            patientUhid,
            tenantId,
            patientCode,
          ),
          statusUpdateStatement,
          c.env.DB.prepare(`
            UPDATE cross_hospital_referrals
            SET to_local_patient_id = (
              SELECT p.id
              FROM patients p
              WHERE p.tenant_id = ? AND p.patient_code = ?
              LIMIT 1
            )
            WHERE id = ?
          `).bind(tenantId, patientCode, referralId),
        );
        await c.env.DB.batch(acceptanceStatements);

        if (c.env.ENVIRONMENT === 'local_server') {
          const createdPatient = await c.env.DB.prepare(`
            SELECT id
            FROM patients
            WHERE tenant_id = ? AND patient_code = ?
            LIMIT 1
          `).bind(tenantId, patientCode).first<{ id: number }>();
          if (!createdPatient?.id) {
            throw new HTTPException(500, {
              message: 'Referral acceptance could not resolve the created patient for sync outbox repair',
            });
          }
          const healthLinkOutbox = await buildReferralHealthLinkOutboxStatement(c.env, {
            tenantId,
            patientId: createdPatient.id,
            uhid: patientUhid,
            nationalId: healthLinkNationalId,
            hospitalName: hospital?.name ?? null,
          });
          if (healthLinkOutbox) await healthLinkOutbox.run();
        }
      }
    } else {
      await statusUpdateStatement.run();
    }

    void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'cross_hospital_referrals', referralId, null, {
      action: 'referral_status_change', new_status: body.status, reason_recorded: Boolean(body.decline_reason),
    });

    return c.json({ message: 'Referral status updated', status: body.status });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update referral status' });
  }
});

export default referralRoutes;
