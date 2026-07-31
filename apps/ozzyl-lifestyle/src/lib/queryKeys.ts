/**
 * queryKeys — central query-key factory for TanStack Query.
 * Mirrors web/src/lib/queryKeys.ts so the lifestyle app uses the same
 * cache-invalidation surface (important: queries by ['md', 'dailyIncome']
 * must match across the monorepo).
 */
export const queryKeys = {
  all: ['all'] as const,
  dashboard: {
    all: ['dashboard'] as const,
  },
  md: {
    all: ['md'] as const,
    dailyIncome: () => ['md', 'dailyIncome'] as const,
    dailyExpenses: () => ['md', 'dailyExpenses'] as const,
    monthlySummary: () => ['md', 'monthlySummary'] as const,
  },
  staff: {
    all: ['staff'] as const,
    list: () => ['staff', 'list'] as const,
  },
  accounting: {
    all: ['accounting'] as const,
    dashboard: () => ['accounting', 'dashboard'] as const,
  },
};

export type QueryKeys = typeof queryKeys;
