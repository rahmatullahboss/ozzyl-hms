import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireRole } from '../../middleware/rbac';
import { requireTenantId } from '../../lib/context-helpers';
import type { Env, Variables } from '../../types';
import {
  loadCashLedgerBackfillDryRun,
  loadCashLedgerBalances,
  loadCashLedgerEvents,
  loadCashLedgerExceptions,
  loadCashLedgerOverview,
  loadCashLedgerReadiness,
  loadCashLedgerReconciliation,
  loadCashLedgerShadowIssues,
  loadCashLedgerShadowReconciliation,
  type CashLedgerFilters,
} from '../../lib/cash-ledger-service';

const cashLedgerRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const CASH_LEDGER_ROLES = ['hospital_admin', 'md', 'director', 'manager', 'accountant', 'reception', 'receptionist'] as const;

cashLedgerRoutes.use('/*', requireRole(...CASH_LEDGER_ROLES));

type CashLedgerContext = Context<{ Bindings: Env; Variables: Variables }>;

function parseFilters(c: CashLedgerContext): CashLedgerFilters {
  const sessionId = Number(c.req.query('sessionId') ?? c.req.query('counterSessionId') ?? 0);
  const limit = Number(c.req.query('limit') ?? 250);
  const includeResolved = ['1', 'true', 'yes'].includes(String(c.req.query('includeResolved') ?? '').toLowerCase());
  return {
    date: c.req.query('date') || undefined,
    from: c.req.query('from') || c.req.query('dateFrom') || undefined,
    to: c.req.query('to') || c.req.query('dateTo') || undefined,
    sessionId: Number.isInteger(sessionId) && sessionId > 0 ? sessionId : undefined,
    status: c.req.query('status') || undefined,
    sourceType: c.req.query('sourceType') || undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    includeResolved,
  };
}

cashLedgerRoutes.get('/overview', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const overview = await loadCashLedgerOverview(c.env.DB, tenantId, filters);
    return c.json({ overview, filters });
  } catch (error) {
    console.error('cash-ledger /overview failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load cash ledger overview',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

cashLedgerRoutes.get('/events', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const events = await loadCashLedgerEvents(c.env.DB, tenantId, filters);
    return c.json({ events, filters });
  } catch (error) {
    console.error('cash-ledger /events failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load cash ledger events',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

cashLedgerRoutes.get('/balances', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const balances = await loadCashLedgerBalances(c.env.DB, tenantId, filters);
    return c.json({ balances, filters });
  } catch (error) {
    console.error('cash-ledger /balances failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load cash ledger balances',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

cashLedgerRoutes.get('/exceptions', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const exceptions = await loadCashLedgerExceptions(c.env.DB, tenantId, filters);
    return c.json({ exceptions, filters });
  } catch (error) {
    console.error('cash-ledger /exceptions failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load cash ledger exceptions',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

cashLedgerRoutes.get('/transfers', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const events = await loadCashLedgerEvents(c.env.DB, tenantId, {
      ...filters,
      includeResolved: filters.includeResolved ?? true,
      limit: filters.limit ?? 500,
    });
    const transfers = events.filter((event) => event.sourceType === 'cash_custody_transfer' || event.sourceType === 'counter_handover' || event.sourceType === 'bank_deposit_request');
    return c.json({ transfers, filters });
  } catch (error) {
    console.error('cash-ledger /transfers failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load cash ledger transfers',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

cashLedgerRoutes.get('/sessions/:id/trail', async (c) => {
  const tenantId = requireTenantId(c);
  const sessionId = Number(c.req.param('id'));
  const filters = parseFilters(c);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return c.json({ error: 'Invalid counter session id' }, 400);
  }
  try {
    const events = await loadCashLedgerEvents(c.env.DB, tenantId, { ...filters, sessionId, includeResolved: true, limit: filters.limit ?? 500 });
    return c.json({ sessionId, events, filters: { ...filters, sessionId } });
  } catch (error) {
    console.error('cash-ledger /sessions/:id/trail failed', { tenantId, sessionId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load session trail',
      detail: error instanceof Error ? error.message : String(error),
      sessionId,
      filters: { ...filters, sessionId },
    }, 500);
  }
});

cashLedgerRoutes.get('/reconciliation', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const reconciliation = await loadCashLedgerReconciliation(c.env.DB, tenantId, filters);
    return c.json({ ...reconciliation, filters });
  } catch (error) {
    console.error('cash-ledger /reconciliation failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load cash ledger reconciliation',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

cashLedgerRoutes.get('/shadow-reconciliation', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const reconciliation = await loadCashLedgerShadowReconciliation(c.env.DB, tenantId, filters);
    return c.json({ ...reconciliation, filters });
  } catch (error) {
    console.error('cash-ledger /shadow-reconciliation failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load shadow reconciliation',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

cashLedgerRoutes.get('/readiness', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const report = await loadCashLedgerReadiness(c.env.DB, tenantId, filters);
    return c.json({ ...report, filters });
  } catch (error) {
    console.error('cash-ledger /readiness failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load cash ledger readiness',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

cashLedgerRoutes.get('/shadow-log', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const issues = await loadCashLedgerShadowIssues(c.env.DB, tenantId, filters);
    return c.json({ issues, filters });
  } catch (error) {
    console.error('cash-ledger /shadow-log failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load cash ledger shadow log',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

cashLedgerRoutes.get('/historical-report', async (c) => {
  const tenantId = requireTenantId(c);
  const filters = parseFilters(c);
  try {
    const report = await loadCashLedgerBackfillDryRun(c.env.DB, tenantId, filters);
    return c.json({ ...report, filters });
  } catch (error) {
    console.error('cash-ledger /historical-report failed', { tenantId, filters, error: String(error) });
    return c.json({
      error: 'Failed to load historical report',
      detail: error instanceof Error ? error.message : String(error),
      filters,
    }, 500);
  }
});

export default cashLedgerRoutes;
