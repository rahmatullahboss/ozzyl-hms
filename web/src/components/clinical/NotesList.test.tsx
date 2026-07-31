import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import NotesList from './NotesList';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { apiFetch } from '../../lib/apiClient';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const mockNotes = [
  {
    id: 1, patient_id: 1, note_type: 'progress' as const, is_signed: 0,
    subjective: 'Patient reports headache', objective: 'BP 120/80',
    assessment: 'Tension headache', plan: 'Ibuprofen 400mg',
    created_at: '2026-01-15T10:00:00Z',
  },
  {
    id: 2, patient_id: 1, note_type: 'procedure' as const, is_signed: 1,
    content: 'Minor excision performed', signed_at: '2026-01-16T12:00:00Z',
    created_at: '2026-01-16T09:00:00Z',
  },
  {
    id: 3, patient_id: 1, note_type: 'history_physical' as const, is_signed: 0,
    chief_complaint: 'Chest pain', subjective: 'Intermittent chest pain',
    created_at: '2026-01-17T08:00:00Z',
  },
];

describe('NotesList', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders notes list with type badges', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ Results: mockNotes, pagination: { total: 3 } });
    render(<NotesList patientId="1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Progress')).toBeInTheDocument());
    expect(screen.getAllByText('Procedure').length).toBeGreaterThan(0);
    expect(screen.getAllByText('H&P').length).toBeGreaterThan(0);
    expect(screen.getByText('notes.title')).toBeInTheDocument();
  });

  it('filters by note type', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ Results: mockNotes, pagination: { total: 3 } });
    render(<NotesList patientId="1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Progress')).toBeInTheDocument());

    // Click the filter tab "Procedure"
    const procedureFilter = screen.getAllByText('Procedure').find(el => el.tagName === 'BUTTON');
    expect(procedureFilter).toBeDefined();
    fireEvent.click(procedureFilter!);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('noteType=procedure'));
    });
  });

  it('shows empty state when no notes', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ Results: [], pagination: { total: 0 } });
    render(<NotesList patientId="1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('notes.none')).toBeInTheDocument());
  });

  it('shows signed notes with lock icon', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ Results: mockNotes, pagination: { total: 3 } });
    render(<NotesList patientId="1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Progress')).toBeInTheDocument());

    // The signed note (id:2) should have a lock icon with title "notes.signed"
    expect(screen.getByTitle('notes.signed')).toBeInTheDocument();
  });

  it('opens NoteEditor when clicking New Note', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ Results: [], pagination: { total: 0 } });
    render(<NotesList patientId="1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('notes.newNote')).toBeInTheDocument());

    fireEvent.click(screen.getByText('notes.newNote'));
    // NoteEditor modal renders with its own header
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'notes.newNote' })).toBeInTheDocument();
    });
  });

  it('displays content preview from structured fields', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ Results: [mockNotes[0]], pagination: { total: 1 } });
    render(<NotesList patientId="1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/Patient reports headache/)).toBeInTheDocument());
  });

  it('displays chief complaint when present', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ Results: [mockNotes[2]], pagination: { total: 1 } });
    render(<NotesList patientId="1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/Chest pain/)).toBeInTheDocument());
  });
});
