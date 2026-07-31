import { beforeEach, describe, expect, it, vi } from 'vitest';

const { canonicalSummary, canonicalDetails } = vi.hoisted(() => ({
  canonicalSummary: vi.fn(),
  canonicalDetails: vi.fn(),
}));

vi.mock('../../src/lib/canonical/reporting/executive-doctor-analytics', () => ({
  getCanonicalExecutiveDoctorPerformance: canonicalSummary,
  getCanonicalExecutiveDoctorPerformanceDetails: canonicalDetails,
}));

import {
  resolveDoctorAnalyticsProviderMode,
  type DoctorAnalyticsProviderDatabase,
  type DoctorAnalyticsProviderPreparedStatement,
} from '../../src/lib/doctor-analytics-provider';
import {
  getDoctorPerformance,
  getDoctorPerformanceDetails,
} from '../../src/lib/executive-doctor-analytics';

class FlagStatement implements DoctorAnalyticsProviderPreparedStatement {
  constructor(private readonly rows: Record<string, { mode: string; is_enabled: number }>) {}
  private tenantId = '';
  private flagKey = '';

  bind(...values: unknown[]): DoctorAnalyticsProviderPreparedStatement {
    const statement = new FlagStatement(this.rows);
    statement.tenantId = String(values[0] ?? '');
    statement.flagKey = String(values[1] ?? '');
    return statement;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.rows[`${this.tenantId}:${this.flagKey}`] as T | undefined) ?? null;
  }
}

function db(rows: Record<string, { mode: string; is_enabled: number }>): DoctorAnalyticsProviderDatabase {
  return { prepare: () => new FlagStatement(rows) };
}

const period = {
  startDate: '2026-07-20',
  endDate: '2026-07-22',
  startDateTimeUtc: '2026-07-19T18:00:00.000Z',
  endDateTimeUtcExclusive: '2026-07-22T18:00:00.000Z',
};

describe('doctor analytics provider routing', () => {
  beforeEach(() => {
    canonicalSummary.mockReset();
    canonicalDetails.mockReset();
  });

  it('does not allow the generic canonical reporting flag to switch the active dashboard', async () => {
    const database = db({
      '102:canonical_reporting_v1': { mode: 'canonical', is_enabled: 1 },
    });
    await expect(resolveDoctorAnalyticsProviderMode(database, '102')).resolves.toBe('legacy');
  });

  it('keeps shadow mode on the legacy provider and requires an enabled dedicated canonical mode', async () => {
    await expect(resolveDoctorAnalyticsProviderMode(db({
      '102:canonical_doctor_analytics_v1': { mode: 'shadow', is_enabled: 1 },
    }), '102')).resolves.toBe('shadow');
    await expect(resolveDoctorAnalyticsProviderMode(db({
      '102:canonical_doctor_analytics_v1': { mode: 'canonical', is_enabled: 0 },
    }), '102')).resolves.toBe('legacy');
    await expect(resolveDoctorAnalyticsProviderMode(db({
      '102:canonical_doctor_analytics_v1': { mode: 'canonical', is_enabled: 1 },
    }), '102')).resolves.toBe('canonical');
  });

  it('switches summary and detail together when the dedicated provider is canonical', async () => {
    const database = db({
      '102:canonical_doctor_analytics_v1': { mode: 'canonical', is_enabled: 1 },
    });
    canonicalSummary.mockResolvedValue({ marker: 'canonical-summary' });
    canonicalDetails.mockResolvedValue({ marker: 'canonical-details' });

    const summaryArgs = {
      dbBinding: database as never,
      tenantId: '102',
      period,
      search: '',
      sortBy: 'payableCommission' as const,
      sortDirection: 'desc' as const,
      page: 1,
      pageSize: 20,
    };
    const detailArgs = {
      dbBinding: database as never,
      tenantId: '102',
      period,
      doctorId: 7,
      tab: 'commissions' as const,
      page: 1,
      pageSize: 20,
    };

    await expect(getDoctorPerformance(summaryArgs)).resolves.toEqual({ marker: 'canonical-summary' });
    await expect(getDoctorPerformanceDetails(detailArgs)).resolves.toEqual({ marker: 'canonical-details' });
    expect(canonicalSummary).toHaveBeenCalledOnce();
    expect(canonicalDetails).toHaveBeenCalledOnce();
  });
});
