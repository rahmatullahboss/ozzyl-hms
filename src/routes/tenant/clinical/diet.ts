import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createDietSchema, updateDietSchema } from '../../../schemas/clinical-assessments';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const dietRoutes = new Hono<ClinicalEnv>();

const ALLOWED = ['DietTypeId','DietTypeName','DietName','Quantity','Unit','FeedingTime','Remarks'];

dietRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId)))
    throw new HTTPException(400, { message: 'patientId required' });
  const { results } = await db.$client
    .prepare('SELECT * FROM CLN_PatientDiet WHERE tenant_id=? AND PatientId=? AND IsActive=1 ORDER BY CreatedOn DESC')
    .bind(tenantId, Number(patientId)).all();
  return c.json({ Results: results });
});

dietRoutes.post('/', zValidator('json', createDietSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const r = await db.$client.prepare(`INSERT INTO CLN_PatientDiet (tenant_id,PatientId,PatientVisitId,DietTypeId,DietTypeName,DietName,Quantity,Unit,FeedingTime,Remarks,CreatedBy) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(tenantId,d.PatientId,d.PatientVisitId??null,d.DietTypeId??null,d.DietTypeName??null,d.DietName??null,d.Quantity??null,d.Unit??null,d.FeedingTime??null,d.Remarks??null,userId).run();
  return c.json({ Results: { id: r.meta.last_row_id } }, 201);
});

dietRoutes.put('/:id', zValidator('json', updateDietSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const ex = await db.$client.prepare('SELECT 1 FROM CLN_PatientDiet WHERE PatientDietId=? AND tenant_id=? AND IsActive=1').bind(id,tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Not found' });
  const data = c.req.valid('json');
  const f: string[] = []; const v: (string|number|null)[] = [];
  Object.entries(data).forEach(([k,val]) => { if (ALLOWED.includes(k) && val !== undefined) { f.push(`${k}=?`); v.push(val as any); } });
  if (f.length > 0) { f.push("ModifiedOn=datetime('now', '+6 hours')"); v.push(id,tenantId);
    await db.$client.prepare(`UPDATE CLN_PatientDiet SET ${f.join(',')} WHERE PatientDietId=? AND tenant_id=?`).bind(...v).run(); }
  return c.json({ Results: true });
});

dietRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const ex = await db.$client.prepare('SELECT 1 FROM CLN_PatientDiet WHERE PatientDietId=? AND tenant_id=? AND IsActive=1').bind(id,tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Not found' });
  await db.$client.prepare("UPDATE CLN_PatientDiet SET IsActive=0,ModifiedOn=datetime('now', '+6 hours') WHERE PatientDietId=? AND tenant_id=?").bind(id,tenantId).run();
  return c.json({ Results: true });
});
