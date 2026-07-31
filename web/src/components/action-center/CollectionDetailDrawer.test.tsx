import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollectionDetailDrawer from './CollectionDetailDrawer';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

const invalidateQueriesMock = vi.fn();
const refetchDetailMock = vi.fn();
const refetchEventsMock = vi.fn();
const mutationByPath = new Map<string, ReturnType<typeof vi.fn>>();
let mutationState: Record<string, unknown> = {};
let writeOffMutationState: Record<string, unknown> = {};
let paymentCapability: 'available' | 'canonical_command_required' = 'available';
let paymentHref: string | null = '/billing?collectBillId=101';
let writeOffRequestCapability: 'available' | 'forbidden' | 'pending' | 'unavailable' = 'available';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: { defaultValue?: string; invoice?: string }) => (
      options?.defaultValue?.replace('{{invoice}}', options.invoice ?? '') ?? key
    ),
  }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    actionCenter: {
      summary: () => ['action-center', 'summary'],
      collections: {
        all: ['action-center', 'collections'],
        detail: (sourceKey: string) => ['action-center', 'collections', 'detail', sourceKey],
        events: (sourceKey: string) => ['action-center', 'collections', 'events', sourceKey],
      },
    },
  },
}));

function detailResponse() {
  return {
    data: {
      sourceKey: 'legacy-bill:101',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      invoiceNumber: 'INV-101',
      patientId: 1,
      patientName: 'Rahim Uddin',
      patientMobile: '01700000001',
      currencyCode: 'BDT',
      totalMinor: 10_000,
      paidMinor: 2_000,
      creditedMinor: 0,
      dueMinor: 8_000,
      issuedAtUtc: '2026-07-14T06:00:00.000Z',
      financialStatus: 'open',
      authorityMode: paymentCapability === 'available' ? 'legacy' : 'canonical',
      caseId: 10,
      collectionStatus: 'contacted',
      assignedTo: null,
      assignedToName: null,
      nextFollowupAtUtc: null,
      promiseDate: null,
      promiseAmountMinor: null,
      promiseCurrencyCode: null,
      latestNote: 'Discussed the invoice.',
      lastContactedAtUtc: '2026-07-14T06:00:00.000Z',
      closedAtUtc: null,
      createdAtUtc: '2026-07-14T06:00:00.000Z',
      updatedAtUtc: '2026-07-14T06:00:00.000Z',
      paymentHref,
      paymentCapability,
      writeOffRequestCapability,
    },
  };
}

function setupQueries() {
  vi.mocked(useApiQuery).mockImplementation((_, path) => {
    if (String(path).endsWith('/events')) {
      return {
        data: {
          data: [{
            id: 1,
            eventType: 'contacted',
            actorId: 7,
            actorName: 'Collection Admin',
            oldStatus: 'new',
            newStatus: 'contacted',
            note: 'Discussed the invoice.',
            metadata: { channel: 'phone' },
            createdAtUtc: '2026-07-14T06:00:00.000Z',
          }],
        },
        isLoading: false,
        isError: false,
        error: null,
        refetch: refetchEventsMock,
      } as never;
    }
    return {
      data: detailResponse(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchDetailMock,
    } as never;
  });
}

function mutation(pathEnding: string) {
  const found = [...mutationByPath.entries()].find(([path]) => path.endsWith(pathEnding));
  if (!found) throw new Error(`Mutation not registered: ${pathEnding}`);
  return found[1];
}

describe('CollectionDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationByPath.clear();
    mutationState = {};
    writeOffMutationState = {};
    paymentCapability = 'available';
    paymentHref = '/billing?collectBillId=101';
    writeOffRequestCapability = 'available';
    setupQueries();
    vi.mocked(useQueryClient).mockReturnValue({ invalidateQueries: invalidateQueriesMock } as never);
    vi.mocked(useApiMutation).mockImplementation((_, path) => {
      const mutate = vi.fn();
      mutationByPath.set(String(path), mutate);
      return {
        mutate,
        isPending: false,
        isError: false,
        error: null,
        ...mutationState,
        ...(String(path).endsWith('/write-off-request') ? writeOffMutationState : {}),
      } as never;
    });
  });

  it('loads detail and timeline in an accessible drawer with API-provided payment link', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={onClose} />,
    );

    expect(screen.getByRole('dialog', { name: /INV-101/ })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getAllByRole('button', { name: 'dueReceivables.actions.close' }).at(-1)).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    expect(useApiQuery).toHaveBeenCalledWith(
      expect.any(Array),
      '/api/action-center/collections/invoice/legacy-bill:101',
      expect.objectContaining({ enabled: true }),
    );
    expect(useApiQuery).toHaveBeenCalledWith(
      expect.any(Array),
      '/api/action-center/collections/invoice/legacy-bill:101/events',
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByText('Collection Admin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'dueReceivables.payment.collect' })).toHaveAttribute(
      'href',
      '/h/city-hospital/billing?collectBillId=101',
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('submits contact and follow-up evidence with the optimistic timestamp', () => {
    render(<CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('dueReceivables.contact.channel'), {
      target: { value: 'phone' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.contact.outcome'), {
      target: { value: 'Patient answered' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.contact.note'), {
      target: { value: 'Explained the outstanding balance.' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.contact.nextFollowupAtUtc'), {
      target: { value: '2099-07-20T04:00:00.000Z' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'dueReceivables.contact.submit' }));
    expect(mutation('/contact')).toHaveBeenCalledWith({
      channel: 'phone',
      outcome: 'Patient answered',
      note: 'Explained the outstanding balance.',
      nextFollowupAtUtc: '2099-07-20T04:00:00.000Z',
      expectedUpdatedAtUtc: '2026-07-14T06:00:00.000Z',
    });

    fireEvent.change(screen.getByLabelText('dueReceivables.followup.nextFollowupAtUtc'), {
      target: { value: '2099-07-22T04:00:00.000Z' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.followup.note'), {
      target: { value: 'Call after salary date.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'dueReceivables.followup.submit' }));
    expect(mutation('/follow-up')).toHaveBeenCalledWith({
      nextFollowupAtUtc: '2099-07-22T04:00:00.000Z',
      note: 'Call after salary date.',
      expectedUpdatedAtUtc: '2026-07-14T06:00:00.000Z',
    });
  });

  it('converts promise input to integer minor units and submits dispute and escalation evidence', () => {
    render(<CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('dueReceivables.promise.date'), {
      target: { value: '2099-07-25' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.promise.amount'), {
      target: { value: '50.25' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.promise.note'), {
      target: { value: 'Patient committed to partial payment.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'dueReceivables.promise.submit' }));
    expect(mutation('/promise')).toHaveBeenCalledWith({
      promiseDate: '2099-07-25',
      promiseAmountMinor: 5025,
      currencyCode: 'BDT',
      note: 'Patient committed to partial payment.',
      expectedUpdatedAtUtc: '2026-07-14T06:00:00.000Z',
    });

    fireEvent.change(screen.getByLabelText('dueReceivables.dispute.reason'), {
      target: { value: 'Service amount questioned' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.dispute.note'), {
      target: { value: 'Invoice review requested.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'dueReceivables.dispute.submit' }));
    expect(mutation('/dispute')).toHaveBeenCalledWith({
      reason: 'Service amount questioned',
      note: 'Invoice review requested.',
      expectedUpdatedAtUtc: '2026-07-14T06:00:00.000Z',
    });

    fireEvent.change(screen.getByLabelText('dueReceivables.escalate.reason'), {
      target: { value: 'Supervisor review required' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.escalate.note'), {
      target: { value: 'Repeated non-response.' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.escalate.assignedTo'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'dueReceivables.escalate.submit' }));
    expect(mutation('/escalate')).toHaveBeenCalledWith({
      reason: 'Supervisor review required',
      note: 'Repeated non-response.',
      assignedTo: 8,
      expectedUpdatedAtUtc: '2026-07-14T06:00:00.000Z',
    });
  });

  it('disables workflow controls while a mutation is pending and recovers from stale conflicts', () => {
    mutationState = {
      isPending: true,
      isError: true,
      error: Object.assign(new Error('Conflict'), { status: 409 }),
    };
    render(<CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'dueReceivables.contact.submit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'dueReceivables.followup.submit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'dueReceivables.promise.submit' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('dueReceivables.conflict');
    fireEvent.click(screen.getByRole('button', { name: 'dueReceivables.actions.refreshCase' }));
    expect(refetchDetailMock).toHaveBeenCalled();
    expect(refetchEventsMock).toHaveBeenCalled();
  });

  it('submits a capability-gated write-off request with live due, reason, evidence, and acknowledgement', () => {
    render(<CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /write off now/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request write-off' }));
    expect(screen.getByLabelText('Write-off amount')).toHaveValue('80.00');
    expect(screen.getByText('BDT')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Write-off reason'), {
      target: { value: 'uncollectible' },
    });
    fireEvent.change(screen.getByLabelText('Write-off explanation'), {
      target: { value: 'Repeated documented follow-ups did not produce a recoverable payment.' },
    });
    fireEvent.change(screen.getByLabelText('Evidence URLs'), {
      target: { value: 'https://evidence.example/one\nhttps://evidence.example/two' },
    });
    fireEvent.click(screen.getByLabelText('Recovery is not reasonably expected for this amount.'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit write-off request' }));

    expect(mutation('/write-off-request')).toHaveBeenCalledWith({
      amountMinor: 8000,
      currencyCode: 'BDT',
      reasonCode: 'uncollectible',
      note: 'Repeated documented follow-ups did not produce a recoverable payment.',
      evidenceUrls: ['https://evidence.example/one', 'https://evidence.example/two'],
    });
  });

  it('retains entered write-off values and explains duplicate conflicts', () => {
    writeOffMutationState = {
      isError: true,
      error: Object.assign(new Error('Duplicate'), { status: 409 }),
    };
    render(<CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Request write-off' }));
    fireEvent.change(screen.getByLabelText('Write-off amount'), { target: { value: '30.00' } });
    fireEvent.change(screen.getByLabelText('Write-off reason'), { target: { value: 'financial_hardship' } });
    fireEvent.change(screen.getByLabelText('Write-off explanation'), {
      target: { value: 'Documented recovery attempts remain unsuccessful after hardship review.' },
    });
    fireEvent.change(screen.getByLabelText('Evidence URLs'), {
      target: { value: 'https://evidence.example/retained' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/already pending/i);
    expect(screen.getByLabelText('Write-off amount')).toHaveValue('30.00');
    expect(screen.getByLabelText('Write-off reason')).toHaveValue('financial_hardship');
    expect(screen.getByLabelText('Write-off explanation')).toHaveValue('Documented recovery attempts remain unsuccessful after hardship review.');
    expect(screen.getByLabelText('Evidence URLs')).toHaveValue('https://evidence.example/retained');
  });

  it('shows a loading submit state without exposing direct execution', () => {
    writeOffMutationState = { isPending: true };
    render(<CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Request write-off' }));
    expect(screen.getByRole('button', { name: 'Submitting write-off request…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /write off now/i })).not.toBeInTheDocument();
  });

  it('does not expose a request control when the server capability is forbidden or already pending', () => {
    writeOffRequestCapability = 'forbidden';
    const forbidden = render(<CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Request write-off' })).not.toBeInTheDocument();
    forbidden.unmount();

    writeOffRequestCapability = 'pending';
    render(<CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Request write-off' })).not.toBeInTheDocument();
    expect(screen.getByText('Write-off request pending approval')).toBeInTheDocument();
  });

  it('does not invent a payment link when canonical authority requires its command surface', () => {
    paymentCapability = 'canonical_command_required';
    paymentHref = null;
    render(<CollectionDetailDrawer open sourceKey="legacy-bill:101" onClose={vi.fn()} />);

    expect(screen.queryByRole('link', { name: 'dueReceivables.payment.collect' })).not.toBeInTheDocument();
    expect(screen.getByText('dueReceivables.payment.canonicalRequired')).toBeInTheDocument();
  });
});
