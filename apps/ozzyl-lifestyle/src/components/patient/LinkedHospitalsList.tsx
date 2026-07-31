import { Building2, CheckCircle2, Plus } from 'lucide-react';
import type { HospitalLink } from '../../hooks/useConnectedCare';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

interface LinkedHospitalsListProps {
  hospitals: HospitalLink[];
  isLoading?: boolean;
  onAddHospital?: () => void;
}

function formatLinkedAt(value: string) {
  return formatPatientDateMonthYear(value);
}

export function LinkedHospitalsList({
  hospitals,
  isLoading = false,
  onAddHospital,
}: LinkedHospitalsListProps) {
  if (isLoading) {
    return <div className="h-44 rounded-3xl bg-slate-100 animate-pulse" />;
  }

  return (
    <div className="bg-white rounded-3xl p-6 shadow-[0_12px_40px_rgba(15,23,42,0.04)] border border-slate-100">
      <div className="flex justify-between items-end mb-5 gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-cyan-600" />
            Connected providers
          </h2>
          <p className="text-sm text-slate-500 mt-1">Hospitals currently linked to your patient identity</p>
        </div>
        <div className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
          {hospitals.length} linked
        </div>
      </div>

      {hospitals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-700">No hospital is linked yet.</p>
          <p className="mt-1 text-sm text-slate-500">Link a provider to bring appointments, prescriptions, labs, and bills into one place.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hospitals.map((hospital) => (
            <div key={hospital.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-cyan-100 text-cyan-800 flex items-center justify-center font-bold text-lg shadow-sm">
                  {hospital.hospital_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{hospital.hospital_name}</p>
                  <p className="text-xs text-slate-500 mt-1">Linked {formatLinkedAt(hospital.linked_at)}</p>
                  <div className="flex items-center gap-1 mt-1 text-[11px] font-medium text-emerald-700">
                    <CheckCircle2 className="w-3 h-3" />
                    {hospital.status || 'active'}
                  </div>
                </div>
              </div>
              <div className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 border border-slate-200">
                {hospital.tenant_id}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onAddHospital}
        className="w-full mt-4 py-3 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200 rounded-2xl font-semibold text-sm flex justify-center items-center gap-2 border-dashed transition-colors"
      >
        <Plus className="w-4 h-4" />
        Link another provider
      </button>
    </div>
  );
}
