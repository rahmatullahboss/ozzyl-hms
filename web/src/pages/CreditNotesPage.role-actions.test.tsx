import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import CreditNotesPage from './CreditNotesPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../components/dashboard/KPICard', () => ({
  default: ({ title, value }: { title: React.ReactNode; value: React.ReactNode }) => <div>{title}: {value}</div>,
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: () => ({
    data: {
      credit_notes: [{
        id: 1,
        credit_note_no: 'CN-001',
        patient_name: 'Rahim',
        refund_amount: 250,
        reason: 'Partial refund',
        status: 'approved',
        created_at: '2026-07-17T10:00:00Z',
      }],
    },
    isLoading: false,
  }),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

function renderPage(role: string) {
  return render(
    <MemoryRouter>
      <CreditNotesPage role={role} />
    </MemoryRouter>,
  );
}

describe('CreditNotesPage role-aware actions', () => {
  it('hides direct credit-note creation from reception', () => {
    renderPage('reception');
    expect(screen.queryByRole('button', { name: /newCreditNote|New Credit Note/i })).not.toBeInTheDocument();
  });

  it('keeps direct credit-note creation for authorized finance roles', () => {
    renderPage('accountant');
    expect(screen.getByRole('button', { name: /newCreditNote|New Credit Note/i })).toBeInTheDocument();
  });
});
