import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import AuditEntryCard from './AuditEntryCard';
import type { AuditEntry } from '../lib/auditGroups';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : (fallback as any)?.defaultValue ?? _key),
    i18n: { language: 'en' },
  }),
}));

const baseEntry: AuditEntry = {
  id: 1,
  user_id: 5,
  user_name: 'Nusrat Jahan',
  action: 'create',
  actionLabel: 'Created',
  entity: 'bills',
  entityLabel: 'Invoice/Bill',
  groupKey: 'cash',
  groupLabel: 'Cash & Transactions',
  entity_id: 5196,
  details: 'Amount: ৳5,000',
  created_at: '2026-06-04T17:23:11Z',
};

describe('AuditEntryCard', () => {
  it('renders the action badge, user, entity label, record id, and details', () => {
    render(React.createElement(AuditEntryCard, { entry: baseEntry }));
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Nusrat Jahan')).toBeInTheDocument();
    expect(screen.getByText(/Invoice\/Bill/)).toBeInTheDocument();
    expect(screen.getByText(/#5196/)).toBeInTheDocument();
    expect(screen.getByText(/Amount: ৳5,000/)).toBeInTheDocument();
  });

  it('falls back to a placeholder when user_name is missing', () => {
    render(React.createElement(AuditEntryCard, { entry: { ...baseEntry, user_name: undefined, user_id: 9 } }));
    expect(screen.getByText(/User #9/)).toBeInTheDocument();
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(React.createElement(AuditEntryCard, { entry: baseEntry, onClick }));
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not crash when entity_id is null', () => {
    render(React.createElement(AuditEntryCard, { entry: { ...baseEntry, entity_id: null } }));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a green ৳+X amount badge for cash-in entries', () => {
    render(React.createElement(AuditEntryCard, {
      entry: { ...baseEntry, amount: 5000, amountSign: 'in' },
    }));
    const badge = screen.getByTestId('audit-amount-badge');
    expect(badge.textContent).toContain('৳+5,000');
    expect(badge.className).toMatch(/emerald/);
  });

  it('renders a red ৳-X amount badge for cash-out entries', () => {
    render(React.createElement(AuditEntryCard, {
      entry: { ...baseEntry, amount: 3500, amountSign: 'out' },
    }));
    const badge = screen.getByTestId('audit-amount-badge');
    expect(badge.textContent).toContain('৳-3,500');
    expect(badge.className).toMatch(/red/);
  });

  it('does not render the amount badge when amount is missing', () => {
    render(React.createElement(AuditEntryCard, { entry: baseEntry }));
    expect(screen.queryByTestId('audit-amount-badge')).toBeNull();
  });

  it('does not render the amount badge for non-cash entries even with an amount', () => {
    render(React.createElement(AuditEntryCard, {
      entry: { ...baseEntry, groupKey: 'other', amount: 100, amountSign: 'in' },
    }));
    expect(screen.queryByTestId('audit-amount-badge')).toBeNull();
  });

  it('renders a "Paid" chip with full amount when bill is fully paid', () => {
    render(React.createElement(AuditEntryCard, {
      entry: {
        ...baseEntry,
        entity: 'bills',
        action: 'create',
        amount: undefined,
        paymentStatus: 'paid',
        paymentPaid: 8000,
        paymentDue: 0,
        paymentTotal: 8000,
      },
    }));
    const chip = screen.getByTestId('audit-payment-chip');
    expect(chip.textContent).toContain('Paid');
    expect(chip.getAttribute('data-payment-status')).toBe('paid');
    expect(screen.getByTestId('audit-payment-breakdown').textContent).toContain('8,000');
  });

  it('renders a "Partial" chip with paid + due + total amounts', () => {
    render(React.createElement(AuditEntryCard, {
      entry: {
        ...baseEntry,
        entity: 'bills',
        action: 'create',
        amount: undefined,
        paymentStatus: 'partially_paid',
        paymentPaid: 5000,
        paymentDue: 3000,
        paymentTotal: 8000,
      },
    }));
    const chip = screen.getByTestId('audit-payment-chip');
    expect(chip.textContent).toContain('Partial');
    expect(chip.getAttribute('data-payment-status')).toBe('partially_paid');
    const breakdown = screen.getByTestId('audit-payment-breakdown').textContent ?? '';
    expect(breakdown).toContain('5,000');
    expect(breakdown).toContain('3,000');
    expect(breakdown).toContain('8,000');
  });

  it('renders an "Unpaid" chip with due amount when bill is open', () => {
    render(React.createElement(AuditEntryCard, {
      entry: {
        ...baseEntry,
        entity: 'bills',
        action: 'create',
        amount: undefined,
        paymentStatus: 'open',
        paymentPaid: 0,
        paymentDue: 1200,
        paymentTotal: 1200,
      },
    }));
    const chip = screen.getByTestId('audit-payment-chip');
    expect(chip.textContent).toContain('Unpaid');
    expect(chip.getAttribute('data-payment-status')).toBe('open');
    expect(screen.getByTestId('audit-payment-breakdown').textContent).toContain('1,200');
  });

  it('does not render a payment chip for non-bill entities', () => {
    render(React.createElement(AuditEntryCard, {
      entry: {
        ...baseEntry,
        entity: 'patients',
        action: 'create',
        paymentStatus: 'paid',
        paymentPaid: 100,
        paymentDue: 0,
        paymentTotal: 100,
      },
    }));
    expect(screen.queryByTestId('audit-payment-chip')).toBeNull();
  });
});
