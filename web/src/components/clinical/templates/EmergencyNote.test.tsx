import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import EmergencyNote from './EmergencyNote';
import type { EmergencyNoteData } from './EmergencyNote';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const emptyData: EmergencyNoteData = {
  modeOfArrival: '', broughtBy: '', phoneNumber: '', triageTime: '', triagedBy: '',
  trauma: false, disposition: '', erCourseDescription: '',
  subjective: '', objective: '', assessment: '', plan: '',
};

describe('EmergencyNote', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders all fields', () => {
    render(<EmergencyNote data={emptyData} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('notes.fields.modeOfArrival')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.broughtBy')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.phoneNumber')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.triageTime')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.triagedBy')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.disposition')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.trauma')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.erCourseDescription')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.subjective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.objective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.assessment')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.plan')).toBeInTheDocument();
  });

  it('shows select dropdown for Mode of Arrival', () => {
    render(<EmergencyNote data={emptyData} onChange={vi.fn()} />, { wrapper: Wrapper });
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(2);
    // Mode of Arrival options
    expect(screen.getByText('notes.arrivalModes.ambulance')).toBeInTheDocument();
    expect(screen.getByText('notes.arrivalModes.walkIn')).toBeInTheDocument();
    expect(screen.getByText('notes.arrivalModes.referred')).toBeInTheDocument();
    expect(screen.getByText('notes.arrivalModes.police')).toBeInTheDocument();
  });

  it('shows select dropdown for Disposition', () => {
    render(<EmergencyNote data={emptyData} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('notes.dispositions.admit')).toBeInTheDocument();
    expect(screen.getByText('notes.dispositions.discharge')).toBeInTheDocument();
    expect(screen.getByText('notes.dispositions.transfer')).toBeInTheDocument();
    expect(screen.getByText('notes.dispositions.ama')).toBeInTheDocument();
    expect(screen.getByText('notes.dispositions.expired')).toBeInTheDocument();
  });

  it('calls onChange when modeOfArrival changed', () => {
    const onChange = vi.fn();
    render(<EmergencyNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'ambulance' } });
    expect(onChange).toHaveBeenCalledWith('modeOfArrival', 'ambulance');
  });

  it('calls onChange when disposition changed', () => {
    const onChange = vi.fn();
    render(<EmergencyNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'admit' } });
    expect(onChange).toHaveBeenCalledWith('disposition', 'admit');
  });

  it('calls onChange when broughtBy field updated', () => {
    const onChange = vi.fn();
    render(<EmergencyNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Family member' } });
    expect(onChange).toHaveBeenCalledWith('broughtBy', 'Family member');
  });

  it('calls onChange when trauma checkbox toggled', () => {
    const onChange = vi.fn();
    render(<EmergencyNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith('trauma', true);
  });

  it('renders with initial data', () => {
    const data: EmergencyNoteData = {
      ...emptyData,
      modeOfArrival: 'ambulance', broughtBy: 'EMS', phoneNumber: '555-1234',
      triagedBy: 'Nurse Jane', disposition: 'admit', trauma: true,
      erCourseDescription: 'Patient stabilized',
    };
    render(<EmergencyNote data={data} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByDisplayValue('EMS')).toBeInTheDocument();
    expect(screen.getByDisplayValue('555-1234')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Nurse Jane')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Patient stabilized')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('disables inputs when disabled prop is true', () => {
    render(<EmergencyNote data={emptyData} onChange={vi.fn()} disabled />, { wrapper: Wrapper });
    const selects = screen.getAllByRole('combobox');
    selects.forEach(s => expect(s).toBeDisabled());
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();
  });
});
