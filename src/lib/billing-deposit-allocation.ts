export interface BillingDepositLedgerRow {
  id: number | string;
  amount: number;
  transaction_type: string;
  deposit_receipt_no?: string | null;
  payment_method?: string | null;
  reference_bill_id?: number | string | null;
  created_at?: string | null;
}

export interface BillDepositSourceAllocation {
  id: string;
  amount: number;
  deposit_receipt_no: string | null;
  payment_method: string | null;
  deposited_at: string | null;
  adjustment_receipt_no: string | null;
  adjusted_at: string | null;
}

interface DepositLot {
  row: BillingDepositLedgerRow;
  remaining: number;
}

function positiveAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function compareRows(left: BillingDepositLedgerRow, right: BillingDepositLedgerRow): number {
  const leftTime = left.created_at ?? '';
  const rightTime = right.created_at ?? '';
  const timeOrder = leftTime.localeCompare(rightTime);
  if (timeOrder !== 0) return timeOrder;
  return String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
}

export function allocateBillDepositSources(
  rows: ReadonlyArray<BillingDepositLedgerRow>,
  billId: number | string,
): BillDepositSourceAllocation[] {
  const depositLots: DepositLot[] = [];
  const allocations: BillDepositSourceAllocation[] = [];
  const targetBillId = String(billId);

  for (const row of [...rows].sort(compareRows)) {
    const amount = positiveAmount(row.amount);
    if (amount <= 0) continue;

    if (row.transaction_type === 'deposit') {
      depositLots.push({ row, remaining: amount });
      continue;
    }

    if (row.transaction_type !== 'adjustment' && row.transaction_type !== 'refund') continue;

    let amountToConsume = amount;
    for (const lot of depositLots) {
      if (amountToConsume <= 0) break;
      if (lot.remaining <= 0) continue;

      const allocatedAmount = Math.min(lot.remaining, amountToConsume);
      const belongsToTargetBill = row.transaction_type === 'adjustment'
        && String(row.reference_bill_id ?? '') === targetBillId;

      if (belongsToTargetBill) {
        allocations.push({
          id: `${row.id}-${lot.row.id}`,
          amount: allocatedAmount,
          deposit_receipt_no: lot.row.deposit_receipt_no ?? null,
          payment_method: lot.row.payment_method ?? null,
          deposited_at: lot.row.created_at ?? null,
          adjustment_receipt_no: row.deposit_receipt_no ?? null,
          adjusted_at: row.created_at ?? null,
        });
      }

      lot.remaining -= allocatedAmount;
      amountToConsume -= allocatedAmount;
    }
  }

  return allocations;
}
