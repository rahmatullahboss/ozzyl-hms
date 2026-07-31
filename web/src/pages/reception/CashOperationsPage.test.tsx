import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CashOperationsPage from './CashOperationsPage';

const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockUseApiMutation = vi.hoisted(() => vi.fn(() => ({ mutate: vi.fn(), isPending: false })));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: (...args: unknown[]) => mockUseApiMutation(...args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'reception', userId: '99' } }),
}));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key }),
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children, role }: { children: React.ReactNode; role: string }) => (
    <div data-testid="dashboard-layout" data-role={role}>{children}</div>
  ),
}));
vi.mock('../../components/reception/ReceptionTopBar', () => ({
  default: ({ role }: { role: string }) => <div data-testid="reception-topbar" data-role={role}>Reception topbar</div>,
}));

describe('CashOperationsPage', () => {
  beforeEach(() => {
    mockUseApiQuery.mockImplementation((key: readonly unknown[]) => {
      if (key[0] === 'cashOperations' && key[1] === 'overview') {
        return {
          data: {
            overview: {
              openingCash: 1000,
              patientCashCollection: 5000,
              refundCashOut: 200,
              doctorPayout: 300,
              expenseCashOut: 150,
              transferOut: 250,
              acceptedTransferIn: 100,
              bankDepositCustody: 400,
              manualCashIn: 100,
              manualCashOut: 450,
              otherDrawerCashOut: 0,
              currentDrawerBalance: 4800,
              heldRefundCash: 350,
              availableCash: 4450,
              sessionId: 1,
            },
          },
          isLoading: false,
        };
      }
      if (key[0] === 'cashOperations' && key[1] === 'activity') {
        return {
          data: { activity: [{ id: '1', movementType: 'cash_out', referenceType: 'doctor_commission_settlement', amount: 300, description: 'Doctor payout' }] },
          isLoading: false,
        };
      }
      if (key[0] === 'cashOperations' && key[1] === 'sessions') {
        if (key[2] === '2026-06-24') return { data: { sessions: [] }, isLoading: false };
        return {
          data: {
            sessions: [
              { sessionId: 2, counterId: 3, counterName: 'Main Cash Counter', status: 'closed', openedAt: '2026-06-18 08:00:00', closedAt: '2026-06-18 17:00:00', openingCash: 700 },
            ],
          },
          isLoading: false,
        };
      }
      if (key[0] === 'cash-operations' && key[1] === 'shift' && key[2] === 'recipients') {
        return {
          data: { recipients: [{ id: 2, name: 'Next Receptionist', role: 'reception' }] },
          isLoading: false,
        };
      }
      if (key[0] === 'doctor-payouts') {
        return {
          data: {
            doctors: [
              {
                doctorId: 1,
                doctorName: 'Dr Amin',
                consultationCommission: 200,
                testCommission: 100,
                payableAmount: 300,
                eligibleItemCount: 2,
                items: [
                  { accrualId: 101, serviceName: 'Consultation fee', sourceType: 'consultation_fee', patientName: 'Karim', invoiceNo: 'INV-1', commissionAmount: 200 },
                  { accrualId: 102, serviceName: 'CBC Test', sourceType: 'lab_test', patientName: 'Karim', invoiceNo: 'INV-2', commissionAmount: 100 },
                ],
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });
  });

  it('renders overview, tabs, doctor payout source labels, and recent activity', () => {
    render(<CashOperationsPage />);

    expect(screen.getByTestId('dashboard-layout')).toHaveAttribute('data-role', 'reception');
    expect(screen.getByTestId('reception-topbar')).toBeInTheDocument();
    expect(screen.getByText('overview.title')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'tabs.doctor' })).toBeInTheDocument();
    expect(screen.getAllByText(/consultation/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/lab\/test/i).length).toBeGreaterThan(0);
    expect(screen.getByText('CBC Test')).toBeInTheDocument();
    expect(screen.getByText(/INV-2/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dr Amin')).toBeInTheDocument();
    expect(screen.getByText('activity.title')).toBeInTheDocument();
  });

  it('renders the unassigned performer reserve panel scoped to the selected payout date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T18:30:00.000Z'));

    try {
      render(<CashOperationsPage />);

      expect(screen.getByRole('heading', { name: 'Unassigned Test Performer Reserves' })).toBeInTheDocument();
      expect(screen.getByLabelText('Reserve from date')).toHaveValue('2026-06-22');
      expect(screen.getByLabelText('Reserve to date')).toHaveValue('2026-06-22');
      expect(mockUseApiQuery.mock.calls).toContainEqual(expect.arrayContaining([
        ['doctor-payouts', 'unassigned-performer-reserves', 1, '2026-06-22', '2026-06-22'],
        '/api/payment-methods/doctor-payouts/unassigned-performer-reserves?includeWaitingPayment=true&from=2026-06-22&to=2026-06-22',
      ]));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows refund reserve separately and uses available cash for shift close', async () => {
    render(<CashOperationsPage />);

    expect(screen.getByText('Pending refund reserve')).toBeInTheDocument();
    expect(screen.getByText('Available drawer cash')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'tabs.close' }));

    expect(screen.getByText('Expected drawer cash')).toBeInTheDocument();
    expect(screen.getByText('Available handover cash')).toBeInTheDocument();
    expect(screen.getAllByText('৳350.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳4,450.00').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Available cash counted for handover')).toBeInTheDocument();
  });

  it('submits shift-close money at two-decimal precision', async () => {
    const mutate = vi.fn();
    mockUseApiMutation.mockImplementation(() => ({ mutate, isPending: false }));
    render(<CashOperationsPage />);

    await userEvent.click(screen.getByRole('tab', { name: 'tabs.close' }));
    fireEvent.change(screen.getByLabelText('Available cash counted for handover'), {
      target: { value: '2077.4900000000002' },
    });
    const recipientSelect = screen.getAllByRole('combobox').at(-1);
    expect(recipientSelect).toBeDefined();
    fireEvent.change(recipientSelect as HTMLSelectElement, {
      target: { value: '2' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'close.submit' }));

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      closingCash: 2077.49,
      handoverAmount: 2077.49,
    }));
  });

  it('shows only uncategorized cash out in the other drawer cash out card', () => {
    render(<CashOperationsPage />);

    const card = screen.getByText('overview.drawerSpent').parentElement;
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('৳0.00')).toBeInTheDocument();
  });

  it('defaults doctor payables to today in Dhaka and clears selections when the range changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T18:30:00.000Z'));

    try {
      render(<CashOperationsPage />);

      const fromInput = screen.getByLabelText('From') as HTMLInputElement;
      const toInput = screen.getByLabelText('To') as HTMLInputElement;
      expect(fromInput.value).toBe('2026-06-22');
      expect(toInput.value).toBe('2026-06-22');
      expect(mockUseApiQuery.mock.calls).toContainEqual(expect.arrayContaining([
        ['doctor-payouts', 'payables', '2026-06-22', '2026-06-22'],
        '/api/payment-methods/doctor-payouts/payables?from=2026-06-22&to=2026-06-22',
      ]));

      fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
      expect(screen.getByText('2 selected items')).toBeInTheDocument();
      fireEvent.change(fromInput, { target: { value: '2026-06-21' } });
      expect(screen.getByText('0 selected items')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });



  it('passes selected closed counter session to cash operation print queries', async () => {
    render(<CashOperationsPage />);

    const sessionSelect = screen.getByLabelText('Counter Session') as HTMLSelectElement;
    expect(sessionSelect).toBeInTheDocument();
    fireEvent.change(sessionSelect, { target: { value: '2' } });

    expect(mockUseApiQuery.mock.calls).toContainEqual(expect.arrayContaining([
      ['cashOperations', 'overview', { counterSessionId: '2' }],
      '/api/cash-operations/overview?counterSessionId=2',
    ]));
    expect(mockUseApiQuery.mock.calls).toContainEqual(expect.arrayContaining([
      ['cashOperations', 'activity', { limit: 50, counterSessionId: '2' }],
      '/api/cash-operations/activity?limit=50&counterSessionId=2',
    ]));
  });



  it('loads counter session options for the selected date range', async () => {
    render(<CashOperationsPage />);

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-06-22' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-06-22' } });

    expect(mockUseApiQuery.mock.calls).toContainEqual(expect.arrayContaining([
      ['cashOperations', 'sessions', '2026-06-22', '2026-06-22', 'own'],
      '/api/cash-operations/sessions?limit=30&from=2026-06-22&to=2026-06-22',
    ]));
  });



  it('keeps the session/date filter panel visible when selected date has no sessions', () => {
    render(<CashOperationsPage />);

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-06-24' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-06-24' } });

    expect(screen.getByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
    expect(screen.getByLabelText('Counter Session')).toBeInTheDocument();
    expect(mockUseApiQuery.mock.calls).toContainEqual(expect.arrayContaining([
      ['cashOperations', 'sessions', '2026-06-24', '2026-06-24', 'own'],
      '/api/cash-operations/sessions?limit=30&from=2026-06-24&to=2026-06-24',
    ]));
  });

  it('uses real expense categories instead of a single petty-cash text field', async () => {
    render(<CashOperationsPage />);

    await userEvent.click(screen.getByRole('tab', { name: 'tabs.expense' }));
    const categorySelect = screen.getByLabelText('common.category');
    expect(categorySelect.tagName).toBe('SELECT');
    expect(within(categorySelect).getByRole('option', { name: /electricity/i })).toBeInTheDocument();
    expect(within(categorySelect).getByRole('option', { name: /maintenance/i })).toBeInTheDocument();
  });
});
