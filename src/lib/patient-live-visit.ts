export type PatientLiveVisitStatus =
  | 'scheduled'
  | 'checked_in'
  | 'waiting'
  | 'called'
  | 'serving'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type PatientArrivalAction =
  | 'wait_for_hospital'
  | 'arrive_soon'
  | 'go_now';

interface AppointmentLike {
  id: number;
  appt_date: string;
  appt_time?: string | null;
  doctor_name?: string | null;
  status?: string | null;
}

interface QueueEntryLike {
  id: number;
  token_no: string;
  token_number: number;
  status: 'waiting' | 'serving' | 'called' | 'no_show' | 'completed' | 'cancelled' | 'transferred';
  estimated_wait_minutes?: number | null;
  counter_no?: string | null;
  called_at?: string | null;
  serve_start_time?: string | null;
  serve_end_time?: string | null;
  updated_at?: string | null;
}

interface VisitLike {
  id: number;
  status: string;
  visit_date?: string | null;
  updated_at?: string | null;
}

function normalizeVisitStatus(status: string | null | undefined): string {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'active' || normalized === 'checked_in') return 'checked-in';
  return String(status ?? '');
}

export interface DerivePatientLiveVisitInput {
  appointment: AppointmentLike | null;
  queueEntry: QueueEntryLike | null;
  visit: VisitLike | null;
  currentServingTokenNo: string | null;
  waitingAheadCount: number;
}

export interface PatientLiveJourneyStep {
  key: 'booked' | 'confirmed' | 'checked_in' | 'called' | 'serving' | 'completed';
  state: 'done' | 'current' | 'upcoming';
  label: string;
}

export interface DerivedPatientLiveVisit {
  status: PatientLiveVisitStatus;
  appointment: AppointmentLike | null;
  visit: {
    id: number;
    status: string;
    visit_date: string | null;
  } | null;
  queue: {
    id: number;
    token_no: string;
    token_number: number;
    status: QueueEntryLike['status'];
    counter_no: string | null;
    called_at: string | null;
    serve_start_time: string | null;
    serve_end_time: string | null;
  } | null;
  current_serving_token_no: string | null;
  patients_ahead: number;
  estimated_wait_minutes: number | null;
  last_updated_at: string | null;
  next_step_label: string | null;
  journey: PatientLiveJourneyStep[];
  arrival_guidance: {
    action: PatientArrivalAction;
    label: string;
  };
}

function getArrivalGuidance(status: PatientLiveVisitStatus, estimatedWaitMinutes: number | null): DerivedPatientLiveVisit['arrival_guidance'] {
  if (status === 'serving' || status === 'called') {
    return {
      action: 'go_now',
      label: 'Please go to the doctor room now.',
    };
  }

  if (status === 'waiting' && estimatedWaitMinutes !== null && estimatedWaitMinutes <= 30) {
    return {
      action: 'arrive_soon',
      label: 'Please arrive soon. Your turn is getting closer.',
    };
  }

  return {
    action: 'wait_for_hospital',
    label: 'Wait for the hospital to activate your live queue status.',
  };
}

function buildJourney(status: PatientLiveVisitStatus, appointmentStatus?: string | null): PatientLiveJourneyStep[] {
  const currentIndexByStatus: Record<PatientLiveVisitStatus, number> = {
    scheduled: appointmentStatus === 'confirmed' ? 1 : 0,
    checked_in: 2,
    waiting: 2,
    called: 3,
    serving: 4,
    completed: 5,
    cancelled: 0,
    no_show: 0,
  };

  const currentIndex = currentIndexByStatus[status];
  const labels: PatientLiveJourneyStep['label'][] = [
    'Booked',
    'Confirmed',
    'Checked in',
    'Called',
    'In consultation',
    'Completed',
  ];

  return (['booked', 'confirmed', 'checked_in', 'called', 'serving', 'completed'] as const).map((key, index) => ({
    key,
    label: labels[index],
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

function getNextStepLabel(status: PatientLiveVisitStatus): string | null {
  if (status === 'scheduled') return 'Hospital confirmation or check-in will appear here.';
  if (status === 'checked_in' || status === 'waiting') return 'Please stay ready for your token to be called.';
  if (status === 'called') return 'Please move to your assigned counter or doctor room now.';
  if (status === 'serving') return 'Consultation is in progress.';
  if (status === 'completed') return 'This visit is completed.';
  if (status === 'cancelled') return 'This visit has been cancelled.';
  if (status === 'no_show') return 'Hospital marked this visit as no-show.';
  return null;
}

export function derivePatientLiveVisit(input: DerivePatientLiveVisitInput): DerivedPatientLiveVisit {
  let status: PatientLiveVisitStatus = 'scheduled';

  const appointmentStatus = String(input.appointment?.status ?? '').toLowerCase();
  const visitStatus = normalizeVisitStatus(input.visit?.status).toLowerCase();

  if (appointmentStatus === 'cancelled') status = 'cancelled';
  if (appointmentStatus === 'no_show') status = 'no_show';
  if (appointmentStatus === 'completed') status = 'completed';
  if (appointmentStatus === 'checked_in' || appointmentStatus === 'in_progress') status = 'checked_in';
  if (visitStatus === 'checked-in' || visitStatus === 'initiated' || visitStatus === 'engaged') status = 'checked_in';
  if (input.queueEntry?.status === 'waiting') status = 'waiting';
  if (input.queueEntry?.status === 'called') status = 'called';
  if (input.queueEntry?.status === 'serving') status = 'serving';
  if (input.queueEntry?.status === 'completed') status = 'completed';
  if (input.queueEntry?.status === 'cancelled') status = 'cancelled';
  if (input.queueEntry?.status === 'no_show') status = 'no_show';

  const estimatedWaitMinutes = input.queueEntry?.estimated_wait_minutes ?? null;
  const lastUpdatedAt = input.queueEntry?.updated_at
    ?? input.queueEntry?.serve_end_time
    ?? input.queueEntry?.serve_start_time
    ?? input.queueEntry?.called_at
    ?? input.visit?.updated_at
    ?? null;

  return {
    status,
    appointment: input.appointment,
    visit: input.visit
      ? {
          id: input.visit.id,
          status: normalizeVisitStatus(input.visit.status),
          visit_date: input.visit.visit_date ?? null,
        }
      : null,
    queue: input.queueEntry
      ? {
          id: input.queueEntry.id,
          token_no: input.queueEntry.token_no,
          token_number: input.queueEntry.token_number,
          status: input.queueEntry.status,
          counter_no: input.queueEntry.counter_no ?? null,
          called_at: input.queueEntry.called_at ?? null,
          serve_start_time: input.queueEntry.serve_start_time ?? null,
          serve_end_time: input.queueEntry.serve_end_time ?? null,
        }
      : null,
    current_serving_token_no: input.currentServingTokenNo,
    patients_ahead: input.waitingAheadCount,
    estimated_wait_minutes: estimatedWaitMinutes,
    last_updated_at: lastUpdatedAt,
    next_step_label: getNextStepLabel(status),
    journey: buildJourney(status, input.appointment?.status),
    arrival_guidance: getArrivalGuidance(status, estimatedWaitMinutes),
  };
}
