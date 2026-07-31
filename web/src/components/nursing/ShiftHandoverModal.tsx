import { useState } from 'react';
import { X, ArrowRightLeft, AlertTriangle, Clock, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import toast from 'react-hot-toast';

interface ShiftHandoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoSummary: {
    pendingVitals: number;
    overdueMeds: number;
    criticalPatients: number;
    notes: string[];
  };
  /** When true, modal cannot be dismissed without completing handover (logout guard). */
  isForced?: boolean;
  /** Called after handover is successfully submitted. */
  onComplete?: () => void;
}

export default function ShiftHandoverModal({ isOpen, onClose, autoSummary, isForced, onComplete }: ShiftHandoverModalProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [handoverNotes, setHandoverNotes] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const aiHandoverMutation = useApiMutation<{ summary: string }, { ward: string; shift: string }>(
    'post',
    '/api/nursing/ai-handover/generate',
    {
      onSuccess: (data) => {
        setHandoverNotes(prev => prev ? `${prev}\n\n${data.summary}` : data.summary);
        toast.success(t('aiHandover.generated', { defaultValue: 'AI summary generated' }));
        setIsGenerating(false);
      },
      onError: () => {
        toast.error(t('aiHandover.error', { defaultValue: 'Failed to generate summary' }));
        setIsGenerating(false);
      },
    },
  );

  const handleGenerateAiSummary = () => {
    setIsGenerating(true);
    const hour = new Date().getHours();
    const shift = hour < 14 ? 'morning' : hour < 20 ? 'evening' : 'night';
    aiHandoverMutation.mutate({ ward: 'General', shift });
  };

  const handoverMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/nursing/handover',
    {
      onSuccess: () => {
        toast.success(t('handover.completed', { defaultValue: 'Handover completed' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.all });
        onComplete?.();
        onClose();
      },
      onError: () => toast.error(t('handover.failed', { defaultValue: 'Handover failed' })),
    },
  );

  const handleComplete = () => {
    const content = [
      autoSummary.pendingVitals > 0 ? `Pending vitals: ${autoSummary.pendingVitals} patients` : '',
      autoSummary.overdueMeds > 0 ? `Overdue medications: ${autoSummary.overdueMeds}` : '',
      autoSummary.criticalPatients > 0 ? `Critical patients: ${autoSummary.criticalPatients}` : '',
      ...autoSummary.notes,
      handoverNotes ? `Additional notes: ${handoverNotes}` : '',
    ].filter(Boolean).join('\n');

    if (!content.trim()) {
      toast.error(t('handover.nothingToHandover', { defaultValue: 'Nothing to handover' }));
      return;
    }

    handoverMutation.mutate({
      shift: new Date().getHours() < 14 ? 'morning' : 'evening',
      content,
      situation: autoSummary.criticalPatients > 0 ? `${autoSummary.criticalPatients} critical patients` : 'All stable',
      background: handoverNotes || undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={isForced ? undefined : onClose} data-testid="handover-modal">
      <div className="w-full max-w-lg bg-[var(--color-bg)] rounded-2xl shadow-xl border border-[var(--color-border)]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {t('handover.title', { defaultValue: 'Shift Handover' })}
              </h2>
              <p className="text-xs text-[var(--color-text-muted)]">
                {t('handover.subtitle', { defaultValue: 'Review and complete your shift handover' })}
              </p>
            </div>
          </div>
          {!isForced && (
            <button onClick={onClose} className="btn-ghost p-1.5" data-testid="handover-close">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Auto Summary */}
        <div className="px-5 py-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {t('handover.autoSummary', { defaultValue: 'Automatic Summary' })}
          </h3>

          {autoSummary.pendingVitals > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20" data-testid="summary-pending-vitals">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {t('handover.pendingVitals', { defaultValue: '{{count}} patients have pending vitals', count: autoSummary.pendingVitals })}
              </p>
            </div>
          )}

          {autoSummary.overdueMeds > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20" data-testid="summary-overdue-meds">
              <Clock className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">
                {t('handover.overdueMeds', { defaultValue: '{{count}} overdue medications', count: autoSummary.overdueMeds })}
              </p>
            </div>
          )}

          {autoSummary.criticalPatients > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20" data-testid="summary-critical">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">
                {t('handover.criticalPatients', { defaultValue: '{{count}} critical patients', count: autoSummary.criticalPatients })}
              </p>
            </div>
          )}

          {autoSummary.pendingVitals === 0 && autoSummary.overdueMeds === 0 && autoSummary.criticalPatients === 0 && (
            <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20" data-testid="summary-all-clear">
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                {t('handover.allClear', { defaultValue: 'All clear — no pending tasks or alerts' })}
              </p>
            </div>
          )}
        </div>

        {/* Handover Notes */}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="label text-sm">
              {t('handover.notesLabel', { defaultValue: 'Additional notes for next shift' })}
            </label>
            <button
              onClick={handleGenerateAiSummary}
              disabled={isGenerating}
              className="btn-ghost text-xs flex items-center gap-1 text-purple-600 hover:text-purple-700 disabled:opacity-50"
              data-testid="generate-ai-summary-btn"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isGenerating
                ? t('aiHandover.generating', { defaultValue: 'Generating summary...' })
                : t('aiHandover.generate', { defaultValue: 'Generate AI Summary' })}
            </button>
          </div>
          <textarea
            value={handoverNotes}
            onChange={e => setHandoverNotes(e.target.value)}
            rows={5}
            placeholder={t('handover.notesPlaceholder', { defaultValue: 'Any special instructions or observations...' })}
            className="input resize-none"
            data-testid="handover-notes"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-[var(--color-border)]">
          {!isForced && (
            <button onClick={onClose} className="btn-secondary">
              {t('common:cancel')}
            </button>
          )}
          <button onClick={handleComplete} disabled={handoverMutation.isPending} className="btn-primary" data-testid="complete-handover-btn">
            {handoverMutation.isPending ? t('common:saving') : t('handover.complete', { defaultValue: 'Complete Handover' })}
          </button>
        </div>
      </div>
    </div>
  );
}
