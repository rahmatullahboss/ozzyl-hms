type NavigateTo = (path: string) => void;

type CheckedInAppointment = {
  id: number;
  patient_id?: number;
  patient_name?: string;
  patient_code?: string | null;
  patient_mobile?: string | null;
  patient_age?: number | string | null;
  patient_date_of_birth?: string | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
};

export type CheckedInVisit = {
  id: number;
  appointment_id: number;
  patient_id: number;
  patient_name: string;
  patient_code?: string;
  mobile?: string;
  age?: number | string | null;
  date_of_birth?: string | null;
  doctor_id?: number | null;
  doctor_name?: string;
  visit_type: 'opd';
  status: 'engaged' | 'initiated';
};

export function getReceptionBillPrintPath(basePath: string, billId: number | string): string {
  const receptionBasePath = basePath.endsWith('/reception') ? basePath : `${basePath}/reception`;
  return `${receptionBasePath}/billing/${billId}/print`;
}

export function getReceptionLabTestBillPrintPath(basePath: string, billId: number | string): string {
  const receptionBasePath = basePath.endsWith('/reception') ? basePath : `${basePath}/reception`;
  return `${receptionBasePath}/billing/${billId}/lab-print`;
}

export function redirectToReceptionBillPrint(
  navigate: NavigateTo,
  basePath: string,
  billId?: number | null,
): boolean {
  if (!billId) return false;
  navigate(getReceptionBillPrintPath(basePath, billId));
  return true;
}

export function buildCheckedInVisit({
  appointment,
  visitId,
  sentToRoom,
}: {
  appointment: CheckedInAppointment;
  visitId?: number | null;
  sentToRoom?: boolean;
}): CheckedInVisit | null {
  if (!visitId || !appointment.patient_id) return null;

  return {
    id: Number(visitId),
    appointment_id: appointment.id,
    patient_id: Number(appointment.patient_id),
    patient_name: appointment.patient_name ?? 'Unknown patient',
    patient_code: appointment.patient_code ?? undefined,
    mobile: appointment.patient_mobile ?? undefined,
    age: appointment.patient_age ?? undefined,
    date_of_birth: appointment.patient_date_of_birth ?? undefined,
    doctor_id: appointment.doctor_id ?? null,
    doctor_name: appointment.doctor_name ?? undefined,
    visit_type: 'opd',
    status: sentToRoom ? 'engaged' : 'initiated',
  };
}
