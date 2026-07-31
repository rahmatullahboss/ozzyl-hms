// accounting-helpers.ts — shared audit + dashboard notification utilities

// Fields that must match EXACTLY (short names that would false-positive with includes)
const SENSITIVE_EXACT_KEYS = [
  'name',
  'summary',
  'notes',
  'token',
];

// Fields that match via substring (longer/specific names)
const SENSITIVE_AUDIT_KEYS = [
  'patientname',
  'patient_name',
  'guardianname',
  'guardian_name',
  'phone',
  'mobile',
  'guardianmobile',
  'emergencycontactphone',
  'email',
  'address',
  'nationalid',
  'national_id',
  'nid',
  'birthcertificate',
  'birth_certificate',
  'password',
  'passwordhash',
  'password_hash',
  'diagnosis',
  'prescription',
  'clinicalnotes',
  'clinical_notes',
  'reconciliationsummary',
  'reconciliation_summary',
];

function isSensitiveAuditKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  if (SENSITIVE_EXACT_KEYS.includes(normalized)) return true;
  return SENSITIVE_AUDIT_KEYS.some((sensitiveKey) => normalized.includes(sensitiveKey));
}

export function redactAuditValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item));
  if (typeof value !== 'object') return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = isSensitiveAuditKey(key) ? '[REDACTED]' : redactAuditValue(nestedValue);
  }
  return redacted;
}

function stringifyAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(redactAuditValue(value));
}

export async function notifyDashboard(
  env: { DASHBOARD_DO?: DurableObjectNamespace },
  tenantId: string,
  type: 'income' | 'expense',
  amount: number,
  isToday: boolean = true,
  isMTD: boolean = true
): Promise<void> {
  // Fire-and-forget: dashboard notification failures must never break the main flow
  try {
    if (!env.DASHBOARD_DO) return;
    const doId = env.DASHBOARD_DO.idFromName(tenantId);
    const doStub = env.DASHBOARD_DO.get(doId) as DurableObjectStub & {
      updateIncome?: (amount: number, isToday: boolean, isMTD: boolean) => Promise<void>;
      updateExpense?: (amount: number, isToday: boolean, isMTD: boolean) => Promise<void>;
    };

    if (type === 'income' && doStub.updateIncome) {
      await doStub.updateIncome(amount, isToday, isMTD);
    } else if (type === 'expense' && doStub.updateExpense) {
      await doStub.updateExpense(amount, isToday, isMTD);
    }
  } catch (error) {
    console.error('Error notifying dashboard:', error);
  }
}

/**
 * Creates an audit log entry in the database.
 * This is an async function but is often called without 'await' to avoid blocking the main flow.
 * 
 * @param env - The environment object containing the D1 database binding.
 * @param tenantId - The unique identifier for the tenant.
 * @param userId - The ID of the user performing the action.
 * @param action - The type of action (e.g., 'CREATE', 'UPDATE', 'DELETE', 'PAYMENT', 'RESULT').
 * @param tableName - The name of the table being affected.
 * @param recordId - The ID of the specific record in the table.
 * @param oldValue - The state of the record before the change (optional).
 * @param newValue - The state of the record after the change (optional).
 * @param ipAddress - The IP address of the requester (optional).
 * @param userAgent - The user agent string of the requester (optional).
 */
export async function createAuditLog(
  env: { DB: D1Database },
  tenantId: string,
  userId: string,
  action: string,
  tableName: string,
  recordId: number,
  oldValue?: any,
  newValue?: any,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id, 
        old_value, new_value, ip_address, user_agent, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      tenantId,
      userId,
      action,
      tableName,
      recordId,
      stringifyAuditValue(oldValue),
      stringifyAuditValue(newValue),
      ipAddress || null,
      userAgent || null
    ).run();
  } catch (error) {
    console.error('Error creating audit log:', error);
  }
}
