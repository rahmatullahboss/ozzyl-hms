import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Lock, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import NoteEditor from './NoteEditor';

type NoteType = 'progress' | 'soap' | 'procedure' | 'consultation' | 'discharge' | 'history_physical' | 'operative' | 'referral' | 'telephone' | 'other';

interface ClinicalNote {
  id: number;
  patient_id: number;
  visit_id?: number;
  note_type: NoteType;
  title?: string;
  content?: string;
  chief_complaint?: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  follow_up?: string;
  follow_up_unit?: string;
  template_id?: number;
  performer_id?: number;
  is_signed: number;
  signed_at?: string;
  created_at: string;
  updated_at?: string;
}

interface Props {
  patientId: string;
  onClose?: () => void;
}

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Notes' },
  { value: 'progress', label: 'Progress' },
  { value: 'soap', label: 'SOAP' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'consultation', label: 'Consultation' },
  { value: 'history_physical', label: 'H&P' },
  { value: 'other', label: 'Other' },
];

const NOTE_TYPE_BADGES: Record<NoteType, string> = {
  progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  soap: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  procedure: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  consultation: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  discharge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  history_physical: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  operative: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  referral: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  telephone: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  progress: 'Progress',
  soap: 'SOAP',
  procedure: 'Procedure',
  consultation: 'Consult',
  discharge: 'Discharge',
  history_physical: 'H&P',
  operative: 'Operative',
  referral: 'Referral',
  telephone: 'Telephone',
  other: 'Other',
};

function getContentPreview(note: ClinicalNote): string {
  // Try structured fields first
  const parts = [note.subjective, note.objective, note.assessment, note.plan].filter(Boolean);
  if (parts.length > 0) return parts.join(' ').substring(0, 100);

  // Fall back to content
  if (note.content) {
    try {
      const parsed = JSON.parse(note.content);
      const vals = Object.values(parsed).filter(v => typeof v === 'string' && v.trim());
      if (vals.length > 0) return (vals.join(' ') as string).substring(0, 100);
    } catch {
      // Not JSON, use raw
    }
    return note.content.substring(0, 100);
  }

  return '';
}

export default function NotesList({ patientId }: Props) {
  const { t } = useTranslation(['clinical']);
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [editingNote, setEditingNote] = useState<ClinicalNote | null>(null);

  const limit = 20;

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        patientId,
        page: String(page),
        limit: String(limit),
      });
      if (filter) params.set('noteType', filter);

      const data = await apiFetch<{ Results: ClinicalNote[]; pagination: { total: number } }>(
        `/api/clinical/notes?${params}`
      );
      setNotes(data.Results || []);
      setTotal(data.pagination?.total || 0);
    } catch {
      toast.error(t('toast.notesLoadFailed', 'Failed to load notes'));
    } finally {
      setLoading(false);
    }
  }, [patientId, filter, page, t]);

  useEffect(() => {
    if (patientId) fetchNotes();
  }, [fetchNotes, patientId]);

  const handleFilterChange = (newFilter: string) => {
    setFilter(newFilter);
    setPage(1);
  };

  const handleViewNote = (note: ClinicalNote) => {
    setEditingNote(note);
    setShowEditor(true);
  };

  const handleNewNote = () => {
    setEditingNote(null);
    setShowEditor(true);
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingNote(null);
    fetchNotes();
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <FileText className="w-5 h-5 text-[var(--color-primary)]" />
          {t('notes.title', 'Clinical Notes')}
          {total > 0 && (
            <span className="text-sm font-normal text-gray-500">({total})</span>
          )}
        </h2>
        <div className="flex gap-2">
          <button onClick={fetchNotes} className="btn-ghost" title={t('common.refresh', 'Refresh')} aria-label={t('common.refresh', 'Refresh')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleNewNote} className="btn-primary">
            <Plus className="w-4 h-4" />
            {t('notes.newNote', 'New Note')}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap bg-gray-100 dark:bg-gray-800 p-1 rounded-lg gap-1">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => handleFilterChange(opt.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              filter === opt.value
                ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Notes list */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-8 text-gray-500">{t('common.loading', 'Loading...')}</div>
        ) : notes.length === 0 ? (
          <div className="text-center py-12 text-gray-500 border border-gray-200 dark:border-gray-800 rounded-lg">
            {t('notes.none', 'No clinical notes found')}
          </div>
        ) : (
          notes.map(note => {
            const preview = getContentPreview(note);
            return (
              <div
                key={note.id}
                className="card p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleViewNote(note)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`badge text-xs ${NOTE_TYPE_BADGES[note.note_type]}`}>
                        {NOTE_TYPE_LABELS[note.note_type]}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(note.created_at).toLocaleString()}
                      </span>
                      {note.is_signed === 1 && (
                        <span title={t('notes.signed', 'Signed')}>
                          <Lock className="w-3.5 h-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>
                    {preview && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                        {preview}{preview.length >= 100 ? '...' : ''}
                      </p>
                    )}
                    {note.chief_complaint && (
                      <p className="text-xs text-gray-500 mt-1">
                        <span className="font-medium">CC:</span> {note.chief_complaint}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-gray-500">
            {t('notes.showing', 'Showing')} {(page - 1) * limit + 1}-{Math.min(page * limit, total)} {t('notes.of', 'of')} {total}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-ghost p-1.5 disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn-ghost p-1.5 disabled:opacity-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Editor modal */}
      {showEditor && (
        <NoteEditor
          patientId={patientId}
          note={editingNote}
          onClose={handleEditorClose}
        />
      )}
    </div>
  );
}
