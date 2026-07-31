import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryDashboard from './InventoryDashboard';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';

const navigateMock = vi.fn();
const dashboardRefetch = vi.fn();
const intelligenceRefetch = vi.fn();
const reorderRefetch = vi.fn();
const recomputeMutate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
}));

vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children, role }: { children: React.ReactNode; role: string }) => (
    <main data-role={role} data-testid="dashboard-layout">{children}</main>
  ),
}));

const dashboardData = {
  summary: {
    totalStockValue: 124000,
    lowStockItems: 3,
    outOfStockItems: 1,
    expiringSoonItems: 2,
    expiredItems: 1,
    pendingPurchaseRequests: 4,
    pendingDepartmentRequests: 5,
    todayReceivedQuantity: 22,
    todayIssuedQuantity: 17,
    damagedStockQuantity: 1,
    assetMaintenanceDue: 2,
  },
  alerts: [
    {
      type: 'out_of_stock',
      severity: 'danger',
      ItemName: 'CBC Reagent Kit',
      BatchNo: 'CBC-01',
      ExpiryDate: '2026-08-01',
      AvailableQuantity: 0,
    },
    {
      type: 'expiring_soon',
      severity: 'warning',
      ItemName: 'EDTA Tube',
      BatchNo: 'EDTA-22',
      ExpiryDate: '2026-07-30',
      AvailableQuantity: 40,
    },
  ],
  recentMovements: [
    {
      TransactionId: 101,
      TransactionType: 'issue',
      TransactionDate: '2026-07-05T08:00:00.000Z',
      ItemName: 'CBC Reagent Kit',
      StoreName: 'Lab Store',
      InQuantity: 0,
      OutQuantity: 2,
      BalanceQuantity: 8,
      ReferenceNo: 'LAB-1001',
    },
  ],
};

const reorderData = {
  suggestions: [
    {
      ItemId: 1,
      ItemName: 'EDTA Tube',
      ItemCode: 'EDTA-001',
      ReOrderLevel: 50,
      current_stock: 12,
      suggested_quantity: 500,
      preferred_vendor_name: 'MedTech BD',
    },
  ],
};

const intelligenceData = {
  status: 'ready',
  snapshotCount: 10,
  lastComputedAt: '2026-07-05T08:00:00.000Z',
  summary: {
    stockout: 1,
    low: 2,
    watch: 3,
    ok: 10,
    suggestedOrderQtyTotal: 42,
  },
  recommendations: [
    {
      id: 11,
      severity: 'critical',
      title: 'CBC may block billing',
      message: 'CBC reagent is below safe stock for today.',
      suggested_action: 'create_purchase_order',
      suggested_quantity: 42,
    },
  ],
};

const emptyDashboardData = {
  summary: {
    ...dashboardData.summary,
    lowStockItems: 0,
    outOfStockItems: 0,
    expiringSoonItems: 0,
    expiredItems: 0,
    damagedStockQuantity: 0,
  },
  alerts: [],
  recentMovements: [],
};

const emptyIntelligenceData = {
  status: 'not_configured',
  snapshotCount: 0,
  lastComputedAt: null,
  summary: {
    stockout: 0,
    low: 0,
    watch: 0,
    ok: 0,
    suggestedOrderQtyTotal: 0,
  },
  recommendations: [],
  message: 'No deterministic stock signals yet.',
};

function mockQueries(options?: { empty?: boolean; loading?: boolean }) {
  const mockedUseApiQuery = vi.mocked(useApiQuery);
  vi.mocked(useApiMutation).mockReturnValue({
    mutate: recomputeMutate,
    isPending: false,
  } as any);
  mockedUseApiQuery.mockImplementation((keyOrPath: unknown) => {
    const normalized = Array.isArray(keyOrPath) ? keyOrPath.join('/') : String(keyOrPath);
    if (normalized.includes('reorder')) {
      return {
        data: options?.empty ? { suggestions: [] } : reorderData,
        isLoading: Boolean(options?.loading),
        refetch: reorderRefetch,
      } as any;
    }
    if (normalized.includes('intelligence')) {
      return {
        data: options?.empty ? emptyIntelligenceData : intelligenceData,
        isLoading: Boolean(options?.loading),
        refetch: intelligenceRefetch,
      } as any;
    }
    return {
      data: options?.empty ? emptyDashboardData : dashboardData,
      isLoading: Boolean(options?.loading),
      isFetching: false,
      refetch: dashboardRefetch,
    } as any;
  });
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/h/demo-hospital/inventory"]}>
      <Routes>
        <Route path="/h/:slug/inventory" element={<InventoryDashboard role="hospital_admin" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('InventoryDashboard screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueries();
  });

  it('renders the smart stock assistant hero, quick operations, and system verdict', () => {
    renderDashboard();

    expect(screen.getByTestId('dashboard-layout')).toHaveAttribute('data-role', 'hospital_admin');
    expect(screen.getByText('Smart Stock Assistant')).toBeInTheDocument();
    expect(screen.getByText('Deterministic stock brain · no AI magic')).toBeInTheDocument();
    expect(screen.getByText('Ready services')).toBeInTheDocument();
    expect(screen.getByText('Risk items')).toBeInTheDocument();
    expect(screen.getByText('3 urgent stock issues')).toBeInTheDocument();
    expect(screen.getByText("Today's system verdict")).toBeInTheDocument();
    expect(screen.getByText('Blocked today')).toBeInTheDocument();
    expect(screen.getByText('Stock brain is up to date.')).toBeInTheDocument();
    expect(screen.getByText('Last computed: 2026-07-05 08:00')).toBeInTheDocument();
    expect(screen.getAllByText('42 units').length).toBeGreaterThan(0);
    expect(screen.getByText('Receive stock')).toBeInTheDocument();
    expect(screen.getByText('Issue stock')).toBeInTheDocument();
    expect(screen.getByText('Approvals')).toBeInTheDocument();
    expect(screen.getByText('Reagent rules')).toBeInTheDocument();
  });

  it('renders smart stock recommendations and lab/OT readiness examples', () => {
    renderDashboard();

    expect(screen.getByText('Smart stock action queue')).toBeInTheDocument();
    expect(screen.getByText('CBC may block billing')).toBeInTheDocument();
    expect(screen.getByText('CBC reagent is below safe stock for today.')).toBeInTheDocument();
    expect(screen.getByText('Create Purchase Order')).toBeInTheDocument();
    expect(screen.getByText('Lab & OT readiness model')).toBeInTheDocument();
    expect(screen.getAllByText('CBC reagent + EDTA tube').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kit reagent per test').length).toBeGreaterThan(0);
    expect(screen.getByText('Safety note')).toBeInTheDocument();
  });

  it('renders reagent readiness examples and the simple daily workflow', () => {
    renderDashboard();

    expect(screen.getByText('Reagent readiness')).toBeInTheDocument();
    expect(screen.getByText('Billing-time semi-auto mode recommended')).toBeInTheDocument();
    expect(screen.getAllByText('CBC reagent + EDTA tube').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kit reagent per test').length).toBeGreaterThan(0);
    expect(screen.getByText('Simple daily workflow')).toBeInTheDocument();
    expect(screen.getByText('1. Receive stock')).toBeInTheDocument();
    expect(screen.getByText('2. Map deduction rule')).toBeInTheDocument();
    expect(screen.getByText('3. Auto deduct')).toBeInTheDocument();
    expect(screen.getByText('4. Review exception')).toBeInTheDocument();
  });

  it('renders action alerts with human-readable labels and recommended next action', () => {
    renderDashboard();

    expect(screen.getByText('Out Of Stock')).toBeInTheDocument();
    expect(screen.getAllByText(/CBC Reagent Kit/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Batch CBC-01/)).toBeInTheDocument();
    expect(screen.getByText('Recommended: block risky use and restock now')).toBeInTheDocument();
    expect(screen.getByText('Expiring Soon')).toBeInTheDocument();
    expect(screen.getByText('Recommended: review before next shift')).toBeInTheDocument();
  });

  it('renders recent stock movement with reference number and reorder suggestion details', () => {
    renderDashboard();

    expect(screen.getByText('Recent stock movement')).toBeInTheDocument();
    expect(screen.getAllByText('CBC Reagent Kit').length).toBeGreaterThan(0);
    expect(screen.getByText('Ref: LAB-1001')).toBeInTheDocument();
    expect(screen.getByText('Reorder suggestions')).toBeInTheDocument();
    expect(screen.getAllByText('EDTA Tube').length).toBeGreaterThan(0);
    expect(screen.getByText(/Current: 12/)).toBeInTheDocument();
    expect(screen.getByText(/Reorder level: 50/)).toBeInTheDocument();
    expect(screen.getByText('Preferred vendor: MedTech BD')).toBeInTheDocument();
    expect(screen.getByText('+500')).toBeInTheDocument();
  });

  it('shows safe empty states when there are no alerts, movements, reorder suggestions, or smart recommendations', () => {
    mockQueries({ empty: true });
    renderDashboard();

    expect(screen.getByText('Stock health looks good')).toBeInTheDocument();
    expect(screen.getByText('Setup needed')).toBeInTheDocument();
    expect(screen.getByText('Run recompute once to activate smart stock signals.')).toBeInTheDocument();
    expect(screen.getByText('Last computed: Not computed yet')).toBeInTheDocument();
    expect(screen.getByText('No smart stock action yet')).toBeInTheDocument();
    expect(screen.getByText('No deterministic stock signals yet.')).toBeInTheDocument();
    expect(screen.getByText('No active inventory alerts')).toBeInTheDocument();
    expect(screen.getByText('Stock is safe enough for daily operation.')).toBeInTheDocument();
    expect(screen.getByText('No stock movement yet')).toBeInTheDocument();
    expect(screen.getByText('Receive or issue stock to start the ledger.')).toBeInTheDocument();
    expect(screen.getByText('No reorder suggestions')).toBeInTheDocument();
    expect(screen.getByText('All items are above reorder level.')).toBeInTheDocument();
  });


  it('runs a real intelligence recompute instead of only refetching stale dashboard data', () => {
    mockQueries({ empty: true });
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: /run recompute/i }));

    expect(useApiMutation).toHaveBeenCalledWith(
      'post',
      '/api/inventory/intelligence/recompute',
      expect.objectContaining({ offline: false }),
    );
    expect(recomputeMutate).toHaveBeenCalledTimes(1);
  });


  it('refetches related panels and shows a success message after recompute completes', async () => {
    mockQueries({ empty: true });
    renderDashboard();

    const mutationOptions = vi.mocked(useApiMutation).mock.calls[0]?.[2] as { onSuccess?: () => void };
    await act(async () => {
      mutationOptions.onSuccess?.();
    });

    expect(dashboardRefetch).toHaveBeenCalledTimes(1);
    expect(intelligenceRefetch).toHaveBeenCalledTimes(1);
    expect(reorderRefetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Stock brain recomputed. Review suggestions before creating purchase orders.')).toBeInTheDocument();
  });

  it('shows a safe error message when recompute fails', async () => {
    mockQueries({ empty: true });
    renderDashboard();

    const mutationOptions = vi.mocked(useApiMutation).mock.calls[0]?.[2] as { onError?: () => void };
    await act(async () => {
      mutationOptions.onError?.();
    });

    expect(screen.getByText('Could not recompute stock brain. Check migration/setup and try again.')).toBeInTheDocument();
  });

  it('refreshes dashboard data from the hero quick operations panel', () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(dashboardRefetch).toHaveBeenCalledTimes(1);
  });

  it('navigates to traceability when a QR or barcode is scanned', () => {
    renderDashboard();

    const scanInput = screen.getByLabelText('Scan inventory QR or barcode');
    fireEvent.change(scanInput, { target: { value: ' LOT-ABC 123 ' } });
    fireEvent.keyDown(scanInput, { key: 'Enter' });

    expect(navigateMock).toHaveBeenCalledWith('/h/demo-hospital/inventory/traceability?scan=LOT-ABC%20123');
    expect(scanInput).toHaveValue('');
  });
});
