import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import { getDoctorWaiverAvailability } from '../../lib/doctor-waiver-availability';
import { getTodayGMT6 } from '../../lib/date-utils';
import { quoteDoctorWaiver } from '../../lib/doctor-waiver-quote';

const discounts = new Hono<{ Bindings: Env; Variables: Variables }>();

const BILLING_DISCOUNT_ROLES = [
  'reception',
  'receptionist',
  'hospital_admin',
  'md',
  'director',
  'manager',
  'accountant',
] as const;

const doctorWaiverAvailabilityQuery = z.object({
  doctorId: z.coerce.number().int().positive(),
  patientId: z.coerce.number().int().positive().optional(),
  billContext: z.string().trim().max(80).optional(),
});

const doctorWaiverPreviewSchema = z.object({
  doctorId: z.number().int().positive(),
  billDate: z.string().trim().max(20).optional(),
  totalDiscount: z.number().min(0).optional(),
  items: z.array(z.object({
    itemCategory: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).nullable().optional(),
    lineTotal: z.number().min(0),
    grossLineTotal: z.number().min(0).nullable().optional(),
    performerReserveAmount: z.number().min(0).nullable().optional(),
    referenceId: z.number().int().positive().nullable().optional(),
    labTestId: z.number().int().positive().nullable().optional(),
    quantity: z.number().int().positive().optional(),
  })).min(1).max(100),
});

discounts.use('*', requireRole(...BILLING_DISCOUNT_ROLES));

discounts.get('/doctor-waiver-availability', zValidator('query', doctorWaiverAvailabilityQuery), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('query');
  const availability = await getDoctorWaiverAvailability(c.env.DB, tenantId, data.doctorId, {
    patientId: data.patientId ?? null,
  });

  return c.json({
    ...availability,
    billContext: data.billContext ?? null,
  });
});

discounts.post('/doctor-waiver-preview', zValidator('json', doctorWaiverPreviewSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const billDate = data.billDate || getTodayGMT6();
  const quote = await quoteDoctorWaiver(c.env.DB, {
    tenantId,
    doctorId: data.doctorId,
    billDate,
    totalDiscount: data.totalDiscount,
    items: data.items,
  });

  return c.json(quote);
});

export default discounts;
