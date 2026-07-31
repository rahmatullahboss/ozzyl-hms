import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import PanelResultEntry from './PanelResultEntry';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiMutation: vi.fn(),
}));

import { useApiMutation } from '../../hooks/useApiQuery';
const mockUseApiMutation = useApiMutation as ReturnType<typeof vi.fn>;

const mockComponents = [
  {
    lab_test_id: 10,
    component_id: 101,
    test_name: 'Hemoglobin',
    unit: 'g/dL',
    reference_range: '13–17',
    value_type: 'numeric',
    display_sequence: 1,
    normal_range: '13–17',
    critical_low: 13,
    critical_high: 17,
  },
  {
    lab_test_id: 10,
    component_id: 102,
    test_name: 'WBC',
    unit: '/cmm',
    reference_range: '4000–11000',
    value_type: 'numeric',
    display_sequence: 2,
    normal_range: '4000–11000',
    critical_low: 4000,
    critical_high: 11000,
  },
  {
    lab_test_id: 10,
    component_id: 103,
    test_name: 'Platelet',
    unit: '/cmm',
    reference_range: '150000–400000',
    value_type: 'numeric',
    display_sequence: 3,
    normal_range: '150000–400000',
    critical_low: 150000,
    critical_high: 400000,
  },
];

const defaultProps = {
  orderId: 100,
  labTestId: 10,
  patientId: 10,
  testName: 'Complete Blood Count',
  components: mockComponents,
  onComplete: vi.fn(),
};

describe('PanelResultEntry', () => {
  let mockMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate = vi.fn();
    mockUseApiMutation.mockReturnValue({ mutate: mockMutate, isPending: false });
  });

  it('renders a table with parameter rows', () => {
    render(<PanelResultEntry {...defaultProps} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Hemoglobin')).toBeInTheDocument();
    expect(screen.getByText('WBC')).toBeInTheDocument();
    expect(screen.getByText('Platelet')).toBeInTheDocument();
  });

  it('each row has a result input, unit, and reference range', () => {
    render(<PanelResultEntry {...defaultProps} />);

    expect(screen.getByText('g/dL')).toBeInTheDocument();
    expect(screen.getAllByText('/cmm').length).toBe(2);
    expect(screen.getByText('13–17')).toBeInTheDocument();
    expect(screen.getByText('4000–11000')).toBeInTheDocument();
    expect(screen.getByText('150000–400000')).toBeInTheDocument();

    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs.length).toBe(3);
  });

  it('renders "Save All" and "Save Draft" buttons', () => {
    render(<PanelResultEntry {...defaultProps} />);

    expect(screen.getByText('Save All')).toBeInTheDocument();
    expect(screen.getByText('Save Draft')).toBeInTheDocument();
  });

  it('calls bulk result API when "Save All" is clicked with results filled', async () => {
    render(<PanelResultEntry {...defaultProps} />);

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '14.5' } });
    fireEvent.change(inputs[1], { target: { value: '8000' } });
    fireEvent.change(inputs[2], { target: { value: '200000' } });

    fireEvent.click(screen.getByText('Save All'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          results: expect.arrayContaining([
            expect.objectContaining({
              lab_test_id: 10,
              component_id: 101,
              result_value: '14.5',
              result_status: 'final',
            }),
          ]),
        }),
      );
    });
  });

  it('shows flag indicator "Low" when numeric value is below reference range', () => {
    render(<PanelResultEntry {...defaultProps} />);

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '9.2' } });

    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('shows flag indicator "High" when numeric value is above reference range', () => {
    render(<PanelResultEntry {...defaultProps} />);

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1], { target: { value: '12000' } });

    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows flag indicator "Normal" when numeric value is within reference range', () => {
    render(<PanelResultEntry {...defaultProps} />);

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '15' } });

    expect(screen.getByText('Normal')).toBeInTheDocument();
  });

  it('handles empty component list gracefully', () => {
    render(<PanelResultEntry {...defaultProps} components={[]} />);

    expect(screen.getByText(/no components/i)).toBeInTheDocument();
  });

  it('shows error toast when saving without filling any results', () => {
    render(<PanelResultEntry {...defaultProps} />);

    fireEvent.click(screen.getByText('Save All'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('calls "Save Draft" with is_draft status', async () => {
    render(<PanelResultEntry {...defaultProps} />);

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '14.5' } });

    fireEvent.click(screen.getByText('Save Draft'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          results: expect.arrayContaining([
            expect.objectContaining({
              result_status: 'preliminary',
            }),
          ]),
        }),
      );
    });
  });
});
