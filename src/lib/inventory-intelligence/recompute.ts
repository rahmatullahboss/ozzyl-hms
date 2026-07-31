import {
  calculateDaysOfCover,
  calculateReorderPoint,
  calculateSuggestedOrderQuantity,
  classifyDemandTrend,
  classifyRecommendationStatus,
  estimateStockoutDate,
  roundTo,
} from './forecast';
import type { DemandTrendLabel, RecommendationStatus } from './types';
import { getInventoryUsableQuantity, isInventoryLotUsable } from '../inventory-lot-policy';

export type InventoryIntelligenceDashboardStatus = 'not_configured' | 'stale' | 'ready';

export interface StockLotForIntelligence {
  AvailableQuantity?: number | null;
  ReservedQuantity?: number | null;
  DamagedQuantity?: number | null;
  BlockedQuantity?: number | null;
  IsActive?: number | boolean | null;
  QCStatus?: string | null;
  StockStatus?: string | null;
  ExpiryDate?: string | null;
  AfterOpenExpiryDate?: string | null;
}

export interface DemandRowForIntelligence {
  demand_date?: string | null;
  consumed_qty?: number | null;
  consumedQty?: number | null;
}

export interface StockSummaryForIntelligence {
  currentStock: number;
  usableStock: number;
  blockedStock: number;
}

export interface BuildItemSnapshotInput extends StockSummaryForIntelligence {
  tenantId: string;
  inventoryItemId: number;
  itemName: string;
  itemCode?: string | null;
  today?: string;
  demandRows?: DemandRowForIntelligence[];
  leadTimeDays?: number | null;
  safetyStockDays?: number | null;
  maxStockQuantity?: number | null;
  openPrQty?: number | null;
  openPoQty?: number | null;
}

export interface InventoryItemSnapshotComputation extends StockSummaryForIntelligence {
  tenantId: string;
  inventoryItemId: number;
  itemName: string;
  itemCode?: string | null;
  avgDailyUsage7d: number;
  avgDailyUsage30d: number;
  avgDailyUsage90d: number;
  trendLabel: DemandTrendLabel;
  leadTimeDays: number;
  safetyStockDays: number;
  reorderPoint: number;
  suggestedOrderQty: number;
  daysOfCover: number | null;
  estimatedStockoutDate: string | null;
  openPrQty: number;
  openPoQty: number;
  recommendationStatus: RecommendationStatus;
}

export interface InventoryRecommendationDraft {
  recommendation_type: string;
  severity: 'critical' | 'warning' | 'info';
  inventory_item_id: number;
  title: string;
  message: string;
  suggested_action: string;
  suggested_quantity: number;
  metadata_json: string;
}

interface D1StatementLike {
  bind(...values: unknown[]): {
    all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    run(): Promise<unknown>;
  };
}

interface D1ClientLike {
  prepare(sql: string): D1StatementLike;
}

interface InventoryItemRow {
  ItemId: number;
  ItemName: string;
  ItemCode?: string | null;
  ReOrderLevel?: number | null;
  MaxStockQuantity?: number | null;
}

interface InboundRow {
  ItemId: number;
  open_pr_qty?: number | null;
  open_po_qty?: number | null;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value?: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

export function isStockLotUsable(lot: StockLotForIntelligence, today: string): boolean {
  return isInventoryLotUsable(lot, { today });
}

export function summarizeStockLots(lots: StockLotForIntelligence[], today: string): StockSummaryForIntelligence {
  let currentStock = 0;
  let usableStock = 0;

  for (const lot of lots) {
    const available = Math.max(0, numberValue(lot.AvailableQuantity));
    currentStock += available;

    if (!isStockLotUsable(lot, today)) continue;

    usableStock += getInventoryUsableQuantity(lot);
  }

  currentStock = roundTo(currentStock, 2);
  usableStock = roundTo(usableStock, 2);
  return { currentStock, usableStock, blockedStock: roundTo(Math.max(0, currentStock - usableStock), 2) };
}

export function averageDailyUsage(rows: DemandRowForIntelligence[], today: string, days: number): number {
  const windowDays = Math.max(1, Math.floor(days));
  const todayDate = new Date(`${today.slice(0, 10)}T00:00:00.000Z`);
  const start = new Date(todayDate);
  start.setUTCDate(start.getUTCDate() - windowDays + 1);
  const startText = start.toISOString().slice(0, 10);
  const endText = todayDate.toISOString().slice(0, 10);

  const total = rows.reduce((sum, row) => {
    const date = normalizeDate(row.demand_date);
    if (!date || date < startText || date > endText) return sum;
    return sum + Math.max(0, numberValue(row.consumed_qty ?? row.consumedQty));
  }, 0);

  return roundTo(total / windowDays, 2);
}

export function buildItemSnapshot(input: BuildItemSnapshotInput): InventoryItemSnapshotComputation {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const demandRows = input.demandRows ?? [];
  const avgDailyUsage7d = averageDailyUsage(demandRows, today, 7);
  const avgDailyUsage30d = averageDailyUsage(demandRows, today, 30);
  const avgDailyUsage90d = averageDailyUsage(demandRows, today, 90);
  const leadTimeDays = Math.max(0, Math.floor(numberValue(input.leadTimeDays ?? 7)) || 7);
  const safetyStockDays = Math.max(0, Math.floor(numberValue(input.safetyStockDays ?? 7)) || 7);
  const reorderPoint = calculateReorderPoint({ avgDailyUsage: avgDailyUsage30d, leadTimeDays, safetyStockDays });
  const daysOfCover = calculateDaysOfCover(input.usableStock, avgDailyUsage30d);
  const suggestedOrderQty = calculateSuggestedOrderQuantity({
    usableStock: input.usableStock,
    maxStockQuantity: input.maxStockQuantity ?? 0,
    reorderPoint,
    openPrQty: input.openPrQty ?? 0,
    openPoQty: input.openPoQty ?? 0,
  });

  return {
    tenantId: input.tenantId,
    inventoryItemId: input.inventoryItemId,
    itemName: input.itemName,
    itemCode: input.itemCode ?? null,
    currentStock: roundTo(input.currentStock, 2),
    usableStock: roundTo(input.usableStock, 2),
    blockedStock: roundTo(input.blockedStock, 2),
    avgDailyUsage7d,
    avgDailyUsage30d,
    avgDailyUsage90d,
    trendLabel: classifyDemandTrend({ avg7: avgDailyUsage7d, avg30: avgDailyUsage30d }),
    leadTimeDays,
    safetyStockDays,
    reorderPoint,
    suggestedOrderQty,
    daysOfCover,
    estimatedStockoutDate: estimateStockoutDate({ usableStock: input.usableStock, avgDailyUsage: avgDailyUsage30d, today }),
    openPrQty: roundTo(numberValue(input.openPrQty), 2),
    openPoQty: roundTo(numberValue(input.openPoQty), 2),
    recommendationStatus: classifyRecommendationStatus({ usableStock: input.usableStock, reorderPoint, daysOfCover, leadTimeDays }),
  };
}

export function buildRecommendationForSnapshot(snapshot: InventoryItemSnapshotComputation): InventoryRecommendationDraft | null {
  if (!['stockout', 'low', 'watch'].includes(snapshot.recommendationStatus)) return null;

  const isStockout = snapshot.recommendationStatus === 'stockout';
  const isLow = snapshot.recommendationStatus === 'low';
  const severity: InventoryRecommendationDraft['severity'] = isStockout ? 'critical' : isLow ? 'warning' : 'info';
  const cover = snapshot.daysOfCover === null ? 'no demand history' : `${snapshot.daysOfCover} days cover`;

  return {
    recommendation_type: snapshot.recommendationStatus,
    severity,
    inventory_item_id: snapshot.inventoryItemId,
    title: isStockout ? `${snapshot.itemName} is out of usable stock` : `${snapshot.itemName} needs reorder review`,
    message: `${snapshot.itemName} has ${snapshot.usableStock} usable units, ${cover}, and reorder point ${snapshot.reorderPoint}.`,
    suggested_action: 'create_purchase_order',
    suggested_quantity: snapshot.suggestedOrderQty,
    metadata_json: JSON.stringify({
      itemCode: snapshot.itemCode,
      daysOfCover: snapshot.daysOfCover,
      estimatedStockoutDate: snapshot.estimatedStockoutDate,
      trendLabel: snapshot.trendLabel,
      source: 'inventory_intelligence_recompute',
    }),
  };
}

export function classifyDashboardStatus(input: { snapshotCount: number; lastComputedAt?: string | null; now?: string; staleAfterHours?: number }): InventoryIntelligenceDashboardStatus {
  if (input.snapshotCount <= 0 || !input.lastComputedAt) return 'not_configured';

  const now = new Date(input.now ?? new Date().toISOString()).getTime();
  const computedAt = new Date(input.lastComputedAt).getTime();
  if (!Number.isFinite(computedAt)) return 'stale';

  const staleAfterMs = Math.max(1, input.staleAfterHours ?? 24) * 60 * 60 * 1000;
  return now - computedAt > staleAfterMs ? 'stale' : 'ready';
}

function inboundMap(rows: InboundRow[], key: 'open_pr_qty' | 'open_po_qty'): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(Number(row.ItemId), numberValue(row[key]));
  }
  return map;
}

export async function recomputeInventoryIntelligence(
  dbClient: D1ClientLike,
  tenantId: string,
  options: { today?: string; now?: string; leadTimeDays?: number; safetyStockDays?: number } = {},
) {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const now = options.now ?? new Date().toISOString();
  const leadTimeDays = options.leadTimeDays ?? 7;
  const safetyStockDays = options.safetyStockDays ?? 7;

  const itemsResult = await dbClient.prepare(`
    SELECT ItemId, ItemName, ItemCode, ReOrderLevel, MaxStockQuantity
    FROM InventoryItem
    WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1
  `).bind(tenantId).all<InventoryItemRow>();

  const stockResult = await dbClient.prepare(`
    SELECT ItemId, AvailableQuantity, ReservedQuantity, DamagedQuantity, BlockedQuantity,
           IsActive, QCStatus, StockStatus, ExpiryDate, AfterOpenExpiryDate
    FROM InventoryStock
    WHERE tenant_id = ? AND COALESCE(IsActive, 1) = 1
  `).bind(tenantId).all<StockLotForIntelligence & { ItemId: number }>();

  const demandResult = await dbClient.prepare(`
    SELECT inventory_item_id AS ItemId, demand_date, consumed_qty
    FROM inventory_demand_daily
    WHERE tenant_id = ? AND demand_date >= date(?, '-89 day') AND demand_date <= ?
  `).bind(tenantId, today, today).all<DemandRowForIntelligence & { ItemId: number }>();

  const demandEventSummary = await dbClient.prepare(`
    SELECT COUNT(*) AS event_count
    FROM inventory_demand_source_event
    WHERE tenant_id = ?
  `).bind(tenantId).first<{ event_count?: number | null }>();

  const openPrResult = await dbClient.prepare(`
    SELECT PRI.ItemId, SUM(COALESCE(NULLIF(PRI.ApprovedQuantity, 0), PRI.Quantity, 0)) AS open_pr_qty
    FROM InventoryPurchaseRequestItem PRI
    JOIN InventoryPurchaseRequest PR ON PR.PurchaseRequestId = PRI.PurchaseRequestId
    WHERE PR.tenant_id = ? AND PR.Status IN ('draft', 'submitted', 'approved')
    GROUP BY PRI.ItemId
  `).bind(tenantId).all<InboundRow>();

  const openPoResult = await dbClient.prepare(`
    SELECT POI.ItemId, SUM(MAX(COALESCE(POI.Quantity, 0) - COALESCE(POI.ReceivedQuantity, 0), 0)) AS open_po_qty
    FROM InventoryPurchaseOrderItem POI
    JOIN InventoryPurchaseOrder PO ON PO.PurchaseOrderId = POI.PurchaseOrderId
    WHERE PO.tenant_id = ? AND COALESCE(PO.IsCancelled, 0) = 0 AND PO.POStatus IN ('pending', 'partial')
    GROUP BY POI.ItemId
  `).bind(tenantId).all<InboundRow>();

  const stockByItem = new Map<number, StockLotForIntelligence[]>();
  for (const lot of stockResult.results ?? []) {
    const itemId = Number(lot.ItemId);
    if (!stockByItem.has(itemId)) stockByItem.set(itemId, []);
    stockByItem.get(itemId)!.push(lot);
  }

  const demandByItem = new Map<number, DemandRowForIntelligence[]>();
  for (const row of demandResult.results ?? []) {
    const itemId = Number(row.ItemId);
    if (!demandByItem.has(itemId)) demandByItem.set(itemId, []);
    demandByItem.get(itemId)!.push(row);
  }

  const prByItem = inboundMap(openPrResult.results ?? [], 'open_pr_qty');
  const poByItem = inboundMap(openPoResult.results ?? [], 'open_po_qty');

  let recomputedItems = 0;
  let generatedRecommendations = 0;

  for (const item of itemsResult.results ?? []) {
    const summary = summarizeStockLots(stockByItem.get(Number(item.ItemId)) ?? [], today);
    const snapshot = buildItemSnapshot({
      tenantId,
      inventoryItemId: Number(item.ItemId),
      itemName: item.ItemName,
      itemCode: item.ItemCode ?? null,
      today,
      ...summary,
      demandRows: demandByItem.get(Number(item.ItemId)) ?? [],
      leadTimeDays,
      safetyStockDays,
      maxStockQuantity: item.MaxStockQuantity ?? item.ReOrderLevel ?? 0,
      openPrQty: prByItem.get(Number(item.ItemId)) ?? 0,
      openPoQty: poByItem.get(Number(item.ItemId)) ?? 0,
    });

    await dbClient.prepare(`
      INSERT INTO inventory_stock_intelligence_snapshot
        (tenant_id, inventory_item_id, usable_stock, blocked_stock, current_stock,
         avg_daily_usage_7d, avg_daily_usage_30d, avg_daily_usage_90d, trend_label,
         lead_time_days, safety_stock_days, reorder_point, suggested_order_qty,
         days_of_cover, estimated_stockout_date, open_pr_qty, open_po_qty,
         recommendation_status, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, inventory_item_id) DO UPDATE SET
        usable_stock = excluded.usable_stock,
        blocked_stock = excluded.blocked_stock,
        current_stock = excluded.current_stock,
        avg_daily_usage_7d = excluded.avg_daily_usage_7d,
        avg_daily_usage_30d = excluded.avg_daily_usage_30d,
        avg_daily_usage_90d = excluded.avg_daily_usage_90d,
        trend_label = excluded.trend_label,
        lead_time_days = excluded.lead_time_days,
        safety_stock_days = excluded.safety_stock_days,
        reorder_point = excluded.reorder_point,
        suggested_order_qty = excluded.suggested_order_qty,
        days_of_cover = excluded.days_of_cover,
        estimated_stockout_date = excluded.estimated_stockout_date,
        open_pr_qty = excluded.open_pr_qty,
        open_po_qty = excluded.open_po_qty,
        recommendation_status = excluded.recommendation_status,
        computed_at = excluded.computed_at
    `).bind(
      tenantId,
      snapshot.inventoryItemId,
      snapshot.usableStock,
      snapshot.blockedStock,
      snapshot.currentStock,
      snapshot.avgDailyUsage7d,
      snapshot.avgDailyUsage30d,
      snapshot.avgDailyUsage90d,
      snapshot.trendLabel,
      snapshot.leadTimeDays,
      snapshot.safetyStockDays,
      snapshot.reorderPoint,
      snapshot.suggestedOrderQty,
      snapshot.daysOfCover,
      snapshot.estimatedStockoutDate,
      snapshot.openPrQty,
      snapshot.openPoQty,
      snapshot.recommendationStatus,
      now,
    ).run();
    recomputedItems += 1;

    const recommendation = buildRecommendationForSnapshot(snapshot);
    if (recommendation) {
      const existingRecommendation = await dbClient.prepare(`
        SELECT id
        FROM inventory_recommendation
        WHERE tenant_id = ? AND inventory_item_id = ? AND recommendation_type = ? AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(tenantId, snapshot.inventoryItemId, recommendation.recommendation_type).first<{ id: number }>();

      if (existingRecommendation?.id) {
        await dbClient.prepare(`
          UPDATE inventory_recommendation
          SET severity = ?, title = ?, message = ?, suggested_action = ?, suggested_quantity = ?, metadata_json = ?, updated_at = ?
          WHERE tenant_id = ? AND id = ? AND status = 'open'
        `).bind(
          recommendation.severity,
          recommendation.title,
          recommendation.message,
          recommendation.suggested_action,
          recommendation.suggested_quantity,
          recommendation.metadata_json,
          now,
          tenantId,
          existingRecommendation.id,
        ).run();
      } else {
        await dbClient.prepare(`
          INSERT INTO inventory_recommendation
            (tenant_id, recommendation_type, severity, inventory_item_id, title, message,
             suggested_action, suggested_quantity, metadata_json, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
        `).bind(
          tenantId,
          recommendation.recommendation_type,
          recommendation.severity,
          recommendation.inventory_item_id,
          recommendation.title,
          recommendation.message,
          recommendation.suggested_action,
          recommendation.suggested_quantity,
          recommendation.metadata_json,
          now,
          now,
        ).run();
      }
      generatedRecommendations += 1;
    } else {
      await dbClient.prepare(`
        UPDATE inventory_recommendation
        SET status = 'resolved', updated_at = ?
        WHERE tenant_id = ? AND inventory_item_id = ? AND status = 'open'
          AND recommendation_type IN ('stockout', 'low', 'watch')
      `).bind(now, tenantId, snapshot.inventoryItemId).run();
    }
  }

  const demandEventCount = Number(demandEventSummary?.event_count ?? 0);
  return {
    message: `Recomputed inventory intelligence for ${recomputedItems} item(s)`,
    recomputedItems,
    generatedRecommendations,
    demandEventCount,
    status: demandEventCount > 0
      ? classifyDashboardStatus({ snapshotCount: recomputedItems, lastComputedAt: now, now })
      : 'not_configured',
    lastComputedAt: recomputedItems > 0 ? now : null,
  };
}
