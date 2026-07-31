export type ProvisionalDoctorPayableItem = {
  id: number;
  patient_id: number;
  admission_id?: number | null;
  visit_id?: number | null;
  item_category?: string | null;
  item_name?: string | null;
  total_amount?: number | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
  doctor_payable_amount?: number | null;
};

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function isDoctorPayableCategory(category: unknown): boolean {
  const normalized = String(category ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return [
    'operation',
    'operation_fee',
    'surgery',
    'surgical_fee',
    'ot',
    'ot_fee',
    'procedure',
    'procedure_fee',
    'doctor_fee',
    'surgeon_fee',
    'anesthesia',
    'anaesthesia',
    'anesthetist_fee',
  ].includes(normalized);
}

export function normalizeDoctorPayableSourceType(_category: unknown): 'consultation_fee' {
  return 'consultation_fee';
}

export function doctorPayableAmountForItem(item: ProvisionalDoctorPayableItem): number {
  const explicit = Number(item.doctor_payable_amount ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return roundMoney(explicit);
  return roundMoney(Number(item.total_amount ?? 0));
}

export function shouldCreateDoctorPayableForItem(item: ProvisionalDoctorPayableItem): boolean {
  return Number(item.doctor_id ?? 0) > 0
    && isDoctorPayableCategory(item.item_category)
    && doctorPayableAmountForItem(item) > 0;
}

export async function createDoctorPayableAccrualsForProvisionalItems(params: {
  db: D1Database;
  tenantId: string | number;
  userId: string | number;
  billId: number;
  items: ProvisionalDoctorPayableItem[];
}): Promise<number> {
  const payableItems = params.items.filter(shouldCreateDoctorPayableForItem);
  if (payableItems.length === 0) return 0;

  const stmts = payableItems.map((item) => {
    const grossAmount = roundMoney(Number(item.total_amount ?? 0));
    const payableAmount = doctorPayableAmountForItem(item);
    return params.db.prepare(`
      INSERT INTO doctor_commission_accruals
        (tenant_id, doctor_id, patient_id, visit_id, bill_id, source_type, incentive_type,
         gross_amount, commission_rule_id, commission_rate_bps, commission_flat_amount,
         commission_amount, earned_commission_amount, payable_commission_amount, balance_amount,
         status, accrued_date, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'performer', ?, NULL, 0, ?, ?, ?, ?, 'accrued', date('now', '+6 hours'), ?, ?)
    `).bind(
      params.tenantId,
      item.doctor_id,
      item.patient_id ?? null,
      item.visit_id ?? null,
      params.billId,
      normalizeDoctorPayableSourceType(item.item_category),
      grossAmount,
      payableAmount,
      payableAmount,
      payableAmount,
      payableAmount,
      `${item.item_name ?? 'Procedure'} from provisional billing item #${item.id}`,
      params.userId,
    );
  });

  await params.db.batch(stmts);
  return payableItems.length;
}
