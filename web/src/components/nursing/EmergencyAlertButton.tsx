import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { apiFetch } from '../../lib/apiClient';

interface EmergencyAlertButtonProps {
  patientId: number;
  admissionId: number;
}

const EMERGENCY_REASONS = [
  { key: 'low-spo2', label: 'Low SpO2' },
  { key: 'unconscious', label: 'Unconscious' },
  { key: 'severe-bleeding', label: 'Severe bleeding' },
  { key: 'chest-pain', label: 'Chest pain' },
  { key: 'seizure', label: 'Seizure' },
  { key: 'fall', label: 'Fall' },
  { key: 'critical-vitals', label: 'Critical vitals' },
  { key: 'other', label: 'Other' },
] as const;

export default function EmergencyAlertButton({ patientId, admissionId }: EmergencyAlertButtonProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const [open, setOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) return;
    setLoading(true);
    try {
      await apiFetch('/api/nursing/emergency-alert', {
        method: 'POST',
        body: {
          patient_id: patientId,
          admission_id: admissionId,
          reason: selectedReason,
          notes: notes.trim(),
        },
      });
      toast.success(t('drawer.emergency.sent', { defaultValue: 'Emergency alert sent to doctor' }));
      setOpen(false);
      setSelectedReason(null);
      setNotes('');
    } catch {
      toast.error(t('drawer.emergency.failed', { defaultValue: 'Failed to send emergency alert' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
        data-testid="emergency-alert-btn"
      >
        <AlertTriangle className="w-4 h-4" />
        {t('drawer.emergency.button', { defaultValue: 'Emergency' })}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" data-testid="emergency-modal">
          <div className="fixed inset-0 bg-black/50" onClick={() => !loading && setOpen(false)} />
          <div className="relative bg-[var(--color-bg)] rounded-xl shadow-2xl border border-[var(--color-border)] w-full max-w-md mx-4 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-red-600 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                {t('drawer.emergency.title', { defaultValue: 'Emergency Alert' })}
              </h3>
              <button onClick={() => !loading && setOpen(false)} className="btn-ghost p-1" data-testid="emergency-close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-[var(--color-text-muted)] mb-3">
              {t('drawer.emergency.selectReason', { defaultValue: 'Select the emergency reason:' })}
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {EMERGENCY_REASONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setSelectedReason(r.key)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                    selectedReason === r.key
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-medium'
                      : 'border-[var(--color-border)] hover:border-red-300 text-[var(--color-text)]'
                  }`}
                  data-testid={`reason-${r.key}`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {selectedReason === 'other' && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('drawer.emergency.notesPlaceholder', { defaultValue: 'Describe the emergency...' })}
                className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] resize-none mb-4"
                rows={3}
                data-testid="emergency-notes"
              />
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="btn-secondary text-sm"
                data-testid="emergency-cancel"
              >
                {t('common:cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!selectedReason || loading}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                data-testid="emergency-submit"
              >
                {loading
                  ? t('drawer.emergency.sending', { defaultValue: 'Sending...' })
                  : t('drawer.emergency.send', { defaultValue: 'Send Alert' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
