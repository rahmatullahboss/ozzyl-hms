export interface CompensationSettlementAllocation {
  grossMinor: number;
  adjustmentMinor: number;
  allocationMinor: number;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

export function allocateCompensationSettlement(
  grossMinorByAccrual: readonly number[],
  netPaidMinor: number,
): CompensationSettlementAllocation[] {
  if (grossMinorByAccrual.length === 0) {
    throw new RangeError('At least one compensation accrual is required');
  }
  positiveSafeInteger(netPaidMinor, 'netPaidMinor');
  const gross = grossMinorByAccrual.map((value, index) => (
    positiveSafeInteger(value, `grossMinorByAccrual[${index}]`)
  ));
  const grossTotal = gross.reduce((sum, value) => {
    const next = sum + value;
    if (!Number.isSafeInteger(next)) throw new RangeError('Gross settlement total exceeds safe integer range');
    return next;
  }, 0);
  if (netPaidMinor > grossTotal) {
    throw new RangeError('Net settlement amount cannot exceed gross settlement amount');
  }
  if (netPaidMinor < gross.length) {
    throw new RangeError('Net settlement amount must retain at least one minor unit per accrual');
  }
  if (netPaidMinor === grossTotal) {
    return gross.map((grossMinor) => ({
      grossMinor,
      adjustmentMinor: 0,
      allocationMinor: grossMinor,
    }));
  }

  const residualNet = netPaidMinor - gross.length;
  const capacities = gross.map((value) => value - 1);
  const capacityTotal = capacities.reduce((sum, value) => sum + value, 0);
  const allocations = new Array<number>(gross.length).fill(1);
  const remainders: Array<{ index: number; remainder: bigint }> = [];
  let distributed = 0;

  if (residualNet > 0) {
    const residualBig = BigInt(residualNet);
    const capacityTotalBig = BigInt(capacityTotal);
    capacities.forEach((capacity, index) => {
      const product = residualBig * BigInt(capacity);
      const share = Number(product / capacityTotalBig);
      allocations[index] += share;
      distributed += share;
      remainders.push({ index, remainder: product % capacityTotalBig });
    });
  }

  let undistributed = residualNet - distributed;
  remainders.sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (const entry of remainders) {
    if (undistributed === 0) break;
    if (allocations[entry.index] >= gross[entry.index]) continue;
    allocations[entry.index] += 1;
    undistributed -= 1;
  }
  if (undistributed !== 0) {
    throw new Error('Compensation settlement allocation did not fully distribute net cash');
  }

  const result = gross.map((grossMinor, index) => ({
    grossMinor,
    adjustmentMinor: grossMinor - allocations[index],
    allocationMinor: allocations[index],
  }));
  const allocatedTotal = result.reduce((sum, entry) => sum + entry.allocationMinor, 0);
  const adjustedTotal = result.reduce((sum, entry) => sum + entry.adjustmentMinor, 0);
  if (allocatedTotal !== netPaidMinor || adjustedTotal + allocatedTotal !== grossTotal) {
    throw new Error('Compensation settlement allocation does not reconcile');
  }
  return result;
}
