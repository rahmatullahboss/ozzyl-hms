/**
 * OT Reports Service
 *
 * Deterministic SQL aggregations for OT reporting.
 * No LLM, no side effects — pure read-only queries.
 *
 * Blueprint §25: Daily, Financial, Inventory, Clinical, Utilization reports.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DailyReport {
  date: string;
  total_scheduled: number;
  completed: number;
  cancelled: number;
  emergency: number;
  in_progress: number;
  room_utilization: Array<{ room_name: string; bookings: number; utilization_pct: number }>;
  surgeon_cases: Array<{ surgeon_name: string; cases: number }>;
  procedure_cases: Array<{ surgery_type: string; cases: number }>;
}

export interface FinancialReport {
  date_from: string;
  date_to: string;
  total_revenue: number;
  surgery_charges: number;
  medicine_charges: number;
  implant_charges: number;
  surgeon_commission: number;
  anesthetist_commission: number;
  total_discount: number;
  net_revenue: number;
}

export interface InventoryReport {
  date_from: string;
  date_to: string;
  total_items_used: number;
  total_value: number;
  by_source: Array<{ source: string; items: number; value: number }>;
  by_charge_head: Array<{ charge_head: string; items: number; value: number }>;
  wastage: { items: number; value: number };
  returned: { items: number; value: number };
}

export interface UtilizationReport {
  date_from: string;
  date_to: string;
  room_utilization: Array<{ room_name: string; total_bookings: number; avg_duration_min: number; utilization_pct: number }>;
  avg_surgery_duration_min: number;
  avg_cleaning_duration_min: number;
  delay_reasons: Array<{ reason: string; count: number }>;
}

// ─── Report Generators ───────────────────────────────────────────────────────

export async function generateDailyReport(
  db: D1Database, tenantId: string, date: string,
): Promise<DailyReport> {
  const prep = (sql: string) => db.prepare(sql).bind(tenantId, date);

  const [total, completed, cancelled, emergency, inProgress, rooms, surgeons, procedures] = await Promise.all([
    prep(`SELECT COUNT(*) as total FROM ot_bookings WHERE tenant_id = ? AND booked_for_date = ? AND is_active = 1`).first<{ total: number }>(),
    prep(`SELECT COUNT(*) as count FROM ot_bookings WHERE tenant_id = ? AND booked_for_date = ? AND operation_status IN ('completed','case_completed','sign_out')`).first<{ count: number }>(),
    prep(`SELECT COUNT(*) as count FROM ot_bookings WHERE tenant_id = ? AND booked_for_date = ? AND operation_status = 'cancelled'`).first<{ count: number }>(),
    prep(`SELECT COUNT(*) as count FROM ot_bookings WHERE tenant_id = ? AND booked_for_date = ? AND is_emergency = 1`).first<{ count: number }>(),
    prep(`SELECT COUNT(*) as count FROM ot_bookings WHERE tenant_id = ? AND booked_for_date = ? AND operation_status = 'in_progress'`).first<{ count: number }>(),
    db.prepare(`
      SELECT r.name as room_name, COUNT(b.id) as bookings,
             ROUND(COUNT(b.id) * 100.0 / MAX((SELECT COUNT(*) FROM ot_bookings WHERE tenant_id = ? AND booked_for_date = ? AND is_active = 1), 1), 1) as utilization_pct
        FROM ot_rooms r LEFT JOIN ot_bookings b ON b.room_id = r.id AND b.tenant_id = ? AND b.booked_for_date = ? AND b.is_active = 1
       WHERE r.tenant_id = ? AND r.is_active = 1
       GROUP BY r.id ORDER BY r.name
    `).bind(tenantId, date, tenantId, date, tenantId).all<{ room_name: string; bookings: number; utilization_pct: number }>(),
    db.prepare(`
      SELECT s.name as surgeon_name, COUNT(t.id) as cases
        FROM ot_team_members t JOIN staff s ON s.id = t.staff_id AND s.tenant_id = t.tenant_id
       WHERE t.tenant_id = ? AND t.role_type = 'surgeon'
         AND t.booking_id IN (SELECT id FROM ot_bookings WHERE tenant_id = ? AND booked_for_date = ? AND is_active = 1)
       GROUP BY t.staff_id ORDER BY cases DESC
    `).bind(tenantId, tenantId, date).all<{ surgeon_name: string; cases: number }>(),
    db.prepare(`
      SELECT surgery_type, COUNT(*) as cases
        FROM ot_bookings WHERE tenant_id = ? AND booked_for_date = ? AND is_active = 1 AND surgery_type IS NOT NULL
       GROUP BY surgery_type ORDER BY cases DESC
    `).bind(tenantId, date).all<{ surgery_type: string; cases: number }>(),
  ]);

  return {
    date,
    total_scheduled: total?.total ?? 0,
    completed: completed?.count ?? 0,
    cancelled: cancelled?.count ?? 0,
    emergency: emergency?.count ?? 0,
    in_progress: inProgress?.count ?? 0,
    room_utilization: rooms?.results ?? [],
    surgeon_cases: surgeons?.results ?? [],
    procedure_cases: procedures?.results ?? [],
  };
}

export async function generateFinancialReport(
  db: D1Database, tenantId: string, dateFrom: string, dateTo: string,
): Promise<FinancialReport> {
  const [totals, chargeHeads, surgeonComm, anesthetistComm] = await Promise.all([
    db.prepare(`
      SELECT COALESCE(SUM(gross_amount), 0) as total_revenue,
             COALESCE(SUM(discount_amount), 0) as total_discount,
             COALESCE(SUM(net_amount), 0) as net_revenue
        FROM ot_bills WHERE tenant_id = ? AND status = 'posted'
          AND created_at >= ? AND created_at <= ?
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').first<{ total_revenue: number; total_discount: number; net_revenue: number }>(),
    db.prepare(`
      SELECT i.charge_head, COALESCE(SUM(i.total), 0) as total
        FROM ot_bill_items i JOIN ot_bills b ON b.id = i.ot_bill_id AND b.tenant_id = i.tenant_id
       WHERE i.tenant_id = ? AND b.status = 'posted'
         AND b.created_at >= ? AND b.created_at <= ?
       GROUP BY i.charge_head
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').all<{ charge_head: string; total: number }>(),
    db.prepare(`
      SELECT COALESCE(SUM(commission_amount), 0) as total
        FROM ot_commissions WHERE tenant_id = ? AND role IN ('chief_surgeon','assistant_surgeon')
          AND created_at >= ? AND created_at <= ?
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').first<{ total: number }>(),
    db.prepare(`
      SELECT COALESCE(SUM(commission_amount), 0) as total
        FROM ot_commissions WHERE tenant_id = ? AND role = 'anesthetist'
          AND created_at >= ? AND created_at <= ?
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').first<{ total: number }>(),
  ]);

  const headMap: Record<string, number> = {};
  for (const row of chargeHeads?.results ?? []) {
    headMap[row.charge_head] = row.total;
  }

  return {
    date_from: dateFrom,
    date_to: dateTo,
    total_revenue: totals?.total_revenue ?? 0,
    surgery_charges: headMap['surgery'] ?? 0,
    medicine_charges: headMap['medicines'] ?? 0,
    implant_charges: headMap['implant'] ?? 0,
    surgeon_commission: surgeonComm?.total ?? 0,
    anesthetist_commission: anesthetistComm?.total ?? 0,
    total_discount: totals?.total_discount ?? 0,
    net_revenue: totals?.net_revenue ?? 0,
  };
}

export async function generateInventoryReport(
  db: D1Database, tenantId: string, dateFrom: string, dateTo: string,
): Promise<InventoryReport> {
  const [totals, bySource, byChargeHead, wastage, returned] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) as total_items, COALESCE(SUM(unit_price * qty_used), 0) as total_value
        FROM ot_inventory_consumptions WHERE tenant_id = ? AND status = 'used'
          AND created_at >= ? AND created_at <= ?
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').first<{ total_items: number; total_value: number }>(),
    db.prepare(`
      SELECT source, COUNT(*) as items, COALESCE(SUM(unit_price * qty_used), 0) as value
        FROM ot_inventory_consumptions WHERE tenant_id = ? AND status = 'used'
          AND created_at >= ? AND created_at <= ?
       GROUP BY source ORDER BY value DESC
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').all<{ source: string; items: number; value: number }>(),
    db.prepare(`
      SELECT charge_head, COUNT(*) as items, COALESCE(SUM(unit_price * qty_used), 0) as value
        FROM ot_inventory_consumptions WHERE tenant_id = ? AND status = 'used'
          AND created_at >= ? AND created_at <= ?
       GROUP BY charge_head ORDER BY value DESC
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').all<{ charge_head: string; items: number; value: number }>(),
    db.prepare(`
      SELECT COUNT(*) as items, COALESCE(SUM(unit_price * qty_wasted), 0) as value
        FROM ot_inventory_consumptions WHERE tenant_id = ? AND status = 'wasted'
          AND created_at >= ? AND created_at <= ?
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').first<{ items: number; value: number }>(),
    db.prepare(`
      SELECT COUNT(*) as items, COALESCE(SUM(unit_price * qty_returned), 0) as value
        FROM ot_inventory_consumptions WHERE tenant_id = ? AND status = 'returned'
          AND created_at >= ? AND created_at <= ?
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').first<{ items: number; value: number }>(),
  ]);

  return {
    date_from: dateFrom,
    date_to: dateTo,
    total_items_used: totals?.total_items ?? 0,
    total_value: totals?.total_value ?? 0,
    by_source: bySource?.results ?? [],
    by_charge_head: byChargeHead?.results ?? [],
    wastage: { items: wastage?.items ?? 0, value: wastage?.value ?? 0 },
    returned: { items: returned?.items ?? 0, value: returned?.value ?? 0 },
  };
}

export async function generateUtilizationReport(
  db: D1Database, tenantId: string, dateFrom: string, dateTo: string,
): Promise<UtilizationReport> {
  const [rooms, avgSurgery, avgCleaning, delays] = await Promise.all([
    db.prepare(`
      SELECT r.name as room_name, COUNT(b.id) as total_bookings,
             ROUND(AVG(CASE WHEN b.actual_end IS NOT NULL AND b.actual_start IS NOT NULL
               THEN (julianday(b.actual_end) - julianday(b.actual_start)) * 1440 ELSE NULL END), 0) as avg_duration_min,
             ROUND(COUNT(b.id) * 100.0 / MAX((SELECT COUNT(*) FROM ot_bookings WHERE tenant_id = ? AND booked_for_date >= ? AND booked_for_date <= ? AND is_active = 1), 1), 1) as utilization_pct
        FROM ot_rooms r LEFT JOIN ot_bookings b ON b.room_id = r.id AND b.tenant_id = ? AND b.booked_for_date >= ? AND b.booked_for_date <= ? AND b.is_active = 1
       WHERE r.tenant_id = ? AND r.is_active = 1
       GROUP BY r.id ORDER BY r.name
    `).bind(tenantId, dateFrom, dateTo, tenantId, dateFrom, dateTo, tenantId).all<{ room_name: string; total_bookings: number; avg_duration_min: number; utilization_pct: number }>(),
    db.prepare(`
      SELECT ROUND(AVG(CASE WHEN actual_end IS NOT NULL AND actual_start IS NOT NULL
        THEN (julianday(actual_end) - julianday(actual_start)) * 1440 ELSE NULL END), 0) as avg_duration
        FROM ot_bookings WHERE tenant_id = ? AND booked_for_date >= ? AND booked_for_date <= ? AND is_active = 1
    `).bind(tenantId, dateFrom, dateTo).first<{ avg_duration: number }>(),
    db.prepare(`
      SELECT ROUND(AVG(cleaning_duration_minutes), 0) as avg_duration
        FROM ot_rooms WHERE tenant_id = ? AND is_active = 1
    `).bind(tenantId).first<{ avg_duration: number }>(),
    db.prepare(`
      SELECT reason, COUNT(*) as count
        FROM ot_status_events WHERE tenant_id = ? AND reason IS NOT NULL AND reason != ''
          AND created_at >= ? AND created_at <= ?
       GROUP BY reason ORDER BY count DESC LIMIT 10
    `).bind(tenantId, dateFrom, dateTo + ' 23:59:59').all<{ reason: string; count: number }>(),
  ]);

  return {
    date_from: dateFrom,
    date_to: dateTo,
    room_utilization: rooms?.results ?? [],
    avg_surgery_duration_min: avgSurgery?.avg_duration ?? 0,
    avg_cleaning_duration_min: avgCleaning?.avg_duration ?? 0,
    delay_reasons: delays?.results ?? [],
  };
}
