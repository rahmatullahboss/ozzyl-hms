import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewModerationPage from './ReviewModerationPage';

const state = vi.hoisted(() => ({
  queryResult: {} as Record<string, unknown>,
  queryCalls: [] as Array<{ key: unknown; url: string }>,
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: (key: unknown, url: string) => {
    state.queryCalls.push({ key, url });
    return state.queryResult;
  },
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: unknown }) => createElement('div', null, children),
}));

vi.mock('../../components/marketplace/ReviewModerationDrawer', () => ({
  default: ({
    open,
    review,
    onChanged,
  }: {
    open: boolean;
    review: { review_text?: string } | null;
    onChanged?: () => void;
  }) => open
    ? createElement(
      'div',
      { role: 'dialog', 'aria-label': review?.review_text ?? 'review' },
      review?.review_text,
      createElement('button', { type: 'button', onClick: onChanged }, 'changed'),
    )
    : null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key.replace('marketplace:', ''),
    i18n: { language: 'en' },
  }),
}));

const review = {
  id: 42,
  reviewer_name: 'Patient A',
  target_type: 'hospital',
  doctor_name: null,
  rating: 4,
  review_text: 'A detailed review that must remain available in full.',
  is_approved: 0,
  created_at: '2026-07-15 10:00:00',
  provider_reply: null,
};

function readyResult(items = [review]) {
  return {
    data: { data: items, pagination: { page: 1, limit: 20, total: items.length } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('ReviewModerationPage', () => {
  beforeEach(() => {
    state.queryCalls.length = 0;
    state.queryResult = readyResult();
  });

  it('loads the pending workspace, changes status filters, and opens a full review drawer', () => {
    render(createElement(ReviewModerationPage));

    expect(screen.getByRole('heading', { name: 'reviews.title' })).toBeInTheDocument();
    expect(state.queryCalls.at(-1)?.url).toBe('/api/v1/marketplace/reviews/all?status=pending');

    fireEvent.click(screen.getByRole('button', { name: 'reviews.status.approved' }));
    expect(state.queryCalls.at(-1)?.url).toBe('/api/v1/marketplace/reviews/all?status=approved');

    fireEvent.click(screen.getByRole('button', { name: /A detailed review/ }));
    expect(screen.getByRole('dialog', { name: review.review_text })).toBeInTheDocument();
  });

  it('closes the stale drawer and refreshes the list after a successful drawer action', () => {
    const result = readyResult();
    state.queryResult = result;
    render(createElement(ReviewModerationPage));

    fireEvent.click(screen.getByRole('button', { name: /A detailed review/ }));
    expect(screen.getByRole('dialog', { name: review.review_text })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'changed' }));

    expect(screen.queryByRole('dialog', { name: review.review_text })).not.toBeInTheDocument();
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders accessible loading, error with retry, and empty states', () => {
    state.queryResult = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    const view = render(createElement(ReviewModerationPage));
    expect(screen.getByRole('status')).toHaveTextContent('reviews.loading');

    const refetch = vi.fn();
    state.queryResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('network'),
      refetch,
    };
    view.rerender(createElement(ReviewModerationPage));
    expect(screen.getByRole('alert')).toHaveTextContent('reviews.error');
    fireEvent.click(screen.getByRole('button', { name: 'reviews.retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    state.queryResult = readyResult([]);
    view.rerender(createElement(ReviewModerationPage));
    expect(screen.getByText('reviews.noReviews')).toBeInTheDocument();
  });

  it('uses touch-sized labelled controls and never invokes browser prompt or confirm', () => {
    render(createElement(ReviewModerationPage));
    expect(screen.getByRole('button', { name: 'reviews.status.pending' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: /A detailed review/ })).toHaveClass('min-h-11');

    const source = readFileSync('src/pages/marketplace/ReviewModerationPage.tsx', 'utf8');
    expect(source).not.toContain('prompt(');
    expect(source).not.toContain('confirm(');
  });
});
