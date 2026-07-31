import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import ProgressNote from './ProgressNote';
import type { ProgressNoteData } from './ProgressNote';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const emptyData: ProgressNoteData = {
  subjective: '', objective: '', assessment: '', plan: '', followUp: '',
};

describe('ProgressNote', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders all fields', () => {
    render(<ProgressNote data={emptyData} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('notes.fields.subjective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.objective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.assessment')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.plan')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.followUp')).toBeInTheDocument();
  });

  it('calls onChange when subjective field updated', () => {
    const onChange = vi.fn();
    render(<ProgressNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const textareas = screen.getAllByRole('textbox');
    fireEvent.change(textareas[0], { target: { value: 'Patient reports pain' } });
    expect(onChange).toHaveBeenCalledWith('subjective', 'Patient reports pain');
  });

  it('calls onChange when objective field updated', () => {
    const onChange = vi.fn();
    render(<ProgressNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const textareas = screen.getAllByRole('textbox');
    fireEvent.change(textareas[1], { target: { value: 'BP 120/80' } });
    expect(onChange).toHaveBeenCalledWith('objective', 'BP 120/80');
  });

  it('calls onChange when plan field updated', () => {
    const onChange = vi.fn();
    render(<ProgressNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const textareas = screen.getAllByRole('textbox');
    fireEvent.change(textareas[3], { target: { value: 'Continue meds' } });
    expect(onChange).toHaveBeenCalledWith('plan', 'Continue meds');
  });

  it('renders with initial data', () => {
    const data: ProgressNoteData = {
      subjective: 'Headache', objective: 'Normal vitals', assessment: 'Tension HA', plan: 'Ibuprofen', followUp: '2 weeks',
    };
    render(<ProgressNote data={data} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByDisplayValue('Headache')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Normal vitals')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Tension HA')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ibuprofen')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2 weeks')).toBeInTheDocument();
  });

  it('disables inputs when disabled prop is true', () => {
    render(<ProgressNote data={emptyData} onChange={vi.fn()} disabled />, { wrapper: Wrapper });
    const textareas = screen.getAllByRole('textbox');
    textareas.forEach(ta => expect(ta).toBeDisabled());
  });
});
