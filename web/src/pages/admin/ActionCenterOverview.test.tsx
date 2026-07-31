import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActionCenterOverview from './ActionCenterOverview';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="dashboard-layout">{children}</div>,
}));

const liveSummary = {
  data: {
    approvals: {
      totalPending: 6,
      highPriority: 2,
      olderThan24h: 1,
      todayApproved: 3,
      rejectedToday: 1,
      totalPendingAmount: 18500,
    },
    exceptions: { open: 0, critical: 0, slaBreached: 0 },
    collections: {
      open: 9,
      followupDue: 0,
      exposure: 11250,
      exposureMinor: 1_125_000,
      currencyCode: 'BDT',
      amountsByCurrency: [{
        currencyCode: 'BDT',
        totalDueMinor: 1_125_000,
        totalInvoices: 9,
      }],
      authorityMode: 'legacy',
      shadowMismatchCount: 0,
    },
    tasks: { open: 0, overdue: 0, assignedToMe: 0 },
    resolvedToday: 4,
    nextBestAction: {
      workstream: 'approvals',
      href: '/action/approvals?status=pending',
      label: 'Review oldest pending approval',
      priority: 'high',
    },
    capabilities: {
      persistentExceptions: true,
      persistentCollections: true,
      persistentTasks: false,
    },
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/h/city-care/action']}>
      <Routes>
        <Route path="/h/:slug/action" element={<ActionCenterOverview />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ActionCenterOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({
      data: liveSummary,
      isLoading: false,
      isError: false,
    } as never);
  });

  it('renders a compact command overview with actionable canonical links', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Action Center' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review approvals/i })).toHaveAttribute(
      'href',
      '/h/city-care/action/approvals?status=pending',
    );
    expect(screen.getByRole('link', { name: /review receivables/i })).toHaveAttribute(
      'href',
      '/h/city-care/action/collections?status=active&sort=exposure',
    );
    expect(screen.getByTestId('metric-exposure')).toHaveTextContent('BDT 11,250.00');
    expect(screen.queryByText(/persistent exceptions/i)).not.toBeInTheDocument();
  });

  it('does not flatten mixed-currency receivable exposure into a fake BDT total', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: {
          ...liveSummary.data,
          collections: {
            ...liveSummary.data.collections,
            exposure: null,
            exposureMinor: null,
            currencyCode: null,
            amountsByCurrency: [
              { currencyCode: 'BDT', totalDueMinor: 1_000_000, totalInvoices: 8 },
              { currencyCode: 'USD', totalDueMinor: 12_500, totalInvoices: 1 },
            ],
          },
        },
      },
      isLoading: false,
      isError: false,
    } as never);

    renderPage();

    expect(screen.getByTestId('metric-exposure')).toHaveTextContent('BDT 10,000.00 + USD 125.00');
    expect(screen.queryByText('৳0.00')).not.toBeInTheDocument();
  });

  it('renders six operational metrics without duplicating the approvals cockpit', () => {
    renderPage();

    expect(screen.getAllByTestId('action-center-metric')).toHaveLength(6);
    expect(screen.getByTestId('metric-pending')).toHaveTextContent('6');
    expect(screen.getByTestId('metric-high-priority')).toHaveTextContent('2');
    expect(screen.queryByText(/approval status/i)).not.toBeInTheDocument();
  });

  it('uses honest capability copy for workflows that are not persistent yet', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: {
          ...liveSummary.data,
          capabilities: {
            persistentExceptions: false,
            persistentCollections: false,
            persistentTasks: false,
          },
        },
      },
      isLoading: false,
      isError: false,
    } as never);

    renderPage();

    expect(screen.getByText(/alerts are available for review; acknowledgement workflow is not active yet/i)).toBeInTheDocument();
    expect(screen.getByText(/task assignment workflow is not active yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open tasks/i })).not.toBeInTheDocument();
  });

  it('shows a healthy empty state without a disabled review button when no next action exists', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: {
          ...liveSummary.data,
          approvals: {
            ...liveSummary.data.approvals,
            totalPending: 0,
            highPriority: 0,
          },
          nextBestAction: null,
        },
      },
      isLoading: false,
      isError: false,
    } as never);

    renderPage();

    expect(screen.getByText(/no approval decision is waiting right now/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /review oldest pending approval/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review queue/i })).not.toBeInTheDocument();
  });
});
