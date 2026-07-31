export type ConsumptionReportDb = {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      all<T = unknown>(): Promise<{ results?: T[] }>;
    };
  };
};

export type ConsumptionReconciliationFilters = {
  from?: string;
  to?: string;
  department?: string;
};

export type ConsumptionReconciliationRow = {
  Department?: string | null;
  Status?: string | null;
  EventCount: number;
  ExpectedQty: number;
  ActualQty: number;
  VarianceQty: number;
};

export type ConsumptionReconciliationSummary = {
  totalEvents: number;
  expectedQty: number;
  actualQty: number;
  varianceQty: number;
  highVarianceRows: number;
};

export type ConsumptionRuleCoverageFilters = ConsumptionReconciliationFilters & {
  triggerType?: string;
};

export type ConsumptionRuleCoverageRow = {
  TriggerType: string;
  TriggerId?: number | null;
  TriggerCode?: string | null;
  Department?: string | null;
  EventCount: number;
  MatchedRuleEvents: number;
  MissingRuleEvents: number;
  RuleCount: number;
  HasActiveRule: number;
};

export type ConsumptionRuleCoverageSummary = {
  totalTriggers: number;
  coveredTriggers: number;
  missingTriggers: number;
  eventCount: number;
  missingRuleEvents: number;
};

function normalizeDate(value?: string): string | undefined {
  const trimmed = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : undefined;
}

export async function listConsumptionReconciliationRows<T extends ConsumptionReconciliationRow = ConsumptionReconciliationRow>(
  db: ConsumptionReportDb,
  tenantId: string,
  filters: ConsumptionReconciliationFilters = {},
): Promise<T[]> {
  const tenant = String(tenantId || '').trim();
  if (!tenant) throw new Error('tenantId is required');
  const where = ['e.tenant_id = ?'];
  const params: unknown[] = [tenant];
  const from = normalizeDate(filters.from);
  const to = normalizeDate(filters.to);
  if (from) {
    where.push('DATE(COALESCE(e.ExpectedAt, e.CreatedOn)) >= ?');
    params.push(from);
  }
  if (to) {
    where.push('DATE(COALESCE(e.ExpectedAt, e.CreatedOn)) <= ?');
    params.push(to);
  }
  if (filters.department) {
    where.push('e.Department = ?');
    params.push(filters.department);
  }

  const rows = await db.prepare(`
    SELECT
      COALESCE(e.Department, 'Unassigned') AS Department,
      e.Status AS Status,
      COUNT(DISTINCT e.EventId) AS EventCount,
      COALESCE(SUM(i.ExpectedQuantity), 0) AS ExpectedQty,
      COALESCE(SUM(COALESCE(i.ActualQuantity, i.ExpectedQuantity)), 0) AS ActualQty,
      COALESCE(SUM(COALESCE(i.VarianceQty, COALESCE(i.ActualQuantity, i.ExpectedQuantity) - i.ExpectedQuantity)), 0) AS VarianceQty
    FROM InventoryConsumptionEvent e
    LEFT JOIN InventoryConsumptionEventItem i ON i.tenant_id = e.tenant_id AND i.EventId = e.EventId
    WHERE ${where.join(' AND ')}
    GROUP BY COALESCE(e.Department, 'Unassigned'), e.Status
    ORDER BY ABS(VarianceQty) DESC, EventCount DESC
    LIMIT 200
  `).bind(...params).all<T>();
  return rows.results ?? [];
}

export function buildConsumptionReconciliationSummary(rows: ConsumptionReconciliationRow[]): ConsumptionReconciliationSummary {
  return rows.reduce<ConsumptionReconciliationSummary>((summary, row) => {
    const eventCount = Number(row.EventCount ?? 0);
    const expectedQty = Number(row.ExpectedQty ?? 0);
    const actualQty = Number(row.ActualQty ?? 0);
    const varianceQty = Number(row.VarianceQty ?? 0);
    return {
      totalEvents: summary.totalEvents + eventCount,
      expectedQty: summary.expectedQty + expectedQty,
      actualQty: summary.actualQty + actualQty,
      varianceQty: summary.varianceQty + varianceQty,
      highVarianceRows: summary.highVarianceRows + (Math.abs(varianceQty) > 0 ? 1 : 0),
    };
  }, { totalEvents: 0, expectedQty: 0, actualQty: 0, varianceQty: 0, highVarianceRows: 0 });
}

export async function listConsumptionRuleCoverageRows<T extends ConsumptionRuleCoverageRow = ConsumptionRuleCoverageRow>(
  db: ConsumptionReportDb,
  tenantId: string,
  filters: ConsumptionRuleCoverageFilters = {},
): Promise<T[]> {
  const tenant = String(tenantId || '').trim();
  if (!tenant) throw new Error('tenantId is required');
  const where = ['e.tenant_id = ?'];
  const params: unknown[] = [tenant];
  const from = normalizeDate(filters.from);
  const to = normalizeDate(filters.to);
  const department = normalizeOptionalString(filters.department);
  const triggerType = normalizeOptionalString(filters.triggerType);
  if (from) {
    where.push('DATE(COALESCE(e.ExpectedAt, e.CreatedOn)) >= ?');
    params.push(from);
  }
  if (to) {
    where.push('DATE(COALESCE(e.ExpectedAt, e.CreatedOn)) <= ?');
    params.push(to);
  }
  if (department) {
    where.push('e.Department = ?');
    params.push(department);
  }
  if (triggerType) {
    where.push('e.TriggerType = ?');
    params.push(triggerType);
  }

  const rows = await db.prepare(`
    SELECT
      e.TriggerType AS TriggerType,
      e.TriggerId AS TriggerId,
      e.TriggerCode AS TriggerCode,
      COALESCE(e.Department, 'Unassigned') AS Department,
      COUNT(DISTINCT e.EventId) AS EventCount,
      COUNT(DISTINCT r.RuleId) AS RuleCount,
      CASE WHEN COUNT(DISTINCT r.RuleId) > 0 THEN 1 ELSE 0 END AS HasActiveRule,
      SUM(CASE WHEN r.RuleId IS NOT NULL AND e.Status <> 'blocked_missing_rule' THEN 1 ELSE 0 END) AS MatchedRuleEvents,
      SUM(CASE WHEN r.RuleId IS NULL OR e.Status = 'blocked_missing_rule' THEN 1 ELSE 0 END) AS MissingRuleEvents
    FROM InventoryConsumptionEvent e
    LEFT JOIN InventoryConsumptionRule r
      ON r.tenant_id = e.tenant_id
      AND r.TriggerType = e.TriggerType
      AND COALESCE(r.IsActive, 1) = 1
      AND (r.Department IS NULL OR r.Department = e.Department)
      AND (
        (r.TriggerId IS NOT NULL AND r.TriggerId = e.TriggerId)
        OR (r.TriggerCode IS NOT NULL AND e.TriggerCode IS NOT NULL AND r.TriggerCode = e.TriggerCode)
        OR (r.TriggerId IS NULL AND r.TriggerCode IS NULL)
      )
    WHERE ${where.join(' AND ')}
    GROUP BY e.TriggerType, e.TriggerId, e.TriggerCode, COALESCE(e.Department, 'Unassigned')
    ORDER BY MissingRuleEvents DESC, EventCount DESC
    LIMIT 200
  `).bind(...params).all<T>();
  return rows.results ?? [];
}

export function buildConsumptionRuleCoverageSummary(rows: ConsumptionRuleCoverageRow[]): ConsumptionRuleCoverageSummary {
  return rows.reduce<ConsumptionRuleCoverageSummary>((summary, row) => {
    const eventCount = Number(row.EventCount ?? 0);
    const missingRuleEvents = Number(row.MissingRuleEvents ?? 0);
    const hasRule = Number(row.HasActiveRule ?? 0) > 0;
    return {
      totalTriggers: summary.totalTriggers + 1,
      coveredTriggers: summary.coveredTriggers + (hasRule ? 1 : 0),
      missingTriggers: summary.missingTriggers + (hasRule ? 0 : 1),
      eventCount: summary.eventCount + eventCount,
      missingRuleEvents: summary.missingRuleEvents + missingRuleEvents,
    };
  }, { totalTriggers: 0, coveredTriggers: 0, missingTriggers: 0, eventCount: 0, missingRuleEvents: 0 });
}
