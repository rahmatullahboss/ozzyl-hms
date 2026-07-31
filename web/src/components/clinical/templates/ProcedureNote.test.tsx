import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import ProcedureNote from './ProcedureNote';
import type { ProcedureNoteData } from './ProcedureNote';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const emptyData: ProcedureNoteData = {
  site: '', procedureDetails: '', findings: '', complications: '', freeText: '',
};

describe('ProcedureNote', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders all fields', () => {
    render(<ProcedureNote data={emptyData} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('notes.fields.site')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.procedureDetails')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.findings')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.complications')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.freeText')).toBeInTheDocument();
  });

  it('calls onChange when site field updated', () => {
    const onChange = vi.fn();
    render(<ProcedureNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Left arm' } });
    expect(onChange).toHaveBeenCalledWith('site', 'Left arm');
  });

  it('calls onChange when procedureDetails field updated', () => {
    const onChange = vi.fn();
    render(<ProcedureNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[1], { target: { value: 'Excision of lesion' } });
    expect(onChange).toHaveBeenCalledWith('procedureDetails', 'Excision of lesion');
  });

  it('calls onChange when findings field updated', () => {
    const onChange = vi.fn();
    render(<ProcedureNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[2], { target: { value: 'No abnormalities' } });
    expect(onChange).toHaveBeenCalledWith('findings', 'No abnormalities');
  });

  it('calls onChange when complications field updated', () => {
    const onChange = vi.fn();
    render(<ProcedureNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[3], { target: { value: 'None' } });
    expect(onChange).toHaveBeenCalledWith('complications', 'None');
  });

  it('renders with initial data', () => {
    const data: ProcedureNoteData = {
      site: 'Right knee', procedureDetails: 'Arthroscopy', findings: 'Tear found',
      complications: 'None', freeText: 'Follow up in 2 weeks',
    };
    render(<ProcedureNote data={data} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByDisplayValue('Right knee')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Arthroscopy')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Tear found')).toBeInTheDocument();
    expect(screen.getByDisplayValue('None')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Follow up in 2 weeks')).toBeInTheDocument();
  });

  it('disables inputs when disabled prop is true', () => {
    render(<ProcedureNote data={emptyData} onChange={vi.fn()} disabled />, { wrapper: Wrapper });
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach(inp => expect(inp).toBeDisabled());
  });
});
