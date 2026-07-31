/**
 * Follow-up validity system for Bangladesh healthcare context.
 *
 * Follow-up visits are valid for a configurable number of days (default 7).
 * Report show visits are valid for a configurable number of days (default 15).
 * After that window, the patient must pay for a new visit.
 */

export const DEFAULT_FOLLOW_UP_VALID_DAYS = 7;
export const DEFAULT_REPORT_SHOW_VALID_DAYS = 15;

export type ValidityBadge =
  | 'new_visit'
  | 'valid_follow_up'
  | 'follow_up_expired'
  | 'valid_report_show'
  | 'report_show_expired';

export interface ValidityResult {
  badge: ValidityBadge;
  days_elapsed: number;
  valid_days: number;
}

/**
 * Map appointment_type to visit validity category.
 * - follow_up / old_patient / followup → follow_up
 * - report_show → report_show
 * - everything else → new_visit (always valid)
 */
function resolveVisitType(appointmentType: string | null | undefined): 'new_visit' | 'follow_up' | 'report_show' {
  const normalized = String(appointmentType ?? '').toLowerCase().trim();
  if (['follow_up', 'old_patient', 'followup'].includes(normalized)) return 'follow_up';
  if (normalized === 'report_show') return 'report_show';
  return 'new_visit';
}

/**
 * Calculate days between two YYYY-MM-DD dates.
 */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const fromDate = new Date(Date.UTC(fy, fm - 1, fd));
  const toDate = new Date(Date.UTC(ty, tm - 1, td));
  return Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000);
}

/**
 * Calculate the validity badge for an appointment based on its type and date.
 *
 * @param appointmentType - The appointment_type field from the appointments table
 * @param appointmentDate - The appt_date (YYYY-MM-DD)
 * @param today - Today's date (YYYY-MM-DD)
 * @param followUpDays - Number of days a follow-up is valid (default 7)
 * @param reportShowDays - Number of days a report show is valid (default 15)
 */
export function calculateVisitValidity(
  appointmentType: string | null | undefined,
  appointmentDate: string,
  today: string,
  followUpDays: number = DEFAULT_FOLLOW_UP_VALID_DAYS,
  reportShowDays: number = DEFAULT_REPORT_SHOW_VALID_DAYS,
): ValidityResult {
  const visitType = resolveVisitType(appointmentType);
  const elapsed = daysBetween(appointmentDate, today);

  if (visitType === 'follow_up') {
    return {
      badge: elapsed <= followUpDays ? 'valid_follow_up' : 'follow_up_expired',
      days_elapsed: elapsed,
      valid_days: followUpDays,
    };
  }

  if (visitType === 'report_show') {
    return {
      badge: elapsed <= reportShowDays ? 'valid_report_show' : 'report_show_expired',
      days_elapsed: elapsed,
      valid_days: reportShowDays,
    };
  }

  // new_visit — always valid
  return {
    badge: 'new_visit',
    days_elapsed: elapsed,
    valid_days: 0,
  };
}

/**
 * Read validity settings from the settings table.
 * Falls back to defaults if no rows exist.
 */
export async function getValiditySettings(
  db: D1Database,
  tenantId: string,
): Promise<{ follow_up_valid_days: number; report_show_valid_days: number }> {
  const followUpRow = await db.prepare(
    `SELECT value FROM settings WHERE key = ? AND tenant_id = ?`
  ).bind('follow_up_valid_days', tenantId).first<{ value: string }>();

  const reportShowRow = await db.prepare(
    `SELECT value FROM settings WHERE key = ? AND tenant_id = ?`
  ).bind('report_show_valid_days', tenantId).first<{ value: string }>();

  return {
    follow_up_valid_days: followUpRow ? Math.max(1, Math.min(90, Number(followUpRow.value) || DEFAULT_FOLLOW_UP_VALID_DAYS)) : DEFAULT_FOLLOW_UP_VALID_DAYS,
    report_show_valid_days: reportShowRow ? Math.max(1, Math.min(90, Number(reportShowRow.value) || DEFAULT_REPORT_SHOW_VALID_DAYS)) : DEFAULT_REPORT_SHOW_VALID_DAYS,
  };
}

/**
 * Upsert a single validity setting.
 */
export async function upsertValiditySetting(
  db: D1Database,
  tenantId: string,
  key: string,
  value: number,
): Promise<void> {
  const existing = await db.prepare(
    `SELECT id FROM settings WHERE key = ? AND tenant_id = ?`
  ).bind(key, tenantId).first<{ id: number }>();

  if (existing) {
    await db.prepare(
      `UPDATE settings SET value = ?, updated_at = datetime('now', '+6 hours') WHERE key = ? AND tenant_id = ?`
    ).bind(String(value), key, tenantId).run();
  } else {
    await db.prepare(
      `INSERT INTO settings (key, value, tenant_id) VALUES (?, ?, ?)`
    ).bind(key, String(value), tenantId).run();
  }
}
