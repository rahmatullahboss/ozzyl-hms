export interface BillAmountLike {
  total?: number | null;
  total_amount?: number | null;
  paid?: number | null;
  paid_amount?: number | null;
  cash_paid_amount?: number | null;
  settled_amount?: number | null;
  deposit_adjusted?: number | null;
  deposit_deducted?: number | null;
  deposit_adjustment_amount?: number | null;
  due?: number | null;
  outstanding?: number | null;
  pending_amount?: number | null;
}

function finiteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getBillTotalAmount(bill?: BillAmountLike | null): number {
  if (!bill) return 0;
  return Math.max(0, finiteNumber(bill.total_amount ?? bill.total) ?? 0);
}

export function getBillDepositAdjustedAmount(bill?: BillAmountLike | null): number {
  if (!bill) return 0;
  return Math.max(
    0,
    finiteNumber(
      bill.deposit_adjusted
        ?? bill.deposit_deducted
        ?? bill.deposit_adjustment_amount,
    ) ?? 0,
  );
}

export function getBillSettledAmount(bill?: BillAmountLike | null): number {
  if (!bill) return 0;
  const serverSettled = finiteNumber(bill.settled_amount);
  if (serverSettled !== null) return Math.max(0, serverSettled);

  const cashPaid = getBillCashPaidAmount(bill);
  return Math.max(0, cashPaid + getBillDepositAdjustedAmount(bill));
}

export function getBillCashPaidAmount(bill?: BillAmountLike | null): number {
  if (!bill) return 0;
  const explicitCashPaid = finiteNumber(bill.cash_paid_amount);
  if (explicitCashPaid !== null) return Math.max(0, explicitCashPaid);

  const depositAdjusted = getBillDepositAdjustedAmount(bill);
  const serverSettled = finiteNumber(bill.settled_amount);
  if (serverSettled !== null && depositAdjusted > 0) {
    return Math.max(0, serverSettled - depositAdjusted);
  }

  return Math.max(0, finiteNumber(bill.paid_amount ?? bill.paid) ?? 0);
}

export function getBillOutstandingAmount(bill?: BillAmountLike | null): number {
  if (!bill) return 0;
  const serverOutstanding = finiteNumber(
    bill.outstanding
      ?? bill.due
      ?? bill.pending_amount,
  );
  if (serverOutstanding !== null) {
    const total = getBillTotalAmount(bill);
    if (total > 0) {
      const computedOutstanding = Math.max(0, roundMoney(total - getBillSettledAmount(bill)));
      return roundMoney(Math.min(Math.max(0, roundMoney(serverOutstanding)), computedOutstanding));
    }
    return Math.max(0, roundMoney(serverOutstanding));
  }

  return Math.max(0, roundMoney(getBillTotalAmount(bill) - getBillSettledAmount(bill)));
}
