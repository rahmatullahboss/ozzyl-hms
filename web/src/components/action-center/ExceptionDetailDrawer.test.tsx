import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExceptionDetailDrawer from './ExceptionDetailDrawer';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

const mutateMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const refetchDetailMock = vi.fn();
const refetchEventsMock = vi.fn();
let status = 'open';
let mutationState: Record<string, unknown> = {};

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: '77', role: 'hospital_admin', permissions: [] } }),
}));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    actionCenter: {
      summary: () => ['action-center', 'summary'],
      exceptions: {
        all: ['action-center', 'exceptions'],
        detail: (id: number) => ['action-center', 'exceptions', 'detail', id],
        events: (id: number) => ['action-center', 'exceptions', 'events', id],
      },
    },
  },
}));

const detail = () => ({
  data: {
    id: 42,
    ruleKey: 'cash.stale_handover',
    fingerprint: 'handover:42',
    sourceType: 'cash_handover',
    sourceId: '42',
    module: 'cash',
    severity: 'warning',
    title: 'Stale cash handover',
    description: 'Pending handover is older than 24 hours.',
    sourceHref: '/cash/handover/42',
    status,
    assignedTo: null,
    assignedToName: null,
    firstDetectedAt: '2026-07-13 08:00:00',
    lastDetectedAt: '2026-07-14 09:00:00',
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionCode: null,
    resolutionNote: null,
    dismissedBy: null,
    dismissedAt: null,
    dismissalReason: null,
    snoozedUntil: null,
    metadata: { amount: 100 },
    slaAgeHours: 28,
    createdAt: '2026-07-13 08:00:00',
    updatedAt: '2026-07-14 09:00:00',
  },
});

function setupQueries() {
  vi.mocked(useApiQuery).mockImplementation((_, path) => {
    if (path.endsWith('/events')) {
      return {
        data: { data: [{ id: 1, eventType: 'created', actorId: 77, actorName: 'Admin User', oldStatus: null, newStatus: 'open', note: 'Created', metadata: {}, createdAt: '2026-07-14 09:00:00' }] },
        isLoading: false,
        isError: false,
        refetch: refetchEventsMock,
      } as never;
    }
    return {
      data: detail(),
      isLoading: false,
      isError: false,
      refetch: refetchDetailMock,
    } as never;
  });
}

describe('ExceptionDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status = 'open';
    mutationState = {};
    setupQueries();
    vi.mocked(useQueryClient).mockReturnValue({ invalidateQueries: invalidateQueriesMock } as never);
    vi.mocked(useApiMutation).mockImplementation((_, __, options) => ({
      mutate: mutateMock,
      isPending: false,
      isError: false,
      error: null,
      ...mutationState,
      __options: options,
    } as never));
  });

  it('loads detail and timeline and renders an accessible modal drawer with source link', () => {
    const onClose = vi.fn();
    const { unmount } = render(<ExceptionDetailDrawer open caseId={42} onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'Stale cash handover' })).toHaveAttribute('aria-modal', 'true');
    const closeButtons = screen.getAllByRole('button', { name: 'alerts.close' });
    expect(closeButtons.at(-1)).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(useApiQuery).toHaveBeenCalledWith(
      expect.any(Array),
      '/api/action-center/exceptions/42',
      expect.objectContaining({ enabled: true }),
    );
    expect(useApiQuery).toHaveBeenCalledWith(
      expect.any(Array),
      '/api/action-center/exceptions/42/events',
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByText('Admin User')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'alerts.openSource' })).toHaveAttribute(
      'href',
      '/h/city-hospital/cash/handover/42',
    );
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('submits acknowledge, assign-to-self, and start actions for an open case', () => {
    render(<ExceptionDetailDrawer open caseId={42} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'alerts.actions.acknowledge' }));
    expect(mutateMock).toHaveBeenLastCalledWith({});

    fireEvent.click(screen.getByRole('button', { name: 'alerts.actions.assignToMe' }));
    expect(mutateMock).toHaveBeenLastCalledWith({ assignedTo: 77 });

    fireEvent.click(screen.getByRole('button', { name: 'alerts.actions.start' }));
    expect(mutateMock).toHaveBeenLastCalledWith({});
  });

  it('requires snooze time, resolution note/code, and dismissal reason before submission', () => {
    status = 'in_progress';
    render(<ExceptionDetailDrawer open caseId={42} onClose={vi.fn()} />);

    const snoozeButton = screen.getByRole('button', { name: 'alerts.actions.snooze' });
    expect(snoozeButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('alerts.fields.snoozedUntil'), { target: { value: '2026-07-15T12:00' } });
    expect(snoozeButton).toBeEnabled();
    fireEvent.click(snoozeButton);
    expect(mutateMock).toHaveBeenLastCalledWith({ snoozedUntil: '2026-07-15T12:00' });

    const resolveButton = screen.getByRole('button', { name: 'alerts.actions.resolve' });
    expect(resolveButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('alerts.fields.resolutionCode'), { target: { value: 'verified' } });
    fireEvent.change(screen.getByLabelText('alerts.fields.resolutionNote'), { target: { value: 'Cash verified.' } });
    expect(resolveButton).toBeEnabled();
    fireEvent.click(resolveButton);
    expect(mutateMock).toHaveBeenLastCalledWith({ resolutionCode: 'verified', note: 'Cash verified.' });

    const dismissButton = screen.getByRole('button', { name: 'alerts.actions.dismiss' });
    expect(dismissButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('alerts.fields.dismissalReason'), { target: { value: 'False positive' } });
    expect(dismissButton).toBeEnabled();
    fireEvent.click(dismissButton);
    expect(mutateMock).toHaveBeenLastCalledWith({ reason: 'False positive' });
  });

  it('requires a note to reopen a resolved case', () => {
    status = 'resolved';
    render(<ExceptionDetailDrawer open caseId={42} onClose={vi.fn()} />);

    const reopenButton = screen.getByRole('button', { name: 'alerts.actions.reopen' });
    expect(reopenButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('alerts.fields.reopenNote'), { target: { value: 'Condition recurred' } });
    expect(reopenButton).toBeEnabled();
    fireEvent.click(reopenButton);
    expect(mutateMock).toHaveBeenLastCalledWith({ note: 'Condition recurred' });
  });

  it('disables all action controls while a mutation is pending', () => {
    mutationState = { isPending: true };
    render(<ExceptionDetailDrawer open caseId={42} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'alerts.actions.acknowledge' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'alerts.actions.assignToMe' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'alerts.actions.start' })).toBeDisabled();
  });

  it('surfaces a 409 stale-write conflict and offers a refresh recovery action', () => {
    mutationState = {
      isError: true,
      error: Object.assign(new Error('Conflict'), { status: 409 }),
    };
    render(<ExceptionDetailDrawer open caseId={42} onClose={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('alerts.conflict');
    fireEvent.click(screen.getByRole('button', { name: 'alerts.refreshCase' }));
    expect(refetchDetailMock).toHaveBeenCalled();
    expect(refetchEventsMock).toHaveBeenCalled();
  });
});
