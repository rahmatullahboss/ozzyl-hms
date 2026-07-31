import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import GlobalSearch from '../GlobalSearch';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  getTenant: () => ({ slug: 'test-hospital' }),
  useAuth: () => ({
    isAuthenticated: true,
    token: 'tok',
    user: { userId: '1', role: 'hospital_admin', permissions: [] },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { useApiQuery } from '../../hooks/useApiQuery';

const mockSearchResults = {
  data: {
    query: 'John',
    patients: [{ id: 1, name: 'John Doe', phone: '01712345678', patient_code: 'P001' }],
    bills: [{
      id: 1,
      invoice_no: 'INV-000023',
      patient_id: 1,
      patient_name: 'John Doe',
      patient_code: 'P001',
      total: 500,
      paid: 100,
      status: 'partial',
    }],
    doctors: [{ id: 1, name: 'Dr. Ahmed', phone: '01612345678' }],
    admissions: [],
    totalResults: 3,
  },
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GlobalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: undefined, isLoading: false });
  });

  it('renders search button with text', () => {
    renderWithProviders(<GlobalSearch />);
    expect(screen.getByText(/Search/i)).toBeTruthy();
  });

  it('shows keyboard shortcut hint', () => {
    renderWithProviders(<GlobalSearch />);
    const kbd = document.querySelector('kbd');
    expect(kbd).toBeTruthy();
    expect(kbd?.textContent).toContain('K');
  });

  it('opens search overlay on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));

    expect(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i)).toBeTruthy();
  });

  it('keeps keyboard focus rings on the trigger and close buttons', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    const trigger = screen.getByRole('button', { name: /Open global search|Search/i });
    expect(trigger.className).toContain('focus-visible:ring-2');
    expect(trigger.className).toContain('focus-visible:ring-[var(--color-primary)]');

    await user.click(trigger);

    const closeButton = screen.getByRole('button', { name: /Close/i });
    expect(closeButton.className).toContain('focus-visible:ring-2');
    expect(closeButton.className).toContain('focus-visible:ring-[var(--color-primary)]');
  });

  it('closes search on Escape key', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    expect(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i)).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search patients, INV-numbers, doctors/i)).toBeNull();
    });
  });

  it('shows helper text for short queries', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'J');

    expect(screen.getByText(/at least 2 characters/i)).toBeTruthy();
  });

  it('shows INV format hint in empty state', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));

    // The empty state should mention INV-000023 as an example
    expect(screen.getByText(/INV-000023/i)).toBeTruthy();
  });

  it('displays search results when available', async () => {
    (useApiQuery as any).mockReturnValue({ data: mockSearchResults, isLoading: false });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'John');

    await waitFor(() => {
      // Patient name appears twice (once in patient section, once in invoice section)
      expect(screen.getAllByText('John Doe').length).toBeGreaterThan(0);
      expect(screen.getByText('INV-000023')).toBeTruthy();
      expect(screen.getByText('Dr. Ahmed')).toBeTruthy();
    });
  });

  it('shows result category headers', async () => {
    (useApiQuery as any).mockReturnValue({ data: mockSearchResults, isLoading: false });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'John');

    await waitFor(() => {
      expect(screen.getByText(/Patients/)).toBeTruthy();
      expect(screen.getByText(/Invoices/)).toBeTruthy();
      expect(screen.getByText(/Doctors/)).toBeTruthy();
    });
  });

  it('shows total results count in footer', async () => {
    (useApiQuery as any).mockReturnValue({ data: mockSearchResults, isLoading: false });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'John');

    await waitFor(() => {
      expect(screen.getByText(/3 results/)).toBeTruthy();
    });
  });

  it('shows patient code and phone in patient results', async () => {
    (useApiQuery as any).mockReturnValue({ data: mockSearchResults, isLoading: false });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'John');

    await waitFor(() => {
      expect(screen.getAllByText(/P001/).length).toBeGreaterThan(0);
      expect(screen.getByText(/01712345678/)).toBeTruthy();
    });
  });

  it('shows invoice status badge and Print button', async () => {
    (useApiQuery as any).mockReturnValue({ data: mockSearchResults, isLoading: false });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'John');

    await waitFor(() => {
      expect(screen.getByText(/partial/i)).toBeTruthy();
      // Print button is present and accessible
      expect(screen.getByRole('button', { name: /Print invoice/i })).toBeTruthy();
    });
  });

  it('opens print preview in a new tab when Print button clicked', async () => {
    (useApiQuery as any).mockReturnValue({ data: mockSearchResults, isLoading: false });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'John');

    await waitFor(() => screen.getByRole('button', { name: /Print invoice/i }));

    await user.click(screen.getByRole('button', { name: /Print invoice/i }));

    expect(openSpy).toHaveBeenCalledWith(
      '/h/test-hospital/billing/1/print',
      '_blank',
      'noopener,noreferrer',
    );

    openSpy.mockRestore();
  });

  it('shows empty state when no results', async () => {
    (useApiQuery as any).mockReturnValue({
      data: { data: { query: 'xyz', patients: [], bills: [], doctors: [], admissions: [], totalResults: 0 } },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'xyz');

    await waitFor(() => {
      expect(screen.getByText(/No results found/)).toBeTruthy();
    });
  });

  it('shows INV typo hint when query looks like an invoice', async () => {
    (useApiQuery as any).mockReturnValue({
      data: { data: { query: 'inv-oooo23', patients: [], bills: [], doctors: [], admissions: [], totalResults: 0 } },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'inv-oooo23');

    await waitFor(() => {
      // Should show normalized suggestion replacing letter "o" with digit "0"
      expect(screen.getByText('INV-000023')).toBeTruthy();
    });
  });

  it('shows invoice hint for BL-prefixed invoice queries', async () => {
    (useApiQuery as any).mockReturnValue({
      data: { data: { query: 'BL-0000-14', patients: [], bills: [], doctors: [], admissions: [], totalResults: 0 } },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'BL-0000-14');

    await waitFor(() => {
      expect(screen.getByText(/Tip: Invoice numbers use digits/)).toBeTruthy();
    });
  });

  it('shows invoice hint for comma-separated numeric invoice queries', async () => {
    (useApiQuery as any).mockReturnValue({
      data: { data: { query: '14,289,23', patients: [], bills: [], doctors: [], admissions: [], totalResults: 0 } },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), '14,289,23');

    await waitFor(() => {
      expect(screen.getByText(/Tip: Invoice numbers use digits/)).toBeTruthy();
    });
  });

  it('shows loading spinner during search', async () => {
    (useApiQuery as any).mockReturnValue({ data: undefined, isLoading: true });
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    await user.type(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i), 'John');

    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows ESC to close hint in footer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));

    expect(screen.getByText(/to close/i)).toBeTruthy();
  });

  it('closes search when clicking backdrop', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));
    expect(screen.getByPlaceholderText(/Search patients, INV-numbers, doctors/i)).toBeTruthy();

    // Click the backdrop (the fixed overlay div)
    const backdrop = document.querySelector('.fixed.inset-0');
    if (backdrop) {
      await user.click(backdrop);
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/Search patients, INV-numbers, doctors/i)).toBeNull();
      });
    }
  });

  it('shows zero results in footer when no search performed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);

    await user.click(screen.getByRole('button', { name: /Open global search|Search/i }));

    expect(screen.getByText(/0 results/)).toBeTruthy();
  });
});
