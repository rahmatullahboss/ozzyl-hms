import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import {
  getDiagnosticBillingClearance,
  getDiagnosticBillingColumns,
  getDiagnosticBillingJoin,
} from '../../lib/diagnostic-billing';

const labMachineDowntime = new Hono<{ Bindings: Env; Variables: Variables }>();

labMachineDowntime.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'hospital_admin', 'director'));

// HL7 ORM^O01 message generator
function generateHL7OrderMessage(order: { id: number; order_no: string }, items: Array<{ test_code: string; test_name: string }>, patient: { id: number; name: string }, machineCode: string): string {
  const now = new Date();
  const msgDate = now.toISOString().replace(/[-:T.]/g, '').substring(0, 12);
  const msh = `MSH|^~\\&|HMS|${machineCode}|${machineCode}||${msgDate}||ORM^O01|${order.id}|P|2.3`;
  const pid = `PID|||${patient.id}||${patient.name}`;
  const obr = `OBR|1|||${items.map(i => `${i.test_code}^${i.test_name}`).join('~')}`;

  return [msh, pid, obr].join('\r');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEND ORDERS TO MACHINE (BIDIRECTIONAL)
// ═══════════════════════════════════════════════════════════════════════════════

labMachineDowntime.post('/:id/send-orders', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = Number(c.req.param('id'));

  const machine = await db.$client.prepare(`
    SELECT * FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(machineId, tenantId).first<{ id: number; machine_code: string; machine_type: string; protocol: string; host_address: string; port: number; is_bidirectional: number }>();
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });
  if (!machine.is_bidirectional) throw new HTTPException(400, { message: 'Machine is not configured for bidirectional communication' });

  // Find unmapped orders with pending items for this machine's test mappings
  const mappedTests = await db.$client.prepare(`
    SELECT mtm.lab_test_id, mtm.machine_test_code FROM lab_machine_test_map mtm WHERE mtm.machine_id = ? AND mtm.is_active = 1
  `).bind(machineId).all<{ lab_test_id: number; machine_test_code: string }>();
  const mappedTestIds = mappedTests.results.map(m => m.lab_test_id);

  if (mappedTestIds.length === 0) throw new HTTPException(400, { message: 'No test mappings configured' });

  // Get pending orders with items matching machine's tests
  const ordersResult = await db.$client.prepare(`
    SELECT DISTINCT lo.id, lo.order_no, lo.patient_id, p.name as patient_name,
           ${getDiagnosticBillingColumns('lo')}
    FROM lab_orders lo
    ${getDiagnosticBillingJoin('lo')}
    JOIN lab_order_items loi ON lo.id = loi.lab_order_id
    JOIN patients p ON lo.patient_id = p.id
    WHERE lo.tenant_id = ? AND loi.status IN ('pending','collected')
      AND loi.lab_test_id IN (${mappedTestIds.map(() => '?').join(',')})
      AND loi.id NOT IN (SELECT lab_order_item_id FROM lab_machine_orders WHERE machine_id = ? AND status = 'completed')
    LIMIT 20
  `).bind(tenantId, ...mappedTestIds, machineId).all<{ id: number; order_no: string; patient_id: number; patient_name: string }>();
  const orders = (ordersResult.results as any[]).filter((row) => getDiagnosticBillingClearance(row).cleared);

  let sent = 0;
  const sentOrders: Array<{ orderId: number; itemId?: number }> = [];

  for (const order of orders) {
    const items = await db.$client.prepare(`
      SELECT loi.id, loi.lab_test_id, ltc.code as test_code, ltc.name as test_name, mtm.machine_test_code
      FROM lab_order_items loi
      JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      JOIN lab_machine_test_map mtm ON loi.lab_test_id = mtm.lab_test_id AND mtm.machine_id = ?
      WHERE loi.lab_order_id = ? AND loi.status IN ('pending','collected')
        AND loi.id NOT IN (SELECT lab_order_item_id FROM lab_machine_orders WHERE machine_id = ? AND status IN ('completed','acknowledged'))
    `).bind(machineId, order.id, machineId).all<{ id: number; lab_test_id: number; test_code: string; test_name: string; machine_test_code: string }>();

    if (items.results.length === 0) continue;

    const hl7Msg = generateHL7OrderMessage(
      { id: order.id, order_no: order.order_no },
      items.results.map(i => ({ test_code: i.machine_test_code || i.test_code, test_name: i.test_name })),
      { id: order.patient_id, name: order.patient_name },
      machine.machine_code
    );

    for (const item of items.results) {
      await db.$client.prepare(`
        INSERT INTO lab_machine_orders (machine_id, lab_order_id, lab_order_item_id, machine_test_code, status, raw_request, sent_at, tenant_id)
        VALUES (?, ?, ?, ?, 'sent', ?, datetime('now', '+6 hours'), ?)
      `).bind(machineId, order.id, item.id, item.machine_test_code || item.test_code, hl7Msg, tenantId).run();

      sentOrders.push({ orderId: order.id, itemId: item.id });
    }

    sent++;
  }

  return c.json({ message: 'Orders sent to machine', sent, orders: sentOrders, machine_protocol: machine.protocol });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PENDING ORDERS
// ═══════════════════════════════════════════════════════════════════════════════

labMachineDowntime.get('/:id/pending-orders', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = Number(c.req.param('id'));

  const rows = await db.$client.prepare(`
    SELECT mo.*, lo.order_no, loi.lab_test_id, ltc.name as test_name
    FROM lab_machine_orders mo
    JOIN lab_orders lo ON mo.lab_order_id = lo.id
    LEFT JOIN lab_order_items loi ON mo.lab_order_item_id = loi.id
    LEFT JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    WHERE mo.machine_id = ? AND mo.tenant_id = ? AND mo.status IN ('pending','sent')
    ORDER BY mo.created_at DESC
  `).bind(machineId, tenantId).all();

  return c.json({ data: rows.results });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ACKNOWLEDGE
// ═══════════════════════════════════════════════════════════════════════════════

labMachineDowntime.post('/:id/acknowledge', zValidator('json', z.object({
  machine_order_ids: z.array(z.number().int().positive()),
  raw_response: z.string().optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = Number(c.req.param('id'));
  const { machine_order_ids, raw_response } = c.req.valid('json');

  for (const moId of machine_order_ids) {
    await db.$client.prepare(`
      UPDATE lab_machine_orders SET status = 'acknowledged', acknowledged_at = datetime('now', '+6 hours'), raw_response = ?
      WHERE id = ? AND machine_id = ? AND tenant_id = ?
    `).bind(raw_response ?? null, moId, machineId, tenantId).run();
  }

  return c.json({ message: 'Orders acknowledged', count: machine_order_ids.length });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOWNTIME TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

labMachineDowntime.post('/:id/downtime', zValidator('json', z.object({
  reason: z.string().min(1),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = Number(c.req.param('id'));
  const { reason } = c.req.valid('json');

  // Check if already down
  const existing = await db.$client.prepare(`
    SELECT id FROM lab_machine_downtime WHERE machine_id = ? AND downtime_end IS NULL
  `).bind(machineId).first();
  if (existing) throw new HTTPException(400, { message: 'Machine already marked as down' });

  const result = await db.$client.prepare(`
    INSERT INTO lab_machine_downtime (machine_id, reason, tenant_id) VALUES (?, ?, ?)
  `).bind(machineId, reason, tenantId).run();

  await db.$client.prepare(`
    UPDATE lab_machines SET status = 'down' WHERE id = ? AND tenant_id = ?
  `).bind(machineId, tenantId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Machine marked as down' }, 201);
});

labMachineDowntime.put('/:id/downtime/:downtimeId/resolve', zValidator('json', z.object({
  notes: z.string().optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const machineId = Number(c.req.param('id'));
  const downtimeId = Number(c.req.param('downtimeId'));
  const { notes } = c.req.valid('json');

  await db.$client.prepare(`
    UPDATE lab_machine_downtime SET downtime_end = datetime('now', '+6 hours'), resolved_by = ?, resolution_notes = ?
    WHERE id = ? AND machine_id = ?
  `).bind(userId, notes ?? null, downtimeId, machineId).run();

  await db.$client.prepare(`
    UPDATE lab_machines SET status = 'active' WHERE id = ? AND tenant_id = ?
  `).bind(machineId, tenantId).run();

  return c.json({ message: 'Machine resolved' });
});

labMachineDowntime.get('/:id/downtime', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = Number(c.req.param('id'));

  const rows = await db.$client.prepare(`
    SELECT d.*, u.name as resolved_by_name
    FROM lab_machine_downtime d
    LEFT JOIN users u ON d.resolved_by = u.id
    WHERE d.machine_id = ? AND d.tenant_id = ?
    ORDER BY d.downtime_start DESC LIMIT 50
  `).bind(machineId, tenantId).all();

  return c.json({ data: rows.results });
});

export default labMachineDowntime;
