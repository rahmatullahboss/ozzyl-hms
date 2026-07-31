import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireRole } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import {
  findBillsMissingAccountingEvents,
  findPartialAccountingVouchers,
  markAccountingEventsDeadLetter,
  repairBillsMissingAccountingEvents,
} from '../../lib/accounting-recovery';
import type { Env, Variables } from '../../types';

const accountingRecovery = new Hono<{ Bindings: Env; Variables: Variables }>();

const ITEM_DETAIL_ROLES = new Set(['hospital_admin', 'md', 'director', 'accountant']);
const RECOVERY_CONFIRMATION = 'RUN_ACCOUNTING_RECOVERY';
const DEAD_LETTER_ATTEMPTS = 5;

interface FailedPostingEventSummary {
  failedCount: number;
  retryableFailedCount: number;
  deadLetterReadyCount: number;
  deadLetterCount: number;
}

accountingRecovery.get('/*', requireRole('hospital_admin', 'md', 'director', 'manager', 'accountant'));
accountingRecovery.post('/*', requireRole('hospital_admin', 'md', 'director', 'accountant'));

const toLimit = (value: unknown) => Math.max(1, Math.min(500, Number(value ?? 50) || 50));

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function canIncludeItems(role: unknown): boolean {
  return typeof role === 'string' && ITEM_DETAIL_ROLES.has(role);
}

function shouldIncludeItems(c: { req: { query: (key: string) => string | undefined }, get: (key: string) => unknown }): boolean {
  const includeItems = c.req.query('includeItems') === 'true';
  if (!includeItems) return false;
  if (!canIncludeItems(c.get('role'))) {
    throw new HTTPException(403, { message: 'Detailed accounting recovery items require accounting/admin access' });
  }
  return true;
}

function withOptionalItems<T>(items: T[], includeItems: boolean): { count: number; items?: T[] } {
  return includeItems ? { count: items.length, items } : { count: items.length };
}

async function summarizeFailedPostingEvents(
  db: Env['DB'],
  tenantId: string,
  maxAttempts = DEAD_LETTER_ATTEMPTS,
): Promise<FailedPostingEventSummary> {
  const row = await db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN status = 'failed' AND COALESCE(attempts, 0) < ? THEN 1 ELSE 0 END) AS retryable_failed_count,
      SUM(CASE WHEN status = 'failed' AND COALESCE(attempts, 0) >= ? THEN 1 ELSE 0 END) AS dead_letter_ready_count,
      SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter_count
    FROM accounting_posting_events
    WHERE tenant_id = ?
  `).bind(maxAttempts, maxAttempts, tenantId).first<any>();

  return {
    failedCount: Number(row?.failed_count ?? 0),
    retryableFailedCount: Number(row?.retryable_failed_count ?? 0),
    deadLetterReadyCount: Number(row?.dead_letter_ready_count ?? 0),
    deadLetterCount: Number(row?.dead_letter_count ?? 0),
  };
}

accountingRecovery.get('/status', async (c) => {
  const tenantId = requireTenantId(c);
  const limit = toLimit(c.req.query('limit'));
  const includeItems = shouldIncludeItems(c);
  const db = c.env.DB;

  const partialVouchers = await findPartialAccountingVouchers(db, tenantId, limit);
  const missingBillEvents = await findBillsMissingAccountingEvents(db, tenantId, limit);
  const failedPostingEvents = await summarizeFailedPostingEvents(db, tenantId);

  return c.json({
    data: {
      tenantId,
      limit,
      includeItems,
      partialVouchers: withOptionalItems(partialVouchers, includeItems),
      missingBillCreatedEvents: withOptionalItems(missingBillEvents, includeItems),
      failedPostingEvents,
      healthy: partialVouchers.length === 0
        && missingBillEvents.length === 0
        && failedPostingEvents.failedCount === 0
        && failedPostingEvents.deadLetterReadyCount === 0,
    },
  });
});

accountingRecovery.post('/run', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const body = await readBody(c);
  const limit = toLimit(body.limit);
  const dryRun = body.dryRun !== false;
  const db = c.env.DB;

  const partialBefore = await findPartialAccountingVouchers(db, tenantId, limit);
  const missingBefore = await findBillsMissingAccountingEvents(db, tenantId, limit);
  const failedBefore = await summarizeFailedPostingEvents(db, tenantId);

  if (dryRun) {
    return c.json({
      data: {
        dryRun: true,
        tenantId,
        limit,
        requiredConfirmation: RECOVERY_CONFIRMATION,
        wouldRepairMissingBillCreatedEvents: missingBefore.length,
        wouldReviewPartialVouchers: partialBefore.length,
        wouldMoveFailedEventsToDeadLetter: failedBefore.deadLetterReadyCount,
        partialVouchers: partialBefore,
        missingBillCreatedEvents: missingBefore,
        failedPostingEvents: failedBefore,
      },
    });
  }

  if (body.confirm !== RECOVERY_CONFIRMATION) {
    throw new HTTPException(400, {
      message: `Set confirm to ${RECOVERY_CONFIRMATION} to run accounting recovery mutations`,
    });
  }

  const repairResult = await repairBillsMissingAccountingEvents(db, tenantId, limit);
  const deadLetteredFailedEvents = await markAccountingEventsDeadLetter(db, tenantId, DEAD_LETTER_ATTEMPTS);
  const partialAfter = await findPartialAccountingVouchers(db, tenantId, limit);
  const failedAfter = await summarizeFailedPostingEvents(db, tenantId);
  const result = {
    dryRun: false,
    tenantId,
    limit,
    repairedMissingBillCreatedEvents: repairResult.inserted,
    scannedMissingBillCreatedEvents: repairResult.scanned,
    repairedSourceEventKeys: repairResult.sourceEventKeys,
    deadLetteredFailedEvents,
    partialVouchersBefore: partialBefore.length,
    partialVouchersAfter: partialAfter.length,
    partialVouchers: partialAfter,
    failedPostingEventsBefore: failedBefore,
    failedPostingEventsAfter: failedAfter,
  };

  await createAuditLog(
    c.env,
    tenantId,
    String(userId),
    'ACCOUNTING_MAINTENANCE_RUN',
    'accounting_posting_events',
    0,
    null,
    result,
    c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? undefined,
    c.req.header('user-agent') ?? undefined,
  );

  return c.json({ data: result });
});

export default accountingRecovery;
