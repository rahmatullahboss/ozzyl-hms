import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import FreeTextNote from './FreeTextNote';
import type { FreeTextNoteData } from './FreeTextNote';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const emptyData: FreeTextNoteData = { content: '' };

describe('FreeTextNote', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders textarea', () => {
    render(<FreeTextNote data={emptyData} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('notes.fields.freeText')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('calls onChange when text entered', () => {
    const onChange = vi.fn();
    render(<FreeTextNote data={emptyData} onChange={onChange} />, { wrapper: Wrapper });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Free text content' } });
    expect(onChange).toHaveBeenCalledWith('content', 'Free text content');
  });

  it('renders with initial data', () => {
    const data: FreeTextNoteData = { content: 'Existing note text' };
    render(<FreeTextNote data={data} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByDisplayValue('Existing note text')).toBeInTheDocument();
  });

  it('disables textarea when disabled prop is true', () => {
    render(<FreeTextNote data={emptyData} onChange={vi.fn()} disabled />, { wrapper: Wrapper });
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
