export interface LegacyLiveInvoiceSourceLineIdentityInput {
  lineNumber: number;
  itemCategory: string;
  referenceId: number | string | null | undefined;
}

export function buildLegacyLiveInvoiceSourceLineId(
  input: LegacyLiveInvoiceSourceLineIdentityInput,
): string {
  if (!Number.isSafeInteger(input.lineNumber) || input.lineNumber <= 0) {
    throw new RangeError('lineNumber must be a positive safe integer');
  }
  const itemCategory = input.itemCategory.trim();
  if (!itemCategory || itemCategory !== input.itemCategory) {
    throw new TypeError('itemCategory must be non-empty without surrounding whitespace');
  }
  const referenceId = input.referenceId == null || String(input.referenceId).trim() === ''
    ? 'none'
    : String(input.referenceId);
  if (referenceId !== 'none' && referenceId.trim() !== referenceId) {
    throw new TypeError('referenceId cannot contain surrounding whitespace');
  }
  return `${input.lineNumber}:${itemCategory}:${referenceId}`;
}
