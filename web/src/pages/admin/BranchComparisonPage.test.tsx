import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BranchComparisonPage from './BranchComparisonPage';

vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts.count === 'number') return `${k} count=${opts.count}`;
      return k;
    },
  }),
  initReactI18next: { type: '3rdParty' },
}))
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { branches: { analytics: (s: string) => ['branches', 'analytics', s] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

import { useApiQuery } from '../../hooks/useApiQuery';
const mockUseApiQuery = useApiQuery as unknown as ReturnType<typeof vi.fn>;

const mockData = {
  branches: [
    { slug: 'city-hospital', name: 'City Hospital', todayCollection: 50000, todayExpense: 30000, opdPatients: 45, ipdOccupied: 20, totalBeds: 30, occupancyPercent: 67, outstandingDue: 15000, staffCount: 25 },
    { slug: 'green-clinic', name: 'Green Clinic', todayCollection: 30000, todayExpense: 18000, opdPatients: 25, ipdOccupied: 10, totalBeds: 15, occupancyPercent: 67, outstandingDue: 8000, staffCount: 12 },
  ],
  totals: { totalCollection: 80000, totalExpense: 48000, totalPatients: 70, totalOccupied: 30, totalBeds: 45, avgOccupancy: 67 },
};

describe('BranchComparisonPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders loading state', () => {
    mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: true });
    render(<BranchComparisonPage />);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(1);
  });

  it('renders totals cards', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<BranchComparisonPage />);
    expect(screen.getByText('branchComparison.totalCollection')).toBeDefined();
    expect(screen.getByText('branchComparison.totalExpense')).toBeDefined();
    expect(screen.getByText('branchComparison.branches')).toBeDefined();
  });

  it('renders branch cards', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<BranchComparisonPage />);
    expect(screen.getByText('City Hospital')).toBeDefined();
    expect(screen.getByText('Green Clinic')).toBeDefined();
  });

  it('highlights current branch', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<BranchComparisonPage />);
    expect(screen.getByText('branchComparison.current')).toBeDefined();
  });

  it('renders branch stats', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    const { container } = render(<BranchComparisonPage />);
    expect(container.textContent).toContain('branchComparison.staffCount count=25');
    expect(container.textContent).toContain('branchComparison.staffCount count=12');
  });

  it('renders empty state', () => {
    mockUseApiQuery.mockReturnValue({ data: { branches: [], totals: null }, isLoading: false });
    render(<BranchComparisonPage />);
    expect(screen.getByText('branchComparison.noBranchData')).toBeDefined();
  });
});
