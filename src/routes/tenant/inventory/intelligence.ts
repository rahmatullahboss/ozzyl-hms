import { Hono } from 'hono';
import type { Env } from '../../../types';
import { getDb } from '../../../db';
import { requireRole, requireTenantId } from '../../../lib/context-helpers';
import {
  calculateDaysOfCover,
  calculateReorderPoint,
  calculateSuggestedOrderQuantity,
  classifyDemandTrend,
  classifyRecommendationStatus,
  estimateStockoutDate,
} from '../../../lib/inventory-intelligence/forecast';
import {
  classifyDashboardStatus,
  recomputeInventoryIntelligence,
} from '../../../lib/inventory-intelligence/recompute';

export { classifyDashboardStatus } from '../../../lib/inventory-intelligence/recompute';

type Variables = { tenantId?: string; userId?: string; role?: string };

const intelligence = new Hono<{ Bindings: Env; Variables: Variables }>();

const INVENTORY_INTELLIGENCE_MUTATION_ROLES = new Set(['hospital_admin', 'md', 'director']);

export function canRunInventoryIntelligenceMutation(role?: string | null): boolean {
  return Boolean(role && INVENTORY_INTELLIGENCE_MUTATION_ROLES.has(role));
}

function requireInventoryIntelligenceMutationAccess(c: Parameters<typeof requireRole>[0]) {
  const role = requireRole(c);
  if (!canRunInventoryIntelligenceMutation(role)) {
    return c.json({ message: 'Forbidden: hospital admin, MD, or director access required' }, 403);
  }
  return null;
}

function numberParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parsePositiveIntegerParam(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function isInventoryIntelligenceSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no such table: inventory_recommendation') ||
    message.includes('no such table: inventory_stock_intelligence_snapshot') ||
    message.includes('no such table: inventory_demand_daily') ||
    message.includes('no such table: inventory_demand_source_event');
}

intelligence.get('/forecast-preview', async (c) => {
  const usableStock = numberParam(c.req.query('usableStock') ?? null, 0);
  const avgDailyUsage30d = numberParam(c.req.query('avgDailyUsage30d') ?? null, 0);
  const avgDailyUsage7d = numberParam(c.req.query('avgDailyUsage7d') ?? null, avgDailyUsage30d);
  const leadTimeDays = numberParam(c.req.query('leadTimeDays') ?? null, 7);
  const safetyStockDays = numberParam(c.req.query('safetyStockDays') ?? null, 7);
  const maxStockQuantity = numberParam(c.req.query('maxStockQuantity') ?? null, 0);
  const openPrQty = numberParam(c.req.query('openPrQty') ?? null, 0);
  const openPoQty = numberParam(c.req.query('openPoQty') ?? null, 0);

  const reorderPoint = calculateReorderPoint({ avgDailyUsage: avgDailyUsage30d, leadTimeDays, safetyStockDays });
  const daysOfCover = calculateDaysOfCover(usableStock, avgDailyUsage30d);

  return c.json({
    forecast: {
      usableStock,
      avgDailyUsage7d,
      avgDailyUsage30d,
      trendLabel: classifyDemandTrend({ avg7: avgDailyUsage7d, avg30: avgDailyUsage30d }),
      leadTimeDays,
      safetyStockDays,
      reorderPoint,
      daysOfCover,
      estimatedStockoutDate: estimateStockoutDate({ usableStock, avgDailyUsage: avgDailyUsage30d }),
      suggestedOrderQty: calculateSuggestedOrderQuantity({ usableStock, maxStockQuantity, reorderPoint, openPrQty, openPoQty }),
      recommendationStatus: classifyRecommendationStatus({ usableStock, reorderPoint, daysOfCover, leadTimeDays }),
      openPrQty,
      openPoQty,
    },
  });
});

intelligence.get('/dashboard', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  try {
    const recommendations = await db.$client.prepare(`
      SELECT id, recommendation_type, severity, inventory_item_id, title, message,
             suggested_action, suggested_quantity, status, created_at
      FROM inventory_recommendation
      WHERE tenant_id = ? AND status = 'open'
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
      LIMIT 20
    `).bind(tenantId).all();

    const snapshotSummary = await db.$client.prepare(`
      SELECT
        COUNT(*) AS snapshot_count,
        MAX(computed_at) AS last_computed_at,
        SUM(CASE WHEN recommendation_status = 'stockout' THEN 1 ELSE 0 END) AS stockout_count,
        SUM(CASE WHEN recommendation_status = 'low' THEN 1 ELSE 0 END) AS low_count,
        SUM(CASE WHEN recommendation_status = 'watch' THEN 1 ELSE 0 END) AS watch_count,
        SUM(CASE WHEN recommendation_status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
        SUM(suggested_order_qty) AS suggested_order_qty_total
      FROM inventory_stock_intelligence_snapshot
      WHERE tenant_id = ?
    `).bind(tenantId).first<Record<string, number | string | null>>();

    const demandSummary = await db.$client.prepare(`
      SELECT COUNT(*) AS event_count
      FROM inventory_demand_source_event
      WHERE tenant_id = ?
    `).bind(tenantId).first<{ event_count?: number | null }>();

    const snapshotCount = Number(snapshotSummary?.snapshot_count ?? 0);
    const lastComputedAt = snapshotSummary?.last_computed_at ? String(snapshotSummary.last_computed_at) : null;
    const demandEventCount = Number(demandSummary?.event_count ?? 0);
    const status = demandEventCount > 0
      ? classifyDashboardStatus({ snapshotCount, lastComputedAt })
      : 'not_configured';

    return c.json({
      status,
      snapshotCount,
      demandEventCount,
      lastComputedAt,
      summary: {
        stockout: Number(snapshotSummary?.stockout_count ?? 0),
        low: Number(snapshotSummary?.low_count ?? 0),
        watch: Number(snapshotSummary?.watch_count ?? 0),
        ok: Number(snapshotSummary?.ok_count ?? 0),
        suggestedOrderQtyTotal: Number(snapshotSummary?.suggested_order_qty_total ?? 0),
      },
      recommendations: recommendations.results ?? [],
    });
  } catch (error) {
    if (isInventoryIntelligenceSchemaError(error)) {
      return c.json({
        status: 'not_configured',
        snapshotCount: 0,
        lastComputedAt: null,
        summary: { stockout: 0, low: 0, watch: 0, ok: 0, suggestedOrderQtyTotal: 0 },
        recommendations: [],
        message: 'Inventory intelligence tables are not ready yet. Apply migration 0399_inventory_intelligence.sql.',
      });
    }

    console.error('[inventory-intelligence] dashboard failed:', error);
    return c.json({ message: 'Failed to load inventory intelligence dashboard' }, 500);
  }
});

intelligence.post('/recompute', async (c) => {
  const forbidden = requireInventoryIntelligenceMutationAccess(c);
  if (forbidden) return forbidden;

  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  try {
    const result = await recomputeInventoryIntelligence(db.$client, tenantId);
    return c.json(result);
  } catch (error) {
    if (isInventoryIntelligenceSchemaError(error)) {
      return c.json({
        message: 'Inventory intelligence tables are not ready yet. Apply migration 0399_inventory_intelligence.sql.',
        recomputedItems: 0,
        generatedRecommendations: 0,
        status: 'not_configured',
        lastComputedAt: null,
      }, 409);
    }

    console.error('[inventory-intelligence] recompute failed:', error);
    return c.json({ message: 'Failed to recompute inventory intelligence' }, 500);
  }
});

intelligence.get('/recommendations', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const status = c.req.query('status') || 'open';
  const severity = c.req.query('severity');

  const params: unknown[] = [tenantId, status];
  let sql = `
    SELECT id, recommendation_type, severity, inventory_item_id, rule_id, reference_type, reference_id,
           title, message, suggested_action, suggested_quantity, metadata_json, status, created_at, updated_at
    FROM inventory_recommendation
    WHERE tenant_id = ? AND status = ?
  `;
  if (severity) {
    sql += ' AND severity = ?';
    params.push(severity);
  }
  sql += ` ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT 100`;

  try {
    const rows = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ recommendations: rows.results ?? [] });
  } catch (error) {
    if (isInventoryIntelligenceSchemaError(error)) {
      return c.json({ recommendations: [], message: 'Inventory intelligence recommendation table is not ready yet.' });
    }

    console.error('[inventory-intelligence] recommendations failed:', error);
    return c.json({ message: 'Failed to load inventory intelligence recommendations' }, 500);
  }
});

intelligence.post('/recommendations/:id/dismiss', async (c) => {
  const forbidden = requireInventoryIntelligenceMutationAccess(c);
  if (forbidden) return forbidden;

  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const id = parsePositiveIntegerParam(c.req.param('id'));
  if (!id) return c.json({ message: 'Invalid recommendation id' }, 400);

  await db.$client.prepare(`
    UPDATE inventory_recommendation
    SET status = 'dismissed', updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND id = ? AND status = 'open'
  `).bind(tenantId, id).run();

  return c.json({ message: 'Recommendation dismissed' });
});

export default intelligence;
