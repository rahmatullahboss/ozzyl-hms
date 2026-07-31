import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { eq, and, like, sql } from 'drizzle-orm';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { externalReferringDoctors } from '../../db/schema';
import { requireRole } from '../../middleware/rbac';

const externalReferringDoctorRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
externalReferringDoctorRoutes.use('*', requireRole('reception', 'hospital_admin'));

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(20).optional(),
  chamber: z.string().trim().max(300).optional(),
  specialty: z.string().trim().max(100).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(20).optional(),
  chamber: z.string().trim().max(300).optional(),
  specialty: z.string().trim().max(100).optional(),
});

// GET /api/external-referring-doctors — list all external referring doctors
externalReferringDoctorRoutes.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const search = c.req.query('search')?.trim();

  let query = db.select()
    .from(externalReferringDoctors)
    .where(eq(externalReferringDoctors.tenantId, tenantId));

  if (search) {
    query = db.select()
      .from(externalReferringDoctors)
      .where(and(
        eq(externalReferringDoctors.tenantId, tenantId),
        like(externalReferringDoctors.name, `%${search}%`),
      ));
  }

  const results = await query.orderBy(externalReferringDoctors.name);
  return c.json(results);
});

// POST /api/external-referring-doctors — create a new external referring doctor
externalReferringDoctorRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const data = c.req.valid('json');

  // Check for duplicate by name + phone
  if (data.phone) {
    const existing = await db.select()
      .from(externalReferringDoctors)
      .where(and(
        eq(externalReferringDoctors.tenantId, tenantId),
        eq(externalReferringDoctors.name, data.name),
        eq(externalReferringDoctors.phone, data.phone),
      ))
      .limit(1);

    if (existing.length > 0) {
      return c.json({ id: existing[0].id, name: existing[0].name, reused: true });
    }
  }

  const [result] = await db.insert(externalReferringDoctors)
    .values({
      name: data.name,
      phone: data.phone ?? null,
      chamber: data.chamber ?? null,
      specialty: data.specialty ?? null,
      tenantId,
    })
    .returning({ id: externalReferringDoctors.id });

  return c.json({ id: result.id, name: data.name }, 201);
});

// PUT /api/external-referring-doctors/:id — update an external referring doctor
externalReferringDoctorRoutes.put('/:id', zValidator('json', updateSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const [existing] = await db.select()
    .from(externalReferringDoctors)
    .where(and(
      eq(externalReferringDoctors.id, id),
      eq(externalReferringDoctors.tenantId, tenantId),
    ))
    .limit(1);

  if (!existing) throw new HTTPException(404, { message: 'External referring doctor not found' });

  await db.update(externalReferringDoctors)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.chamber !== undefined && { chamber: data.chamber }),
      ...(data.specialty !== undefined && { specialty: data.specialty }),
      updatedAt: sql`(datetime('now', '+6 hours'))`,
    })
    .where(and(
      eq(externalReferringDoctors.id, id),
      eq(externalReferringDoctors.tenantId, tenantId),
    ));

  return c.json({ id, message: 'Updated' });
});

// DELETE /api/external-referring-doctors/:id — delete an external referring doctor
externalReferringDoctorRoutes.delete('/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const id = Number(c.req.param('id'));

  const [existing] = await db.select()
    .from(externalReferringDoctors)
    .where(and(
      eq(externalReferringDoctors.id, id),
      eq(externalReferringDoctors.tenantId, tenantId),
    ))
    .limit(1);

  if (!existing) throw new HTTPException(404, { message: 'External referring doctor not found' });

  await db.delete(externalReferringDoctors)
    .where(and(
      eq(externalReferringDoctors.id, id),
      eq(externalReferringDoctors.tenantId, tenantId),
    ));

  return c.json({ message: 'Deleted' });
});

export default externalReferringDoctorRoutes;
