import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveFiscalYear } from '../src/lib/fiscal-year';
import { createMockDB } from './integration/helpers/mock-db';

describe('fiscal year date selection', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the GMT+6 hospital date when no date is supplied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T20:30:00.000Z'));

    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM fiscal_years')) {
          return {
            first: {
              id: 2,
              prefix: 'FY26',
              insurance_prefix: 'INS26',
              pharmacy_prefix: 'PHR26',
            },
          };
        }
        return null;
      },
    });

    const fiscalYear = await getActiveFiscalYear(mockDB.db, 'tenant-1');

    expect(fiscalYear).toEqual({
      id: 2,
      prefix: 'FY26',
      insurancePrefix: 'INS26',
      pharmacyPrefix: 'PHR26',
    });
    expect(mockDB.queries[0].params).toEqual(['tenant-1', '2026-04-01', '2026-04-01']);
  });
});
