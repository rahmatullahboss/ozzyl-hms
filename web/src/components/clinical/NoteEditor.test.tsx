import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import NoteEditor from './NoteEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { apiFetch } from '../../lib/apiClient';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('NoteEditor', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders note type selector dropdown when creating new note', () => {
    render(<NoteEditor patientId="1" note={null} onClose={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('notes.noteType')).toBeInTheDocument();
    expect(screen.getByText('Progress Note')).toBeInTheDocument();
    expect(screen.getByText('History & Physical')).toBeInTheDocument();
    expect(screen.getByText('Procedure Note')).toBeInTheDocument();
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    expect(screen.getByText('Free Text')).toBeInTheDocument();
  });

  it('shows ProgressNote form by default', () => {
    render(<NoteEditor patientId="1" note={null} onClose={vi.fn()} />, { wrapper: Wrapper });
    // ProgressNote renders Subjective, Objective, Assessment, Plan fields
    expect(screen.getByText('notes.fields.subjective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.objective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.assessment')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.plan')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.followUp')).toBeInTheDocument();
  });

  it('shows ProgressNote form when progress selected', () => {
    render(<NoteEditor patientId="1" note={null} onClose={vi.fn()} />, { wrapper: Wrapper });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'progress' } });
    expect(screen.getByText('notes.fields.subjective')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.objective')).toBeInTheDocument();
  });

  it('shows HistoryPhysicalNote form when history_physical selected', () => {
    render(<NoteEditor patientId="1" note={null} onClose={vi.fn()} />, { wrapper: Wrapper });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'history_physical' } });
    expect(screen.getByText('notes.fields.chiefComplaints')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.hpi')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.ros')).toBeInTheDocument();
  });

  it('shows ProcedureNote form when procedure selected', () => {
    render(<NoteEditor patientId="1" note={null} onClose={vi.fn()} />, { wrapper: Wrapper });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'procedure' } });
    expect(screen.getByText('notes.fields.site')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.procedureDetails')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.findings')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.complications')).toBeInTheDocument();
  });

  it('shows ConsultNote form when consultation selected', () => {
    render(<NoteEditor patientId="1" note={null} onClose={vi.fn()} />, { wrapper: Wrapper });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'consultation' } });
    expect(screen.getByText('notes.fields.consultantName')).toBeInTheDocument();
    expect(screen.getByText('notes.fields.reasonForConsult')).toBeInTheDocument();
  });

  it('shows FreeTextNote form when other selected', () => {
    render(<NoteEditor patientId="1" note={null} onClose={vi.fn()} />, { wrapper: Wrapper });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'other' } });
    expect(screen.getByText('notes.fields.freeText')).toBeInTheDocument();
  });

  it('submits note via POST when saving new note', async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    const onClose = vi.fn();
    render(<NoteEditor patientId="1" note={null} onClose={onClose} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText('common.save'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/clinical/notes', expect.objectContaining({
        method: 'POST',
      }));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('signs note via PUT /sign', async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClose = vi.fn();
    const existingNote = {
      id: 42, patient_id: 1, note_type: 'progress' as const, is_signed: 0,
      subjective: 'Test', created_at: '2026-01-15T10:00:00Z',
    };
    render(<NoteEditor patientId="1" note={existingNote} onClose={onClose} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText('notes.sign'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/clinical/notes/42/sign', expect.objectContaining({
        method: 'PUT',
      }));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not show note type selector when editing existing note', () => {
    const existingNote = {
      id: 1, patient_id: 1, note_type: 'progress' as const, is_signed: 0,
      subjective: 'Existing', created_at: '2026-01-15T10:00:00Z',
    };
    render(<NoteEditor patientId="1" note={existingNote} onClose={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.queryByText('notes.noteType')).not.toBeInTheDocument();
  });

  it('shows signed label and hides save/sign buttons for signed notes', () => {
    const signedNote = {
      id: 1, patient_id: 1, note_type: 'progress' as const, is_signed: 1,
      signed_at: '2026-01-15T12:00:00Z', created_at: '2026-01-15T10:00:00Z',
    };
    render(<NoteEditor patientId="1" note={signedNote} onClose={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByRole('heading', { name: /notes\.editNote.*notes\.signed/ })).toBeInTheDocument();
    expect(screen.queryByText('common.save')).not.toBeInTheDocument();
    expect(screen.queryByText('notes.sign')).not.toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(<NoteEditor patientId="1" note={null} onClose={onClose} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('common.cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
