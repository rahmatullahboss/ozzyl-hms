import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IPBillingPage from './IPBillingPage';
import { api } from '../lib/apiClient';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }), useNavigate: () => vi.fn() }));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('../components/dashboard/KPICard', () => ({
  default: ({ title, value }: { title: string; value: string | number }) => <div data-testid="ipd-kpi"><span>{title}</span><span>{String(value)}</span></div>,
}));
vi.mock('../components/dashboard/EmptyState', () => ({ default: () => <div>No data</div> }));
vi.mock('../components/HelpButton', () => ({ default: () => null }));
vi.mock('../components/WhatsAppButton', () => ({ default: () => null }));
vi.mock('../components/HelpPanel', () => ({ default: () => null }));
vi.mock('../components/reception/ProvisionalBillingModal', () => ({ ProvisionalBillingModal: () => null }));
vi.mock('../components/ipd/DoctorRoundForm', () => ({ default: () => null }));
vi.mock('../lib/apiClient', () => ({
  ApiClientError: class extends Error {},
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const get = api.get as ReturnType<typeof vi.fn>;

describe('IPBillingPage selected reporting period', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (path: string) => {
      if (path === '/api/ip-billing/patients') return { data: [] };
      if (path.startsWith('/api/ip-billing/stats?')) return {
        total_inpatients: 4,
        pending_billing: 2,
        total_charges_today: 1200,
        settled_today: 900,
        high_due_patients: 1,
        package_patients: 1,
        today_admissions: 3,
        today_discharges: 2,
      };
      throw new Error(`Unhandled GET ${path}`);
    });
  });

  it('reloads department finance cards with the selected custom range', async () => {
    render(<IPBillingPage />);

    expect(await screen.findByText('IP Billing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom start date'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Custom end date'), { target: { value: '2026-07-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }));

    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/api/ip-billing/stats?from=2026-07-01&to=2026-07-10');
    });

    expect(screen.getByText('Admissions in Period')).toBeInTheDocument();
    expect(screen.getByText('Discharges in Period')).toBeInTheDocument();
    expect(screen.getByText('Charges in Period')).toBeInTheDocument();
    expect(screen.getByText('Settled in Period')).toBeInTheDocument();
    expect(screen.getByTestId('ipd-reporting-period')).toHaveTextContent('2026-07-01 – 2026-07-10');
  });
});
