import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import AuditGroupCard from './AuditGroupCard';
import { AUDIT_GROUPS } from '../lib/auditGroups';
import type { AuditEntry } from '../lib/auditGroups';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string'
        ? fallback
        : fallback && typeof fallback === 'object'
          ? (fallback.defaultValue ?? _k)
          : _k,
  }),
}));

const entries: AuditEntry[] = [
  {
    id: 1, user_id: 1, user_name: 'Nusrat', action: 'create', actionLabel: 'Created',
    entity: 'bills', entityLabel: 'Invoice/Bill', groupKey: 'cash',
    groupLabel: 'Cash & Transactions', entity_id: 5196,
    details: 'Amount: ৳5,000', created_at: '2026-06-04T17:23:11Z',
  },
  {
    id: 2, user_id: 1, user_name: 'Nusrat', action: 'payment', actionLabel: 'PAYMENT',
    entity: 'bills', entityLabel: 'Invoice/Bill', groupKey: 'cash',
    groupLabel: 'Cash & Transactions', entity_id: 5195,
    details: 'Amount: ৳2,500', created_at: '2026-06-04T15:36:23Z',
  },
];

function renderInRouter(props: React.ComponentProps<typeof AuditGroupCard>) {
  return render(
    React.createElement(MemoryRouter, null,
      React.createElement(AuditGroupCard, props),
    ),
  );
}

describe('AuditGroupCard', () => {
  it('renders the group label and count badge', () => {
    renderInRouter({ group: AUDIT_GROUPS[0], entries, maxItems: 5 });
    expect(screen.getByText('Cash & Transactions')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('caps visible entries at maxItems', () => {
    const many: AuditEntry[] = Array.from({ length: 10 }, (_, i) => ({
      ...entries[0], id: i + 100, entity_id: 5000 + i,
    }));
    renderInRouter({ group: AUDIT_GROUPS[0], entries: many, maxItems: 3 });
    expect(screen.getAllByText(/Nusrat/)).toHaveLength(3);
  });

  it('renders a footer link when href is provided', () => {
    renderInRouter({ group: AUDIT_GROUPS[0], entries, maxItems: 5, href: '/audit?group=cash' });
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/audit?group=cash');
  });

  it('shows the selected visual state when selected is true', () => {
    const { container } = renderInRouter({ group: AUDIT_GROUPS[0], entries, maxItems: 5, selected: true });
    const card = container.querySelector('[data-group-card]');
    expect(card?.className).toMatch(/emerald/);
  });

  it('calls onToggle when the card header is clicked', () => {
    const onToggle = vi.fn();
    const { container } = renderInRouter({ group: AUDIT_GROUPS[0], entries, maxItems: 5, onToggle, selected: false });
    const card = container.querySelector('[data-group-card]');
    fireEvent.click(card!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows an empty-state message when there are no entries', () => {
    renderInRouter({ group: AUDIT_GROUPS[0], entries: [], maxItems: 5 });
    expect(screen.getByText(/No cash activity/i)).toBeInTheDocument();
  });
});
