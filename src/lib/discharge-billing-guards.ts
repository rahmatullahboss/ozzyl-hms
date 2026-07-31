import { HTTPException } from 'hono/http-exception';

export type PendingDischargeBilling = {
  provisionalAmount: number;
  pendingServiceAmount: number;
  dueAmount: number;
};

export type PendingDischargeBillingOptions = {
  includeProvisional?: boolean;
};

function readPendingAmount(row: Record<string, unknown> | null | undefined, fallbackKey: string): number {
  const value = row?.amount ?? row?.balance ?? row?.[fallbackKey] ?? 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export async function getPendingDischargeBilling(
  db: D1Database,
  tenantId: string,
  admissionId: string | number,
  patientId: number,
  admissionDate: string | null,
  options: PendingDischargeBillingOptions = {},
): Promise<PendingDischargeBilling> {
  const includeProvisional = options.includeProvisional ?? true;
  const [provisional, services, dues] = await Promise.all([
    includeProvisional
      ? db.prepare(`
          SELECT COALESCE(SUM(total_amount), 0) AS amount
          FROM billing_provisional_items
          WHERE tenant_id = ?
            AND admission_id = ?
            AND bill_status = 'provisional'
            AND COALESCE(is_active, 1) = 1
        `).bind(tenantId, admissionId).first<Record<string, unknown>>()
      : Promise.resolve({ amount: 0 }),
    db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) AS amount
      FROM visit_services
      WHERE tenant_id = ?
        AND patient_id = ?
        AND status = ?
        AND (admission_id = ? OR admission_id IS NULL)
        AND (? IS NULL OR created_at >= ?)
    `).bind(tenantId, patientId, 'pending', admissionId, admissionDate, admissionDate).first<Record<string, unknown>>(),
    db.prepare(`
      SELECT COALESCE(SUM(due), 0) AS amount
      FROM bills
      WHERE tenant_id = ?
        AND patient_id = ?
        AND COALESCE(due, 0) > 0
        AND status != ?
        AND (admission_id = ? OR admission_id IS NULL)
        AND (? IS NULL OR created_at >= ?)
    `).bind(tenantId, patientId, 'paid', admissionId, admissionDate, admissionDate).first<Record<string, unknown>>(),
  ]);

  return {
    provisionalAmount: readPendingAmount(provisional, 'total_amount'),
    pendingServiceAmount: readPendingAmount(services, 'total_amount'),
    dueAmount: readPendingAmount(dues, 'due'),
  };
}

export function hasPendingDischargeBilling(pending: PendingDischargeBilling): boolean {
  return pending.provisionalAmount + pending.pendingServiceAmount + pending.dueAmount > 0;
}

export async function assertNoPendingDischargeBilling(
  db: D1Database,
  tenantId: string,
  admissionId: string | number,
  patientId: number,
  admissionDate: string | null,
  options: PendingDischargeBillingOptions = {},
): Promise<void> {
  const pending = await getPendingDischargeBilling(db, tenantId, admissionId, patientId, admissionDate, options);
  if (hasPendingDischargeBilling(pending)) {
    throw new HTTPException(400, {
      message: `Pending billing must be cleared before discharge. Provisional: ${pending.provisionalAmount}, services: ${pending.pendingServiceAmount}, dues: ${pending.dueAmount}`,
    });
  }
}
