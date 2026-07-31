import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';

const helpdeskRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createTicketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.enum(['it', 'facility', 'equipment', 'billing', 'hr', 'security', 'other']),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  wardId: z.number().int().positive().optional(),
  wardName: z.string().max(100).optional(),
  patientId: z.number().int().positive().optional(),
  patientName: z.string().max(200).optional(),
  source: z.enum(['web', 'email', 'phone', 'walkin', 'mobile']).default('web'),
});

const updateTicketSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed', 'escalated', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignedToId: z.number().int().positive().optional(),
  assignedToName: z.string().max(100).optional(),
  resolutionNotes: z.string().max(2000).optional(),
  closeReason: z.string().max(500).optional(),
});

const commentSchema = z.object({
  ticketId: z.number().int().positive(),
  content: z.string().min(1).max(3000),
  isInternal: z.boolean().default(false),
  attachmentUrl: z.string().url().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateTicketNo(tenantId: string, seq: number): string {
  const prefix = 'TKT';
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

function calculateDueAt(priority: string, createdAt: string): string {
  const date = new Date(createdAt);
  const slaMinutes: Record<string, number> = {
    low: 1440, medium: 480, high: 240, critical: 120,
  };
  date.setMinutes(date.getMinutes() + (slaMinutes[priority] || 480));
  return date.toISOString();
}

// ─── Categories ───────────────────────────────────────────────────────────────

helpdeskRoutes.get('/categories', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(
    'SELECT * FROM helpdesk_categories WHERE tenant_id = ? AND is_active = 1 ORDER BY name'
  ).bind(tenantId).all();

  return c.json({ categories: results });
});

// ─── Tickets ──────────────────────────────────────────────────────────────────

helpdeskRoutes.get('/tickets', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { status, priority, category, assignedToId, requesterId, wardId, page = '1', limit = '20' } = c.req.query();

  let sql = 'SELECT * FROM helpdesk_tickets WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (priority) { sql += ' AND priority = ?'; params.push(priority); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (assignedToId) { sql += ' AND assigned_to_id = ?'; params.push(Number(assignedToId)); }
  if (requesterId) { sql += ' AND requester_id = ?'; params.push(Number(requesterId)); }
  if (wardId) { sql += ' AND ward_id = ?'; params.push(Number(wardId)); }

  sql += ' ORDER BY CASE priority WHEN "critical" THEN 1 WHEN "high" THEN 2 WHEN "medium" THEN 3 ELSE 4 END, created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM helpdesk_tickets WHERE tenant_id = ? AND is_active = 1'
    + (status ? ' AND status = ?' : '') + (priority ? ' AND priority = ?' : '') + (category ? ' AND category = ?' : '')
    + (assignedToId ? ' AND assigned_to_id = ?' : '') + (requesterId ? ' AND requester_id = ?' : '') + (wardId ? ' AND ward_id = ?' : '')
  ).bind(...[tenantId, ...(status ? [status] : []), ...(priority ? [priority] : []), ...(category ? [category] : []), ...(assignedToId ? [Number(assignedToId)] : []), ...(requesterId ? [Number(requesterId)] : []), ...(wardId ? [Number(wardId)] : [])]).first<{ total: number }>();

  return c.json({ tickets: results, pagination: { page: Number(page), limit: Number(limit), total: countResult?.total ?? 0 } });
});

helpdeskRoutes.get('/tickets/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const ticket = await db.$client.prepare(
    'SELECT * FROM helpdesk_tickets WHERE tenant_id = ? AND id = ? AND is_active = 1'
  ).bind(tenantId, id).first();

  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  const { results: comments } = await db.$client.prepare(
    'SELECT * FROM helpdesk_ticket_comments WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at ASC'
  ).bind(tenantId, id).all();

  const { results: history } = await db.$client.prepare(
    'SELECT * FROM helpdesk_ticket_history WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at ASC'
  ).bind(tenantId, id).all();

  return c.json({ ticket: { ...ticket, comments, history } });
});

helpdeskRoutes.post('/tickets', zValidator('json', createTicketSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as cnt FROM helpdesk_tickets WHERE tenant_id = ?'
  ).bind(tenantId).first<{ cnt: number }>();
  const ticketNo = generateTicketNo(tenantId, (countResult?.cnt ?? 0) + 1);

  const createdAt = new Date().toISOString();
  const dueAt = calculateDueAt(data.priority, createdAt);

  // Auto-assign based on category
  const categoryInfo = await db.$client.prepare(
    'SELECT default_assignee_id FROM helpdesk_categories WHERE tenant_id = ? AND name = ? AND is_active = 1'
  ).bind(tenantId, data.category).first<{ default_assignee_id: number | null }>();

  const result = await db.$client.prepare(`
    INSERT INTO helpdesk_tickets
    (tenant_id, ticket_no, title, description, category, priority, status, requester_id, requester_name,
     assigned_to_id, ward_id, ward_name, patient_id, patient_name, source, due_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, ticketNo, data.title, data.description, data.category, data.priority,
    userId, 'User', categoryInfo?.default_assignee_id ?? null, data.wardId ?? null,
    data.wardName ?? null, data.patientId ?? null, data.patientName ?? null,
    data.source, dueAt, createdAt, createdAt,
  ).run();

  const ticketId = result.meta.last_row_id;

  // Add system comment
  await db.$client.prepare(`
    INSERT INTO helpdesk_ticket_comments (tenant_id, ticket_id, author_id, author_name, content, is_system)
    VALUES (?, ?, ?, ?, ?, 1)
  `).bind(tenantId, ticketId, userId, 'System', `Ticket created with ${data.priority} priority.`).run();

  return c.json({ id: ticketId, ticketNo }, 201);
});

helpdeskRoutes.patch('/tickets/:id', zValidator('json', updateTicketSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT * FROM helpdesk_tickets WHERE tenant_id = ? AND id = ? AND is_active = 1'
  ).bind(tenantId, id).first<Record<string, any>>();

  if (!existing) return c.json({ error: 'Ticket not found' }, 404);

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.status) {
    updates.push('status = ?');
    params.push(data.status);

    if (data.status === 'in_progress' && !existing.assigned_to_id && data.assignedToId) {
      updates.push('assigned_to_id = ?', 'assigned_to_name = ?', 'assigned_at = CURRENT_TIMESTAMP');
      params.push(data.assignedToId, data.assignedToName ?? 'Agent');
    }

    if (data.status === 'resolved') {
      updates.push('resolved_by_id = ?', 'resolved_by_name = ?', 'resolved_at = CURRENT_TIMESTAMP', 'resolution_notes = ?');
      params.push(userId, 'User', data.resolutionNotes ?? null);

      // Calculate resolution time
      if (existing.created_at) {
        const created = new Date(existing.created_at as string);
        const resolved = new Date();
        const minutes = Math.floor((resolved.getTime() - created.getTime()) / 60000);
        updates.push('resolution_time_minutes = ?');
        params.push(minutes);
      }
    }

    if (data.status === 'closed') {
      updates.push('closed_by_id = ?', 'closed_by_name = ?', 'closed_at = CURRENT_TIMESTAMP', 'close_reason = ?');
      params.push(userId, 'User', data.closeReason ?? null);
    }

    if (data.status === 'open' && existing.status !== 'open') {
      updates.push('reopened_count = reopened_count + 1');
    }

    // Record history
    await db.$client.prepare(`
      INSERT INTO helpdesk_ticket_history (tenant_id, ticket_id, field_name, old_value, new_value, changed_by_id, changed_by_name)
      VALUES (?, ?, 'status', ?, ?, ?, ?)
    `).bind(tenantId, id, existing.status, data.status, userId, 'User').run();
  }

  if (data.priority && data.priority !== existing.priority) {
    updates.push('priority = ?');
    params.push(data.priority);
    await db.$client.prepare(`
      INSERT INTO helpdesk_ticket_history (tenant_id, ticket_id, field_name, old_value, new_value, changed_by_id, changed_by_name)
      VALUES (?, ?, 'priority', ?, ?, ?, ?)
    `).bind(tenantId, id, existing.priority, data.priority, userId, 'User').run();
  }

  if (data.assignedToId && data.assignedToId !== existing.assigned_to_id) {
    updates.push('assigned_to_id = ?', 'assigned_to_name = ?', 'assigned_at = CURRENT_TIMESTAMP');
    params.push(data.assignedToId, data.assignedToName ?? 'Agent');
    await db.$client.prepare(`
      INSERT INTO helpdesk_ticket_history (tenant_id, ticket_id, field_name, old_value, new_value, changed_by_id, changed_by_name)
      VALUES (?, ?, 'assigned_to', ?, ?, ?, ?)
    `).bind(tenantId, id, String(existing.assigned_to_id ?? ''), String(data.assignedToId), userId, 'User').run();
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    await db.$client.prepare(
      `UPDATE helpdesk_tickets SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`
    ).bind(...params, tenantId, id).run();
  }

  return c.json({ success: true });
});

// ─── Comments ─────────────────────────────────────────────────────────────────

helpdeskRoutes.get('/tickets/:id/comments', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const { results } = await db.$client.prepare(
    'SELECT * FROM helpdesk_ticket_comments WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at ASC'
  ).bind(tenantId, id).all();

  return c.json({ comments: results });
});

helpdeskRoutes.post('/comments', zValidator('json', commentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO helpdesk_ticket_comments (tenant_id, ticket_id, author_id, author_name, content, is_internal, attachment_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.ticketId, userId, 'User', data.content, data.isInternal ? 1 : 0, data.attachmentUrl ?? null).run();

  // Update first response time if this is the first comment by non-requester
  const ticket = await db.$client.prepare(
    'SELECT requester_id, first_response_at FROM helpdesk_tickets WHERE tenant_id = ? AND id = ?'
  ).bind(tenantId, data.ticketId).first<{ requester_id: number; first_response_at: string | null }>();

  if (ticket && !ticket.first_response_at && String(ticket.requester_id) !== String(userId)) {
    const ticketCreated = await db.$client.prepare(
      'SELECT created_at FROM helpdesk_tickets WHERE tenant_id = ? AND id = ?'
    ).bind(tenantId, data.ticketId).first<{ created_at: string }>();

    if (ticketCreated) {
      const created = new Date(ticketCreated.created_at);
      const now = new Date();
      const minutes = Math.floor((now.getTime() - created.getTime()) / 60000);

      await db.$client.prepare(
        'UPDATE helpdesk_tickets SET first_response_at = CURRENT_TIMESTAMP, response_time_minutes = ? WHERE tenant_id = ? AND id = ?'
      ).bind(minutes, tenantId, data.ticketId).run();
    }
  }

  return c.json({ id: result.meta.last_row_id }, 201);
});

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

helpdeskRoutes.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const openCount = await db.$client.prepare(
    "SELECT COUNT(*) as cnt FROM helpdesk_tickets WHERE tenant_id = ? AND is_active = 1 AND status IN ('open', 'in_progress', 'escalated')"
  ).bind(tenantId).first<{ cnt: number }>();

  const criticalCount = await db.$client.prepare(
    "SELECT COUNT(*) as cnt FROM helpdesk_tickets WHERE tenant_id = ? AND is_active = 1 AND priority = 'critical' AND status IN ('open', 'in_progress', 'escalated')"
  ).bind(tenantId).first<{ cnt: number }>();

  const resolvedToday = await db.$client.prepare(
    "SELECT COUNT(*) as cnt FROM helpdesk_tickets WHERE tenant_id = ? AND is_active = 1 AND status = 'resolved' AND date(resolved_at) = date('now', '+6 hours')"
  ).bind(tenantId).first<{ cnt: number }>();

  const slaBreached = await db.$client.prepare(
    "SELECT COUNT(*) as cnt FROM helpdesk_tickets WHERE tenant_id = ? AND is_active = 1 AND sla_breached = 1 AND status IN ('open', 'in_progress', 'escalated')"
  ).bind(tenantId).first<{ cnt: number }>();

  const avgResolution = await db.$client.prepare(
    "SELECT AVG(resolution_time_minutes) as avg FROM helpdesk_tickets WHERE tenant_id = ? AND is_active = 1 AND status IN ('resolved', 'closed') AND resolved_at >= date('now', '-30 days')"
  ).bind(tenantId).first<{ avg: number }>();

  // By category
  const { results: byCategory } = await db.$client.prepare(
    "SELECT category, COUNT(*) as count FROM helpdesk_tickets WHERE tenant_id = ? AND is_active = 1 AND created_at >= date('now', '-30 days') GROUP BY category"
  ).bind(tenantId).all();

  return c.json({
    openTickets: openCount?.cnt ?? 0,
    criticalTickets: criticalCount?.cnt ?? 0,
    resolvedToday: resolvedToday?.cnt ?? 0,
    slaBreached: slaBreached?.cnt ?? 0,
    avgResolutionMinutes: Math.round(avgResolution?.avg ?? 0),
    byCategory,
  });
});

export default helpdeskRoutes;
