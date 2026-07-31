import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import HistoryPhysicalNote from './HistoryPhysicalNote';
import type { HistoryPhysicalData } from './HistoryPhysicalNote';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const emptyData: HistoryPhysicalData = {
  chiefComplaint: '', hpi: '', ros: '', subjective: '', objective: '', assessment: '', plan: '',
};

describe('HistoryPhysicalNote', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders all fields', () => {
    render(<HistoryPhysicalNote data={emptyData} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('notes.fields.chiefComplaints')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.hpi')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.ros')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.subjective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.objective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.assessment')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.plan')).toBeInTheDocument();
  });

  it('calls onChange when chiefComplaint field updated', () => {
    const onChange = vi.fn();
    render(<HistoryPhysicalNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Chest pain' } });
    expect(onChange).toHaveBeenCalledWith('chiefComplaint', 'Chest pain');
  });

  it('calls onChange when hpi field updated', () => {
    const onChange = vi.fn();
    render(<HistoryPhysicalNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[1], { target: { value: 'Started 3 days ago' } });
    expect(onChange).toHaveBeenCalledWith('hpi', 'Started 3 days ago');
  });

  it('calls onChange when assessment field updated', () => {
    const onChange = vi.fn();
    render(<HistoryPhysicalNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[5], { target: { value: 'Acute bronchitis' } });
    expect(onChange).toHaveBeenCalledWith('assessment', 'Acute bronchitis');
  });

  it('renders with initial data', () => {
    const data: HistoryPhysicalData = {
      chiefComplaint: 'Headache', hpi: 'Started yesterday', ros: 'Unremarkable',
      subjective: 'Mild pain', objective: 'Normal exam', assessment: 'Tension HA', plan: 'Rest',
    };
    render(<HistoryPhysicalNote data={data} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByDisplayValue('Headache')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Started yesterday')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Unremarkable')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Tension HA')).toBeInTheDocument();
  });

  it('disables inputs when disabled prop is true', () => {
    render(<HistoryPhysicalNote data={emptyData} onChange={vi.fn()} disabled />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach(inp => expect(inp).toBeDisabled());
  });
});
