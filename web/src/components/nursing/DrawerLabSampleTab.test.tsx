import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerLabSampleTab from './DrawerLabSampleTab';
import type { BedGridItem } from './WardBedGrid';

const mockMutate = vi.fn();
const mockInvalidateQueries = vi.fn();
let mutationCallbacks: Record<string, unknown> = {};
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
  useApiMutation: (_method: string, _pathOrFn: unknown, options?: Record<string, unknown>) => {
    mutationCallbacks = options ?? {};
    return {
      mutate: mockMutate,
      isPending: false,
    };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
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

function makeLabOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    test_name: 'Complete Blood Count',
    status: 'pending',
    ordered_date: '2026-05-26T08:00:00Z',
    priority: 'routine',
    notes: 'Fasting required',
    ...overrides,
  };
}

describe('DrawerLabSampleTab', () => {
  beforeEach(() => {
    queryData = undefined;
    mockMutate.mockClear();
  });

  it('renders the lab-tab container', () => {
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByTestId('lab-tab')).toBeInTheDocument();
  });

  it('renders empty state when no pending lab orders', () => {
    queryData = { Results: [] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByTestId('lab-empty')).toBeInTheDocument();
    expect(screen.getByText('No pending lab orders')).toBeInTheDocument();
  });

  it('renders empty state when data is undefined', () => {
    queryData = undefined;
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByTestId('lab-empty')).toBeInTheDocument();
  });

  it('renders a list of lab orders', () => {
    queryData = {
      Results: [
        makeLabOrder({ id: 1, test_name: 'Complete Blood Count' }),
        makeLabOrder({ id: 2, test_name: 'Blood Sugar' }),
      ],
    };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByTestId('lab-list')).toBeInTheDocument();
    expect(screen.getByText('Complete Blood Count')).toBeInTheDocument();
    expect(screen.getByText('Blood Sugar')).toBeInTheDocument();
  });

  it('renders ordered date', () => {
    queryData = { Results: [makeLabOrder()] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByText(/Ordered/)).toBeInTheDocument();
  });

  it('renders notes when present', () => {
    queryData = { Results: [makeLabOrder({ notes: 'Fasting required' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByText('Fasting required')).toBeInTheDocument();
  });

  it('renders stat priority badge with red color', () => {
    queryData = { Results: [makeLabOrder({ priority: 'stat' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    const badge = screen.getByText('STAT');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-700');
  });

  it('renders urgent priority badge with amber color', () => {
    queryData = { Results: [makeLabOrder({ priority: 'urgent' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    const badge = screen.getByText('URGENT');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.className).toContain('text-amber-700');
  });

  it('renders routine priority badge with blue color', () => {
    queryData = { Results: [makeLabOrder({ priority: 'routine' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    const badge = screen.getByText('ROUTINE');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-blue-100');
    expect(badge.className).toContain('text-blue-700');
  });

  it('renders pending status badge with yellow color', () => {
    queryData = { Results: [makeLabOrder({ status: 'pending' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    const badge = screen.getByTestId('lab-status-1');
    expect(badge).toHaveTextContent('pending');
    expect(badge.className).toContain('bg-yellow-100');
    expect(badge.className).toContain('text-yellow-700');
  });

  it('renders collected status badge with blue color', () => {
    queryData = { Results: [makeLabOrder({ status: 'collected' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    const badge = screen.getByTestId('lab-status-1');
    expect(badge).toHaveTextContent('collected');
    expect(badge.className).toContain('bg-blue-100');
    expect(badge.className).toContain('text-blue-700');
  });

  it('renders sent status badge with emerald color', () => {
    queryData = { Results: [makeLabOrder({ status: 'sent' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    const badge = screen.getByTestId('lab-status-1');
    expect(badge).toHaveTextContent('sent');
    expect(badge.className).toContain('bg-emerald-100');
    expect(badge.className).toContain('text-emerald-700');
  });

  it('renders rejected status badge with red color', () => {
    queryData = { Results: [makeLabOrder({ status: 'rejected' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    const badge = screen.getByTestId('lab-status-1');
    expect(badge).toHaveTextContent('rejected');
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-600');
  });

  it('renders completed status badge with gray color', () => {
    queryData = { Results: [makeLabOrder({ status: 'completed' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    const badge = screen.getByTestId('lab-status-1');
    expect(badge).toHaveTextContent('completed');
    expect(badge.className).toContain('bg-gray-100');
    expect(badge.className).toContain('text-gray-600');
  });

  it('renders individual lab order items with correct test ids', () => {
    queryData = { Results: [makeLabOrder({ id: 42, test_name: 'Lipid Panel' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByTestId('lab-order-42')).toBeInTheDocument();
  });

  it('renders Mark Collected button for pending orders', () => {
    queryData = { Results: [makeLabOrder({ id: 1, status: 'pending' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByTestId('lab-collect-1')).toBeInTheDocument();
    expect(screen.getByText('Mark Collected')).toBeInTheDocument();
  });

  it('renders Send to Lab button for collected orders', () => {
    queryData = { Results: [makeLabOrder({ id: 1, status: 'collected' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByTestId('lab-send-1')).toBeInTheDocument();
    expect(screen.getByText('Send to Lab')).toBeInTheDocument();
  });

  it('does not render action buttons for sent orders', () => {
    queryData = { Results: [makeLabOrder({ id: 1, status: 'sent' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.queryByTestId('lab-collect-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lab-send-1')).not.toBeInTheDocument();
  });

  it('does not render action buttons for rejected orders', () => {
    queryData = { Results: [makeLabOrder({ id: 1, status: 'rejected' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.queryByTestId('lab-collect-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lab-send-1')).not.toBeInTheDocument();
  });

  it('does not render action buttons for completed orders', () => {
    queryData = { Results: [makeLabOrder({ id: 1, status: 'completed' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.queryByTestId('lab-collect-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lab-send-1')).not.toBeInTheDocument();
  });

  it('calls mutation with collected status when Mark Collected is clicked', () => {
    queryData = { Results: [makeLabOrder({ id: 1, status: 'pending' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('lab-collect-1'));
    expect(mockMutate).toHaveBeenCalledWith({ id: 1, status: 'collected' });
  });

  it('calls mutation with sent status when Send to Lab is clicked', () => {
    queryData = { Results: [makeLabOrder({ id: 1, status: 'collected' })] };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('lab-send-1'));
    expect(mockMutate).toHaveBeenCalledWith({ id: 1, status: 'sent' });
  });

  it('shows status badge for each lab order', () => {
    queryData = {
      Results: [
        makeLabOrder({ id: 1, status: 'pending' }),
        makeLabOrder({ id: 2, status: 'collected' }),
      ],
    };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByTestId('lab-status-1')).toHaveTextContent('pending');
    expect(screen.getByTestId('lab-status-2')).toHaveTextContent('collected');
  });

  it('renders multiple orders with different priorities', () => {
    queryData = {
      Results: [
        makeLabOrder({ id: 1, priority: 'stat', test_name: 'Troponin' }),
        makeLabOrder({ id: 2, priority: 'routine', test_name: 'CBC' }),
      ],
    };
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByText('STAT')).toBeInTheDocument();
    expect(screen.getByText('ROUTINE')).toBeInTheDocument();
  });

  it('renders the title', () => {
    render(<DrawerLabSampleTab bed={makeBed()} />);
    expect(screen.getByText('Lab / Sample Collection')).toBeInTheDocument();
  });
});
