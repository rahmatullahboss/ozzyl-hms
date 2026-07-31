import { useState } from 'react';
import { FileText, Plus, X, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { BedGridItem } from './WardBedGrid';
import VoiceNoteButton from './VoiceNoteButton';

interface NursingNote {
  id: number;
  patient_id: number;
  note_type: string;
  note: string;
  created_at: string;
  created_by?: number;
}

interface DrawerNotesTabProps {
  bed: BedGridItem;
}

const NOTE_TEMPLATES = [
  { key: 'vitals', label: 'Vitals stable', text: 'Vitals stable, patient comfortable.' },
  { key: 'medication', label: 'Medication given', text: 'Medication administered as prescribed. No adverse reaction observed.' },
  { key: 'assessment', label: 'Assessment', text: 'Patient assessed. ' },
  { key: 'intake', label: 'Intake noted', text: 'Oral intake documented. ' },
];

export default function DrawerNotesTab({ bed }: DrawerNotesTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [noteType, setNoteType] = useState('general');
  const [noteText, setNoteText] = useState('');

  const notesQuery = useApiQuery<{ Results?: NursingNote[] }>(
    queryKeys.nursing.notes(bed.patient_id!),
    `/api/nursing/notes?patient_id=${bed.patient_id}&limit=10`,
    { enabled: !!bed.patient_id },
  );
  const notes = notesQuery.data?.Results ?? [];

  const createMutation = useApiMutation('post', '/api/nursing/notes', {
    onSuccess: () => {
      toast.success(t('drawer.notes.saved', { defaultValue: 'Note saved' }));
      setNoteText('');
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.notes(bed.patient_id!) });
    },
    onError: (err) => toast.error(err.message || t('drawer.notes.failed', { defaultValue: 'Failed to save note' })),
  });

  const deleteMutation = useApiMutation('delete', (id: number) => `/api/nursing/notes/${id}`, {
    onSuccess: () => {
      toast.success(t('common:deleted', { defaultValue: 'Deleted' }));
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.notes(bed.patient_id!) });
    },
    onError: () => toast.error(t('common:deleteFailed', { defaultValue: 'Delete failed' })),
  });

  const handleSave = () => {
    if (!noteText.trim()) {
      toast.error(t('drawer.notes.contentRequired', { defaultValue: 'Note content required' }));
      return;
    }
    createMutation.mutate({
      patient_id: bed.patient_id,
      note_type: noteType,
      note: noteText.trim(),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm(t('common:confirmDelete', { defaultValue: 'Delete this record?' }))) return;
    deleteMutation.mutate(id);
  };

  const applyTemplate = (text: string) => {
    setNoteText(prev => prev ? `${prev}\n${text}` : text);
  };

  return (
    <div className="space-y-4" data-testid="notes-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t('drawer.notes.title', { defaultValue: 'Nursing Notes' })}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => notesQuery.refetch()} className="btn-ghost p-1.5" aria-label="Refresh" data-testid="notes-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-ghost p-1.5 text-[var(--color-primary)]"
            aria-label="Add note"
            data-testid="add-note-btn"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quick Add Form */}
      {showForm && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30 space-y-3" data-testid="note-form">
          <div>
            <label className="label text-xs">{t('drawer.notes.type', { defaultValue: 'Note Type' })}</label>
            <select
              value={noteType}
              onChange={e => setNoteType(e.target.value)}
              className="input text-sm"
              data-testid="note-type-select"
            >
              <option value="general">{t('options.note_type.general', { defaultValue: 'General' })}</option>
              <option value="assessment">{t('options.note_type.assessment', { defaultValue: 'Assessment' })}</option>
              <option value="progress">{t('options.note_type.progress', { defaultValue: 'Progress' })}</option>
              <option value="procedure">{t('options.note_type.procedure', { defaultValue: 'Procedure' })}</option>
            </select>
          </div>

          {/* Quick Templates */}
          <div>
            <label className="label text-xs">{t('drawer.notes.templates', { defaultValue: 'Quick Templates' })}</label>
            <div className="flex flex-wrap gap-1.5">
              {NOTE_TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.key}
                  onClick={() => applyTemplate(tmpl.text)}
                  className="px-2 py-1 text-xs rounded-md border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors"
                  data-testid={`template-${tmpl.key}`}
                >
                  {tmpl.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label text-xs">{t('drawer.notes.content', { defaultValue: 'Note' })} *</label>
              <VoiceNoteButton
                onTranscript={(text) => setNoteText(prev => prev ? `${prev} ${text}` : text)}
                language="en-GB"
              />
            </div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={3}
              className="input resize-none text-sm"
              placeholder={t('drawer.notes.placeholder', { defaultValue: 'Enter nursing note...' })}
              data-testid="note-text-input"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setNoteText(''); }} className="btn-secondary text-xs">
              {t('common:cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={createMutation.isPending || !noteText.trim()}
              className="btn-primary text-xs"
              data-testid="save-note-btn"
            >
              {createMutation.isPending ? t('common:saving') : t('common:save')}
            </button>
          </div>
        </div>
      )}

      {/* Notes List */}
      <div className="space-y-2" data-testid="notes-list">
        {notesQuery.isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-lg" />
          ))
        ) : notes.length === 0 ? (
          <div className="text-center py-6 text-[var(--color-text-muted)]" data-testid="notes-empty">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('drawer.notes.noNotes', { defaultValue: 'No nursing notes yet' })}</p>
          </div>
        ) : (
          notes.map(note => (
            <div
              key={note.id}
              className="p-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)]/20 transition-colors group"
              data-testid="note-item"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                      {note.note_type}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {note.created_at ? new Date(note.created_at).toLocaleString('en-GB', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      }) : '—'}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{note.note}</p>
                </div>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="btn-ghost p-1 text-red-500 opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                  title={t('common:delete')}
                  data-testid="delete-note-btn"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
