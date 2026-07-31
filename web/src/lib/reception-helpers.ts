/* eslint-disable @typescript-eslint/no-explicit-any */

export function formatTime(value?: string | null, options?: { assumeUtc?: boolean }) {
  if (!value) return undefined;
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    const [hours, minutes] = value.split(':');
    const hourNum = Number(hours);
    if (Number.isNaN(hourNum)) return value.slice(0, 5);
    const hour12 = hourNum % 12 || 12;
    const period = hourNum >= 12 ? 'PM' : 'AM';
    return `${String(hour12).padStart(2, '0')}:${minutes} ${period}`;
  }
  const naiveDateTimeMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (naiveDateTimeMatch) {
    const [, year, month, day, hours, minutes, seconds = '00'] = naiveDateTimeMatch;
    if (!options?.assumeUtc) {
      const hourNum = Number(hours);
      if (Number.isNaN(hourNum)) return undefined;
      const hour12 = hourNum % 12 || 12;
      const period = hourNum >= 12 ? 'PM' : 'AM';
      return `${String(hour12).padStart(2, '0')}:${minutes} ${period}`;
    }
    const utcDate = new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`);
    if (Number.isNaN(utcDate.getTime())) return undefined;
    return utcDate.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: true });
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: true });
}

const COMPLETED_RECEPTION_FLOW_STATUSES = new Set([
  'concluded',
  'completed',
  'completed_bill',
  'discharged',
  'closed',
  'cancelled',
  'transferred_out',
]);

export function isCompletedReceptionFlowStatus(status?: string | null) {
  return COMPLETED_RECEPTION_FLOW_STATUSES.has(String(status ?? '').toLowerCase());
}

export function sortReceptionFlowRows<T extends {
  status?: string | null;
  source?: string;
  visit?: { created_at?: string | null } | null;
  appointment?: { created_at?: string | null } | null;
  serial?: number | string | null;
  time?: string | null;
}>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aDone = isCompletedReceptionFlowStatus(a.status);
    const bDone = isCompletedReceptionFlowStatus(b.status);
    if (aDone !== bDone) return aDone ? 1 : -1;
    const timeA = a.source === 'visit'
      ? (a.visit?.created_at ? new Date(String(a.visit.created_at).replace(' ', 'T')).getTime() : 0)
      : (a.appointment?.created_at ? new Date(`${String(a.appointment.created_at).replace(' ', 'T')}Z`).getTime() : 0);
    const timeB = b.source === 'visit'
      ? (b.visit?.created_at ? new Date(String(b.visit.created_at).replace(' ', 'T')).getTime() : 0)
      : (b.appointment?.created_at ? new Date(`${String(b.appointment.created_at).replace(' ', 'T')}Z`).getTime() : 0);
    if (timeA !== timeB) return timeB - timeA;
    const serialA = Number(a.serial ?? 999999);
    const serialB = Number(b.serial ?? 999999);
    if (serialA !== serialB) return serialA - serialB;
    return String(a.time ?? '').localeCompare(String(b.time ?? ''));
  });
}

export function getAppointmentPendingAmount(appointment?: any, billingStatus?: string | null) {
  if (!appointment) return 0;
  const pendingStatuses = new Set(['pending', 'unpaid', 'partial_paid', 'partially_paid', 'partial']);
  const normalizedStatus = String(billingStatus ?? appointment.billing_status ?? '').toLowerCase();
  if (!pendingStatuses.has(normalizedStatus)) return 0;
  return Number(appointment.final_fee ?? appointment.total_amount ?? appointment.fee ?? appointment.consultation_fee ?? 0);
}

export function getBillServiceLabel(bill?: any) {
  if (!bill) return 'Service bill';
  const summary = String(bill.service_summary ?? '').trim();
  if (summary) {
    const parts = summary.split(',').map((part: string) => part.trim()).filter(Boolean);
    if (parts.length > 3) return `${parts.slice(0, 3).join(', ')} +${parts.length - 3} more`;
    return parts.join(', ');
  }
  const categoryLabels: Array<[string, string]> = [
    ['test_bill', 'Lab / diagnostic test'],
    ['doctor_visit_bill', 'Doctor consultation'],
    ['operation_bill', 'Procedure / operation'],
    ['admission_bill', 'Admission / bed charge'],
    ['medicine_bill', 'Medicine'],
  ];
  const matched = categoryLabels.find(([key]) => Number(bill[key] ?? 0) > 0);
  return matched?.[1] ?? 'Service bill';
}

export function getFlowTokenLabel(row: { serial?: number | string | null; visit?: unknown | null; pendingServices?: number | null; pendingAmount?: number | null }) {
  if (row.serial) return `#${row.serial}`;
  if (!row.visit) return '-';
  if (Number(row.pendingServices ?? 0) > 0 || Number(row.pendingAmount ?? 0) > 0) return 'No token yet';
  return 'Walk-in';
}

export function getNonConsultationPendingAmount(visit: { pending_amount?: number | null; pending_doctor_visit_amount?: number | null }) {
  return Math.max(0, Number(visit.pending_amount ?? 0) - Number(visit.pending_doctor_visit_amount ?? 0));
}

export function buildPendingConsultationEntries(input: {
  appointments: Array<any & { id: number }>;
  visits: Array<any & { id: number }>;
}) {
  const appointmentEntries = input.appointments.map((appointment) => ({
    key: `appointment-${appointment.id}`,
    source: 'appointment' as const,
    label: 'Consultation',
    patientName: appointment.patient_name ?? `Appointment #${appointment.id}`,
    doctorName: appointment.doctor_name ?? 'Doctor',
    tokenLabel: appointment.token_no ? `#${appointment.token_no}` : '-',
    amount: getAppointmentPendingAmount(appointment, appointment.billing_status),
    appointment,
    visit: null,
  })).filter((entry) => entry.amount > 0);

  const visitEntries = input.visits.map((visit) => ({
    key: `visit-${visit.id}`,
    source: 'visit' as const,
    label: 'Consultation',
    patientName: visit.patient_name ?? `Visit #${visit.id}`,
    doctorName: visit.doctor_name ?? 'Doctor',
    tokenLabel: getFlowTokenLabel({ serial: null, visit, pendingServices: visit.pending_doctor_visit_services, pendingAmount: visit.pending_doctor_visit_amount }),
    amount: Number(visit.pending_doctor_visit_amount ?? 0),
    appointment: null,
    visit,
  })).filter((entry) => entry.amount > 0);

  return [...appointmentEntries, ...visitEntries];
}

export function calculateAgeLabel(dateOfBirth?: string | null) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const diffMs = Date.now() - dob.getTime();
  const age = Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000));
  return age >= 0 ? `${age}y` : null;
}
