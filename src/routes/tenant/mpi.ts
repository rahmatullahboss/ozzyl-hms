// ═══════════════════════════════════════════════════════════════════════════════
// MPI (Master Patient Index) Hardening Routes
// Cross-tenant duplicate detection, guardian management, alias tracking,
// verification level upgrades
// ═══════════════════════════════════════════════════════════════════════════════

import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../../types';
import { createGuardianSchema, updateGuardianSchema, createAliasSchema, resolveDuplicateSchema, verifyPatientSchema } from '../../schemas/mpi';
import { computePairScore, scoreToAction, REVIEW_THRESHOLD, type IdentityFields } from '../../lib/mpi-scoring';
import { requirePermission } from '../../middleware/rbac';

type MpiEnv = { Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } };

const mpiRoutes = new Hono<MpiEnv>();

function requireTenantId(c: any): string {
  const tid = c.get('tenantId');
  if (!tid) throw new HTTPException(401, { message: 'Tenant context required' });
  return tid;
}

function requireUserId(c: any): string {
  const uid = c.get('userId');
  if (!uid) throw new HTTPException(401, { message: 'Auth required' });
  return uid;
}

/**
 * P0-33 (fix/portal-consent): verify the (tenantId, patientId) pair is
 * accessible to the caller. Returns the patient row on success; throws
 * HTTP 404 if the patient doesn't exist OR the caller has no permission
 * to mutate it. This prevents an admin in tenant A from touching
 * guardians/aliases that belong to a patient in tenant B.
 */
async function loadPatientForMutation(
  c: Context<MpiEnv>,
  patientId: string,
  tenantId: string,
): Promise<{ id: number; tenant_id: string }> {
  const row = await c.env.DB.prepare(
    'SELECT id, tenant_id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ id: number; tenant_id: string }>();
  if (!row) {
    throw new HTTPException(404, { message: 'Patient not found in this tenant' });
  }
  return row;
}

// ─── Cross-Tenant Duplicate Scan (Probabilistic) ──────────────────────────

mpiRoutes.post('/scan-duplicates', async (c) => {
  const role = c.get('role');
  if (role !== 'hospital_admin' && role !== 'super_admin') {
    throw new HTTPException(403, { message: 'Admin role required' });
  }

  const db = c.env.DB;

  // Step 1: SQL-level candidate narrowing — self-join on shared phone OR DOB
  const { results: candidates } = await db.prepare(`
    SELECT g1.id AS id1, g2.id AS id2,
      g1.national_id AS nid1, g2.national_id AS nid2,
      g1.primary_name AS name1, g2.primary_name AS name2,
      g1.primary_phone AS phone1, g2.primary_phone AS phone2,
      g1.date_of_birth AS dob1, g2.date_of_birth AS dob2,
      g1.gender AS gender1, g2.gender AS gender2,
      g1.blood_group AS bg1, g2.blood_group AS bg2
    FROM global_patient_identity g1
    JOIN global_patient_identity g2 ON g1.id < g2.id
    WHERE (
      (g1.primary_phone = g2.primary_phone AND g1.primary_phone IS NOT NULL AND g1.primary_phone != '')
      OR (g1.date_of_birth = g2.date_of_birth AND g1.date_of_birth IS NOT NULL)
      OR (g1.national_id = g2.national_id AND g1.national_id IS NOT NULL AND g1.national_id != '')
      OR (LOWER(g1.primary_name) = LOWER(g2.primary_name) AND g1.primary_name IS NOT NULL)
    )
    AND NOT EXISTS (
      SELECT 1 FROM mpi_duplicate_suspects
      WHERE identity_id_1 = g1.id AND identity_id_2 = g2.id
    )
    LIMIT 500
  `).all<{
    id1: number; id2: number;
    nid1: string | null; nid2: string | null;
    name1: string | null; name2: string | null;
    phone1: string | null; phone2: string | null;
    dob1: string | null; dob2: string | null;
    gender1: string | null; gender2: string | null;
    bg1: string | null; bg2: string | null;
  }>();

  // Step 2: Score each pair in JS
  let inserted = 0;
  let autoLinked = 0;
  let ignored = 0;

  for (const row of candidates ?? []) {
    const a: IdentityFields = {
      id: row.id1, national_id: row.nid1, primary_name: row.name1,
      primary_phone: row.phone1, date_of_birth: row.dob1,
      gender: row.gender1, blood_group: row.bg1,
    };
    const b: IdentityFields = {
      id: row.id2, national_id: row.nid2, primary_name: row.name2,
      primary_phone: row.phone2, date_of_birth: row.dob2,
      gender: row.gender2, blood_group: row.bg2,
    };

    const { score, matchDetails } = computePairScore(a, b);
    const action = scoreToAction(score);

    if (action === 'ignore') {
      ignored++;
      continue;
    }

    const matchType = Object.keys(matchDetails).sort().join('+');
    const status = action === 'auto_link' ? 'auto_linked' : 'pending';

    await db.prepare(`
      INSERT OR IGNORE INTO mpi_duplicate_suspects
        (identity_id_1, identity_id_2, match_type, confidence, match_details, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(row.id1, row.id2, matchType, score, JSON.stringify(matchDetails), status).run();

    inserted++;
    if (action === 'auto_link') autoLinked++;
  }

  return c.json({
    message: 'Probabilistic duplicate scan completed',
    candidates_evaluated: candidates?.length ?? 0,
    new_suspects: inserted,
    auto_linked: autoLinked,
    below_threshold: ignored,
  });
});

// ─── Duplicate Suspects Queue ───────────────────────────────────────────────

mpiRoutes.get('/duplicate-suspects', async (c) => {
  const role = c.get('role');
  if (role !== 'hospital_admin' && role !== 'super_admin') {
    throw new HTTPException(403, { message: 'Admin role required' });
  }

  const status = c.req.query('status') || 'pending';
  const limit = Math.min(Number(c.req.query('limit') || 20), 100);

  const { results } = await c.env.DB.prepare(`
    SELECT ds.*,
      g1.primary_name AS name_1, g1.primary_phone AS phone_1, g1.national_id AS nid_1, g1.uhid AS uhid_1,
      g2.primary_name AS name_2, g2.primary_phone AS phone_2, g2.national_id AS nid_2, g2.uhid AS uhid_2
    FROM mpi_duplicate_suspects ds
    JOIN global_patient_identity g1 ON ds.identity_id_1 = g1.id
    JOIN global_patient_identity g2 ON ds.identity_id_2 = g2.id
    WHERE ds.status = ?
    ORDER BY ds.confidence DESC, ds.created_at DESC
    LIMIT ?
  `).bind(status, limit).all();

  return c.json({ Results: results });
});

mpiRoutes.post('/duplicate-suspects/:id/resolve', zValidator('json', resolveDuplicateSchema), async (c) => {
  const role = c.get('role');
  if (role !== 'hospital_admin' && role !== 'super_admin') {
    throw new HTTPException(403, { message: 'Admin role required' });
  }

  const id = c.req.param('id');
  const userId = requireUserId(c);
  const { action, notes } = c.req.valid('json');

  await c.env.DB.prepare(`
    UPDATE mpi_duplicate_suspects
    SET status = ?, reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), notes = ?
    WHERE id = ?
  `).bind(action, userId, notes ?? null, id).run();

  return c.json({ message: `Duplicate suspect ${action}` });
});

// ─── Guardian CRUD ──────────────────────────────────────────────────────────

mpiRoutes.get('/patients/:id/guardians', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('id');

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM patient_guardians
    WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
    ORDER BY is_primary DESC, created_at
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

mpiRoutes.post('/patients/:id/guardians', requirePermission('mpi.guardian.add'), zValidator('json', createGuardianSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = c.req.param('id');
  await loadPatientForMutation(c, patientId, tenantId);
  const data = c.req.valid('json');

  const result = await c.env.DB.prepare(`
    INSERT INTO patient_guardians (tenant_id, patient_id, guardian_name, relationship, national_id, phone, address, is_primary, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, patientId, data.guardian_name, data.relationship,
    data.national_id ?? null, data.phone ?? null, data.address ?? null,
    data.is_primary ? 1 : 0, userId,
  ).run();

  return c.json({ message: 'Guardian added', id: result.meta?.last_row_id }, 201);
});

mpiRoutes.put('/patients/:id/guardians/:gid', requirePermission('mpi.guardian.update'), zValidator('json', updateGuardianSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('id');
  const gid = c.req.param('gid');
  await loadPatientForMutation(c, patientId, tenantId);
  const data = c.req.valid('json');

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.guardian_name !== undefined) { sets.push('guardian_name = ?'); values.push(data.guardian_name); }
  if (data.relationship !== undefined) { sets.push('relationship = ?'); values.push(data.relationship); }
  if (data.national_id !== undefined) { sets.push('national_id = ?'); values.push(data.national_id); }
  if (data.phone !== undefined) { sets.push('phone = ?'); values.push(data.phone); }
  if (data.address !== undefined) { sets.push('address = ?'); values.push(data.address); }
  if (data.is_primary !== undefined) { sets.push('is_primary = ?'); values.push(data.is_primary ? 1 : 0); }

  if (sets.length === 0) return c.json({ message: 'No fields to update' }, 400);

  sets.push("updated_at = datetime('now', '+6 hours')");
  values.push(tenantId, patientId, gid);

  await c.env.DB.prepare(`UPDATE patient_guardians SET ${sets.join(', ')} WHERE tenant_id = ? AND patient_id = ? AND id = ?`).bind(...values).run();
  return c.json({ message: 'Guardian updated' });
});

mpiRoutes.delete('/patients/:id/guardians/:gid', requirePermission('mpi.guardian.remove'), async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('id');
  const gid = c.req.param('gid');
  await loadPatientForMutation(c, patientId, tenantId);

  await c.env.DB.prepare(`UPDATE patient_guardians SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE tenant_id = ? AND patient_id = ? AND id = ?`).bind(tenantId, patientId, gid).run();
  return c.json({ message: 'Guardian removed' });
});

// ─── Alias History ──────────────────────────────────────────────────────────

mpiRoutes.get('/patients/:id/aliases', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('id');

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM patient_aliases
    WHERE tenant_id = ? AND patient_id = ?
    ORDER BY created_at DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

mpiRoutes.post('/patients/:id/aliases', requirePermission('mpi.alias.add'), zValidator('json', createAliasSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = c.req.param('id');
  await loadPatientForMutation(c, patientId, tenantId);
  const data = c.req.valid('json');

  await c.env.DB.prepare(`
    INSERT INTO patient_aliases (tenant_id, patient_id, alias_type, alias_value, valid_from, valid_to, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, patientId, data.alias_type, data.alias_value,
    data.valid_from ?? null, data.valid_to ?? null, data.reason ?? null, userId,
  ).run();

  return c.json({ message: 'Alias recorded' }, 201);
});

// ─── Verification Upgrade ───────────────────────────────────────────────────

mpiRoutes.post('/patients/:id/verify', requirePermission('mpi.verify'), zValidator('json', verifyPatientSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const patientId = c.req.param('id');
  await loadPatientForMutation(c, patientId, tenantId);
  const { level, verification_method, metadata } = c.req.valid('json');

  // Level 3 (Govt-Verified) requires admin/md role
  if (level === 3 && role !== 'hospital_admin' && role !== 'super_admin' && role !== 'md') {
    throw new HTTPException(403, { message: 'Admin or MD role required for government verification' });
  }

  // Get patient's NID to find global identity
  const patient = await c.env.DB.prepare(
    'SELECT national_id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ national_id: string | null }>();

  if (!patient?.national_id) {
    throw new HTTPException(400, { message: 'Patient must have NID before verification upgrade' });
  }

  const verificationMeta = JSON.stringify({
    ...(metadata ?? {}),
    verified_by: verification_method ?? 'manual',
    verified_at: new Date().toISOString(),
    verified_by_user: userId,
    verified_at_tenant: tenantId,
  });

  await c.env.DB.prepare(`
    UPDATE global_patient_identity
    SET verification_level = ?, verification_metadata = ?, updated_at = datetime('now', '+6 hours')
    WHERE national_id = ? AND verification_level < ?
  `).bind(level, verificationMeta, patient.national_id, level).run();

  return c.json({ message: `Verification upgraded to level ${level}` });
});

// ─── Global Identity Lookup ─────────────────────────────────────────────────

mpiRoutes.get('/identity/:uhid', async (c) => {
  const role = c.get('role');
  if (role !== 'hospital_admin' && role !== 'super_admin' && role !== 'doctor' && role !== 'md') {
    throw new HTTPException(403, { message: 'Insufficient permissions' });
  }

  const uhid = c.req.param('uhid');

  const identity = await c.env.DB.prepare(`
    SELECT id, national_id, uhid, primary_name, primary_phone, primary_email,
      blood_group, date_of_birth, gender, brn,
      verification_level, profile_picture_url, created_at, updated_at
    FROM global_patient_identity
    WHERE uhid = ?
  `).bind(uhid).first();

  if (!identity) return c.json({ error: 'Identity not found' }, 404);

  // Get linked hospitals
  const { results: links } = await c.env.DB.prepare(`
    SELECT phl.tenant_id, phl.patient_id, phl.hospital_name, phl.linked_at
    FROM patient_health_links phl
    WHERE phl.national_id = ? AND phl.is_active = 1
  `).bind((identity as Record<string, unknown>).national_id).all();

  return c.json({ Result: { ...identity, linked_hospitals: links } });
});

export default mpiRoutes;
