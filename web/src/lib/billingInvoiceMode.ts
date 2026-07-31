export type BillingInvoiceMode = 'paid' | 'credit' | 'provisional';

export type BillingInvoiceSubmissionResolution = {
  effectiveMode: BillingInvoiceMode;
  paidAmount: number;
  depositDeducted: number;
  adjustedToCredit: boolean;
};

type BillingInvoiceSubmissionInput = {
  selectedMode: BillingInvoiceMode;
  total: number;
  paidAmount?: number | null;
  depositDeducted?: number | null;
};

function nonNegativeAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

export function resolveBillingInvoiceSubmissionMode(
  input: BillingInvoiceSubmissionInput,
): BillingInvoiceSubmissionResolution {
  const total = nonNegativeAmount(input.total);
  const paidAmount = nonNegativeAmount(input.paidAmount);
  const depositDeducted = nonNegativeAmount(input.depositDeducted);

  if (total <= 0 && input.selectedMode !== 'provisional') {
    return {
      effectiveMode: 'paid',
      paidAmount: 0,
      depositDeducted: 0,
      adjustedToCredit: false,
    };
  }

  if (input.selectedMode === 'credit' || input.selectedMode === 'provisional') {
    return {
      effectiveMode: input.selectedMode,
      paidAmount: 0,
      depositDeducted: 0,
      adjustedToCredit: false,
    };
  }

  if (total > 0 && paidAmount <= 0 && depositDeducted <= 0) {
    return {
      effectiveMode: 'credit',
      paidAmount: 0,
      depositDeducted: 0,
      adjustedToCredit: true,
    };
  }

  return {
    effectiveMode: 'paid',
    paidAmount,
    depositDeducted,
    adjustedToCredit: false,
  };
}
