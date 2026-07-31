import type { D1Database } from '@cloudflare/workers-types';
import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from './accounting-posting';

type FinanceContext = Context<{ Bindings: Env; Variables: Variables }>;

export function queueDirectFinancePosting(c: FinanceContext, tenantId: string, label = 'Failed to post direct finance accounting event:'): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error(label, error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

export async function hasDirectIncomeAccountingEvent(db: D1Database, tenantId: string, incomeId: string | number): Promise<boolean> {
  const row = await db.prepare(`
    SELECT id FROM accounting_posting_events
    WHERE tenant_id = ? AND source_type = 'direct_income' AND source_id = ?
      AND event_type = ? AND status IN ('pending', 'posted')
    LIMIT 1
  `).bind(tenantId, String(incomeId), ACCOUNTING_EVENT_TYPES.directIncomeReceived).first<{ id: number }>();
  return Boolean(row);
}

export async function hasDirectExpenseAccountingEvent(db: D1Database, tenantId: string, expenseId: string | number): Promise<boolean> {
  const row = await db.prepare(`
    SELECT id FROM accounting_posting_events
    WHERE tenant_id = ? AND source_type = 'direct_expense' AND source_id = ?
      AND event_type = ? AND status IN ('pending', 'posted')
    LIMIT 1
  `).bind(tenantId, String(expenseId), ACCOUNTING_EVENT_TYPES.directExpensePaid).first<{ id: number }>();
  return Boolean(row);
}

export async function recordAndQueueDirectIncomeAccountingEvent(
  c: FinanceContext,
  input: {
    tenantId: string;
    userId: string;
    incomeId: string | number;
    date: string;
    source: string;
    amount: number;
    description?: string | null;
    paymentMethod?: string | null;
  },
): Promise<void> {
  await recordAccountingPostingEvent(c.env.DB, {
    tenantId: input.tenantId,
    sourceType: 'direct_income',
    sourceId: input.incomeId,
    eventType: ACCOUNTING_EVENT_TYPES.directIncomeReceived,
    eventDate: input.date,
    createdBy: input.userId,
    payload: {
      incomeId: input.incomeId,
      source: input.source,
      amount: input.amount,
      paymentMethod: input.paymentMethod ?? 'cash',
      description: input.description ?? null,
    },
  });
  queueDirectFinancePosting(c, input.tenantId);
}

export async function recordAndQueueDirectExpenseAccountingEvent(
  c: FinanceContext,
  input: {
    tenantId: string;
    userId: string;
    expenseId: string | number;
    date: string;
    category: string;
    amount: number;
    description?: string | null;
    paymentMethod?: string | null;
  },
): Promise<void> {
  await recordAccountingPostingEvent(c.env.DB, {
    tenantId: input.tenantId,
    sourceType: 'direct_expense',
    sourceId: input.expenseId,
    eventType: ACCOUNTING_EVENT_TYPES.directExpensePaid,
    eventDate: input.date,
    createdBy: input.userId,
    payload: {
      expenseId: input.expenseId,
      category: input.category,
      amount: input.amount,
      paymentMethod: input.paymentMethod ?? 'cash',
      description: input.description ?? null,
    },
  });
  queueDirectFinancePosting(c, input.tenantId);
}
