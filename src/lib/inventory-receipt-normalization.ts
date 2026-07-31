export type InventoryReceiptNormalizationInput = {
  receivedQuantity: number;
  rejectedQuantity?: number | null;
  freeQuantity?: number | null;
  landedCostPerPurchaseUnit: number;
  unitConversionFactor?: number | null;
  itemType?: string | null;
};

export type InventoryReceiptNormalizationResult = {
  stockQuantity: number;
  costPerIssueUnit: number;
  qcStatus: 'pending' | 'accepted';
  stockStatus: 'blocked' | 'available';
};

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeInventoryReceiptLot(
  input: InventoryReceiptNormalizationInput,
): InventoryReceiptNormalizationResult {
  const receivedQuantity = finiteNumber(input.receivedQuantity);
  const rejectedQuantity = finiteNumber(input.rejectedQuantity);
  const freeQuantity = finiteNumber(input.freeQuantity);
  const suppliedFactor = input.unitConversionFactor;
  const unitConversionFactor = suppliedFactor === undefined || suppliedFactor === null
    ? 1
    : finiteNumber(suppliedFactor);

  if (unitConversionFactor <= 0) {
    throw new Error('Unit conversion factor must be greater than zero');
  }
  if (rejectedQuantity < 0 || rejectedQuantity > receivedQuantity) {
    throw new Error('Rejected quantity cannot exceed received quantity');
  }

  const acceptedQuantity = receivedQuantity - rejectedQuantity;
  const stockQuantity = (acceptedQuantity + freeQuantity) * unitConversionFactor;
  const costPerIssueUnit = finiteNumber(input.landedCostPerPurchaseUnit) / unitConversionFactor;
  const isLabReagent = String(input.itemType ?? '').trim().toLowerCase() === 'lab_reagent';

  return {
    stockQuantity,
    costPerIssueUnit,
    qcStatus: isLabReagent ? 'pending' : 'accepted',
    stockStatus: isLabReagent ? 'blocked' : 'available',
  };
}
