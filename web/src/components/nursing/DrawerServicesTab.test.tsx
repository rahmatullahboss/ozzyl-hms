import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerServicesTab from './DrawerServicesTab';
import type { BedGridItem } from './WardBedGrid';

let mutateFn: ReturnType<typeof vi.fn>;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiMutation: (_method: string, _url: string, opts?: Record<string, unknown>) => ({
    mutate: (vars: unknown) => {
      mutateFn(vars);
      opts?.onSuccess?.({}, vars, {});
    },
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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

describe('DrawerServicesTab', () => {
  beforeEach(() => {
    mutateFn = vi.fn();
  });

  it('renders services-tab container', () => {
    render(<DrawerServicesTab bed={makeBed()} />);
    expect(screen.getByTestId('services-tab')).toBeInTheDocument();
  });

  it('renders two quick-action buttons', () => {
    render(<DrawerServicesTab bed={makeBed()} />);
    expect(screen.getByTestId('add-service-btn')).toBeInTheDocument();
    expect(screen.getByTestId('order-pharmacy-btn')).toBeInTheDocument();
  });

  it('toggles service form on button click', () => {
    render(<DrawerServicesTab bed={makeBed()} />);
    expect(screen.queryByTestId('service-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-service-btn'));
    expect(screen.getByTestId('service-form')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-service-btn'));
    expect(screen.queryByTestId('service-form')).not.toBeInTheDocument();
  });

  it('toggles pharmacy form on button click', () => {
    render(<DrawerServicesTab bed={makeBed()} />);
    expect(screen.queryByTestId('pharmacy-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('order-pharmacy-btn'));
    expect(screen.getByTestId('pharmacy-form')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('order-pharmacy-btn'));
    expect(screen.queryByTestId('pharmacy-form')).not.toBeInTheDocument();
  });

  it('submits service charge with correct data', () => {
    render(<DrawerServicesTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-service-btn'));
    fireEvent.change(screen.getByTestId('service-name-input'), { target: { value: 'Cannulation' } });
    fireEvent.change(screen.getByTestId('service-amount-input'), { target: { value: '250' } });
    fireEvent.click(screen.getByTestId('submit-service-btn'));
    expect(mutateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 100,
        admission_id: 50,
        items: [expect.objectContaining({
          is_manual: true,
          item_category: 'nursing_service',
          item_name: 'Cannulation',
          quantity: 1,
          unit_price: 250,
        })],
      }),
    );
  });

  it('submits pharmacy order with correct data', () => {
    render(<DrawerServicesTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('order-pharmacy-btn'));
    fireEvent.change(screen.getByTestId('pharmacy-med-input'), { target: { value: 'Paracetamol' } });
    fireEvent.click(screen.getByTestId('submit-pharmacy-btn'));
    expect(mutateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 100,
        admission_id: 50,
        items: [{ medication_name: 'Paracetamol', quantity: 1 }],
        urgency: 'routine',
      }),
    );
  });

  it('renders service form with required fields', () => {
    render(<DrawerServicesTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-service-btn'));
    expect(screen.getByTestId('service-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('service-amount-input')).toBeInTheDocument();
    expect(screen.getByTestId('submit-service-btn')).toBeInTheDocument();
  });

  it('renders pharmacy form with required fields', () => {
    render(<DrawerServicesTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('order-pharmacy-btn'));
    expect(screen.getByTestId('pharmacy-med-input')).toBeInTheDocument();
    expect(screen.getByTestId('submit-pharmacy-btn')).toBeInTheDocument();
  });
});
