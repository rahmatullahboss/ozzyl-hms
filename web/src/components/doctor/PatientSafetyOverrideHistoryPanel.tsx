import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '../../lib/apiClient';

interface SafetyOverrideAuditEntry {
  id: number;
  prescription_id?: number | null;
  patient_id: number;
  patient_name?: string | null;
  patient_code?: string | null;
  medication_name?: string | null;
  generic_name?: string | null;
  check_type?: string | null;
  warning_count?: number | null;
  override_reason?: string | null;
  checked_by?: number | null;
  checked_by_name?: string | null;
  checked_at?: string | null;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function PatientSafetyOverrideHistoryPanel({ patientId }: { patientId: number }) {
  const [overrides, setOverrides] = useState<SafetyOverrideAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadOverrides() {
      setLoading(true);
      try {
        const result = await api.get<{ overrides?: SafetyOverrideAuditEntry[] }>(`/api/e-prescribing/safety-overrides?patientId=${patientId}&limit=5`);
        if (!cancelled) setOverrides(result.overrides ?? []);
      } catch {
        if (!cancelled) setOverrides([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (patientId) loadOverrides();
    return () => { cancelled = true; };
  }, [patientId]);

  if (!loading && overrides.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
      <h3 className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
        <ShieldAlert className="w-4 h-4" />
        Safety Override History
        {loading && <span className="text-[11px] font-normal text-amber-700">Refreshing…</span>}
      </h3>
      {overrides.length === 0 ? (
        <p className="text-xs text-amber-800">No previous override found for this patient.</p>
      ) : (
        <div className="space-y-2">
          {overrides.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-amber-200 bg-white/70 p-2.5 text-xs">
              <div className="font-semibold text-amber-950">{entry.medication_name || 'Medication safety warning'}</div>
              <div className="mt-1 text-amber-900">{entry.override_reason || 'No reason recorded'}</div>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-amber-800">
                {entry.warning_count != null && <span>{entry.warning_count} warning(s)</span>}
                {entry.checked_by_name && <span>By {entry.checked_by_name}</span>}
                {entry.checked_at && <span>{formatDateTime(entry.checked_at)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
