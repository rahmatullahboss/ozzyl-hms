import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerMARTab from './DrawerMARTab';
import type { BedGridItem } from './WardBedGrid';

const mockInvalidateQueries = vi.fn();
const mockMutate = vi.fn();

let queryData: Record<string, unknown> | undefined = undefined;
let mutationCallbacks: Record<string, unknown> = {};

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

vi.mock('../../hooks/usePatientVerification', () => ({
  usePatientVerification: () => ({
    isVerified: false,
    isMismatch: false,
    matchedPatient: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('./BarcodeScanner', () => ({
  default: ({ onScan }: { onScan: (value: string) => void }) => (
    <div data-testid="barcode-scanner">BarcodeScanner Mock</div>
  ),
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

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    schedule_id: 1,
    medication_name: 'Amoxicillin',
    generic_name: 'Amoxicillin',
    dose: '500mg',
    route: 'Oral',
    frequency: 'TID',
    scheduled_time: '2026-05-26T08:00:00Z',
    status: 'pending',
    ...overrides,
  };
}

function selectDropdownOption(testId: string, optionText: string) {
  const select = screen.getByTestId(testId) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: optionText } });
}

describe('DrawerMARTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData = undefined;
    mutationCallbacks = {};
  });

  it('renders the mar-tab container', () => {
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByTestId('mar-tab')).toBeInTheDocument();
  });

  it('renders empty state when no scheduled medications', () => {
    queryData = { Results: [] };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByTestId('mar-empty')).toBeInTheDocument();
    expect(screen.getByText('No medications scheduled for today')).toBeInTheDocument();
  });

  it('renders empty state when data is undefined', () => {
    queryData = undefined;
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByTestId('mar-empty')).toBeInTheDocument();
  });

  it('renders medications grouped by morning time slot', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', scheduled_time: '2026-05-26T08:00:00' }),
        makeSchedule({ schedule_id: 2, medication_name: 'Metformin', scheduled_time: '2026-05-26T10:00:00' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByTestId('mar-slot-morning')).toBeInTheDocument();
    expect(screen.getByText('Amoxicillin')).toBeInTheDocument();
    expect(screen.getByText('Metformin')).toBeInTheDocument();
  });

  it('renders medications in afternoon slot', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 3, medication_name: 'Aspirin', scheduled_time: '2026-05-26T14:00:00' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByTestId('mar-slot-afternoon')).toBeInTheDocument();
    expect(screen.getByText('Aspirin')).toBeInTheDocument();
  });

  it('renders medications in evening slot', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 4, medication_name: 'Omeprazole', scheduled_time: '2026-05-26T21:00:00' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByTestId('mar-slot-evening')).toBeInTheDocument();
    expect(screen.getByText('Omeprazole')).toBeInTheDocument();
  });

  it('shows given status with green background and checkmark', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'given', administered_at: '2026-05-26T08:05:00' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const item = screen.getByTestId('mar-item-1');
    expect(item.className).toContain('bg-emerald-50');
    const checkbox = screen.getByTestId('mar-checkbox-1');
    expect(checkbox.className).toContain('bg-emerald-500');
  });

  it('checkbox click calls administer mutation', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const checkbox = screen.getByTestId('mar-checkbox-1');
    fireEvent.click(checkbox);
    expect(mockMutate).toHaveBeenCalledWith({ _id: 1, status: 'given' });
  });

  it('disabled checkbox for already-given medications', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'given' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const checkbox = screen.getByTestId('mar-checkbox-1');
    expect(checkbox).toBeDisabled();
  });

  it('renders medication details (dose, route, frequency)', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', dose: '500mg', route: 'Oral', frequency: 'TID' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByText('500mg · Oral · TID')).toBeInTheDocument();
  });

  it('renders generic name in parentheses', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'BrandX', generic_name: 'Amoxicillin' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByText('(Amoxicillin)')).toBeInTheDocument();
  });

  it('renders today date in heading', () => {
    render(<DrawerMARTab bed={makeBed()} />);
    const today = new Date().toISOString().split('T')[0];
    expect(screen.getByText(today)).toBeInTheDocument();
  });

  // ── PRN/SOS Flow ────────────────────────────────────────────────────────

  it('shows PRN badge for PRN medications', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Paracetamol', is_prn: true, status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByTestId('mar-prn-badge-1')).toBeInTheDocument();
  });

  it('opens PRN reason modal when Give is tapped on PRN medication', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Paracetamol', is_prn: true, status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    expect(screen.getByTestId('prn-reason-modal')).toBeInTheDocument();
  });

  it('PRN modal has reason dropdown with expected options', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Paracetamol', is_prn: true, status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    const select = screen.getByTestId('prn-reason-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('Fever');
    expect(options).toContain('Pain');
    expect(options).toContain('Vomiting');
    expect(options).toContain('Breathlessness');
    expect(options).toContain('High BP');
    expect(options).toContain('Anxiety');
    expect(options).toContain('Other');
  });

  it('PRN modal confirm button is disabled until reason is selected', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Paracetamol', is_prn: true, status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    const confirmBtn = screen.getByTestId('prn-confirm-btn');
    expect(confirmBtn).toBeDisabled();
    selectDropdownOption('prn-reason-select', 'Fever');
    expect(confirmBtn).not.toBeDisabled();
  });

  it('PRN modal submits with reason and closes', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Paracetamol', is_prn: true, status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    selectDropdownOption('prn-reason-select', 'Fever');
    fireEvent.click(screen.getByTestId('prn-confirm-btn'));
    expect(mockMutate).toHaveBeenCalledWith({ _id: 1, status: 'given', reason: 'Fever' });
    expect(screen.queryByTestId('prn-reason-modal')).not.toBeInTheDocument();
  });

  it('PRN modal cancel closes modal without submitting', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Paracetamol', is_prn: true, status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    fireEvent.click(screen.getByTestId('prn-cancel-btn'));
    expect(screen.queryByTestId('prn-reason-modal')).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  // ── Missed Dose / Withhold-Refused Flow ─────────────────────────────────

  it('shows action menu button on pending medications', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByTestId('mar-menu-btn-1')).toBeInTheDocument();
  });

  it('action menu shows Withhold and Refused options', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    expect(screen.getByTestId('mar-menu-withhold-1')).toBeInTheDocument();
    expect(screen.getByTestId('mar-menu-refused-1')).toBeInTheDocument();
  });

  it('clicking Withhold opens missed dose modal with reason dropdown', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-withhold-1'));
    expect(screen.getByTestId('missed-dose-modal')).toBeInTheDocument();
    expect(screen.getByTestId('missed-dose-select')).toBeInTheDocument();
  });

  it('missed dose modal has expected reason options', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-withhold-1'));
    const select = screen.getByTestId('missed-dose-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('Patient refused');
    expect(options).toContain('Patient asleep');
    expect(options).toContain('Vomiting');
    expect(options).toContain('Medicine not available');
    expect(options).toContain('Doctor hold');
    expect(options).toContain('NPO');
    expect(options).toContain('Transferred');
    expect(options).toContain('Other');
  });

  it('missed dose modal confirm is disabled until reason selected', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-withhold-1'));
    const confirmBtn = screen.getByTestId('missed-dose-confirm-btn');
    expect(confirmBtn).toBeDisabled();
    selectDropdownOption('missed-dose-select', 'Patient refused');
    expect(confirmBtn).not.toBeDisabled();
  });

  it('withhold submits with status withheld and reason', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-withhold-1'));
    selectDropdownOption('missed-dose-select', 'Doctor hold');
    fireEvent.click(screen.getByTestId('missed-dose-confirm-btn'));
    expect(mockMutate).toHaveBeenCalledWith({ _id: 1, status: 'withheld', reason: 'Doctor hold' });
  });

  it('refused submits with status refused and reason', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-refused-1'));
    selectDropdownOption('missed-dose-select', 'Patient refused');
    fireEvent.click(screen.getByTestId('missed-dose-confirm-btn'));
    expect(mockMutate).toHaveBeenCalledWith({ _id: 1, status: 'refused', reason: 'Patient refused' });
  });

  it('missed dose modal cancel closes without submitting', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-withhold-1'));
    fireEvent.click(screen.getByTestId('missed-dose-cancel-btn'));
    expect(screen.queryByTestId('missed-dose-modal')).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('does not show action menu for already-given medications', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'given' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.queryByTestId('mar-menu-btn-1')).not.toBeInTheDocument();
  });

  it('shows withheld status with appropriate styling', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'withheld', reason_not_given: 'Doctor hold' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const item = screen.getByTestId('mar-item-1');
    expect(item.className).toContain('amber');
    expect(screen.getByText('Doctor hold')).toBeInTheDocument();
  });

  it('shows refused status with appropriate styling', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'refused', reason_not_given: 'Patient refused' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const item = screen.getByTestId('mar-item-1');
    expect(item.className).toContain('red');
    expect(screen.getByText('Patient refused')).toBeInTheDocument();
  });

  // ── Allergy Warning Banner ────────────────────────────────────────────

  it('shows allergy warning banner when allergy_count > 0', () => {
    queryData = { Results: [] };
    render(<DrawerMARTab bed={makeBed({ allergy_count: 3 })} />);
    const banner = screen.getByTestId('mar-allergy-warning');
    expect(banner).toBeInTheDocument();
    expect(screen.getByText('Patient has 3 allergy(ies)')).toBeInTheDocument();
  });

  it('does not show allergy warning banner when allergy_count is 0', () => {
    queryData = { Results: [] };
    render(<DrawerMARTab bed={makeBed({ allergy_count: 0 })} />);
    expect(screen.queryByTestId('mar-allergy-warning')).not.toBeInTheDocument();
  });

  it('does not show allergy warning banner when allergy_count is undefined', () => {
    queryData = { Results: [] };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.queryByTestId('mar-allergy-warning')).not.toBeInTheDocument();
  });

  // ── High-Risk Medication Double Check ─────────────────────────────────

  it('shows high-risk modal when giving insulin', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Insulin Glargine', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    expect(screen.getByTestId('high-risk-modal')).toBeInTheDocument();
    expect(screen.getAllByText('Insulin Glargine').length).toBeGreaterThanOrEqual(1);
  });

  it('shows high-risk modal for heparin', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Heparin 5000U', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    expect(screen.getByTestId('high-risk-modal')).toBeInTheDocument();
  });

  it('does not show high-risk modal for normal medications', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    expect(screen.queryByTestId('high-risk-modal')).not.toBeInTheDocument();
    expect(mockMutate).toHaveBeenCalledWith({ _id: 1, status: 'given' });
  });

  it('high-risk modal confirm is disabled without patient verification', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Morphine', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    const confirmBtn = screen.getByTestId('high-risk-confirm-btn');
    expect(confirmBtn).toBeDisabled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('high-risk modal cancel closes without submitting', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Warfarin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    fireEvent.click(screen.getByTestId('high-risk-cancel-btn'));
    expect(screen.queryByTestId('high-risk-modal')).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('high-risk modal matches case-insensitively', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'POTASSIUM CHLORIDE', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-checkbox-1'));
    expect(screen.getByTestId('high-risk-modal')).toBeInTheDocument();
  });

  // ── Late Status (auto-detection) ──────────────────────────────────────────

  it('auto-detects late status when given time > scheduled + 30min', () => {
    queryData = {
      Results: [
        makeSchedule({
          schedule_id: 1,
          medication_name: 'Amoxicillin',
          status: 'given',
          scheduled_time: '2026-05-26T08:00:00',
          administered_at: '2026-05-26T08:35:00',
        }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.getByTestId('mar-late-badge-1')).toBeInTheDocument();
  });

  it('does not show late badge when given within 30min of scheduled time', () => {
    queryData = {
      Results: [
        makeSchedule({
          schedule_id: 1,
          medication_name: 'Amoxicillin',
          status: 'given',
          scheduled_time: '2026-05-26T08:00:00',
          administered_at: '2026-05-26T08:25:00',
        }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.queryByTestId('mar-late-badge-1')).not.toBeInTheDocument();
  });

  it('shows amber badge for late medications', () => {
    queryData = {
      Results: [
        makeSchedule({
          schedule_id: 1,
          medication_name: 'Amoxicillin',
          status: 'given',
          scheduled_time: '2026-05-26T08:00:00',
          administered_at: '2026-05-26T08:35:00',
        }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const badge = screen.getByTestId('mar-late-badge-1');
    expect(badge.className).toContain('amber');
  });

  it('shows late item with amber background', () => {
    queryData = {
      Results: [
        makeSchedule({
          schedule_id: 1,
          medication_name: 'Amoxicillin',
          status: 'late',
          scheduled_time: '2026-05-26T08:00:00',
          administered_at: '2026-05-26T08:35:00',
        }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const item = screen.getByTestId('mar-item-1');
    expect(item.className).toContain('amber');
  });

  // ── Hold Status ───────────────────────────────────────────────────────────

  it('shows Hold option in action menu', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    expect(screen.getByTestId('mar-menu-hold-1')).toBeInTheDocument();
  });

  it('clicking Hold opens hold modal with reason dropdown', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-hold-1'));
    expect(screen.getByTestId('hold-modal')).toBeInTheDocument();
    expect(screen.getByTestId('hold-reason-select')).toBeInTheDocument();
  });

  it('hold modal has expected reason options', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-hold-1'));
    const select = screen.getByTestId('hold-reason-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('Doctor hold');
    expect(options).toContain('Patient condition improved');
    expect(options).toContain('Side effects');
  });

  it('hold modal confirm is disabled until reason selected', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-hold-1'));
    const confirmBtn = screen.getByTestId('hold-confirm-btn');
    expect(confirmBtn).toBeDisabled();
    selectDropdownOption('hold-reason-select', 'Doctor hold');
    expect(confirmBtn).not.toBeDisabled();
  });

  it('hold submits with status hold and reason', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-hold-1'));
    selectDropdownOption('hold-reason-select', 'Doctor hold');
    fireEvent.click(screen.getByTestId('hold-confirm-btn'));
    expect(mockMutate).toHaveBeenCalledWith({ _id: 1, status: 'hold', reason: 'Doctor hold' });
  });

  it('hold modal cancel closes without submitting', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-hold-1'));
    fireEvent.click(screen.getByTestId('hold-cancel-btn'));
    expect(screen.queryByTestId('hold-modal')).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('shows held status with blue styling', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'hold', reason_not_given: 'Doctor hold' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const item = screen.getByTestId('mar-item-1');
    expect(item.className).toContain('blue');
    expect(screen.getByText('Doctor hold')).toBeInTheDocument();
  });

  // ── Not Available Status ──────────────────────────────────────────────────

  it('shows Not Available option in action menu', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    expect(screen.getByTestId('mar-menu-not-available-1')).toBeInTheDocument();
  });

  it('clicking Not Available opens confirmation modal', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-not-available-1'));
    expect(screen.getByTestId('not-available-modal')).toBeInTheDocument();
  });

  it('not available modal confirm submits with not_available status', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-not-available-1'));
    fireEvent.click(screen.getByTestId('not-available-confirm-btn'));
    expect(mockMutate).toHaveBeenCalledWith({ _id: 1, status: 'not_available', reason: 'Medicine not available' });
  });

  it('not available modal cancel closes without submitting', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'pending' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('mar-menu-btn-1'));
    fireEvent.click(screen.getByTestId('mar-menu-not-available-1'));
    fireEvent.click(screen.getByTestId('not-available-cancel-btn'));
    expect(screen.queryByTestId('not-available-modal')).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('shows not available status with grey styling', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'not_available', reason_not_given: 'Medicine not available' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const item = screen.getByTestId('mar-item-1');
    expect(item.className).toContain('slate');
    expect(screen.getByText('Medicine not available')).toBeInTheDocument();
  });

  // ── Cancelled Status ──────────────────────────────────────────────────────

  it('shows cancelled status with strikethrough text', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'cancelled' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const nameEl = screen.getByText('Amoxicillin');
    expect(nameEl.className).toContain('line-through');
  });

  it('does not show action buttons for cancelled medications', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'cancelled' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    expect(screen.queryByTestId('mar-checkbox-1')).toBeDisabled();
    expect(screen.queryByTestId('mar-menu-btn-1')).not.toBeInTheDocument();
  });

  it('shows cancelled item with muted styling', () => {
    queryData = {
      Results: [
        makeSchedule({ schedule_id: 1, medication_name: 'Amoxicillin', status: 'cancelled' }),
      ],
    };
    render(<DrawerMARTab bed={makeBed()} />);
    const item = screen.getByTestId('mar-item-1');
    expect(item.className).toContain('slate');
  });
});
