import { describe, expect, it } from 'vitest';
import { allocateOldestAvailableDeposits } from '../../src/lib/canonical/deposit-source-allocation';

const sources = [
  {
    depositPublicId: 'dep-newer',
    availableMinor: 4_000,
    receivedAtUtc: '2026-07-12T09:00:00.000Z',
    status: 'posted' as const,
  },
  {
    depositPublicId: 'dep-oldest',
    availableMinor: 3_000,
    receivedAtUtc: '2026-07-10T09:00:00.000Z',
    status: 'posted' as const,
  },
  {
    depositPublicId: 'dep-middle',
    availableMinor: 2_000,
    receivedAtUtc: '2026-07-11T09:00:00.000Z',
    status: 'posted' as const,
  },
];

describe('oldest available canonical deposit allocation', () => {
  it('allocates one source when the oldest deposit is sufficient', () => {
    expect(allocateOldestAvailableDeposits(sources, 2_500)).toEqual([
      { depositPublicId: 'dep-oldest', amountMinor: 2_500 },
    ]);
  });

  it('splits deterministically across sources in received-time order', () => {
    expect(allocateOldestAvailableDeposits(sources, 7_500)).toEqual([
      { depositPublicId: 'dep-oldest', amountMinor: 3_000 },
      { depositPublicId: 'dep-middle', amountMinor: 2_000 },
      { depositPublicId: 'dep-newer', amountMinor: 2_500 },
    ]);
  });

  it('uses public id as a deterministic tie breaker', () => {
    expect(allocateOldestAvailableDeposits([
      { depositPublicId: 'dep-b', availableMinor: 2_000, receivedAtUtc: '2026-07-10T09:00:00.000Z', status: 'posted' },
      { depositPublicId: 'dep-a', availableMinor: 2_000, receivedAtUtc: '2026-07-10T09:00:00.000Z', status: 'posted' },
    ], 3_000)).toEqual([
      { depositPublicId: 'dep-a', amountMinor: 2_000 },
      { depositPublicId: 'dep-b', amountMinor: 1_000 },
    ]);
  });

  it('ignores non-posted and zero-balance deposits', () => {
    expect(allocateOldestAvailableDeposits([
      { depositPublicId: 'dep-reversed', availableMinor: 5_000, receivedAtUtc: '2026-07-01T09:00:00.000Z', status: 'reversed' },
      { depositPublicId: 'dep-empty', availableMinor: 0, receivedAtUtc: '2026-07-02T09:00:00.000Z', status: 'posted' },
      { depositPublicId: 'dep-live', availableMinor: 1_500, receivedAtUtc: '2026-07-03T09:00:00.000Z', status: 'posted' },
    ], 1_000)).toEqual([{ depositPublicId: 'dep-live', amountMinor: 1_000 }]);
  });

  it('rejects insufficient aggregate balance without returning a partial plan', () => {
    expect(() => allocateOldestAvailableDeposits(sources, 9_001)).toThrow(/insufficient/i);
  });

  it('rejects invalid amounts and duplicate source identities', () => {
    expect(() => allocateOldestAvailableDeposits(sources, 0)).toThrow(/positive/i);
    expect(() => allocateOldestAvailableDeposits([
      sources[0],
      { ...sources[0], availableMinor: 1_000 },
    ], 1_000)).toThrow(/duplicate/i);
  });

  it('does not mutate caller-owned source ordering', () => {
    const copy = sources.map((source) => ({ ...source }));
    allocateOldestAvailableDeposits(copy, 1_000);
    expect(copy).toEqual(sources);
  });
});
