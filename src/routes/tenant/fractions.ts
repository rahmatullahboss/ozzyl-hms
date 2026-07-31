import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  createFractionPercentSchema,
  calculateFractionSchema,
} from '../../schemas/fraction';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireRole } from '../../middleware/rbac';

const fractionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const FRACTION_ADMIN_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

// POST /api/fractions/percent — create a fraction percent rule
fractionRoutes.post('/percent', requireRole(...FRACTION_ADMIN_ROLES), zValidator('json', createFractionPercentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Validate that hospital_percent + doctor_percent = 100
  if (Math.abs(data.hospitalPercent + data.doctorPercent - 100) > 0.01) {
    throw new HTTPException(400, { message: 'hospital_percent + doctor_percent must equal 100' });
  }

  try {
    const result = await db.$client.prepare(`
      INSERT INTO fraction_percents
        (tenant_id, service_item_id, bill_item_category, hospital_percent, doctor_percent, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).bind(
      tenantId,
      data.serviceItemId ?? null,
      data.billItemCategory ?? null,
      data.hospitalPercent,
      data.doctorPercent,
      userId,
    ).run();

    const ruleId = Number(result.meta.last_row_id);
    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'CREATE',
      'fraction_percents',
      ruleId,
      null,
      { ruleId, ...data },
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent')
    );

    return c.json({ message: 'Fraction percent rule created', id: ruleId }, 201);
  } catch {
    throw new HTTPException(500, { message: 'Failed to create fraction percent rule' });
  }
});

// GET /api/fractions/percent — list all fraction percent rules
fractionRoutes.get('/percent', requireRole(...FRACTION_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const { results } = await db.$client.prepare(`
      SELECT fp.*, si.item_name as service_item_name, si.item_code as service_item_code
      FROM fraction_percents fp
      LEFT JOIN billing_service_items si ON si.id = fp.service_item_id AND si.tenant_id = fp.tenant_id
      WHERE fp.tenant_id = ?
      ORDER BY fp.is_active DESC, fp.id DESC
    `).bind(tenantId).all();

    return c.json({ rules: results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch fraction percent rules' });
  }
});

// POST /api/fractions/calculate — calculate fraction for a bill
fractionRoutes.post('/calculate', requireRole(...FRACTION_ADMIN_ROLES), zValidator('json', calculateFractionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    // 1. Get invoice items for the bill
    const { results: invoiceItems } = await db.$client.prepare(`
      SELECT id, bill_id, item_category, description, quantity, unit_price, line_total, reference_id
      FROM invoice_items
      WHERE bill_id = ? AND tenant_id = ?
    `).bind(data.billId, tenantId).all<{
      id: number;
      bill_id: number;
      item_category: string | null;
      description: string;
      quantity: number;
      unit_price: number;
      line_total: number;
      reference_id: number | null;
    }>();

    if (invoiceItems.length === 0) {
      throw new HTTPException(404, { message: 'No invoice items found for this bill' });
    }

    // 2. Get active fraction percent rules
    const { results: fractionRules } = await db.$client.prepare(`
      SELECT id, service_item_id, bill_item_category, hospital_percent, doctor_percent
      FROM fraction_percents
      WHERE tenant_id = ? AND is_active = 1
    `).bind(tenantId).all<{
      id: number;
      service_item_id: number | null;
      bill_item_category: string | null;
      hospital_percent: number;
      doctor_percent: number;
    }>();

    // 3. Calculate fractions for each item
    const calculations: Array<{
      invoiceItemId: number;
      grossAmount: number;
      hospitalAmount: number;
      doctorAmount: number;
      fractionPercentId: number | null;
    }> = [];

    for (const item of invoiceItems) {
      const grossAmount = Number(item.line_total || 0);

      // Find matching rule: prefer service_item_id match, then bill_item_category match
      let matchedRule = fractionRules.find(
        (r) => r.service_item_id != null && r.service_item_id === item.reference_id
      );
      if (!matchedRule && item.item_category) {
        matchedRule = fractionRules.find(
          (r) => r.bill_item_category != null && r.bill_item_category === item.item_category
        );
      }

      const hospitalPercent = matchedRule?.hospital_percent ?? 60;
      const doctorPercent = matchedRule?.doctor_percent ?? 40;
      const hospitalAmount = Math.round((grossAmount * hospitalPercent) / 100);
      const doctorAmount = grossAmount - hospitalAmount;

      calculations.push({
        invoiceItemId: item.id,
        grossAmount,
        hospitalAmount,
        doctorAmount,
        fractionPercentId: matchedRule?.id ?? null,
      });
    }

    // 4. Save to fraction_calculations (idempotent: clear prior calculated rows first)
    await db.$client.prepare(
      `DELETE FROM fraction_calculations WHERE tenant_id = ? AND bill_id = ? AND doctor_id = ? AND status = 'calculated'`
    ).bind(tenantId, data.billId, data.doctorId).run();

    for (const calc of calculations) {
      await db.$client.prepare(`
        INSERT INTO fraction_calculations
          (tenant_id, bill_id, invoice_item_id, doctor_id, gross_amount, hospital_amount, doctor_amount, fraction_percent_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'calculated')
      `).bind(
        tenantId,
        data.billId,
        calc.invoiceItemId,
        data.doctorId,
        calc.grossAmount,
        calc.hospitalAmount,
        calc.doctorAmount,
        calc.fractionPercentId,
      ).run();
    }

    // 5. Return summary
    const totalGross = calculations.reduce((sum, c) => sum + c.grossAmount, 0);
    const totalHospital = calculations.reduce((sum, c) => sum + c.hospitalAmount, 0);
    const totalDoctor = calculations.reduce((sum, c) => sum + c.doctorAmount, 0);

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'CREATE',
      'fraction_calculations',
      data.billId,
      null,
      { billId: data.billId, doctorId: data.doctorId, itemCount: calculations.length, totalGross, totalHospital, totalDoctor },
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent')
    );

    return c.json({
      message: 'Fractions calculated successfully',
      billId: data.billId,
      doctorId: data.doctorId,
      itemCount: calculations.length,
      summary: {
        totalGross,
        totalHospital,
        totalDoctor,
      },
      items: calculations,
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Calculate fraction error:', error);
    throw new HTTPException(500, { message: 'Failed to calculate fractions' });
  }
});

// GET /api/fractions/doctor-summary — doctor incentive summary
fractionRoutes.get('/doctor-summary', requireRole(...FRACTION_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = c.req.query('doctor_id');

  if (!doctorId) {
    throw new HTTPException(400, { message: 'doctor_id query parameter is required' });
  }

  try {
    const summary = await db.$client.prepare(`
      SELECT
        COUNT(*) as total_items,
        COALESCE(SUM(gross_amount), 0) as total_gross,
        COALESCE(SUM(hospital_amount), 0) as total_hospital,
        COALESCE(SUM(doctor_amount), 0) as total_doctor,
        COALESCE(SUM(CASE WHEN status = 'calculated' THEN doctor_amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN status = 'settled' THEN doctor_amount ELSE 0 END), 0) as settled_amount
      FROM fraction_calculations
      WHERE tenant_id = ? AND doctor_id = ?
    `).bind(tenantId, Number(doctorId)).first<{
      total_items: number;
      total_gross: number;
      total_hospital: number;
      total_doctor: number;
      pending_amount: number;
      settled_amount: number;
    }>();

    return c.json({
      doctorId: Number(doctorId),
      totalItems: Number(summary?.total_items ?? 0),
      totalGross: Number(summary?.total_gross ?? 0),
      totalHospital: Number(summary?.total_hospital ?? 0),
      totalDoctor: Number(summary?.total_doctor ?? 0),
      pendingAmount: Number(summary?.pending_amount ?? 0),
      settledAmount: Number(summary?.settled_amount ?? 0),
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch doctor fraction summary' });
  }
});

// PUT /api/fractions/settle — settle fractions for a doctor
fractionRoutes.put('/settle', requireRole(...FRACTION_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const doctorId = c.req.query('doctor_id');

  if (!doctorId) {
    throw new HTTPException(400, { message: 'doctor_id query parameter is required' });
  }

  try {
    const result = await db.$client.prepare(`
      UPDATE fraction_calculations
      SET status = 'settled',
          settled_date = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND doctor_id = ? AND status = 'calculated'
    `).bind(tenantId, Number(doctorId)).run();

    const settledCount = Number(result.meta.changes ?? 0);

    if (settledCount === 0) {
      throw new HTTPException(404, { message: 'No calculated fractions found for this doctor' });
    }

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'UPDATE',
      'fraction_calculations',
      Number(doctorId),
      null,
      { doctorId: Number(doctorId), settledCount, action: 'settle_fractions' },
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent')
    );

    return c.json({
      message: 'Fractions settled successfully',
      doctorId: Number(doctorId),
      settledCount,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Settle fractions error:', error);
    throw new HTTPException(500, { message: 'Failed to settle fractions' });
  }
});

export default fractionRoutes;
