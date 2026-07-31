import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import ConsultNote from './ConsultNote';
import type { ConsultNoteData } from './ConsultNote';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const emptyData: ConsultNoteData = {
  consultantName: '', reasonForConsult: '', chiefComplaint: '',
  hpi: '', ros: '', subjective: '', objective: '', assessment: '', plan: '',
};

describe('ConsultNote', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders all fields', () => {
    render(<ConsultNote data={emptyData} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('notes.fields.consultantName')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.reasonForConsult')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.chiefComplaints')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.hpi')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.ros')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.subjective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.objective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.assessment')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.plan')).toBeInTheDocument();
  });

  it('calls onChange when consultantName field updated', () => {
    const onChange = vi.fn();
    render(<ConsultNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Dr. Smith' } });
    expect(onChange).toHaveBeenCalledWith('consultantName', 'Dr. Smith');
  });

  it('calls onChange when reasonForConsult field updated', () => {
    const onChange = vi.fn();
    render(<ConsultNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[1], { target: { value: 'Cardiology evaluation' } });
    expect(onChange).toHaveBeenCalledWith('reasonForConsult', 'Cardiology evaluation');
  });

  it('calls onChange when hpi field updated', () => {
    const onChange = vi.fn();
    render(<ConsultNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[3], { target: { value: 'Chest pain for 3 days' } });
    expect(onChange).toHaveBeenCalledWith('hpi', 'Chest pain for 3 days');
  });

  it('calls onChange when assessment field updated', () => {
    const onChange = vi.fn();
    render(<ConsultNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[7], { target: { value: 'Possible angina' } });
    expect(onChange).toHaveBeenCalledWith('assessment', 'Possible angina');
  });

  it('renders with initial data', () => {
    const data: ConsultNoteData = {
      consultantName: 'Dr. Jones', reasonForConsult: 'Pulmonary eval', chiefComplaint: 'SOB',
      hpi: 'Progressive dyspnea', ros: 'Respiratory positive', subjective: 'Short of breath',
      objective: 'Decreased breath sounds', assessment: 'COPD exacerbation', plan: 'Bronchodilators',
    };
    render(<ConsultNote data={data} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByDisplayValue('Dr. Jones')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pulmonary eval')).toBeInTheDocument();
    expect(screen.getByDisplayValue('SOB')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Progressive dyspnea')).toBeInTheDocument();
    expect(screen.getByDisplayValue('COPD exacerbation')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bronchodilators')).toBeInTheDocument();
  });

  it('disables inputs when disabled prop is true', () => {
    render(<ConsultNote data={emptyData} onChange={vi.fn()} disabled />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach(inp => expect(inp).toBeDisabled());
  });
});
