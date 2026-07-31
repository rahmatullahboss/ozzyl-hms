import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskDetailDrawer from './TaskDetailDrawer';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
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
  useApiMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

const detail = {
  id: 42,
  title: 'Investigate discount exception',
  description: 'Review the high discount before end of shift.',
  sourceType: 'exception',
  sourcePublicId: 'exception-case:42',
  sourceHref: '/action/exceptions/42',
  sourceMetadata: { exceptionCaseId: 42 },
  priority: 'critical',
  status: 'open',
  assignedTo: 7,
  assignedToName: 'Task Admin',
  dueAtUtc: '2026-07-20T10:00:00.000Z',
  completedBy: null,
  completedByName: null,
  completedAtUtc: null,
  completionNote: null,
  createdBy: 7,
  createdByName: 'Task Admin',
  createdAtUtc: '2026-07-14T08:00:00.000Z',
  updatedAtUtc: '2026-07-14T09:00:00.000Z',
  isOverdue: false,
  sourceStatusSummary: { status: 'open', severity: 'critical' },
} as const;

const events = [
  {
    id: 1,
    eventType: 'created',
    actorId: 7,
    actorName: 'Task Admin',
    oldStatus: null,
    newStatus: 'open',
    note: 'Created from exception.',
    metadata: {},
    createdAtUtc: '2026-07-14T08:00:00.000Z',
  },
];

const detailRefetch = vi.fn();
const eventsRefetch = vi.fn();
const invalidateQueries = vi.fn();
const mutationOptions = new Map<string, { onSuccess?: () => unknown }>();
const mutationStates = new Map<string, {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: Error | ({ status: number } & Error) | null;
}>();

function mutationState(path: string) {
  const state = mutationStates.get(path);
  if (!state) throw new Error(`Missing mutation state for ${path}`);
  return state;
}

function renderDrawer(props?: Partial<React.ComponentProps<typeof TaskDetailDrawer>>) {
  return render(
    <MemoryRouter initialEntries={['/h/city-hospital/action/tasks']}>
      <Routes>
        <Route
          path="/h/:slug/action/tasks"
          element={(
            <TaskDetailDrawer
              open
              taskId={42}
              onClose={vi.fn()}
              {...props}
            />
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function actionDialog() {
  return screen.getByRole('dialog', { name: /tasks\.drawer\.dialog\./ });
}

function setMutationError(path: string, status: number) {
  const state = mutationState(path);
  state.isError = true;
  state.error = Object.assign(new Error('stale'), { status });
}

describe('TaskDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationOptions.clear();
    mutationStates.clear();
    detailRefetch.mockReset();
    eventsRefetch.mockReset();
    invalidateQueries.mockReset();

    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      token: 'token',
      user: { userId: '7', tenantId: 'tenant-a', role: 'hospital_admin', permissions: [] },
    } as never);
    vi.mocked(useQueryClient).mockReturnValue({ invalidateQueries } as never);
    vi.mocked(useApiQuery).mockImplementation((_key, path) => {
      if (path === '/api/action-center/tasks/42') {
        return { data: { data: detail }, isLoading: false, isError: false, refetch: detailRefetch } as never;
      }
      if (path === '/api/action-center/tasks/42/events') {
        return { data: { data: events }, isLoading: false, isError: false, refetch: eventsRefetch } as never;
      }
      if (path === '/api/staff') {
        return {
          data: { staff: [{ id: 7, name: 'Task Admin' }, { id: 8, name: 'Task Owner' }] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        } as never;
      }
      throw new Error(`Unexpected query path: ${path}`);
    });

    for (const action of ['assign', 'start', 'reschedule', 'complete', 'cancel']) {
      mutationStates.set(`/api/action-center/tasks/42/${action}`, {
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        error: null,
      });
    }
    vi.mocked(useApiMutation).mockImplementation((_method, path, options) => {
      const resolvedPath = String(path);
      mutationOptions.set(resolvedPath, options as { onSuccess?: () => unknown });
      return mutationState(resolvedPath) as never;
    });
  });

  it('loads task detail, source link, and actor-labelled timeline and closes on Escape', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    expect(screen.getByRole('heading', { name: 'Investigate discount exception' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'tasks.actions.openSource' }).getAttribute('href'))
      .toBe('/h/city-hospital/action/exceptions/42');
    expect(screen.getByText('Task Admin')).toBeTruthy();
    expect(screen.getByText('Created from exception.')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('assigns a task from an accessible staff selector', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'tasks.actions.assign' }));
    const dialog = actionDialog();
    const assigneeSelect = within(dialog).getByLabelText('tasks.drawer.fields.assignee');
    expect(assigneeSelect).toHaveFocus();
    fireEvent.change(assigneeSelect, { target: { value: '8' } });
    fireEvent.change(within(dialog).getByLabelText('tasks.drawer.fields.noteOptional'), { target: { value: 'Hand over to owner.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'tasks.actions.saveAssignment' }));

    expect(mutationState('/api/action-center/tasks/42/assign').mutate).toHaveBeenCalledWith({
      assignedTo: 8,
      note: 'Hand over to owner.',
      expectedUpdatedAtUtc: detail.updatedAtUtc,
    });
  });

  it('starts and reschedules an open task with optimistic concurrency evidence', () => {
    const started = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'tasks.actions.start' }));
    fireEvent.change(within(actionDialog()).getByLabelText('tasks.drawer.fields.noteOptional'), { target: { value: 'Work started.' } });
    fireEvent.click(within(actionDialog()).getByRole('button', { name: 'tasks.actions.startTask' }));
    expect(mutationState('/api/action-center/tasks/42/start').mutate).toHaveBeenCalledWith({
      note: 'Work started.',
      expectedUpdatedAtUtc: detail.updatedAtUtc,
    });
    started.unmount();

    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'tasks.actions.reschedule' }));
    const dueValue = '2026-07-21T10:30';
    fireEvent.change(within(actionDialog()).getByLabelText('tasks.drawer.fields.dueAt'), { target: { value: dueValue } });
    fireEvent.click(within(actionDialog()).getByRole('button', { name: 'tasks.actions.saveSchedule' }));
    expect(mutationState('/api/action-center/tasks/42/reschedule').mutate).toHaveBeenCalledWith({
      dueAtUtc: new Date(dueValue).toISOString(),
      expectedUpdatedAtUtc: detail.updatedAtUtc,
    });
  });

  it('requires notes before completing or cancelling a task', () => {
    const completed = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'tasks.actions.complete' }));
    const completeDialog = actionDialog();
    const completeSubmit = within(completeDialog).getByRole('button', { name: 'tasks.actions.completeTask' });
    expect(completeSubmit).toBeDisabled();
    fireEvent.change(within(completeDialog).getByLabelText('tasks.drawer.fields.noteRequired'), { target: { value: 'Verified and completed.' } });
    fireEvent.click(completeSubmit);
    expect(mutationState('/api/action-center/tasks/42/complete').mutate).toHaveBeenCalledWith({
      note: 'Verified and completed.',
      expectedUpdatedAtUtc: detail.updatedAtUtc,
    });
    completed.unmount();

    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'tasks.actions.cancel' }));
    const cancelDialog = actionDialog();
    const cancelSubmit = within(cancelDialog).getByRole('button', { name: 'tasks.actions.cancelTask' });
    expect(cancelSubmit).toBeDisabled();
    fireEvent.change(within(cancelDialog).getByLabelText('tasks.drawer.fields.noteRequired'), { target: { value: 'Source follow-up withdrawn.' } });
    fireEvent.click(cancelSubmit);
    expect(mutationState('/api/action-center/tasks/42/cancel').mutate).toHaveBeenCalledWith({
      note: 'Source follow-up withdrawn.',
      expectedUpdatedAtUtc: detail.updatedAtUtc,
    });
  });

  it('disables task actions while any mutation is pending', () => {
    mutationState('/api/action-center/tasks/42/start').isPending = true;
    renderDrawer();

    expect(screen.getByRole('button', { name: 'tasks.actions.assign' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'tasks.actions.start' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'tasks.actions.reschedule' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'tasks.actions.complete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'tasks.actions.cancel' })).toBeDisabled();
  });

  it('keeps keyboard focus inside an open action dialog', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'tasks.actions.assign' }));
    const dialog = actionDialog();
    const dialogButtons = within(dialog).getAllByRole('button');
    const firstButton = dialogButtons[0];
    const lastButton = dialogButtons[dialogButtons.length - 1];
    lastButton.focus();

    fireEvent.keyDown(window, { key: 'Tab' });
    expect(firstButton).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(lastButton).toHaveFocus();
  });

  it('shows a visible error when a task action fails without a conflict', () => {
    setMutationError('/api/action-center/tasks/42/start', 500);
    renderDrawer();

    expect(screen.getByRole('alert').textContent).toContain('tasks.actionError');
  });

  it('shows stale-write recovery for 409 conflicts and refreshes detail plus timeline', () => {
    setMutationError('/api/action-center/tasks/42/start', 409);
    renderDrawer();

    expect(screen.getByRole('alert').textContent).toContain('tasks.conflict');
    fireEvent.click(screen.getByRole('button', { name: 'tasks.actions.refreshTask' }));
    expect(detailRefetch).toHaveBeenCalledTimes(1);
    expect(eventsRefetch).toHaveBeenCalledTimes(1);
  });

  it('invalidates task lists and refreshes detail and timeline after a successful action', async () => {
    const onChanged = vi.fn();
    renderDrawer({ onChanged });

    await act(async () => {
      await mutationOptions.get('/api/action-center/tasks/42/complete')?.onSuccess?.();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['action-center', 'tasks'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['action-center', 'summary'] });
    expect(detailRefetch).toHaveBeenCalledTimes(1);
    expect(eventsRefetch).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
