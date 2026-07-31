import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EscalationRules from './EscalationRules';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { admin: { escalationRules: () => ['admin', 'escalation-rules'] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockRules = [
  {
    id: 'R1',
    name: 'Cash dispute escalation',
    category: 'cash_dispute',
    triggerCondition: 'When cash variance > ৳500',
    steps: [
      { delayMinutes: 15, notifyRole: 'Shift Manager' },
      { delayMinutes: 30, notifyRole: 'Accounts Head' },
    ],
    status: 'active',
  },
  {
    id: 'R2',
    name: 'High discount approval',
    category: 'high_discount',
    triggerCondition: 'When discount > 20% and no reference',
    steps: [
      { delayMinutes: 10, notifyRole: 'Department Head' },
    ],
    status: 'inactive',
  },
];

describe('EscalationRules', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<EscalationRules />);
    expect(screen.getByText('escalationRules.loading')).toBeInTheDocument();
  });

  it('renders page title and Add Rule button', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { rules: [] }, isLoading: false } as never);
    render(<EscalationRules />);
    expect(screen.getByText('escalationRules.title')).toBeInTheDocument();
    expect(screen.getByText('escalationRules.actions.addRule')).toBeInTheDocument();
  });

  it('renders 3 summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { rules: mockRules, summary: { totalRules: 5, activeRules: 3, categories: 4 } },
      isLoading: false,
    } as never);
    render(<EscalationRules />);
    expect(screen.getByText('escalationRules.summary.totalRules')).toBeInTheDocument();
    expect(screen.getByText('escalationRules.summary.activeRules')).toBeInTheDocument();
    expect(screen.getByText('escalationRules.summary.categories')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders rule cards with name, category, and status', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { rules: mockRules }, isLoading: false } as never);
    render(<EscalationRules />);
    expect(screen.getByText('Cash dispute escalation')).toBeInTheDocument();
    expect(screen.getByText('High discount approval')).toBeInTheDocument();
    expect(screen.getByText('cash dispute')).toBeInTheDocument();
    expect(screen.getByText('high discount')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('renders trigger condition and escalation steps', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { rules: [mockRules[0]] }, isLoading: false } as never);
    render(<EscalationRules />);
    expect(screen.getByText('When cash variance > ৳500')).toBeInTheDocument();
    expect(screen.getByText(/15min.*Shift Manager/)).toBeInTheDocument();
    expect(screen.getByText(/30min.*Accounts Head/)).toBeInTheDocument();
  });

  it('shows empty state when no rules', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { rules: [] }, isLoading: false } as never);
    render(<EscalationRules />);
    expect(screen.getByText('escalationRules.empty')).toBeInTheDocument();
  });
});
