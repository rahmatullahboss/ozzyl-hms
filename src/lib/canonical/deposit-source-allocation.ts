export interface AvailableCanonicalDepositSource {
  depositPublicId: string;
  availableMinor: number;
  receivedAtUtc: string;
  status: 'posted' | 'reversed' | string;
}

export interface CanonicalDepositAllocation {
  depositPublicId: string;
  amountMinor: number;
}

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requirePublicId(value: string): string {
  if (!value || value.trim() !== value) {
    throw new TypeError('depositPublicId must be non-empty without surrounding whitespace');
  }
  return value;
}

function requireUtc(value: string): string {
  if (!value || Number.isNaN(Date.parse(value)) || !value.endsWith('Z')) {
    throw new RangeError('receivedAtUtc must be a normalized UTC timestamp');
  }
  return value;
}

export function allocateOldestAvailableDeposits(
  sources: readonly AvailableCanonicalDepositSource[],
  requestedMinor: number,
): CanonicalDepositAllocation[] {
  requirePositiveSafeInteger(requestedMinor, 'requestedMinor');

  const seen = new Set<string>();
  const eligible = sources
    .map((source) => {
      const depositPublicId = requirePublicId(source.depositPublicId);
      if (seen.has(depositPublicId)) {
        throw new Error(`Duplicate canonical deposit source: ${depositPublicId}`);
      }
      seen.add(depositPublicId);
      if (!Number.isSafeInteger(source.availableMinor) || source.availableMinor < 0) {
        throw new RangeError('availableMinor must be a non-negative safe integer');
      }
      return {
        depositPublicId,
        availableMinor: source.availableMinor,
        receivedAtUtc: requireUtc(source.receivedAtUtc),
        status: source.status,
      };
    })
    .filter((source) => source.status === 'posted' && source.availableMinor > 0)
    .sort((left, right) => (
      left.receivedAtUtc.localeCompare(right.receivedAtUtc)
      || left.depositPublicId.localeCompare(right.depositPublicId)
    ));

  let remaining = requestedMinor;
  const allocations: CanonicalDepositAllocation[] = [];
  for (const source of eligible) {
    if (remaining === 0) break;
    const amountMinor = Math.min(source.availableMinor, remaining);
    allocations.push({ depositPublicId: source.depositPublicId, amountMinor });
    remaining -= amountMinor;
  }

  if (remaining !== 0) {
    const availableMinor = requestedMinor - remaining;
    throw new RangeError(`Canonical deposit balance is insufficient: requested ${requestedMinor}, available ${availableMinor}`);
  }

  return allocations;
}
