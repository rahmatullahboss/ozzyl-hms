import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createGlucoseSchema, updateGlucoseSchema } from '../../../schemas/clinical-assessments';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const glucoseRoutes = new Hono<ClinicalEnv>();

const ALLOWED = ['SugarValue','Unit','BSLType','MeasurementTime','Remarks'];

glucoseRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId)))
    throw new HTTPException(400, { message: 'patientId required' });
  const { results } = await db.$client
    .prepare('SELECT * FROM CLN_Glucose WHERE tenant_id=? AND PatientId=? AND IsActive=1 ORDER BY CreatedOn DESC')
    .bind(tenantId, Number(patientId)).all();
  return c.json({ Results: results });
});

glucoseRoutes.get('/trend', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId)))
    throw new HTTPException(400, { message: 'patientId required' });
  const { results } = await db.$client
    .prepare('SELECT GlucoseId,SugarValue,Unit,BSLType,MeasurementTime,CreatedOn FROM CLN_Glucose WHERE tenant_id=? AND PatientId=? AND IsActive=1 ORDER BY CreatedOn ASC')
    .bind(tenantId, Number(patientId)).all();
  return c.json({ Results: results });
});

glucoseRoutes.post('/', zValidator('json', createGlucoseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const r = await db.$client.prepare(`INSERT INTO CLN_Glucose (tenant_id,PatientId,PatientVisitId,SugarValue,Unit,BSLType,MeasurementTime,Remarks,CreatedBy) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(tenantId,d.PatientId,d.PatientVisitId??null,d.SugarValue,d.Unit,d.BSLType??null,d.MeasurementTime??null,d.Remarks??null,userId).run();
  return c.json({ Results: { id: r.meta.last_row_id } }, 201);
});

glucoseRoutes.put('/:id', zValidator('json', updateGlucoseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const ex = await db.$client.prepare('SELECT 1 FROM CLN_Glucose WHERE GlucoseId=? AND tenant_id=? AND IsActive=1').bind(id,tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Not found' });
  const data = c.req.valid('json');
  const f: string[] = []; const v: (string|number|null)[] = [];
  Object.entries(data).forEach(([k,val]) => { if (ALLOWED.includes(k) && val !== undefined) { f.push(`${k}=?`); v.push(val as any); } });
  if (f.length > 0) { f.push("ModifiedOn=datetime('now', '+6 hours')"); v.push(id,tenantId);
    await db.$client.prepare(`UPDATE CLN_Glucose SET ${f.join(',')} WHERE GlucoseId=? AND tenant_id=?`).bind(...v).run(); }
  return c.json({ Results: true });
});

glucoseRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const ex = await db.$client.prepare('SELECT 1 FROM CLN_Glucose WHERE GlucoseId=? AND tenant_id=? AND IsActive=1').bind(id,tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Not found' });
  await db.$client.prepare("UPDATE CLN_Glucose SET IsActive=0,ModifiedOn=datetime('now', '+6 hours') WHERE GlucoseId=? AND tenant_id=?").bind(id,tenantId).run();
  return c.json({ Results: true });
});
