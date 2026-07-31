function toMoneyCents(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative amount`);
  }
  return Math.round(value * 100);
}

function fromMoneyCents(value: number): number {
  return Math.round(value) / 100;
}

/**
 * Allocate a bill/order-level discount across line gross amounts without
 * losing cents or recording a discount greater than any individual line.
 */
export function allocateDiscountAcrossGrossAmounts(
  grossAmounts: number[],
  totalDiscount: number,
): number[] {
  const grossCents = grossAmounts.map((value, index) => toMoneyCents(value, `Gross amount at index ${index}`));
  const discountCents = toMoneyCents(totalDiscount, 'Discount');
  const totalGrossCents = grossCents.reduce((sum, value) => sum + value, 0);

  if (discountCents > totalGrossCents) {
    throw new Error('Discount exceeds the total gross amount');
  }
  if (grossCents.length === 0) {
    if (discountCents > 0) throw new Error('Discount exceeds the total gross amount');
    return [];
  }
  if (discountCents === 0 || totalGrossCents === 0) {
    return grossCents.map(() => 0);
  }

  const exactShares = grossCents.map((gross) => (discountCents * gross) / totalGrossCents);
  const allocated = exactShares.map((share, index) => Math.min(grossCents[index], Math.floor(share)));
  let remaining = discountCents - allocated.reduce((sum, value) => sum + value, 0);

  const distributionOrder = exactShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  while (remaining > 0) {
    let progressed = false;
    for (const { index } of distributionOrder) {
      if (remaining <= 0) break;
      if (allocated[index] >= grossCents[index]) continue;
      allocated[index] += 1;
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) throw new Error('Discount allocation could not be completed safely');
  }

  return allocated.map(fromMoneyCents);
}

/** Validate and return identifiers while refusing duplicate order lines. */
export function requireUniquePositiveIds(ids: number[], label: string): number[] {
  const seen = new Set<number>();
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} id must be a positive integer`);
    if (seen.has(id)) throw new Error(`Duplicate ${label} id: ${id}`);
    seen.add(id);
  }
  return [...ids];
}
