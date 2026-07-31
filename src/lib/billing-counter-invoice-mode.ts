export type BillingCounterFinalMode = 'paid' | 'credit';

export type BillingCounterInvoiceModeAdjustmentReason =
  | 'zero_settlement_normalized_to_credit'
  | 'credit_settlement_ignored'
  | 'zero_total_settled';

export type BillingCounterInvoiceModeResolution = {
  requestedMode: BillingCounterFinalMode;
  effectiveMode: BillingCounterFinalMode;
  paidAmount: number;
  depositDeducted: number;
  modeAdjusted: boolean;
  modeAdjustmentReason: BillingCounterInvoiceModeAdjustmentReason | null;
};

type BillingCounterInvoiceModeInput = {
  requestedMode: BillingCounterFinalMode;
  total: number;
  paidAmount?: number | null;
  depositDeducted?: number | null;
};

function nonNegativeAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

export function resolveBillingCounterInvoiceMode(
  input: BillingCounterInvoiceModeInput,
): BillingCounterInvoiceModeResolution {
  const total = nonNegativeAmount(input.total);
  const requestedPaidAmount = nonNegativeAmount(input.paidAmount);
  const requestedDepositDeducted = nonNegativeAmount(input.depositDeducted);

  if (total <= 0) {
    const modeAdjusted = input.requestedMode !== 'paid'
      || requestedPaidAmount > 0
      || requestedDepositDeducted > 0;
    return {
      requestedMode: input.requestedMode,
      effectiveMode: 'paid',
      paidAmount: 0,
      depositDeducted: 0,
      modeAdjusted,
      modeAdjustmentReason: modeAdjusted ? 'zero_total_settled' : null,
    };
  }

  if (input.requestedMode === 'credit') {
    const hasSettlementValues = requestedPaidAmount > 0 || requestedDepositDeducted > 0;
    return {
      requestedMode: 'credit',
      effectiveMode: 'credit',
      paidAmount: 0,
      depositDeducted: 0,
      modeAdjusted: hasSettlementValues,
      modeAdjustmentReason: hasSettlementValues ? 'credit_settlement_ignored' : null,
    };
  }

  if (total > 0 && requestedPaidAmount <= 0 && requestedDepositDeducted <= 0) {
    return {
      requestedMode: 'paid',
      effectiveMode: 'credit',
      paidAmount: 0,
      depositDeducted: 0,
      modeAdjusted: true,
      modeAdjustmentReason: 'zero_settlement_normalized_to_credit',
    };
  }

  return {
    requestedMode: 'paid',
    effectiveMode: 'paid',
    paidAmount: requestedPaidAmount,
    depositDeducted: requestedDepositDeducted,
    modeAdjusted: false,
    modeAdjustmentReason: null,
  };
}
