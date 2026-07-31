import { roundMoney } from './discount_allocation';

export type PerformerPayoutRateType = 'flat' | 'percent';

export type NormalizedPerformerRule = {
  rateType: PerformerPayoutRateType;
  rateValue: number;
};

export type DiagnosticLinePayoutUnit = {
  unitSequence: number;
  unitServiceAmount: number;
  unitDiscountAmount: number;
  netUnitServiceAmount: number;
  reservedAmount: number;
};

const toCents = (value: number): number => Math.max(0, Math.round(roundMoney(value) * 100));
const fromCents = (value: number): number => roundMoney(value / 100);

export function normalizePerformerRule(input: {
  rateType: PerformerPayoutRateType;
  flatAmount?: number | null;
  percent?: number | null;
}): NormalizedPerformerRule {
  if (input.rateType === 'percent') {
    const percent = Number(input.percent ?? 0);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error('Percentage must be between 0 and 100');
    }
    return { rateType: 'percent', rateValue: Math.round(percent * 100) };
  }

  const flatAmount = Number(input.flatAmount ?? 0);
  if (!Number.isFinite(flatAmount) || flatAmount < 0) {
    throw new Error('Flat amount must be zero or greater');
  }
  return { rateType: 'flat', rateValue: roundMoney(flatAmount) };
}

export function splitMoneyAcrossUnits(total: number, quantity: number): number[] {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive integer');
  }

  const cents = toCents(total);
  const base = Math.floor(cents / quantity);
  const remainder = cents % quantity;
  return Array.from({ length: quantity }, (_, index) => (
    fromCents(base + (index < remainder ? 1 : 0))
  ));
}

export function allocateProportionalMoney(total: number, weights: number[]): number[] {
  const totalCents = toCents(total);
  const normalizedWeights = weights.map((value) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  });
  const weightTotal = normalizedWeights.reduce((sum, value) => sum + value, 0);

  if (normalizedWeights.length === 0) return [];
  if (totalCents === 0 || weightTotal === 0) return normalizedWeights.map(() => 0);

  const exactShares = normalizedWeights.map((weight) => (totalCents * weight) / weightTotal);
  const allocatedCents = exactShares.map(Math.floor);
  const allocatedTotal = allocatedCents.reduce((sum, value) => sum + value, 0);
  const remainder = totalCents - allocatedTotal;
  const allocationOrder = exactShares
    .map((value, index) => ({ index, fraction: value - allocatedCents[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let index = 0; index < remainder; index += 1) {
    allocatedCents[allocationOrder[index % allocationOrder.length].index] += 1;
  }

  return allocatedCents.map(fromCents);
}

export function calculateUnitPerformerReserve(input: {
  netUnitServiceAmount: number;
  rule: NormalizedPerformerRule;
}): number {
  const netUnitServiceAmount = Math.max(0, roundMoney(input.netUnitServiceAmount));
  const rateValue = Math.max(0, Number(input.rule.rateValue ?? 0));
  if (input.rule.rateType === 'flat') {
    return roundMoney(rateValue);
  }

  const calculated = roundMoney((netUnitServiceAmount * rateValue) / 10_000);
  return roundMoney(Math.min(netUnitServiceAmount, Math.max(0, calculated)));
}

export function calculateDiagnosticLinePayoutSplit(input: {
  serviceAmountExcludingTax: number;
  discountAmount: number;
  quantity: number;
  rule: NormalizedPerformerRule;
}): {
  units: DiagnosticLinePayoutUnit[];
  netServiceAmount: number;
  performerReserveAmount: number;
  commissionBaseAmount: number;
} {
  const serviceAmount = Math.max(0, roundMoney(input.serviceAmountExcludingTax));
  const discountAmount = Math.min(serviceAmount, Math.max(0, roundMoney(input.discountAmount)));
  const unitServiceAmounts = splitMoneyAcrossUnits(serviceAmount, input.quantity);
  const unitDiscountAmounts = allocateProportionalMoney(discountAmount, unitServiceAmounts);

  const units = unitServiceAmounts.map((unitServiceAmount, index) => {
    const unitDiscountAmount = Math.min(
      unitServiceAmount,
      Math.max(0, roundMoney(unitDiscountAmounts[index] ?? 0)),
    );
    const netUnitServiceAmount = roundMoney(Math.max(0, unitServiceAmount - unitDiscountAmount));
    return {
      unitSequence: index + 1,
      unitServiceAmount,
      unitDiscountAmount,
      netUnitServiceAmount,
      reservedAmount: calculateUnitPerformerReserve({
        netUnitServiceAmount,
        rule: input.rule,
      }),
    };
  });

  const netServiceAmount = roundMoney(units.reduce((sum, unit) => sum + unit.netUnitServiceAmount, 0));
  const performerReserveAmount = roundMoney(units.reduce((sum, unit) => sum + unit.reservedAmount, 0));
  return {
    units,
    netServiceAmount,
    performerReserveAmount,
    commissionBaseAmount: roundMoney(Math.max(0, netServiceAmount - performerReserveAmount)),
  };
}
