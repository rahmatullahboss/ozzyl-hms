export interface TokenReservationRange {
  token_from: number;
  token_to: number;
  label?: string | null;
}

export interface AvailableReservedToken {
  token: number;
  token_no: number;
  label: string | null;
}

export interface TokenReservationAvailabilitySummary {
  currentTokenNo: number;
  nextRegularTokenNo: number;
  reservedTotal: number;
  reservedBooked: number;
  reservedAvailable: number;
}

export interface TokenReservationAvailability {
  tokens: AvailableReservedToken[];
  summary: TokenReservationAvailabilitySummary;
}

function normalizeBookedTokenNumbers(bookedTokenNumbers: Array<number | null | undefined>): number[] {
  return bookedTokenNumbers
    .map((token) => Number(token))
    .filter((token) => Number.isInteger(token) && token > 0);
}

function isTokenReserved(token: number, ranges: TokenReservationRange[]): boolean {
  return ranges.some((range) => token >= Number(range.token_from) && token <= Number(range.token_to));
}

function nextRegularTokenAfter(currentTokenNo: number, ranges: TokenReservationRange[]): number {
  // Auto-regular must continue after the highest already-issued serial.
  // It should not backfill earlier gaps such as #3/#6/#8; those gaps remain
  // available only for manual/custom selection from the serial strip.
  let candidate = Math.max(0, currentTokenNo) + 1;
  while (isTokenReserved(candidate, ranges)) candidate += 1;
  return candidate;
}

export function buildTokenReservationAvailability(input: {
  ranges: TokenReservationRange[];
  bookedTokenNumbers: Array<number | null | undefined>;
}): TokenReservationAvailability {
  const ranges = [...input.ranges]
    .map((range) => ({
      token_from: Number(range.token_from),
      token_to: Number(range.token_to),
      label: range.label ?? null,
    }))
    .filter((range) => Number.isInteger(range.token_from) && Number.isInteger(range.token_to) && range.token_from > 0 && range.token_to >= range.token_from)
    .sort((a, b) => a.token_from - b.token_from);
  const bookedTokens = normalizeBookedTokenNumbers(input.bookedTokenNumbers);
  const bookedSet = new Set(bookedTokens);
  const tokens: AvailableReservedToken[] = [];
  let reservedTotal = 0;
  let reservedBooked = 0;

  for (const range of ranges) {
    for (let token = range.token_from; token <= range.token_to; token += 1) {
      reservedTotal += 1;
      if (bookedSet.has(token)) {
        reservedBooked += 1;
      } else {
        tokens.push({ token, token_no: token, label: range.label });
      }
    }
  }

  const currentTokenNo = bookedTokens.length > 0 ? Math.max(...bookedTokens) : 0;

  return {
    tokens,
    summary: {
      currentTokenNo,
      nextRegularTokenNo: nextRegularTokenAfter(currentTokenNo, ranges),
      reservedTotal,
      reservedBooked,
      reservedAvailable: tokens.length,
    },
  };
}
