export type DoctorWaiverAvailabilityAccrual = {
  id: number;
  billId: number | null;
  patientId: number | null;
  sourceType: string | null;
  amount: number;
  accruedDate: string | null;
};

export type DoctorWaiverAvailability = {
  doctorId: number;
  doctorName: string | null;
  availableWaiverAmount: number;
  basis: 'pending_commission_accruals';
  accruals: DoctorWaiverAvailabilityAccrual[];
};

function roundMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

type AccrualRow = {
  id: number;
  bill_id: number | null;
  patient_id: number | null;
  source_type: string | null;
  commission_amount: number | null;
  earned_commission_amount: number | null;
  doctor_waiver_amount: number | null;
  payable_commission_amount: number | null;
  paid_amount: number | null;
  balance_amount: number | null;
  accrued_date: string | null;
};

type DoctorRow = { name: string | null };

export function calculateAccrualAvailableWaiverAmount(row: {
  commissionAmount?: number | null;
  earnedCommissionAmount?: number | null;
  doctorWaiverAmount?: number | null;
  payableCommissionAmount?: number | null;
  paidAmount?: number | null;
  balanceAmount?: number | null;
}): number {
  const explicitBalance = roundMoney(row.balanceAmount);
  if (explicitBalance > 0) return explicitBalance;

  const payable = roundMoney(row.payableCommissionAmount);
  const paid = roundMoney(row.paidAmount);
  if (payable > 0) return roundMoney(Math.max(0, payable - paid));

  const earned = roundMoney(row.earnedCommissionAmount || row.commissionAmount);
  const waived = roundMoney(row.doctorWaiverAmount);
  return roundMoney(Math.max(0, earned - waived - paid));
}

export async function getDoctorWaiverAvailability(
  db: D1Database,
  tenantId: string,
  doctorId: number,
  options: { patientId?: number | null; limit?: number } = {},
): Promise<DoctorWaiverAvailability> {
  const doctor = await db.prepare(`
    SELECT name
    FROM doctors
    WHERE tenant_id = ? AND id = ? AND (is_active = 1 OR is_active IS NULL)
    LIMIT 1
  `).bind(tenantId, doctorId).first<DoctorRow>();

  const filters = [
    'tenant_id = ?',
    'doctor_id = ?',
    "status IN ('accrued', 'approved')",
  ];
  const params: Array<string | number> = [tenantId, doctorId];
  if (options.patientId) {
    filters.push('patient_id = ?');
    params.push(options.patientId);
  }
  const limit = Math.min(Math.max(Number(options.limit ?? 50), 1), 100);

  const { results } = await db.prepare(`
    SELECT id, bill_id, patient_id, source_type, commission_amount,
           earned_commission_amount, doctor_waiver_amount, payable_commission_amount,
           paid_amount, balance_amount, accrued_date
    FROM doctor_commission_accruals
    WHERE ${filters.join(' AND ')}
    ORDER BY date(accrued_date) ASC, id ASC
    LIMIT ${limit}
  `).bind(...params).all<AccrualRow>();

  const accruals = (results ?? [])
    .map((row) => ({
      id: Number(row.id),
      billId: row.bill_id == null ? null : Number(row.bill_id),
      patientId: row.patient_id == null ? null : Number(row.patient_id),
      sourceType: row.source_type ?? null,
      amount: calculateAccrualAvailableWaiverAmount({
        commissionAmount: row.commission_amount,
        earnedCommissionAmount: row.earned_commission_amount,
        doctorWaiverAmount: row.doctor_waiver_amount,
        payableCommissionAmount: row.payable_commission_amount,
        paidAmount: row.paid_amount,
        balanceAmount: row.balance_amount,
      }),
      accruedDate: row.accrued_date ?? null,
    }))
    .filter((row) => row.amount > 0);

  return {
    doctorId,
    doctorName: doctor?.name ?? null,
    availableWaiverAmount: roundMoney(accruals.reduce((sum, row) => sum + row.amount, 0)),
    basis: 'pending_commission_accruals',
    accruals,
  };
}
