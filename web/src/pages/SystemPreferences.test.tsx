import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemPreferences from './SystemPreferences';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ slug: 'city-hospital' }) };
});

const mockInvalidateQueries = vi.fn();
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { useApiQuery, useApiMutation } from '../hooks/useApiQuery';

const MOCK_PREFS = {
  language: 'en',
  date_format: 'dd-mm-yyyy',
  time_format: '12',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  default_page: 'dashboard',
  items_per_page: 20,
  patient_prefix: 'P',
  invoice_prefix: 'INV',
  lab_sample_prefix: 'LAB',
  prescription_prefix: 'RX',
  admission_prefix: 'ADM',
};

describe('SystemPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: { preferences: MOCK_PREFS }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it('renders the page title', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByText('System Preferences')).toBeInTheDocument();
  });

  it('renders all setting sections', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Number Prefixes')).toBeInTheDocument();
  });

  it('shows language dropdown', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/language/i)).toBeInTheDocument();
  });

  it('shows date format dropdown', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/date format/i)).toBeInTheDocument();
  });

  it('shows time format dropdown', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/time format/i)).toBeInTheDocument();
  });

  it('shows currency dropdown', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/currency/i)).toBeInTheDocument();
  });

  it('shows timezone dropdown', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
  });

  it('shows items per page input', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/items per page/i)).toHaveValue(20);
  });

  it('shows patient prefix input', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/patient prefix/i)).toHaveValue('P');
  });

  it('shows invoice prefix input', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/invoice prefix/i)).toHaveValue('INV');
  });

  it('shows lab sample prefix input', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/lab sample prefix/i)).toHaveValue('LAB');
  });

  it('shows prescription prefix input', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/prescription prefix/i)).toHaveValue('RX');
  });

  it('shows admission prefix input', () => {
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getByLabelText(/admission prefix/i)).toHaveValue('ADM');
  });

  it('saves settings when save button is clicked', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<SystemPreferences role="hospital_admin" />);
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockMutate).toHaveBeenCalled();
  });

  it('shows skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: null, isLoading: true });
    render(<SystemPreferences role="hospital_admin" />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});
