import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerDischargeTab from './DrawerDischargeTab';
import type { BedGridItem } from './WardBedGrid';

const mockFetch = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: (...args: unknown[]) => mockFetch(...args),
  ApiClientError: class extends Error {
    constructor(message: string) { super(message); }
  },
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

function makeChecklistItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    admission_id: 50,
    item_name: 'Doctor clearance',
    category: 'medical',
    is_completed: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('DrawerDischargeTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ Results: [] });
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DrawerDischargeTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders the discharge tab container', () => {
    render(<DrawerDischargeTab bed={makeBed()} />);
    expect(screen.getByTestId('discharge-tab')).toBeInTheDocument();
  });

  it('renders empty state when no items', async () => {
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByTestId('discharge-empty')).toBeInTheDocument();
    });
  });

  it('renders add defaults button when no items', async () => {
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByTestId('add-defaults-btn')).toBeInTheDocument();
    });
  });

  it('renders checklist items when they exist', async () => {
    mockFetch.mockResolvedValue({
      Results: [
        makeChecklistItem(),
        makeChecklistItem({ id: 2, item_name: 'Medications dispensed', category: 'pharmacy', is_completed: true, completed_at: new Date().toISOString() }),
      ],
    });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      const items = screen.getAllByTestId('discharge-item');
      expect(items).toHaveLength(2);
    });
  });

  it('renders progress bar when items exist', async () => {
    mockFetch.mockResolvedValue({
      Results: [
        makeChecklistItem({ id: 1, is_completed: true }),
        makeChecklistItem({ id: 2, item_name: 'Item 2', is_completed: false }),
      ],
    });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByTestId('discharge-progress')).toBeInTheDocument();
      expect(screen.getByText('1/2 completed')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
    });
  });

  it('shows ready for discharge when 100% complete', async () => {
    mockFetch.mockResolvedValue({
      Results: [makeChecklistItem({ is_completed: true })],
    });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByTestId('discharge-complete-badge')).toBeInTheDocument();
    });
  });

  it('toggles form visibility when add button clicked', () => {
    render(<DrawerDischargeTab bed={makeBed()} />);
    expect(screen.queryByTestId('discharge-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-discharge-item-btn'));
    expect(screen.getByTestId('discharge-form')).toBeInTheDocument();
  });

  it('renders form fields', () => {
    render(<DrawerDischargeTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-discharge-item-btn'));
    expect(screen.getByTestId('discharge-item-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('discharge-category-select')).toBeInTheDocument();
  });

  it('renders toggle buttons for checklist items', async () => {
    mockFetch.mockResolvedValue({
      Results: [makeChecklistItem()],
    });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByTestId('toggle-discharge-item')).toBeInTheDocument();
    });
  });

  it('renders refresh button', () => {
    render(<DrawerDischargeTab bed={makeBed()} />);
    expect(screen.getByTestId('discharge-refresh')).toBeInTheDocument();
  });

  it('calls PUT when toggle is clicked', async () => {
    mockFetch.mockResolvedValueOnce({
      Results: [makeChecklistItem({ is_completed: false })],
    });
    mockFetch.mockResolvedValueOnce({});
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByTestId('toggle-discharge-item')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('toggle-discharge-item'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/discharge-planning/checklist/1',
        expect.objectContaining({ method: 'PUT', body: { is_completed: true } }),
      );
    });
  });

  it('calls POST when add item is submitted', async () => {
    render(<DrawerDischargeTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-discharge-item-btn'));
    fireEvent.change(screen.getByTestId('discharge-item-name-input'), { target: { value: 'Insurance form signed' } });
    fireEvent.change(screen.getByTestId('discharge-category-select'), { target: { value: 'billing' } });
    mockFetch.mockResolvedValueOnce({});
    fireEvent.click(screen.getByTestId('save-discharge-item-btn'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/discharge-planning/checklist',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            admission_id: 50,
            item_name: 'Insurance form signed',
            category: 'billing',
          }),
        }),
      );
    });
  });

  it('calls POST for each default item when Add Defaults clicked', async () => {
    mockFetch.mockResolvedValue({ Results: [] });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByTestId('add-defaults-btn')).toBeInTheDocument();
    });
    mockFetch.mockResolvedValue({});
    fireEvent.click(screen.getByTestId('add-defaults-btn'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('renders category badge for items with category', async () => {
    mockFetch.mockResolvedValue({
      Results: [makeChecklistItem({ category: 'medical' })],
    });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByText('medical')).toBeInTheDocument();
    });
  });

  it('renders item name with line-through when completed', async () => {
    mockFetch.mockResolvedValue({
      Results: [makeChecklistItem({ is_completed: true })],
    });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      const itemName = screen.getByText('Doctor clearance');
      expect(itemName.className).toContain('line-through');
    });
  });

  it('renders delete button for items', async () => {
    mockFetch.mockResolvedValue({
      Results: [makeChecklistItem()],
    });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByTestId('delete-discharge-item-btn')).toBeInTheDocument();
    });
  });

  it('shows 0% progress when no items are completed', async () => {
    mockFetch.mockResolvedValue({
      Results: [
        makeChecklistItem({ id: 1, is_completed: false }),
        makeChecklistItem({ id: 2, item_name: 'Item 2', is_completed: false }),
      ],
    });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByText('0%')).toBeInTheDocument();
      expect(screen.getByText('0/2 completed')).toBeInTheDocument();
    });
  });

  it('shows 100% progress when all items completed', async () => {
    mockFetch.mockResolvedValue({
      Results: [
        makeChecklistItem({ id: 1, is_completed: true }),
        makeChecklistItem({ id: 2, item_name: 'Item 2', is_completed: true }),
      ],
    });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.getByText('100%')).toBeInTheDocument();
      expect(screen.getByText('2/2 completed')).toBeInTheDocument();
    });
  });

  it('does not show progress bar when no items', async () => {
    mockFetch.mockResolvedValue({ Results: [] });
    render(<DrawerDischargeTab bed={makeBed()} />);
    await waitFor(() => {
      expect(screen.queryByTestId('discharge-progress')).not.toBeInTheDocument();
    });
  });
});
