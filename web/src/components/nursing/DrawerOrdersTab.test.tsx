import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerOrdersTab from './DrawerOrdersTab';
import type { BedGridItem } from './WardBedGrid';

let queryData: Record<string, unknown> | undefined = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: queryData, isLoading: false, isError: false }),
}));

function makeBed(overrides: Partial<BedGridItem> = {}): BedGridItem {
  return {
    bed_id: 1,
    ward_name: 'ICU',
    bed_number: 'B1',
    bed_type: 'standard',
    bed_status: 'occupied',
    patient_id: 100,
    admission_id: 50,
    patient_name: 'Test Patient',
    statusColor: 'stable',
    ...overrides,
  };
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    medication_name: 'Amoxicillin',
    generic_name: 'Amoxicillin',
    dose: '500mg',
    route: 'Oral',
    frequency: 'TID',
    duration: '7 days',
    instructions: 'Take with food',
    priority: 'routine',
    status: 'active',
    start_datetime: '2026-05-26T08:00:00Z',
    ...overrides,
  };
}

describe('DrawerOrdersTab', () => {
  beforeEach(() => {
    queryData = undefined;
  });

  it('renders the orders-tab container', () => {
    render(<DrawerOrdersTab bed={makeBed()} />);
    expect(screen.getByTestId('orders-tab')).toBeInTheDocument();
  });

  it('renders empty state when no active orders', () => {
    queryData = { Results: [] };
    render(<DrawerOrdersTab bed={makeBed()} />);
    expect(screen.getByTestId('orders-empty')).toBeInTheDocument();
    expect(screen.getByText('No active orders')).toBeInTheDocument();
  });

  it('renders empty state when data is undefined', () => {
    queryData = undefined;
    render(<DrawerOrdersTab bed={makeBed()} />);
    expect(screen.getByTestId('orders-empty')).toBeInTheDocument();
  });

  it('renders a list of medication orders', () => {
    queryData = {
      Results: [
        makeOrder({ id: 1, medication_name: 'Amoxicillin' }),
        makeOrder({ id: 2, medication_name: 'Metformin' }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    expect(screen.getByTestId('orders-list')).toBeInTheDocument();
    expect(screen.getByText('Amoxicillin')).toBeInTheDocument();
    expect(screen.getByText('Metformin')).toBeInTheDocument();
  });

  it('renders medication details (dose, route, frequency)', () => {
    queryData = {
      Results: [
        makeOrder({ id: 1, dose: '500mg', route: 'Oral', frequency: 'TID', duration: undefined }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    expect(screen.getByText('500mg · Oral · TID')).toBeInTheDocument();
  });

  it('renders duration when present', () => {
    queryData = {
      Results: [
        makeOrder({ id: 1, dose: '500mg', route: 'Oral', frequency: 'TID', duration: '7 days' }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    expect(screen.getByText('500mg · Oral · TID · 7 days')).toBeInTheDocument();
  });

  it('renders generic name in parentheses', () => {
    queryData = {
      Results: [
        makeOrder({ id: 1, medication_name: 'BrandX', generic_name: 'Amoxicillin' }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    expect(screen.getByText('(Amoxicillin)')).toBeInTheDocument();
  });

  it('renders instructions when present', () => {
    queryData = {
      Results: [
        makeOrder({ id: 1, instructions: 'Take with food' }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    expect(screen.getByText('Take with food')).toBeInTheDocument();
  });

  it('renders stat priority badge with red color', () => {
    queryData = {
      Results: [
        makeOrder({ id: 1, priority: 'stat' }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    const badge = screen.getByText('STAT');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-700');
  });

  it('renders urgent priority badge with amber color', () => {
    queryData = {
      Results: [
        makeOrder({ id: 1, priority: 'urgent' }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    const badge = screen.getByText('URGENT');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.className).toContain('text-amber-700');
  });

  it('renders routine priority badge with blue color', () => {
    queryData = {
      Results: [
        makeOrder({ id: 1, priority: 'routine' }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    const badge = screen.getByText('ROUTINE');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-blue-100');
    expect(badge.className).toContain('text-blue-700');
  });

  it('renders prn priority badge with purple color', () => {
    queryData = {
      Results: [
        makeOrder({ id: 1, priority: 'prn' }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    const badge = screen.getByText('PRN');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-purple-100');
    expect(badge.className).toContain('text-purple-700');
  });

  it('renders individual order items with correct test ids', () => {
    queryData = {
      Results: [
        makeOrder({ id: 42, medication_name: 'Aspirin' }),
      ],
    };
    render(<DrawerOrdersTab bed={makeBed()} />);
    expect(screen.getByTestId('order-42')).toBeInTheDocument();
  });
});
