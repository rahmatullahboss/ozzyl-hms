/**
 * Accessibility (a11y) smoke tests for all 7 admin dashboard widgets.
 *
 * Uses axe-core via vitest-axe to catch:
 * - Missing alt text
 * - Buttons/links without accessible names
 * - Form inputs without labels
 * - Invalid ARIA attributes
 * - Heading hierarchy skips
 * - Color contrast (disabled in jsdom — no real color rendering)
 * - And the 50+ other WCAG 2.1 AA rules axe-core enforces
 *
 * Each widget is rendered in a realistic data state and asserted to
 * have zero violations. Failures here mean a screen reader user would
 * be confused, blocked, or unable to operate the dashboard.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { runAxe } from '../../../test/a11y-helpers';

// Shared mock setup
const navigateMock = vi.fn();
vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string, opts?: { count?: number }) => {
    if (opts && typeof opts.count === 'number') {
      if (k.endsWith('minutesAgo')) return `${opts.count}m ago`;
      if (k.endsWith('hoursAgo')) return `${opts.count}h ago`;
      if (k.endsWith('daysAgo')) return `${opts.count}d ago`;
      if (k.endsWith('alertsCount')) return `${opts.count} alerts`;
      if (k.endsWith('showingEntries')) return `Showing ${opts.count} entries`;
      if (k.endsWith('moreCount')) return `+${opts.count} more`;
    }
    return k;
  } }),
  initReactI18next: { type: '3rdParty' },
}));

vi.mock('../../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../../../lib/queryKeys', () => ({
  queryKeys: {
    admin: {
      dashboard: () => ['admin', 'dashboard'],
      revenueTrend: () => ['admin', 'revenue-trend'],
      paymentBreakdown: () => ['admin', 'payment-breakdown'],
      activeCounters: () => ['admin', 'active-counters'],
      securityAlerts: () => ['admin', 'security-alerts'],
    },
    actionCenter: { summary: () => ['actionCenter', 'summary'] },
    auditLog: { logs: () => ['auditLog', 'logs'] },
  },
}));

import { useApiQuery } from '../../../hooks/useApiQuery';
const mockUseApiQuery = useApiQuery as unknown as ReturnType<typeof vi.fn>;

import ActionRequiredPanel from './ActionRequiredPanel';
import AuditFeedWidget from './AuditFeedWidget';
import KPISummaryCards from './KPISummaryCards';
import LiveCashDrawerWidget from './LiveCashDrawerWidget';
import OperationsSnapshot from './OperationsSnapshot';
import PaymentMethodBreakdown from './PaymentMethodBreakdown';
import RevenueTrendChart from './RevenueTrendChart';

describe('Admin dashboard widgets — accessibility (axe-core)', () => {
  describe('KPISummaryCards', () => {
    it('has no a11y violations in default state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: {
          finance: { todayCollection: 50000, todayExpense: 10000, patientDue: 5000 },
          todaySummary: { totalDiscount: 2000, admittedPatients: 8 },
          patientSummary: { opdPatients: 31 },
        },
        isLoading: false,
      } as never);
      const { container } = render(
        <KPISummaryCards
          filters={{ preset: 'today', startDate: '2026-07-17', endDate: '2026-07-17' }}
          onFiltersChange={vi.fn()}
        />,
      );
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no a11y violations in error state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      } as never);
      const { container } = render(
        <KPISummaryCards
          filters={{ preset: 'today', startDate: '2026-07-17', endDate: '2026-07-17' }}
          onFiltersChange={vi.fn()}
        />,
      );
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('OperationsSnapshot', () => {
    it('has no a11y violations in loaded state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: {
          todaySummary: { totalAppointments: 30, completedConsultations: 20, pendingTests: 5, completedTests: 15, pharmacySales: 25000 },
          bedSummary: { total: 50, available: 12, occupied: 38, occupancyPercentage: 76 },
          pharmacySummary: { todaySales: 25000, todaySalesCount: 10, lowStockItems: 3 },
        },
        isLoading: false,
      } as never);
      const { container } = render(<OperationsSnapshot />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no a11y violations in error state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      } as never);
      const { container } = render(<OperationsSnapshot />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('RevenueTrendChart', () => {
    it('has no a11y violations in loaded state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: { revenueData: [
          { day: '01 Jun', revenue: 45000 },
          { day: '02 Jun', revenue: 52000 },
        ] },
        isLoading: false,
      });
      const { container } = render(<RevenueTrendChart />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no a11y violations in error state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: null,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });
      const { container } = render(<RevenueTrendChart />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('PaymentMethodBreakdown', () => {
    it('has no a11y violations in loaded state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: { by_payment_method: [
          { payment_method: 'cash', total_amount: 45000 },
          { payment_method: 'bkash', total_amount: 15000 },
        ] },
        isLoading: false,
      });
      const { container } = render(<PaymentMethodBreakdown />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no a11y violations in error state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: null,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });
      const { container } = render(<PaymentMethodBreakdown />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('LiveCashDrawerWidget', () => {
    it('has no a11y violations in loaded state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: {
          activeCounters: [
            { sessionId: 1, counterName: 'Reception-01', operatorName: 'Karim', expectedCash: 45000, openedAt: '2026-06-11T08:00:00Z' },
          ],
          totalActive: 1,
        },
        isLoading: false,
      } as never);
      const { container } = render(<LiveCashDrawerWidget />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no a11y violations in error state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      } as never);
      const { container } = render(<LiveCashDrawerWidget />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('ActionRequiredPanel', () => {
    it('has no a11y violations when alerts are present', async () => {
      mockUseApiQuery.mockImplementation((_key: any, path: string) => {
        if (path === '/api/approvals/counts') {
          return { data: { data: { discount: 2, refund: 3 } }, isLoading: false } as never;
        }
        return {
          data: { summary: { canceledCount: 1, highDiscountCount: 4, discrepancyCount: 0, lowStockCount: 5 } },
          isLoading: false,
        } as never;
      });
      const { container } = render(<ActionRequiredPanel />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no a11y violations in error state', async () => {
      mockUseApiQuery.mockImplementation((_key: any, _path: string) => ({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      }) as never);
      const { container } = render(<ActionRequiredPanel />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('AuditFeedWidget', () => {
    it('has no a11y violations in loaded state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: { auditLogs: [
          {
            id: 1,
            created_at: new Date(Date.now() - 120000).toISOString(),
            user_id: 1,
            user_name: 'Karim',
            action: 'UPDATE',
            table_name: 'bills',
            record_id: 'INV-001',
          },
        ] },
        isLoading: false,
      });
      const { container } = render(<AuditFeedWidget />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no a11y violations in error state', async () => {
      mockUseApiQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });
      const { container } = render(<AuditFeedWidget />);
      const results = await runAxe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
