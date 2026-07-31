import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const favouritesRoutes = new Hono<NursingEnv>();

const addFavouriteSchema = z.object({
  patient_id: z.number().int().positive(),
});

favouritesRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const { results } = await db.$client.prepare(`
    SELECT nfp.id, nfp.patient_id, nfp.added_on,
           p.name AS patient_name, p.patient_code, p.gender, p.mobile
    FROM nursing_favourite_patients nfp
    JOIN patients p ON p.id = nfp.patient_id AND p.tenant_id = nfp.tenant_id
    WHERE nfp.tenant_id = ? AND nfp.nurse_user_id = ?
    ORDER BY nfp.added_on DESC
  `).bind(tenantId, userId).all();

  return c.json({ Results: results });
});

favouritesRoutes.post('/', zValidator('json', addFavouriteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { patient_id } = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM nursing_favourite_patients WHERE tenant_id = ? AND nurse_user_id = ? AND patient_id = ?'
  ).bind(tenantId, userId, patient_id).first();

  if (existing) return c.json({ Results: { already_exists: true } });

  const result = await db.$client.prepare(
    'INSERT INTO nursing_favourite_patients (tenant_id, nurse_user_id, patient_id) VALUES (?, ?, ?)'
  ).bind(tenantId, userId, patient_id).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

favouritesRoutes.delete('/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = parseInt(c.req.param('patientId'));
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  await db.$client.prepare(
    'DELETE FROM nursing_favourite_patients WHERE tenant_id = ? AND nurse_user_id = ? AND patient_id = ?'
  ).bind(tenantId, userId, patientId).run();

  return c.json({ Results: true });
});
