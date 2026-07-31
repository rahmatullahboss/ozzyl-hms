import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId } from '../../../lib/context-helpers';
import {
  listInventoryIssueDiagnostics,
  listInventoryIssueOperations,
  type InventoryIssueOperationStatus,
} from '../../../lib/inventory-issue-diagnostics';

const issueOperations = new Hono<{ Bindings: Env; Variables: Variables }>();
const allowedRoles = new Set(['hospital_admin', 'director']);
const allowedStatuses = new Set(['all', 'pending', 'processing', 'completed', 'failed', 'recovered']);

issueOperations.use('*', async (c, next) => {
  const role = String(c.get('role') ?? '');
  if (!allowedRoles.has(role)) {
    throw new HTTPException(403, { message: 'Inventory operation diagnostics require administrator access.' });
  }
  await next();
});

issueOperations.get('/diagnostics', async (c) => {
  const tenantId = requireTenantId(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 500);
  const data = await listInventoryIssueDiagnostics(c.env.DB, { tenantId, limit });
  const summary = data.reduce((acc, row) => {
    acc[row.issueCode] = (acc[row.issueCode] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return c.json({ data, summary });
});

issueOperations.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const requestedStatus = c.req.query('status') || 'all';
  const status = allowedStatuses.has(requestedStatus)
    ? requestedStatus as InventoryIssueOperationStatus | 'all'
    : 'all';
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 500);
  const data = await listInventoryIssueOperations(c.env.DB, { tenantId, status, limit });
  return c.json({ data });
});

export default issueOperations;
