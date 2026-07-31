export type BillPaymentStatus = 'open' | 'partially_paid' | 'paid';

export type BillPaymentStateInput = {
  total: number;
  paidAmount?: number;
  depositDeducted?: number;
};

export type BillPaymentState = {
  paid: number;
  depositDeducted: number;
  due: number;
  status: BillPaymentStatus;
  settledAmount: number;
};

function roundMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export function calculatePaymentGuardOutstanding(input: BillPaymentStateInput & { discount?: number | null }): number {
  const total = Math.max(0, roundMoney(input.total));
  const paid = Math.max(0, roundMoney(input.paidAmount));
  const depositDeducted = Math.max(0, roundMoney(input.depositDeducted));
  // bills.total is stored as the final net payable amount after discount, so
  // the guard must not subtract bills.discount a second time.
  return Math.max(0, roundMoney(total - paid - depositDeducted));
}

export function calculateBillPaymentState(input: BillPaymentStateInput): BillPaymentState {
  const total = Math.max(0, roundMoney(input.total));
  const requestedDeposit = Math.max(0, roundMoney(input.depositDeducted));
  const depositDeducted = roundMoney(Math.min(total, requestedDeposit));
  const remainingPayable = Math.max(0, roundMoney(total - depositDeducted));
  const requestedPaid = Math.max(0, roundMoney(input.paidAmount));
  const paid = roundMoney(Math.min(remainingPayable, requestedPaid));
  const settledAmount = roundMoney(paid + depositDeducted);
  const due = Math.max(0, roundMoney(total - settledAmount));

  let status: BillPaymentStatus = 'open';
  if (due <= 0) status = 'paid';
  else if (settledAmount > 0) status = 'partially_paid';

  return {
    paid,
    depositDeducted,
    due,
    status,
    settledAmount,
  };
}
