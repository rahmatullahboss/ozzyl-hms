import { BedDouble, CheckCircle, Pencil, Tag } from 'lucide-react';

export interface EmergencyPatientActionState {
  patient_id?: number | null;
  er_status: 'new' | 'triaged' | 'finalized';
  profile_incomplete?: boolean | number;
  active_admission_id?: number | null;
  active_admission_public_id?: string | null;
  active_admission_no?: string | null;
}

interface EmergencyPatientActionsProps {
  patient: EmergencyPatientActionState;
  onEdit: () => void;
  onAdmit: () => void;
  onTriage: () => void;
  onFinalize: () => void;
}

export default function EmergencyPatientActions({
  patient,
  onEdit,
  onAdmit,
  onTriage,
  onFinalize,
}: EmergencyPatientActionsProps) {
  const isLiveCase = patient.er_status === 'new' || patient.er_status === 'triaged';
  const hasActiveAdmission = Boolean(
    patient.active_admission_id
      || patient.active_admission_public_id
      || patient.active_admission_no,
  );
  const admissionLabel = hasActiveAdmission
    ? 'Complete IPD admission linkage'
    : 'Admit to IPD';

  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        disabled={!patient.patient_id}
        className="btn-ghost p-1.5 text-blue-600 text-xs disabled:opacity-40"
        title="Edit / Complete Patient Details"
        aria-label="Edit / Complete Patient Details"
      >
        <Pencil className="w-4 h-4" />
      </button>
      {Boolean(patient.profile_incomplete) && (
        <span className="badge badge-warning">Incomplete details</span>
      )}
      {isLiveCase && (
        <button
          type="button"
          onClick={onAdmit}
          className="btn-ghost p-1.5 text-purple-600 text-xs"
          title={admissionLabel}
          aria-label={admissionLabel}
        >
          <BedDouble className="w-4 h-4" />
        </button>
      )}
      {patient.er_status !== 'finalized' && (
        <button
          type="button"
          onClick={onTriage}
          className="btn-ghost p-1.5 text-amber-600 text-xs"
          title="Assign Triage"
          aria-label="Assign Triage"
        >
          <Tag className="w-4 h-4" />
        </button>
      )}
      {isLiveCase && (
        <button
          type="button"
          onClick={onFinalize}
          className="btn-ghost p-1.5 text-emerald-600 text-xs"
          title="Finalize without admission"
          aria-label="Finalize without admission"
        >
          <CheckCircle className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
