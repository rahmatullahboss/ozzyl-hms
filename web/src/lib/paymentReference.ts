const NON_CASH_PAYMENT_METHODS = new Set([
  'card',
  'bkash',
  'nagad',
  'rocket',
  'bank_transfer',
  'bank',
  'cheque',
  'other',
]);

export function requiresPaymentReference(method: string | null | undefined, paidAmount: number): boolean {
  return Number(paidAmount) > 0 && NON_CASH_PAYMENT_METHODS.has(String(method ?? '').trim().toLowerCase());
}

export function normalizeExternalTransactionId(
  method: string | null | undefined,
  paidAmount: number,
  value: string | null | undefined,
): string | undefined {
  if (!requiresPaymentReference(method, paidAmount)) return undefined;
  const reference = String(value ?? '').trim();
  return reference || undefined;
}
