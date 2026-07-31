import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import { dueAgingQuerySchema } from '../../schemas/due-aging';

const dueAging = new Hono<{ Bindings: Env; Variables: Variables }>();

dueAging.use('/*', requireRole('hospital_admin', 'md', 'director', 'manager', 'accountant'));

const BUCKETS = [
  { label: '0-7 days', minDays: 0, maxDays: 7 },
  { label: '8-15 days', minDays: 8, maxDays: 15 },
  { label: '16-30 days', minDays: 16, maxDays: 30 },
  { label: '31-60 days', minDays: 31, maxDays: 60 },
  { label: '60+ days', minDays: 61, maxDays: 999999 },
];

function toDateOnly(dateStr: string): Date {
  const d = dateStr.split(' ')[0].split('T')[0];
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function daysBetween(dateStr: string, asOfDate: string): number {
  const created = toDateOnly(dateStr);
  const asOf = toDateOnly(asOfDate);
  return Math.floor((asOf.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

// GET / — Aging summary with buckets
dueAging.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const query = dueAgingQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: query.error.flatten() }, 400);
  }

  const { asOfDate } = query.data;
  const today = asOfDate || new Date().toISOString().split('T')[0];

  const { results } = await db
    .prepare(
      `SELECT id, invoice_no, patient_id, total, paid, due, status, created_at 
       FROM bills WHERE tenant_id = ? AND due > 0 LIMIT 1000`
    )
    .bind(tenantId)
    .all();

  const filtered = (results as Record<string, unknown>[]).filter(
    bill => bill.status !== 'cancelled' && bill.status !== 'void',
  );

  const buckets = BUCKETS.map(bucket => ({
    label: bucket.label,
    minDays: bucket.minDays,
    maxDays: bucket.maxDays,
    amount: 0,
    count: 0,
    invoices: [] as unknown[],
  }));

  let totalDue = 0;

  for (const bill of filtered) {
    const due = Number(bill.due) || 0;
    const days = daysBetween(bill.created_at as string, today);
    totalDue += due;

    for (const bucket of buckets) {
      if (days >= bucket.minDays && days <= bucket.maxDays) {
        bucket.amount += due;
        bucket.count += 1;
        bucket.invoices.push(bill);
        break;
      }
    }
  }

  return c.json({
    data: {
      asOfDate: today,
      totalDue,
      buckets: buckets.map(({ invoices, minDays, maxDays, ...rest }) => rest),
    },
  });
});

// GET /details — Detailed list for a specific bucket
dueAging.get('/details', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const query = dueAgingQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: query.error.flatten() }, 400);
  }

  const bucket = c.req.query('bucket');
  const asOfDate = query.data.asOfDate || new Date().toISOString().split('T')[0];

  const { results } = await db
    .prepare(
      `SELECT id, invoice_no, patient_id, total, paid, due, status, created_at 
       FROM bills WHERE tenant_id = ? AND due > 0 LIMIT 1000`
    )
    .bind(tenantId)
    .all();

  const activeBills = (results as Record<string, unknown>[]).filter(
    bill => bill.status !== 'cancelled' && bill.status !== 'void',
  );

  const targetBucket = BUCKETS.find(b => b.label.startsWith(bucket || ''));
  if (!targetBucket) {
    return c.json({ error: 'Invalid bucket' }, 400);
  }

  const filtered = activeBills.filter(bill => {
    const days = daysBetween(bill.created_at as string, asOfDate);
    return days >= targetBucket.minDays && days <= targetBucket.maxDays;
  });

  return c.json({ data: filtered });
});

export default dueAging;
