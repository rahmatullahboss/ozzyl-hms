export type BillCategoryTotals = {
  testBill: number;
  doctorVisitBill: number;
  admissionBill: number;
  operationBill: number;
  medicineBill: number;
};

export type BillCategoryTotalInput = {
  category?: string | null;
  amount: number;
};

export function emptyBillCategoryTotals(): BillCategoryTotals {
  return {
    testBill: 0,
    doctorVisitBill: 0,
    admissionBill: 0,
    operationBill: 0,
    medicineBill: 0,
  };
}

export function normalizeBillCategory(category?: string | null): keyof BillCategoryTotals | null {
  const value = String(category ?? '').trim().toLowerCase();
  if (!value) return null;

  if (['test', 'lab', 'laboratory', 'radiology', 'diagnostic', 'diagnostics'].includes(value)) return 'testBill';
  if (['doctor_visit', 'doctor_round', 'doctor', 'consultation', 'opd', 'visit'].includes(value)) return 'doctorVisitBill';
  if (['admission', 'package', 'bed_charge', 'bed', 'ward', 'cabin', 'room', 'ipd'].includes(value)) return 'admissionBill';
  if (['operation', 'procedure', 'surgery', 'ot'].includes(value)) return 'operationBill';
  if (['medicine', 'pharmacy', 'drug'].includes(value)) return 'medicineBill';

  return null;
}

export function calculateBillCategoryTotals(items: BillCategoryTotalInput[]): BillCategoryTotals {
  const totals = emptyBillCategoryTotals();

  for (const item of items) {
    const key = normalizeBillCategory(item.category);
    if (!key) continue;
    totals[key] += Number(item.amount ?? 0);
  }

  return totals;
}
