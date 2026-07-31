import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApprovalPolicies from './ApprovalPolicies';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}))
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/approval-policies', search: params.toString(), hash: '', state: null, key: 'default' }),
    useSearchParams: () => {
      const setParams = (next: Record<string, string> | ((p: URLSearchParams) => URLSearchParams)) => {
        if (typeof next === 'function') {
          params = next(params);
        } else {
          params = new URLSearchParams(next);
        }
      };
      return [params, setParams] as ReturnType<typeof actual.useSearchParams>;
    },
  };
});
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { approvalPolicies: () => ['admin', 'approval-policies'] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('ApprovalPolicies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps in DashboardLayout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<ApprovalPolicies />);
    expect(screen.getByTestId('layout')).toBeTruthy();
  });

  it('shows loading skeleton when loading', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: true });
    render(<ApprovalPolicies />);
    expect(screen.getByText('approvalPolicies.loading')).toBeTruthy();
  });

  it('renders page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<ApprovalPolicies />);
    expect(screen.getByText('approvalPolicies.title')).toBeTruthy();
  });

  it('renders action type tabs: All, Discount, Refund, Write-Off, Override', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<ApprovalPolicies />);
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Discount')).toBeTruthy();
    expect(screen.getByText('Refund')).toBeTruthy();
    expect(screen.getByText('Write-Off')).toBeTruthy();
    expect(screen.getByText('Override')).toBeTruthy();
  });

  it('shows empty state when no policies', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { policies: [] }, isLoading: false });
    render(<ApprovalPolicies />);
    expect(screen.getByText('approvalPolicies.empty')).toBeTruthy();
  });

  it('shows policies table with data', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        policies: [
          { id: '1', name: 'High Discount Approval', action: 'discount', condition: 'Percentage > 20%', approver: 'Hospital Admin', attachmentRequired: true, pinRequired: true, escalationMinutes: 30, enabled: true },
          { id: '2', name: 'Refund Over 5000', action: 'refund', condition: 'Amount > 5000', approver: 'Hospital Admin', attachmentRequired: true, pinRequired: false, escalationMinutes: 60, enabled: true },
        ],
      },
      isLoading: false,
    });
    render(<ApprovalPolicies />);
    expect(screen.getByText('High Discount Approval')).toBeTruthy();
    expect(screen.getByText('Refund Over 5000')).toBeTruthy();
  });

  it('filters by action type tab', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        policies: [
          { id: '1', name: 'High Discount Approval', action: 'discount', condition: 'Percentage > 20%', approver: 'Hospital Admin', attachmentRequired: true, pinRequired: true, escalationMinutes: 30, enabled: true },
          { id: '2', name: 'Refund Over 5000', action: 'refund', condition: 'Amount > 5000', approver: 'Hospital Admin', attachmentRequired: true, pinRequired: false, escalationMinutes: 60, enabled: true },
        ],
      },
      isLoading: false,
    });
    render(<ApprovalPolicies />);
    fireEvent.click(screen.getByText('Refund'));
    expect(screen.getByText('Refund Over 5000')).toBeTruthy();
  });

  it('shows condition and approver columns', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        policies: [
          { id: '1', name: 'High Discount Approval', action: 'discount', condition: 'Percentage > 20%', approver: 'Hospital Admin', attachmentRequired: true, pinRequired: true, escalationMinutes: 30, enabled: true },
        ],
      },
      isLoading: false,
    });
    render(<ApprovalPolicies />);
    expect(screen.getByText('Percentage > 20%')).toBeTruthy();
    expect(screen.getByText('Hospital Admin')).toBeTruthy();
  });
});
