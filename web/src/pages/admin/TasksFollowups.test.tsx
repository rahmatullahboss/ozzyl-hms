import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TasksFollowups from './TasksFollowups';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; [key: string]: unknown }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock('../../components/action-center/ActionCenterShell', () => ({
  default: ({ children, title, description }: { children: React.ReactNode; title: string; description: string }) => (
    <section data-testid="action-center-shell">
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </section>
  ),
}));
vi.mock('../../components/action-center/TaskDetailDrawer', () => ({
  default: ({ open, taskId }: { open: boolean; taskId: number | null }) => (
    open ? <div data-testid="task-drawer">task:{taskId}</div> : null
  ),
}));

const task = {
  id: 42,
  title: 'Investigate discount exception',
  description: 'Review the high discount before end of shift.',
  sourceType: 'exception',
  sourcePublicId: 'exception-case:42',
  sourceHref: '/action/exceptions/42',
  sourceMetadata: {},
  priority: 'critical',
  status: 'open',
  assignedTo: 7,
  assignedToName: 'Task Admin',
  dueAtUtc: '2026-07-15T08:00:00.000Z',
  completedBy: null,
  completedByName: null,
  completedAtUtc: null,
  completionNote: null,
  createdBy: 7,
  createdByName: 'Task Admin',
  createdAtUtc: '2026-07-14T08:00:00.000Z',
  updatedAtUtc: '2026-07-14T09:00:00.000Z',
  isOverdue: true,
} as const;

const baseQueryResult = {
  data: {
    data: {
      items: [task],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    },
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderPage(initialEntry = '/h/city-hospital/action/tasks') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/h/:slug/action/tasks"
          element={(
            <>
              <TasksFollowups />
              <LocationProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function mockManagementUser() {
  vi.mocked(useAuth).mockReturnValue({
    isAuthenticated: true,
    token: 'token',
    user: { userId: '7', tenantId: 'tenant-a', role: 'hospital_admin', permissions: [] },
  } as never);
}

describe('TasksFollowups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManagementUser();
    vi.mocked(useApiQuery).mockReturnValue(baseQueryResult as never);
  });

  it('renders the canonical Action Center task workspace and all management views', () => {
    renderPage();

    expect(screen.getByTestId('layout')).toBeTruthy();
    expect(screen.getByTestId('action-center-shell')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'tasks.title' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'tasks.views.mine' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'tasks.views.team' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'tasks.views.dueToday' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'tasks.views.overdue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'tasks.views.completed' })).toBeTruthy();
  });

  it('loads the persistent task API from URL-backed view, filters, search, and page', () => {
    renderPage('/h/city-hospital/action/tasks?view=overdue&priority=high&sourceType=exception&search=discount&page=2');

    expect(useApiQuery).toHaveBeenCalledWith(
      expect.any(Array),
      '/api/action-center/tasks?view=overdue&priority=high&sourceType=exception&search=discount&page=2&limit=50',
      expect.objectContaining({ staleTime: 15_000 }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'tasks.views.team' }));
    expect(screen.getByTestId('location-search').textContent).toContain('view=team');
    expect(screen.getByTestId('location-search').textContent).not.toContain('page=2');
  });

  it('updates priority, source type, and search filters in the URL', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('tasks.filters.priority'), { target: { value: 'critical' } });
    expect(screen.getByTestId('location-search').textContent).toContain('priority=critical');

    fireEvent.change(screen.getByLabelText('tasks.filters.sourceType'), { target: { value: 'collection' } });
    expect(screen.getByTestId('location-search').textContent).toContain('sourceType=collection');

    fireEvent.change(screen.getByLabelText('tasks.filters.search'), { target: { value: 'patient' } });
    expect(screen.getByTestId('location-search').textContent).toContain('search=patient');
  });

  it('renders persistent task rows, tenant-safe source links, and opens task detail', () => {
    renderPage();

    expect(screen.getByText('Investigate discount exception')).toBeTruthy();
    const sourceLink = screen.getByRole('link', { name: 'tasks.actions.openSource' });
    expect(sourceLink.getAttribute('href')).toBe('/h/city-hospital/action/exceptions/42');

    fireEvent.click(screen.getByRole('button', { name: 'Investigate discount exception' }));
    expect(screen.getByTestId('task-drawer').textContent).toBe('task:42');
  });

  it('suppresses source links scoped to a different tenant', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      ...baseQueryResult,
      data: {
        data: {
          items: [{ ...task, sourceHref: '/h/other-hospital/action/exceptions/42' }],
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        },
      },
    } as never);

    renderPage();

    expect(screen.queryByRole('link', { name: 'tasks.actions.openSource' })).toBeNull();
  });

  it('keeps pagination in the URL and disables unavailable directions', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      ...baseQueryResult,
      data: {
        data: {
          items: [task],
          pagination: { page: 2, limit: 50, total: 120, totalPages: 3 },
        },
      },
    } as never);

    renderPage('/h/city-hospital/action/tasks?view=team&page=2');

    fireEvent.click(screen.getByRole('button', { name: 'tasks.pagination.next' }));
    expect(screen.getByTestId('location-search').textContent).toContain('page=3');
  });

  it('renders loading, error with retry, and empty states', () => {
    vi.mocked(useApiQuery).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as never);
    const loading = renderPage();
    expect(screen.getByRole('status').textContent).toContain('tasks.loading');
    loading.unmount();

    const retry = vi.fn();
    vi.mocked(useApiQuery).mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: retry,
    } as never);
    const error = renderPage();
    expect(screen.getByRole('alert').textContent).toContain('tasks.error');
    fireEvent.click(screen.getByRole('button', { name: 'tasks.retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    error.unmount();

    vi.mocked(useApiQuery).mockReturnValueOnce({
      data: { data: { items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    renderPage();
    expect(screen.getByText('tasks.emptyTitle')).toBeTruthy();
    expect(screen.getByText('tasks.empty')).toBeTruthy();
  });
});
