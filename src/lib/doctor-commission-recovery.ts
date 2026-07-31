export type DoctorCommissionRecoveryApplication = {
  adjustmentId: number;
  amount: number;
};

type OutstandingRecoveryRow = {
  adjustment_id: number;
  outstanding_amount: number;
};

function money(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

export function allocateDoctorCommissionRecoveries(
  rows: Array<{ adjustmentId: number; outstandingAmount: number }>,
  maxDeduction: number,
): { applications: DoctorCommissionRecoveryApplication[]; totalDeduction: number } {
  let remaining = Math.max(0, money(maxDeduction));
  const applications: DoctorCommissionRecoveryApplication[] = [];

  for (const row of rows) {
    if (remaining <= 0) break;
    const outstanding = Math.max(0, money(row.outstandingAmount));
    if (outstanding <= 0) continue;
    const amount = money(Math.min(outstanding, remaining));
    if (amount <= 0) continue;
    applications.push({ adjustmentId: row.adjustmentId, amount });
    remaining = money(remaining - amount);
  }

  return {
    applications,
    totalDeduction: money(applications.reduce((sum, row) => sum + row.amount, 0)),
  };
}

export async function prepareDoctorCommissionRecoveryStatements(
  db: D1Database,
  input: {
    tenantId: string;
    doctorId: number;
    settlementIdempotencyKey: string;
    maxDeduction: number;
    createdBy: string | number;
  },
): Promise<{
  statements: D1PreparedStatement[];
  applications: DoctorCommissionRecoveryApplication[];
  totalDeduction: number;
}> {
  const tenantId = input.tenantId.trim();
  const settlementIdempotencyKey = input.settlementIdempotencyKey.trim();
  if (!tenantId) throw new TypeError('tenantId cannot be empty');
  if (!Number.isSafeInteger(input.doctorId) || input.doctorId <= 0) {
    throw new RangeError('doctorId must be a positive safe integer');
  }
  if (!settlementIdempotencyKey) throw new TypeError('settlementIdempotencyKey cannot be empty');

  const { results } = await db.prepare(`
    SELECT
      adjustment.id AS adjustment_id,
      ROUND(MAX(0, adjustment.amount - COALESCE(SUM(application.amount), 0)), 2) AS outstanding_amount
    FROM doctor_commission_adjustments adjustment
    LEFT JOIN doctor_commission_adjustment_applications application
      ON application.tenant_id = adjustment.tenant_id
     AND application.adjustment_id = adjustment.id
    WHERE adjustment.tenant_id = ?
      AND adjustment.doctor_id = ?
      AND adjustment.adjustment_type = 'clawback'
      AND adjustment.status IN ('outstanding','applied')
    GROUP BY adjustment.id, adjustment.amount, adjustment.created_at
    HAVING outstanding_amount > 0.009
    ORDER BY adjustment.created_at ASC, adjustment.id ASC
  `).bind(tenantId, input.doctorId).all<OutstandingRecoveryRow>();

  const allocation = allocateDoctorCommissionRecoveries(
    (results ?? []).map((row) => ({
      adjustmentId: Number(row.adjustment_id),
      outstandingAmount: Number(row.outstanding_amount),
    })),
    input.maxDeduction,
  );

  if (allocation.applications.length === 0) {
    return { statements: [], ...allocation };
  }

  const statements: D1PreparedStatement[] = [];
  for (const application of allocation.applications) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO doctor_commission_adjustment_applications (
        tenant_id,adjustment_id,settlement_id,amount,created_by
      )
      SELECT ?, adjustment.id, settlement.id, ?, ?
      FROM doctor_commission_adjustments adjustment
      JOIN doctor_commission_settlements settlement
        ON settlement.tenant_id = adjustment.tenant_id
       AND settlement.doctor_id = adjustment.doctor_id
      WHERE adjustment.tenant_id = ?
        AND adjustment.id = ?
        AND adjustment.doctor_id = ?
        AND adjustment.adjustment_type = 'clawback'
        AND adjustment.status IN ('outstanding','applied')
        AND settlement.idempotency_key = ?
        AND ROUND(
          adjustment.amount - COALESCE((
            SELECT SUM(existing.amount)
            FROM doctor_commission_adjustment_applications existing
            WHERE existing.tenant_id = adjustment.tenant_id
              AND existing.adjustment_id = adjustment.id
          ), 0),
          2
        ) >= ? - 0.009
    `).bind(
      tenantId,
      application.amount,
      input.createdBy,
      tenantId,
      application.adjustmentId,
      input.doctorId,
      settlementIdempotencyKey,
      application.amount,
    ));

    statements.push(db.prepare(`
      UPDATE doctor_commission_adjustments
      SET status = CASE
            WHEN COALESCE((
              SELECT SUM(application.amount)
              FROM doctor_commission_adjustment_applications application
              WHERE application.tenant_id = doctor_commission_adjustments.tenant_id
                AND application.adjustment_id = doctor_commission_adjustments.id
            ), 0) >= amount - 0.009 THEN 'applied'
            ELSE 'outstanding'
          END,
          settlement_id = (
            SELECT settlement.id
            FROM doctor_commission_settlements settlement
            WHERE settlement.tenant_id = ?
              AND settlement.doctor_id = ?
              AND settlement.idempotency_key = ?
            LIMIT 1
          ),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND doctor_id = ?
        AND id = ?
        AND adjustment_type = 'clawback'
    `).bind(
      tenantId,
      input.doctorId,
      settlementIdempotencyKey,
      tenantId,
      input.doctorId,
      application.adjustmentId,
    ));
  }

  const exactApplicationClauses = allocation.applications.map(() => `
    ABS(COALESCE((
      SELECT application.amount
      FROM doctor_commission_adjustment_applications application
      JOIN doctor_commission_settlements settlement
        ON settlement.tenant_id = application.tenant_id
       AND settlement.id = application.settlement_id
      WHERE application.tenant_id = ?
        AND settlement.idempotency_key = ?
        AND application.adjustment_id = ?
      LIMIT 1
    ), -1) - ?) > 0.009
  `);
  const guardBindings: Array<string | number> = [
    tenantId,
    settlementIdempotencyKey,
    tenantId,
    settlementIdempotencyKey,
    allocation.applications.length,
    tenantId,
    settlementIdempotencyKey,
    allocation.totalDeduction,
  ];
  for (const application of allocation.applications) {
    guardBindings.push(tenantId, settlementIdempotencyKey, application.adjustmentId, application.amount);
  }

  statements.push(db.prepare(`
    INSERT INTO doctor_commission_adjustment_applications (
      tenant_id,adjustment_id,settlement_id,amount
    )
    SELECT NULL,-1,-1,0
    WHERE
      (SELECT COUNT(*)
       FROM doctor_commission_settlements settlement
       WHERE settlement.tenant_id = ?
         AND settlement.idempotency_key = ?) <> 1
      OR (SELECT COUNT(*)
          FROM doctor_commission_adjustment_applications application
          JOIN doctor_commission_settlements settlement
            ON settlement.tenant_id = application.tenant_id
           AND settlement.id = application.settlement_id
          WHERE application.tenant_id = ?
            AND settlement.idempotency_key = ?) <> ?
      OR ABS((SELECT COALESCE(SUM(application.amount), 0)
              FROM doctor_commission_adjustment_applications application
              JOIN doctor_commission_settlements settlement
                ON settlement.tenant_id = application.tenant_id
               AND settlement.id = application.settlement_id
              WHERE application.tenant_id = ?
                AND settlement.idempotency_key = ?) - ?) > 0.009
      OR ${exactApplicationClauses.join('\n      OR ')}
  `).bind(...guardBindings));

  return { statements, ...allocation };
}
