export type PerformerPayoutLineOverride = {
  lineId: number;
  payoutAmount: number;
  reason?: string | null;
};

export type PerformerPayoutSourceLine = {
  lineId: number;
  calculatedAmount: number;
  maximumAmount: number;
};

export type ResolvedPerformerPayoutLine = {
  lineId: number;
  calculatedAmount: number;
  finalAmount: number;
  differenceAmount: number;
  overrideReason: string | null;
};

function money(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.round(parsed * 100) / 100;
}

export function resolvePayoutLineAmounts(
  rows: PerformerPayoutSourceLine[],
  overrides: PerformerPayoutLineOverride[] = [],
): ResolvedPerformerPayoutLine[] {
  const selectedIds = new Set(rows.map((row) => row.lineId));
  const overrideById = new Map<number, PerformerPayoutLineOverride>();

  for (const override of overrides) {
    if (overrideById.has(override.lineId)) {
      throw new Error(`Duplicate payout override for line ${override.lineId}`);
    }
    if (!selectedIds.has(override.lineId)) {
      throw new Error(`Payout override line ${override.lineId} is not selected`);
    }
    overrideById.set(override.lineId, override);
  }

  return rows.map((row) => {
    const calculatedAmount = money(row.calculatedAmount);
    const maximumAmount = money(row.maximumAmount);
    const override = overrideById.get(row.lineId);
    const finalAmount = override ? money(override.payoutAmount) : calculatedAmount;

    if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
      throw new Error(`Payout amount must be positive for line ${row.lineId}`);
    }
    if (!Number.isFinite(maximumAmount) || finalAmount > maximumAmount) {
      throw new Error(`Payout amount exceeds service amount for line ${row.lineId}`);
    }

    const differenceAmount = money(finalAmount - calculatedAmount);
    if (differenceAmount === 0) {
      return {
        lineId: row.lineId,
        calculatedAmount,
        finalAmount: calculatedAmount,
        differenceAmount: 0,
        overrideReason: null,
      };
    }

    const reason = override?.reason?.trim() ?? '';
    if (reason.length < 3) {
      throw new Error(`Override reason is required for line ${row.lineId}`);
    }

    return {
      lineId: row.lineId,
      calculatedAmount,
      finalAmount,
      differenceAmount,
      overrideReason: reason,
    };
  });
}
