import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationSettings from './NotificationSettings';
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
    useLocation: () => ({ pathname: '/admin/notification-settings', search: params.toString(), hash: '', state: null, key: 'default' }),
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
    admin: { notificationRules: () => ['admin', 'notification-rules'] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('NotificationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps in DashboardLayout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<NotificationSettings />);
    expect(screen.getByTestId('layout')).toBeTruthy();
  });

  it('shows loading skeleton when loading', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: true });
    render(<NotificationSettings />);
    expect(screen.getByText('notificationSettings.loading')).toBeTruthy();
  });

  it('renders page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<NotificationSettings />);
    expect(screen.getByText('notificationSettings.title')).toBeTruthy();
  });

  it('renders channel tabs: All, Email, SMS, In-App', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<NotificationSettings />);
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('SMS')).toBeTruthy();
    expect(screen.getByText('In-App')).toBeTruthy();
  });

  it('shows empty state when no rules', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { rules: [] }, isLoading: false });
    render(<NotificationSettings />);
    expect(screen.getByText('notificationSettings.empty')).toBeTruthy();
  });

  it('shows rules table with data', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        rules: [
          { id: '1', name: 'Low Stock Alert', event: 'stock_low', channel: 'email', recipients: 'admin@hospital.com', enabled: true },
          { id: '2', name: 'Cash Shortage', event: 'cash_shortage', channel: 'sms', recipients: '+1234567890', enabled: false },
        ],
      },
      isLoading: false,
    });
    render(<NotificationSettings />);
    expect(screen.getByText('Low Stock Alert')).toBeTruthy();
    expect(screen.getByText('Cash Shortage')).toBeTruthy();
  });

  it('filters by channel tab', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        rules: [
          { id: '1', name: 'Low Stock Alert', event: 'stock_low', channel: 'email', recipients: 'admin@hospital.com', enabled: true },
          { id: '2', name: 'Cash Shortage', event: 'cash_shortage', channel: 'sms', recipients: '+1234567890', enabled: false },
        ],
      },
      isLoading: false,
    });
    render(<NotificationSettings />);
    fireEvent.click(screen.getByText('Email'));
    expect(screen.getByText('Low Stock Alert')).toBeTruthy();
  });

  it('shows enabled/disabled status badges', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        rules: [
          { id: '1', name: 'Low Stock Alert', event: 'stock_low', channel: 'email', recipients: 'admin@hospital.com', enabled: true },
        ],
      },
      isLoading: false,
    });
    render(<NotificationSettings />);
    expect(screen.getByText('notificationSettings.statusLabels.enabled')).toBeTruthy();
  });
});
