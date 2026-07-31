import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewModerationDrawer, { type MarketplaceReview } from './ReviewModerationDrawer';

interface MutationMock {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: ReturnType<typeof vi.fn>;
  options?: { onSuccess?: () => unknown };
}

const state = vi.hoisted(() => ({
  eventsQuery: {} as Record<string, unknown>,
  mutationByPath: new Map<string, MutationMock>(),
  invalidateQueries: vi.fn(),
  eventsRefetch: vi.fn(),
}));

function mutation(path: string, overrides: Partial<MutationMock> = {}): MutationMock {
  const value: MutationMock = {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
  };
  state.mutationByPath.set(path, value);
  return value;
}

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: (_key: unknown, url: string) => {
    if (!url.endsWith('/moderation-events')) throw new Error(`Unexpected query ${url}`);
    return state.eventsQuery;
  },
  useApiMutation: (_method: string, path: string, options?: { onSuccess?: () => unknown }) => {
    const value = state.mutationByPath.get(path) ?? mutation(path);
    value.options = options;
    return value;
  },
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key.replace('marketplace:', ''),
    i18n: { language: 'en' },
  }),
}));

const review: MarketplaceReview = {
  id: 42,
  reviewer_name: 'Patient A',
  target_type: 'doctor',
  doctor_name: 'Dr. Rahman',
  rating: 2,
  review_text: 'The consultation was delayed, but the clinical explanation was clear and respectful.',
  is_approved: 0,
  created_at: '2026-07-15 10:00:00',
  provider_reply: 'Thank you for the feedback.',
  provider_reply_at_utc: '2026-07-15T11:00:00.000Z',
  moderation_reason_code: null,
  moderation_note: null,
  moderated_at_utc: null,
};

const events = [
  {
    id: 1,
    reviewId: 42,
    eventType: 'reply_posted',
    actorId: 8,
    actorName: 'Patient Experience Lead',
    reasonCode: null,
    note: null,
    oldState: 0,
    newState: 0,
    metadata: { replyLength: 27 },
    createdAtUtc: '2026-07-15T11:00:00.000Z',
  },
];

function renderDrawer(overrides: Partial<React.ComponentProps<typeof ReviewModerationDrawer>> = {}) {
  const props = {
    open: true,
    review,
    onClose: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  };
  return { ...render(<ReviewModerationDrawer {...props} />), props };
}

describe('ReviewModerationDrawer', () => {
  beforeEach(() => {
    state.mutationByPath.clear();
    state.invalidateQueries.mockReset();
    state.eventsRefetch = vi.fn().mockResolvedValue(undefined);
    state.eventsQuery = {
      data: { data: events },
      isLoading: false,
      isError: false,
      error: null,
      refetch: state.eventsRefetch,
    };
  });

  it('shows the full review, target, reply, timeline, and restores focus when Escape closes', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open review';
    document.body.appendChild(trigger);
    trigger.focus();

    const { props } = renderDrawer();

    expect(screen.getByRole('dialog', { name: 'reviews.drawer.title' })).toBeInTheDocument();
    expect(screen.getByText(review.review_text!)).toBeInTheDocument();
    expect(screen.getByText('Dr. Rahman')).toBeInTheDocument();
    expect(screen.getByText('Thank you for the feedback.')).toBeInTheDocument();
    expect(screen.getByText(/Patient Experience Lead/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('hides the background drawer from assistive technology while an action dialog is open', () => {
    renderDrawer();
    const drawer = screen.getByRole('dialog', { name: 'reviews.drawer.title' });

    fireEvent.click(screen.getByRole('button', { name: 'reviews.approve' }));

    expect(screen.getByRole('dialog', { name: 'reviews.drawer.approveTitle' })).toBeInTheDocument();
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
  });

  it('submits approval with an optional trimmed note', () => {
    const approve = mutation('/api/v1/marketplace/reviews/42/approve');
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'reviews.approve' }));
    fireEvent.change(screen.getByLabelText('reviews.drawer.noteOptional'), { target: { value: '  Verified visit.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'reviews.drawer.confirmApprove' }));

    expect(approve.mutate).toHaveBeenCalledWith({ note: 'Verified visit.' });
  });

  it('requires a structured rejection reason and submits the optional note', () => {
    const reject = mutation('/api/v1/marketplace/reviews/42/reject');
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'reviews.reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'reviews.drawer.confirmReject' }));
    expect(screen.getByRole('alert')).toHaveTextContent('reviews.drawer.reasonRequired');
    expect(reject.mutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('reviews.drawer.reason'), { target: { value: 'personal_information' } });
    fireEvent.change(screen.getByLabelText('reviews.drawer.noteOptional'), { target: { value: 'Contains a phone number.' } });
    fireEvent.click(screen.getByRole('button', { name: 'reviews.drawer.confirmReject' }));

    expect(reject.mutate).toHaveBeenCalledWith({
      reasonCode: 'personal_information',
      note: 'Contains a phone number.',
    });
  });

  it('posts a trimmed provider reply', () => {
    const reply = mutation('/api/v1/marketplace/reviews/42/reply');
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'reviews.reply' }));
    fireEvent.change(screen.getByLabelText('reviews.drawer.replyText'), { target: { value: '  We reviewed your concern.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'reviews.drawer.postReply' }));

    expect(reply.mutate).toHaveBeenCalledWith({ reply_text: 'We reviewed your concern.' });
  });

  it('disables all actions while any mutation is pending', () => {
    mutation('/api/v1/marketplace/reviews/42/approve', { isPending: true });
    renderDrawer();

    expect(screen.getByRole('button', { name: 'reviews.approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'reviews.reject' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'reviews.reply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'reviews.drawer.close' })).toBeDisabled();
  });

  it('shows stale conflict recovery and refreshes the timeline', async () => {
    const approve = mutation('/api/v1/marketplace/reviews/42/approve', {
      isError: true,
      error: { status: 409, message: 'stale' },
    });
    renderDrawer();

    expect(screen.getByRole('alert')).toHaveTextContent('reviews.drawer.conflict');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'reviews.drawer.refresh' }));
    });
    expect(approve.reset).toHaveBeenCalledTimes(1);
    expect(state.eventsRefetch).toHaveBeenCalledTimes(1);
  });

  it('invalidates review lists and refreshes history after a successful action', async () => {
    const onChanged = vi.fn();
    const approve = mutation('/api/v1/marketplace/reviews/42/approve');
    renderDrawer({ onChanged });

    await act(async () => {
      await approve.options?.onSuccess?.();
    });

    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['marketplace', 'reviews'] });
    expect(state.eventsRefetch).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('renders timeline loading and avoids browser prompt APIs', () => {
    state.eventsQuery = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: state.eventsRefetch,
    };
    renderDrawer();
    expect(screen.getByRole('status')).toHaveTextContent('reviews.drawer.timelineLoading');

    const source = readFileSync('src/components/marketplace/ReviewModerationDrawer.tsx', 'utf8');
    expect(source).not.toContain('prompt(');
    expect(source).not.toContain('confirm(');
  });
});
