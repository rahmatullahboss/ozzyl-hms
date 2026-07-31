export type LisQcState = 'pass' | 'fail' | 'not_run' | 'stale' | 'config_missing' | 'system_error' | 'override';

export interface LisQcGateResult {
  state: LisQcState;
  eligible: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

interface D1LikeDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

const DEFAULT_QC_MAX_AGE_HOURS = 24;

function hasWestgardViolation(value: unknown): boolean {
  if (value == null) return false;
  const normalized = String(value).trim();
  return normalized !== '' && normalized !== '[]' && normalized !== 'null';
}

export async function evaluateLisQcGate(
  database: D1LikeDatabase,
  tenantId: string | number,
  machineId: string | number,
  labTestId: string | number,
  now: Date = new Date(),
  maxAgeHours: number = DEFAULT_QC_MAX_AGE_HOURS,
): Promise<LisQcGateResult> {
  let configuredCount: number;
  try {
    const configured = await database.prepare(`
      SELECT COUNT(*) AS total
      FROM lab_qc_ranges
      WHERE tenant_id = ? AND lab_test_id = ? AND is_active = 1
    `).bind(tenantId, labTestId).first<{ total: number }>();
    configuredCount = Number(configured?.total ?? 0);
  } catch (error) {
    return {
      state: 'system_error',
      eligible: false,
      reason: 'qc_configuration_unavailable',
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }

  if (configuredCount <= 0) {
    return { state: 'config_missing', eligible: false, reason: 'qc_not_configured' };
  }

  try {
    const calibration = await database.prepare(`
      SELECT COUNT(*) AS total
      FROM lab_calibrations
      WHERE tenant_id = ? AND machine_id = ?
        AND (
          (is_active = 1 AND status IN ('scheduled', 'in_progress', 'overdue') AND due_date < CURRENT_DATE)
          OR (COALESCE(result_status, 'pending') IN ('fail', 'pending')
              AND COALESCE(next_due_date, scheduled_date) <= CURRENT_DATE)
        )
    `).bind(tenantId, machineId).first<{ total: number }>();
    if (Number(calibration?.total ?? 0) > 0) {
      return { state: 'fail', eligible: false, reason: 'calibration_not_current' };
    }
  } catch (error) {
    return {
      state: 'system_error',
      eligible: false,
      reason: 'calibration_status_unavailable',
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }

  let latest: Record<string, unknown> | null;
  try {
    latest = await database.prepare(`
      SELECT result_value, is_out_of_range, westgard_violations, run_date, created_at
      FROM lab_qc_results
      WHERE tenant_id = ? AND machine_id = ? AND lab_test_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(tenantId, machineId, labTestId).first<Record<string, unknown>>();
  } catch (error) {
    return {
      state: 'system_error',
      eligible: false,
      reason: 'qc_result_unavailable',
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }

  if (!latest) {
    return { state: 'not_run', eligible: false, reason: 'qc_result_missing' };
  }

  if (Number(latest.is_out_of_range ?? 0) === 1 || hasWestgardViolation(latest.westgard_violations)) {
    return { state: 'fail', eligible: false, reason: 'qc_failed', details: latest };
  }

  const evidenceTimestamp = latest.created_at ?? latest.run_date;
  const evidenceDate = evidenceTimestamp ? new Date(String(evidenceTimestamp)) : null;
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  if (!evidenceDate || Number.isNaN(evidenceDate.getTime()) || now.getTime() - evidenceDate.getTime() > maxAgeMs) {
    return { state: 'stale', eligible: false, reason: 'qc_result_stale', details: latest };
  }

  return { state: 'pass', eligible: true, reason: 'qc_passed', details: latest };
}
