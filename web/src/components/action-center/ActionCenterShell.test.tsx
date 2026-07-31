import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActionCenterShell from './ActionCenterShell';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const summary = {
  data: {
    approvals: { totalPending: 7 },
    exceptions: { open: 4, critical: 1, slaBreached: 2 },
    collections: { open: 12, followupDue: 0, exposure: 2500 },
    tasks: { open: 0, overdue: 0, assignedToMe: 0 },
    resolvedToday: 3,
    nextBestAction: null,
    capabilities: {
      persistentExceptions: true,
      persistentCollections: false,
      persistentTasks: false,
    },
  },
};

function renderShell(
  activeSection: 'overview' | 'approvals' | 'exceptions' | 'collections' | 'tasks',
  initialEntry = '/h/city-care/action/exceptions',
  child: ReactNode = <div>Queue content</div>,
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/h/:slug/*"
          element={(
            <ActionCenterShell
              activeSection={activeSection}
              title="Exceptions"
              description="Review operational risks"
            >
              {child}
            </ActionCenterShell>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ActionCenterShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({
      data: summary,
      isLoading: false,
      isError: false,
    } as never);
  });

  it('renders canonical Action Center navigation with accessible active state', () => {
    renderShell('exceptions');

    const navigation = screen.getByRole('navigation', { name: /action center/i });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /approvals/i })).toHaveAttribute(
      'href',
      '/h/city-care/action/approvals',
    );
    expect(screen.getByRole('link', { name: /exceptions/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Exceptions' })).toBeInTheDocument();
    expect(screen.getByText('Queue content')).toBeInTheDocument();
  });

  it('uses touch-safe focus-visible controls and only shows counts backed by live capabilities', () => {
    renderShell('overview');

    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-11');
      expect(link.className).toContain('focus-visible:ring-2');
    }

    expect(screen.getByTestId('action-center-count-approvals')).toHaveTextContent('7');
    expect(screen.getByTestId('action-center-count-exceptions')).toHaveTextContent('4');
    expect(screen.queryByTestId('action-center-count-collections')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-center-count-tasks')).not.toBeInTheDocument();
  });

  it('keeps navigation available while summary data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as never);

    renderShell('approvals');

    expect(screen.getByRole('navigation', { name: /action center/i })).toBeInTheDocument();
    expect(screen.getByText(/loading action center summary/i)).toBeInTheDocument();
  });

  it('shows a non-blocking stale summary message when counts fail to load', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as never);

    renderShell('collections');

    expect(screen.getByRole('status')).toHaveTextContent(/counts are temporarily unavailable/i);
    expect(screen.getByText('Queue content')).toBeInTheDocument();
  });
});
