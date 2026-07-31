import { Pencil } from 'lucide-react';

interface EmergencyAdmissionPatientEditState {
  patientId: number;
  admissionType?: string | null;
  admitSource?: string | null;
  isEmergency?: boolean | number | null;
}

interface EmergencyAdmissionPatientEditActionProps {
  admission: EmergencyAdmissionPatientEditState;
  onEdit: (patientId: number) => void;
}

export function isEmergencyAdmission(
  admission: EmergencyAdmissionPatientEditState,
): boolean {
  return Boolean(admission.isEmergency)
    || admission.admissionType?.trim().toLowerCase() === 'emergency'
    || admission.admitSource?.trim().toLowerCase() === 'emergency';
}

export default function EmergencyAdmissionPatientEditAction({
  admission,
  onEdit,
}: EmergencyAdmissionPatientEditActionProps) {
  if (!isEmergencyAdmission(admission)) return null;

  return (
    <button
      type="button"
      onClick={() => onEdit(admission.patientId)}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors shadow-xs cursor-pointer"
      title="Edit / Complete Patient Details"
      aria-label="Edit / Complete Patient Details"
    >
      <Pencil className="w-3.5 h-3.5" />
      Edit Details
    </button>
  );
}
