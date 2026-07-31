import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router';
import {
  Calendar, CalendarClock, Clock, Plus, Search, CheckCircle2, XCircle,
  AlertCircle, User, Stethoscope, Hash, ChevronLeft, ChevronRight, LogIn, Bell,
  CreditCard, Send, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { formatDisplayDate, formatDisplayDateTime, getTodayGMT6, formatToTodayGMT6 } from '../lib/date-utils';
import ReceptionTopBar from '../components/reception/ReceptionTopBar';

// ─── Constants ───────────────────────────────────────────────────────────────

export const tokenModeOptions = [
  { value: 'auto' as const, labelKey: 'appointments.tokenModeAuto' },
  { value: 'reserved' as const, labelKey: 'appointments.tokenModeReserved' },
  { value: 'manual' as const, labelKey: 'appointments.tokenModeManual' },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Appointment {
  id: number;
  appt_no: string;
  token_no: number;
  token_assignment_type?: 'auto' | 'reserved' | 'manual' | null;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  patient_mobile: string;
  doctor_id: number | null;
  doctor_name: string | null;
  doctor_specialty: string | null;
  appt_date: string;
  appt_time: string | null;
  visit_type: 'opd' | 'followup' | 'emergency';
  status: 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show' | 'pending_approval';
  chief_complaint: string | null;
  notes: string | null;
  fee: number;
  appointment_type?: AppointmentType | null;
  original_fee?: number | null;
  discount_amount?: number | null;
  final_fee?: number | null;
  billing_status?: 'no_charge' | 'pending' | 'unpaid' | 'partial_paid' | 'paid' | 'due_approved' | 'refunded' | 'cancelled' | null;
  source: 'scheduled' | 'walk_in' | 'online' | 'phone';
  created_at?: string | null;
}

interface Doctor {
  id: number;
  name: string;
  specialty: string | null;
  consultation_fee: number;
}

interface Patient {
  id: number;
  name: string;
  patient_code: string;
  mobile: string;
}

interface AppointmentsResponse {
  appointments: Appointment[];
}

interface DoctorsResponse {
  doctors: Doctor[];
}

type AppointmentType = 'new_patient' | 'old_patient' | 'follow_up' | 'report_show' | 'free_visit' | 'discounted_visit' | 'emergency';

export interface PaidVisitRecord {
  appointmentId: number;
  doctorId: number | null;
  doctorName: string | null;
  appointmentType: string | null;
  appointmentDate: string | null;
  paidAt: string;
}

type PaidVisitContext = {
  selectedDoctor: PaidVisitRecord | null;
  latestAnyDoctor: PaidVisitRecord | null;
};

export function getPaidVisitContextDisplay(context?: PaidVisitContext | null): {
  primary: PaidVisitRecord | null;
  secondary: PaidVisitRecord | null;
} {
  const primary = context?.selectedDoctor ?? null;
  const latestAnyDoctor = context?.latestAnyDoctor ?? null;
  const secondary = latestAnyDoctor
    && latestAnyDoctor.appointmentId !== primary?.appointmentId
    && latestAnyDoctor.doctorId !== primary?.doctorId
    ? latestAnyDoctor
    : null;
  return { primary, secondary };
}

interface AppointmentFeePreviewResponse {
  charge: {
    appointmentType: AppointmentType;
    originalFee: number;
    discountAmount: number;
    finalFee: number;
    billingStatus: string;
  };
  eligibility?: {
    eligible: boolean;
    windowDays: number;
    lastVisitDate: string | null;
    reason: string | null;
  };
  paidVisitContext?: PaidVisitContext;
}

interface SchemePreviewResponse {
  eligible: boolean;
  scheme_id: number | null;
  scheme_name: string | null;
  scheme_code?: string | null;
  suggested_discount: number;
  allocation_type: string;
  matched_member_id?: number | null;
  matched_member_code?: string | null;
  service_category?: string | null;
  blockers: string[];
}

interface AppointmentBenefitDraft {
  schemeCode: string;
  memberCode: string;
  preview: SchemePreviewResponse | null;
}

interface AvailableReservedToken {
  token?: number;
  token_no?: number;
  label?: string | null;
}

interface TokenReservationAvailabilityResponse {
  tokens?: AvailableReservedToken[];
  available?: AvailableReservedToken[];
  summary?: {
    currentTokenNo: number;
    nextRegularTokenNo: number;
    reservedTotal: number;
    reservedBooked: number;
    reservedAvailable: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoToday(): string {
  return getTodayGMT6();
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function addDays(date: string, delta: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return formatToTodayGMT6(d);
}

export const appointmentConsultationFeeAmount = (consultationFee: number | null | undefined): number => {
  const fee = Number(consultationFee ?? 0);
  return Number.isFinite(fee) && fee > 0 ? Math.round(fee) : 0;
};

const STATUS_STYLE: Record<string, string> = {
  scheduled:  'bg-blue-50 text-blue-700 border-blue-200',
  checked_in: 'bg-teal-50 text-teal-700 border-teal-200',
  completed:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled:  'bg-gray-100 text-gray-500 border-gray-200 line-through',
  no_show:           'bg-amber-50 text-amber-700 border-amber-200',
  pending_approval:  'bg-orange-50 text-orange-700 border-orange-200',
};
const STATUS_ICON: Record<string, React.ReactNode> = {
  scheduled:         <Clock className="w-3.5 h-3.5" />,
  checked_in:        <LogIn className="w-3.5 h-3.5" />,
  completed:         <CheckCircle2 className="w-3.5 h-3.5" />,
  cancelled:         <XCircle className="w-3.5 h-3.5" />,
  no_show:           <AlertCircle className="w-3.5 h-3.5" />,
  pending_approval:  <Bell className="w-3.5 h-3.5" />,
};
const VISIT_BADGE: Record<string, string> = {
  opd:       'bg-sky-100 text-sky-700',
  followup:  'bg-purple-100 text-purple-700',
  emergency: 'bg-red-100 text-red-700',
};

const BILLING_STATUS_STYLE: Record<string, string> = {
  no_charge: 'bg-slate-50 text-slate-700 border-slate-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  unpaid: 'bg-red-50 text-red-700 border-red-200',
  partial_paid: 'bg-orange-50 text-orange-700 border-orange-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  due_approved: 'bg-blue-50 text-blue-700 border-blue-200',
  refunded: 'bg-purple-50 text-purple-700 border-purple-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};


function appointmentBillingStatus(appt: Appointment): string {
  if (appt.billing_status) return appt.billing_status;
  return appointmentConsultationFeeAmount(appt.fee) > 0 ? 'unpaid' : 'no_charge';
}

function canEnterDoctorQueue(appt: Appointment): boolean {
  return ['paid', 'due_approved', 'no_charge'].includes(appointmentBillingStatus(appt));
}

function compareAppointmentsNewestFirst(a: Appointment, b: Appointment): number {
  const dateCompare = b.appt_date.localeCompare(a.appt_date);
  if (dateCompare !== 0) return dateCompare;

  const tokenCompare = (b.token_no ?? 0) - (a.token_no ?? 0);
  if (tokenCompare !== 0) return tokenCompare;

  const createdCompare = String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  if (createdCompare !== 0) return createdCompare;

  return b.id - a.id;
}

function newAppointmentPaymentAttemptKey(appointmentId: number): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `appointment-pay-${appointmentId}-${suffix}`;
}

// ─── Book Appointment Modal ───────────────────────────────────────────────────

interface BookModalProps {
  date: string;
  doctors: Doctor[];
  onClose: () => void;
  onBooked: () => void;
}

function BookModal({ date, doctors, onClose, onBooked }: BookModalProps) {
  const [patientQuery, setPatientQuery] = useState('');
  const [patients, setPatients]         = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [doctorId, setDoctorId]   = useState('');
  const [localDate, setLocalDate] = useState(date);
  const [apptTime, setApptTime]   = useState('');
  const [visitType, setVisitType] = useState<'opd' | 'followup' | 'emergency'>('opd');
  const [appointmentType, setAppointmentType] = useState<AppointmentType>('new_patient');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountByName, setDiscountByName] = useState('');
  const [complaint, setComplaint] = useState('');
  const [fee, setFee]             = useState('');
  const [requestedTokenNo, setRequestedTokenNo] = useState<number | ''>('');
  const [tokenMode, setTokenMode] = useState<'auto' | 'reserved' | 'manual'>('auto');
  const [manualTokenNo, setManualTokenNo] = useState<number | ''>('');
  const [originalFee, setOriginalFee] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [paidVisitContext, setPaidVisitContext] = useState<PaidVisitContext | null>(null);
  const { t } = useTranslation(['appointments', 'common']);

  const bookMutation = useApiMutation<{ tokenNo: number }, unknown>(
    'post',
    '/api/appointments',
    {
      onSuccess: (data) => {
        toast.success(t('appointments.appointmentBooked', { tokenNo: data.tokenNo }));
        onBooked();
        onClose();
      },
      onError: (err) => {
        toast.error(err.message || t('toast.failed_to_book'));
      },
    },
  );

  // Search patients (debounced)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (patientQuery.length < 2) { setPatients([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.get<{ patients: Patient[] }>(`/api/patients?search=${encodeURIComponent(patientQuery)}`)
        .then(r => setPatients(r.patients ?? []))
        .catch(() => setPatients([]));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [patientQuery]);

  useEffect(() => {
    if (appointmentType === 'old_patient' || appointmentType === 'follow_up' || appointmentType === 'report_show') setVisitType('followup');
    if (appointmentType === 'emergency') setVisitType('emergency');
    if (appointmentType === 'new_patient' || appointmentType === 'free_visit' || appointmentType === 'discounted_visit') setVisitType('opd');
  }, [appointmentType]);

  const { data: availableTokensData, isLoading: availableTokensLoading } = useApiQuery<TokenReservationAvailabilityResponse>(
    queryKeys.tokenReservations.available({ date: localDate, doctorId }),
    `/api/reception/token-reservations/available?date=${localDate}&doctorId=${doctorId}`,
    { enabled: !!doctorId },
  );
  const availableTokens = useMemo(() => (availableTokensData?.tokens ?? availableTokensData?.available ?? [])
    .map((token) => ({
      token_no: Number(token.token_no ?? token.token),
      label: token.label ?? null,
    }))
    .filter((token) => Number.isInteger(token.token_no) && token.token_no > 0), [availableTokensData?.available, availableTokensData?.tokens]);
  const tokenAvailabilitySummary = availableTokensData?.summary;

  useEffect(() => {
    if (!requestedTokenNo) return;
    if (availableTokens.some((token) => token.token_no === requestedTokenNo)) return;
    setRequestedTokenNo('');
  }, [availableTokens, requestedTokenNo]);

  // Auto-fill fee from server-side doctor/type setup. The backend remains authoritative.
  useEffect(() => {
    const doc = doctors.find(d => String(d.id) === doctorId);
    if (!doctorId || !doc) {
      setOriginalFee(0);
      setFee('0');
      setPaidVisitContext(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    const params = new URLSearchParams({
      doctorId,
      appointmentType,
      discountAmount: discountAmount || '0',
    });
    if (selectedPatient?.id) params.set('patientId', String(selectedPatient.id));
    params.set('apptDate', localDate);
    api.get<AppointmentFeePreviewResponse>(`/api/appointments/fee-preview?${params}`)
      .then((response) => {
        if (cancelled) return;
        setOriginalFee(response.charge.originalFee);
        setFee(String(response.charge.finalFee));
        setPaidVisitContext(response.paidVisitContext ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = appointmentType === 'report_show' ? 0 : appointmentConsultationFeeAmount(doc.consultation_fee);
        const discount = appointmentType === 'free_visit' ? fallback : Math.min(Number(discountAmount || 0), fallback);
        setOriginalFee(fallback);
        setFee(String(Math.max(0, fallback - discount)));
        setPaidVisitContext(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [doctorId, doctors, appointmentType, discountAmount, selectedPatient?.id, localDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) { toast.error(t('appointments.please_select_a_patient')); return; }
    if (tokenMode === 'manual' && !manualTokenNo) { toast.error(t('appointments.forceTokenNoRequired')); return; }
    const effectiveDiscount = appointmentType === 'free_visit' ? originalFee : Number(discountAmount || 0);
    if (originalFee > 0 && effectiveDiscount > 0 && (effectiveDiscount / originalFee) * 100 > 20 && !discountByName.trim()) {
      toast.error('Discount referred by name is required when discount is above 20%.');
      return;
    }

    const body: Record<string, unknown> = {
      patientId:      selectedPatient.id,
      doctorId:       doctorId ? Number(doctorId) : undefined,
      apptDate:       localDate,
      apptTime:       apptTime || undefined,
      visitType,
      appointmentType,
      discountAmount: effectiveDiscount,
      discountReason: discountReason || undefined,
      discountByName: discountByName.trim() || undefined,
      chiefComplaint: complaint || undefined,
    };
    if (tokenMode === 'reserved' && requestedTokenNo) {
      body.requestedTokenNo = Number(requestedTokenNo);
    }
    if (tokenMode === 'manual' && manualTokenNo) {
      body.forceTokenNo = Number(manualTokenNo);
    }
    bookMutation.mutate(body);
  };

  const paidVisitDisplay = getPaidVisitContextDisplay(paidVisitContext);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="p-5 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('bookAppointment')}</h2>
          <p className="text-sm text-[var(--color-text-muted)]">{fmtDate(localDate)}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Patient search */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('patient')} *</label>
            {selectedPatient ? (
              <div className="flex items-center justify-between p-2 rounded-lg border border-[var(--color-primary)] bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[var(--color-primary)]" />
                  <div>
                    <p className="text-sm font-medium">{selectedPatient.name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{selectedPatient.patient_code} · {selectedPatient.mobile}</p>
                  </div>
                </div>
                <button type="button" onClick={() => { setSelectedPatient(null); setPatientQuery(''); }}
                  className="text-xs text-[var(--color-text-muted)] hover:text-red-500">{t('common:change', { defaultValue: 'Change' })}</button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  value={patientQuery}
                  onChange={e => setPatientQuery(e.target.value)}
                  placeholder={t("appointments.search_by_name_id_or_mobile")}
                  className="input pl-9 w-full"
                />
                {patients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {patients.map(p => (
                      <button key={p.id} type="button"
                        onClick={() => { setSelectedPatient(p); setPatientQuery(''); setPatients([]); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--color-bg-secondary)] text-left">
                        <User className="w-4 h-4 text-[var(--color-text-muted)]" />
                        <div>
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{p.patient_code} · {p.mobile}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {(paidVisitDisplay.primary || paidVisitDisplay.secondary) && (
            <div className="rounded-lg border border-purple-200 bg-purple-50/70 p-3 text-xs text-purple-900 dark:border-purple-900/60 dark:bg-purple-950/30 dark:text-purple-100">
              {paidVisitDisplay.primary && (
                <div>
                  <div className="font-semibold">Last paid with selected doctor</div>
                  <div className="mt-1 text-purple-800 dark:text-purple-200">
                    {paidVisitDisplay.primary.doctorName ?? 'Selected doctor'}
                    {paidVisitDisplay.primary.appointmentType ? ` · ${paidVisitDisplay.primary.appointmentType.replace(/_/g, ' ')}` : ''}
                  </div>
                  <div className="mt-0.5">Paid: {formatDisplayDateTime(paidVisitDisplay.primary.paidAt)}</div>
                  {paidVisitDisplay.primary.appointmentDate && (
                    <div>Appointment: {formatDisplayDate(paidVisitDisplay.primary.appointmentDate)}</div>
                  )}
                </div>
              )}
              {paidVisitDisplay.secondary && (
                <div className={paidVisitDisplay.primary ? 'mt-2 border-t border-purple-200 pt-2 dark:border-purple-800' : ''}>
                  <div className="font-semibold">Latest paid appointment with another doctor</div>
                  <div className="mt-1 text-purple-800 dark:text-purple-200">
                    {paidVisitDisplay.secondary.doctorName ?? 'Doctor'}
                    {paidVisitDisplay.secondary.appointmentType ? ` · ${paidVisitDisplay.secondary.appointmentType.replace(/_/g, ' ')}` : ''}
                  </div>
                  <div className="mt-0.5">Paid: {formatDisplayDateTime(paidVisitDisplay.secondary.paidAt)}</div>
                  {paidVisitDisplay.secondary.appointmentDate && (
                    <div>Appointment: {formatDisplayDate(paidVisitDisplay.secondary.appointmentDate)}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Doctor + date row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('doctor')}</label>
              <select value={doctorId} onChange={e => setDoctorId(e.target.value)} className="input w-full">
                <option value="">— {t('walkIn')} —</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` (${d.specialty})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('date')}</label>
              <div className="flex gap-2">
                <input type="date" value={localDate} onChange={e => setLocalDate(e.target.value)} className="input min-w-0 flex-1" />
                <button
                  type="button"
                  className="rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
                  onClick={() => setLocalDate((current) => addDays(current, 1))}
                >
                  Next day
                </button>
              </div>
            </div>
          </div>

          {/* Time + visit type row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('time')} (opt.)</label>
              <input type="time" value={apptTime} onChange={e => setApptTime(e.target.value)} className="input w-full" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('type')}</label>
                <select value={appointmentType} onChange={e => setAppointmentType(e.target.value as AppointmentType)} className="input w-full">
                  <option value="new_patient">{t('type.new_patient')}</option>
                  <option value="old_patient">{t('type.old_patient')}</option>
                  <option value="report_show">{t('type.report_show')}</option>
                  <option value="free_visit">{t('type.free_visit')}</option>
                  <option value="emergency">{t('type.emergency')}</option>
                </select>
            </div>
          </div>

          <input type="hidden" value={visitType} readOnly />

          {/* Fee row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('form.original')}</label>
              <div className="input w-full bg-[var(--color-bg-secondary)] font-data">৳{originalFee}</div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('form.discount')}</label>
              <input
                type="number"
                value={appointmentType === 'free_visit' ? String(originalFee) : discountAmount}
                onChange={e => setDiscountAmount(e.target.value)}
                placeholder="0"
                min={0}
                disabled={appointmentType === 'free_visit' || appointmentType === 'report_show'}
                className="input w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('form.payable')}</label>
              <div className="input w-full bg-[var(--color-bg-secondary)] font-data">{previewLoading ? '...' : `৳${fee || 0}`}</div>
            </div>
          </div>
          {appointmentType === 'free_visit' && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('form.reason')}</label>
              <input value={discountReason} onChange={e => setDiscountReason(e.target.value)} className="input w-full" placeholder={t('placeholder.approval_note')} />
            </div>
          )}
          {(appointmentType === 'free_visit' ? originalFee : Number(discountAmount || 0)) > 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                Discount referred by{originalFee > 0 && ((appointmentType === 'free_visit' ? originalFee : Number(discountAmount || 0)) / originalFee) * 100 > 20 ? ' *' : ''}
              </label>
              <input
                value={discountByName}
                onChange={e => setDiscountByName(e.target.value)}
                className="input w-full"
                placeholder={originalFee > 0 && ((appointmentType === 'free_visit' ? originalFee : Number(discountAmount || 0)) / originalFee) * 100 > 20 ? 'Required above 20%' : 'Optional'}
              />
            </div>
          )}

          {doctorId ? (
            <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-950/30">
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-blue-700 dark:text-blue-300">Current serial</div>
                  <div className="font-data text-lg font-semibold text-blue-950 dark:text-blue-100">
                    {availableTokensLoading ? '...' : tokenAvailabilitySummary?.currentTokenNo ? `#${tokenAvailabilitySummary.currentTokenNo}` : 'None'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-blue-700 dark:text-blue-300">Next regular</div>
                  <div className="font-data text-lg font-semibold text-blue-950 dark:text-blue-100">
                    {availableTokensLoading ? '...' : tokenAvailabilitySummary?.nextRegularTokenNo ? `#${tokenAvailabilitySummary.nextRegularTokenNo}` : 'Auto'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-blue-700 dark:text-blue-300">Reserved free</div>
                  <div className="font-data text-lg font-semibold text-blue-950 dark:text-blue-100">
                    {availableTokensLoading ? '...' : `${tokenAvailabilitySummary?.reservedAvailable ?? availableTokens.length}/${tokenAvailabilitySummary?.reservedTotal ?? 0}`}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('appointments.tokenMode')}</label>
                <div className="flex items-center gap-4">
                  {tokenModeOptions.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="tokenMode"
                        value={opt.value}
                        checked={tokenMode === opt.value}
                        onChange={() => setTokenMode(opt.value)}
                        className="accent-[var(--color-primary)]"
                      />
                      {t(opt.labelKey)}
                    </label>
                  ))}
                </div>
                {tokenMode === 'reserved' && (
                  <div className="space-y-1">
                    <select
                      className="input w-full"
                      value={requestedTokenNo}
                      onChange={(e) => setRequestedTokenNo(e.target.value ? Number(e.target.value) : '')}
                    >
                      <option value="">
                        Auto-assign regular{tokenAvailabilitySummary?.nextRegularTokenNo ? ` #${tokenAvailabilitySummary.nextRegularTokenNo}` : ''}
                      </option>
                      {availableTokens.map((token) => (
                        <option key={token.token_no} value={token.token_no}>
                          Reserved #{token.token_no}{token.label ? ` (${token.label})` : ''}
                        </option>
                      ))}
                    </select>
                    {!availableTokensLoading && tokenAvailabilitySummary?.reservedTotal ? (
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {tokenAvailabilitySummary.reservedAvailable > 0
                          ? `${tokenAvailabilitySummary.reservedAvailable} reserved serial${tokenAvailabilitySummary.reservedAvailable === 1 ? '' : 's'} still open.`
                          : 'All reserved serials are already assigned.'}
                      </p>
                    ) : null}
                  </div>
                )}
                {tokenMode === 'manual' && (
                  <input
                    type="number"
                    className="input w-full"
                    value={manualTokenNo}
                    onChange={(e) => setManualTokenNo(e.target.value ? Number(e.target.value) : '')}
                    placeholder={t('appointments.manualTokenPlaceholder')}
                    min={1}
                  />
                )}
              </div>
            </div>
          ) : null}

          {/* Chief complaint */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('patients_main_concern')}</label>
            <textarea value={complaint} onChange={e => setComplaint(e.target.value)}
              rows={2} placeholder={t("appointments.patients_main_concern")} className="input w-full resize-none" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common:cancel')}</button>
            <button type="submit" disabled={bookMutation.isPending || !selectedPatient} className="btn-primary flex-1">
              {bookMutation.isPending ? t('booking') : t('bookAppointment')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reschedule Modal ─────────────────────────────────────────────────────────

interface RescheduleModalProps {
  appointment: Appointment;
  doctors: Doctor[];
  onClose: () => void;
  onRescheduled: () => void;
}

function RescheduleModal({ appointment, doctors, onClose, onRescheduled }: RescheduleModalProps) {
  const [newDate, setNewDate]     = useState(appointment.appt_date);
  const [newTime, setNewTime]     = useState(appointment.appt_time ?? '');
  const [newDoctorId, setNewDoctorId] = useState(String(appointment.doctor_id ?? ''));
  const { t } = useTranslation(['appointments', 'common']);

  const rescheduleMutation = useApiMutation<unknown, unknown>(
    'put',
    `/api/appointments/${appointment.id}`,
    {
      onSuccess: () => {
        toast.success(t('appointments.rescheduled', { defaultValue: 'Appointment rescheduled' }));
        onRescheduled();
        onClose();
      },
      onError: (err) => {
        toast.error(err.message || t('toast.failed_to_reschedule'));
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    rescheduleMutation.mutate({
      status: 'scheduled',
      apptDate: newDate,
      apptTime: newTime || undefined,
      doctorId: newDoctorId ? Number(newDoctorId) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-5 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('rescheduleAppointment', { defaultValue: 'Reschedule Appointment' })}</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            {appointment.patient_name} · {appointment.appt_no}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('newDate', { defaultValue: 'New Date' })} *</label>
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="input w-full" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('time')} (opt.)</label>
              <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} className="input w-full" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('doctor')}</label>
              <select value={newDoctorId} onChange={e => setNewDoctorId(e.target.value)} className="input w-full">
                <option value="">— {t('walkIn')} —</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` (${d.specialty})` : ''}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common:cancel')}</button>
            <button type="submit" disabled={rescheduleMutation.isPending} className="btn-primary flex-1">
              {rescheduleMutation.isPending ? t('saving', { defaultValue: 'Saving...' }) : t('reschedule')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AppointmentScheduler({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t } = useTranslation(['appointments', 'common']);
  const queryClient = useQueryClient();
  const showAdvancedAppointmentActions = true;
  const [selectedDate, setSelectedDate]     = useState(isoToday());
  const [filterDoctorId, setFilterDoctorId] = useState('');
  const [filterStatus, setFilterStatus]     = useState('');
  const [showBook, setShowBook]             = useState(false);
  const [rescheduleAppt, setRescheduleAppt] = useState<Appointment | null>(null);
  const [appointmentBenefitDrafts, setAppointmentBenefitDrafts] = useState<Record<number, AppointmentBenefitDraft>>({});

  const filters = useMemo(() => ({
    date: selectedDate,
    doctorId: filterDoctorId,
    status: filterStatus,
  }), [selectedDate, filterDoctorId, filterStatus]);

  const buildApptUrl = () => {
    const params = new URLSearchParams({ date: selectedDate });
    if (filterDoctorId) params.set('doctorId', filterDoctorId);
    if (filterStatus)   params.set('status',   filterStatus);
    return `/api/appointments?${params}`;
  };

  const { data: apptData, isLoading: loadingAppts } = useApiQuery<AppointmentsResponse>(
    queryKeys.appointments.list(filters),
    buildApptUrl(),
  );

  const { data: docData } = useApiQuery<DoctorsResponse>(
    [...queryKeys.doctors.list(), role, selectedDate],
    role === 'reception' ? `/api/reception/doctors/today?date=${selectedDate}` : '/api/doctors',
  );

  const appointments = useMemo(
    () => [...(apptData?.appointments ?? [])].sort(compareAppointmentsNewestFirst),
    [apptData?.appointments],
  );
  const doctors = role === 'reception'
    ? (docData?.doctors ?? []).filter((doctor: any) => Number(doctor.is_available ?? 1) === 1)
    : (docData?.doctors ?? []);
  const loading = loadingAppts;

  const statusMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    (vars) => `/api/appointments/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('appointments.status_updated'));
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
      },
      onError: () => {
        toast.error(t('appointments.failed_to_update'));
      },
    },
  );

  const checkInMutation = useApiMutation<{ visitId: number; visitNo: string; consultationFee: number }, number>(
    'post',
    (apptId) => `/api/appointments/${apptId}/check-in`,
    {
      onSuccess: (data) => {
        const fee = data.consultationFee ? ` (৳${appointmentConsultationFeeAmount(data.consultationFee)})` : '';
        toast.success(t('toast.checked_in', { visitNo: data.visitNo, fee }));
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
      },
      onError: (err) => {
        toast.error(err.message || t('toast.failed_to_check_in'));
      },
    },
  );

  const payNowMutation = useApiMutation<
    { invoiceNo?: string; receiptNo?: string; total?: number },
    {
      id: number;
      paymentMethod: string;
      idempotencyKey: string;
      schemeApplication?: { schemeId?: number; schemeCode?: string; memberCode?: string; memberId?: number; serviceCategory?: string; allocationType?: string; suggestedDiscount?: number };
    }
  >(
    'post',
    (vars) => `/api/appointments/${vars.id}/pay-now`,
    {
      onSuccess: (data) => {
        const invoice = data.invoiceNo ? ` ${data.invoiceNo}` : '';
        toast.success(t('toast.consultation_fee_paid', { invoice }));
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
      },
      onError: (err) => { toast.error(err.message || t('toast.failed_to_collect_payment')); },
    },
  );

  const checkAppointmentSchemePreviewMutation = useApiMutation<
    SchemePreviewResponse,
    { appointmentId: number; patient_id?: number; scheme_code?: string; member_code?: string; service_category?: string; subtotal: number }
  >(
    'post',
    '/api/billing-master/apply-scheme-preview',
    {
      onSuccess: (preview, variables) => {
        setAppointmentBenefitDrafts((current) => ({
          ...current,
          [variables.appointmentId]: {
            schemeCode: current[variables.appointmentId]?.schemeCode ?? variables.scheme_code ?? '',
            memberCode: current[variables.appointmentId]?.memberCode ?? variables.member_code ?? '',
            preview,
          },
        }));
        if (preview.eligible) toast.success(`Eligible: ${preview.scheme_name ?? 'scheme'} benefit`);
        else toast.error(preview.blockers?.[0] ?? 'Scheme is not eligible.');
      },
      onError: (err) => { toast.error(err.message || 'Failed to check appointment benefit'); },
    },
  );

  const sendToCounterMutation = useApiMutation<
    { billingStatus: string; consultationFee?: number },
    { id: number }
  >(
    'post',
    (vars) => `/api/appointments/${vars.id}/send-to-counter`,
    {
      onSuccess: () => {
        toast.success(t('toast.sent_to_billing'));
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
      },
      onError: (err) => { toast.error(err.message || t('toast.failed_to_send_to_billing')); },
    },
  );

  const approveDueMutation = useApiMutation<
    { invoiceNo?: string; billingStatus: string },
    { id: number; remarks: string }
  >(
    'post',
    (vars) => `/api/appointments/${vars.id}/due-approval`,
    {
      onSuccess: () => {
        toast.success(t('toast.due_approved'));
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
      },
      onError: (err) => { toast.error(err.message || t('toast.failed_to_approve_due')); },
    },
  );

  const reminderMutation = useApiMutation<unknown, unknown>(
    'post',
    '/api/notifications/appointment',
    {
      onSuccess: () => {
        toast.success(t('reminderSent', { defaultValue: 'Reminder sent' }));
      },
      onError: () => {
        toast.error(t('reminderFailed', { defaultValue: 'Failed to send reminder' }));
      },
    },
  );

  const sendReminder = (appt: Appointment) => {
    reminderMutation.mutate({
      patientName: appt.patient_name,
      patientPhone: appt.patient_mobile || undefined,
      doctorName: appt.doctor_name || 'Doctor',
      appointmentDate: appt.appt_date,
      appointmentTime: appt.appt_time || '—',
      channel: 'both',
    });
  };

  const updateStatus = (id: number, status: string) => {
    statusMutation.mutate({ id, status });
  };

  const handleBooked = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
  };

  // Daily stats
  const stats = {
    total:     appointments.length,
    scheduled: appointments.filter(a => a.status === 'scheduled').length,
    completed: appointments.filter(a => a.status === 'completed').length,
    noShow:    appointments.filter(a => a.status === 'no_show').length,
  };

  const basePath = `/h/${slug}`;

  return (
    <DashboardLayout role={role}>
      {showBook && (
        <BookModal
          date={selectedDate}
          doctors={doctors}
          onClose={() => setShowBook(false)}
          onBooked={handleBooked}
        />
      )}
      {rescheduleAppt && (
        <RescheduleModal
          appointment={rescheduleAppt}
          doctors={doctors}
          onClose={() => setRescheduleAppt(null)}
          onRescheduled={handleBooked}
        />
      )}

      <div className="space-y-4">
        {role === 'reception' ? <ReceptionTopBar role={role} /> : null}

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{role === 'reception' ? t('page.opd_serial_title') : t('title', { defaultValue: 'Appointment Scheduler' })}</h1>
              {role === 'reception' ? <span className="badge badge-success">{t('page.registration_badge')}</span> : null}
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">{fmtDate(selectedDate)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowBook(true)} className="btn-primary self-start sm:self-auto">
              <Plus className="w-4 h-4" /> {t('bookAppointment', { defaultValue: 'Book Appointment' })}
            </button>
          </div>
        </div>

        {/* ── Date Nav ── */}
        <div className="card p-3 flex items-center gap-3">
          <button onClick={() => setSelectedDate(d => addDays(d, -1))} className="btn-secondary p-2">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="input flex-1 text-center font-medium"
          />
          <button onClick={() => setSelectedDate(d => addDays(d, +1))} className="btn-secondary p-2">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={() => setSelectedDate(isoToday())} className="btn-secondary text-sm px-3">
            {t('today')}
          </button>
        </div>

        {/* ── Stats Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: t('total'),     value: stats.total,     color: 'text-[var(--color-primary)]',  icon: <Calendar className="w-5 h-5" /> },
            { label: t('scheduled'), value: stats.scheduled, color: 'text-blue-600',                icon: <Clock className="w-5 h-5" /> },
            { label: t('completed'), value: stats.completed, color: 'text-emerald-600',             icon: <CheckCircle2 className="w-5 h-5" /> },
            { label: t('noShow'),   value: stats.noShow,    color: 'text-amber-600',               icon: <AlertCircle className="w-5 h-5" /> },
          ].map(s => (
            <div key={s.label} className="card p-4 flex items-center gap-3">
              <div className={s.color}>{s.icon}</div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="card p-3 flex flex-wrap gap-2">
          <select value={filterDoctorId} onChange={e => setFilterDoctorId(e.target.value)} className="input text-sm">
            <option value="">{t('allDoctors')}</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input text-sm">
            <option value="">{t('allStatuses')}</option>
            <option value="scheduled">{t('scheduled')}</option>
            <option value="checked_in">{t('checkedIn', { defaultValue: 'Checked In' })}</option>
            <option value="completed">{t('completed')}</option>
            <option value="no_show">{t('noShow')}</option>
            <option value="cancelled">{t('cancelled')}</option>
          </select>
        </div>

        {/* ── Appointment Queue ── */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-4">
              {[1,2,3].map(i => <div key={i} className="skeleton h-16 rounded-lg" />)}
            </div>
          ) : appointments.length === 0 ? (
            <div className="py-16 text-center">
              <Calendar className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-3" />
              <p className="text-[var(--color-text-muted)]">{t('noAppointmentsForDate')}</p>
              <button onClick={() => setShowBook(true)} className="btn-primary mt-4">
                <Plus className="w-4 h-4" /> {t('bookFirstAppointment')}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {appointments.map(appt => {
                const billingStatus = appointmentBillingStatus(appt);
                const billingClass = BILLING_STATUS_STYLE[billingStatus] ?? 'bg-slate-50 text-slate-700 border-slate-200';
                const requiresPayment = appointmentConsultationFeeAmount(appt.fee) > 0 && !canEnterDoctorQueue(appt);
                const canApproveDue = ['hospital_admin', 'md', 'director', 'accountant'].includes(role);
                const appointmentType = appt.appointment_type ?? (appt.visit_type === 'emergency' ? 'emergency' : appt.visit_type === 'followup' ? 'follow_up' : 'new_patient');
                const originalFee = appointmentConsultationFeeAmount(appt.original_fee ?? appt.fee);
                const discountAmount = appointmentConsultationFeeAmount(appt.discount_amount ?? 0);
                const finalFee = appointmentConsultationFeeAmount(appt.final_fee ?? appt.fee);
                return (
                <div key={appt.id} className={`flex flex-col gap-3 p-4 transition-colors hover:bg-[var(--color-bg-secondary)] ${appt.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-4 w-full">
                    {/* Left: Token Badge + Patient Info */}
                    <div className="flex items-start gap-4 min-w-0 flex-1">
                      {/* Token Badge */}
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-[var(--color-bg-secondary)] flex flex-col items-center justify-center border border-[var(--color-border)]">
                        <Hash className="w-3 h-3 text-[var(--color-text-muted)]" />
                        <span className="text-lg font-bold text-[var(--color-primary)] leading-none">{appt.token_no}</span>
                      </div>

                      {/* Patient Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-[var(--color-text-primary)] text-base">{appt.patient_name}</span>
                          <span className="text-xs text-[var(--color-text-muted)]">{appt.patient_code}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${VISIT_BADGE[appt.visit_type]}`}>
                            {appt.visit_type === 'opd' ? t('opd') : appt.visit_type === 'followup' ? t('followUp') : `🚨 ${t('emergency')}`}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                            {t(`type.${appointmentType}`)}
                          </span>
                          {appt.source && appt.source !== 'scheduled' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">
                              {t(`source.${appt.source}`)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-sm text-[var(--color-text-muted)] flex-wrap">
                          {appt.doctor_name && (
                            <span className="flex items-center gap-1">
                              <Stethoscope className="w-3.5 h-3.5" /> {appt.doctor_name}
                            </span>
                          )}
                          {appt.appt_time && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" /> {appt.appt_time}
                            </span>
                          )}
                          {appt.chief_complaint && (
                            <span className="italic truncate max-w-[200px]">"{appt.chief_complaint}"</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Status + Fee details */}
                    <div className="flex-shrink-0 flex flex-col items-end gap-1.5 text-right">
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <span className={`flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full border font-medium ${STATUS_STYLE[appt.status]}`}>
                          {STATUS_ICON[appt.status]} {t(appt.status)}
                        </span>
                        <span className={`flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full border font-medium ${billingClass}`}>
                          <CreditCard className="w-3.5 h-3.5" /> {t(`billing_status.${billingStatus}`)}
                        </span>
                      </div>
                      <span className="text-xs text-[var(--color-text-muted)] mt-0.5 block">
                        ৳{finalFee}{discountAmount > 0 ? ` (${t('fee.discount_info', { discount: discountAmount, original: originalFee })})` : ''}
                      </span>
                      {/* Link to patient detail */}
                      <Link
                        to={`${basePath}/${role === 'reception' ? 'reception/' : ''}patients/${appt.patient_id}`}
                        className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-0.5 mt-1">
                        {t('viewPatient')} <ChevronRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>

                  {/* Action buttons bottom row */}
                  {(appt.status === 'scheduled' || appt.status === 'checked_in' || appt.status === 'no_show') && (
                    <div className="flex flex-wrap gap-1.5 pt-2 mt-1 border-t border-[var(--color-border-light)] w-full">
                      {requiresPayment && appt.status === 'scheduled' && (
                        <>
                          {(() => {
                            const draft = appointmentBenefitDrafts[appt.id] ?? { schemeCode: '', memberCode: '', preview: null };
                            const preview = draft.preview;
                            const suggested = Math.min(Number(preview?.suggested_discount ?? 0), Number(finalFee ?? 0));
                            return (
                              <div className="flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-[var(--color-border-light)] bg-[var(--color-bg-secondary)] px-2 py-2 text-[11px]">
                                <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / Benefit</span>
                                <input className="input h-7 w-28 text-xs" value={draft.schemeCode} onChange={(event) => setAppointmentBenefitDrafts((current) => ({ ...current, [appt.id]: { ...(current[appt.id] ?? { schemeCode: '', memberCode: '', preview: null }), schemeCode: event.target.value, preview: null } }))} placeholder="Scheme code" />
                                <input className="input h-7 w-28 text-xs" value={draft.memberCode} onChange={(event) => setAppointmentBenefitDrafts((current) => ({ ...current, [appt.id]: { ...(current[appt.id] ?? { schemeCode: '', memberCode: '', preview: null }), memberCode: event.target.value, preview: null } }))} placeholder="Member code" />
                                <button type="button" className="btn-secondary h-7 px-2 text-xs" disabled={checkAppointmentSchemePreviewMutation.isPending || (!draft.schemeCode.trim() && !draft.memberCode.trim()) || Number(finalFee ?? 0) <= 0} onClick={() => checkAppointmentSchemePreviewMutation.mutate({ appointmentId: appt.id, patient_id: appt.patient_id, scheme_code: draft.schemeCode.trim() || undefined, member_code: draft.memberCode.trim() || undefined, service_category: 'appointment_payment', subtotal: Number(finalFee ?? 0) })}>{checkAppointmentSchemePreviewMutation.isPending ? 'Checking…' : 'Check'}</button>
                                <span className="text-[var(--color-text-muted)]">{preview?.eligible ? `${preview.scheme_name ?? 'Scheme'} · ৳${appointmentConsultationFeeAmount(suggested)}` : preview?.blockers?.join(', ') || 'Optional: leave empty for normal Pay Now.'}</span>
                              </div>
                            );
                          })()}
                          <button
                            onClick={() => {
                              const preview = appointmentBenefitDrafts[appt.id]?.preview;
                              const draft = appointmentBenefitDrafts[appt.id];
                              payNowMutation.mutate({
                                id: appt.id,
                                paymentMethod: 'cash',
                                schemeApplication: preview?.eligible && Number(preview.suggested_discount ?? 0) > 0 ? {
                                  schemeId: preview.scheme_id ?? undefined,
                                  schemeCode: (preview.scheme_code ?? draft?.schemeCode?.trim()) || undefined,
                                  memberCode: (preview.matched_member_code ?? draft?.memberCode?.trim()) || undefined,
                                  memberId: preview.matched_member_id ?? undefined,
                                  serviceCategory: preview.service_category ?? 'appointment_payment',
                                  allocationType: preview.allocation_type,
                                  suggestedDiscount: preview.suggested_discount,
                                } : undefined,
                                idempotencyKey: newAppointmentPaymentAttemptKey(appt.id),
                              });
                            }}
                            disabled={payNowMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-[var(--color-primary)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm">
                            <CreditCard className="w-3.5 h-3.5" />
                            {t('payNow', { defaultValue: 'Pay Now' })}
                          </button>
                          {showAdvancedAppointmentActions && <button
                            onClick={() => sendToCounterMutation.mutate({ id: appt.id })}
                            disabled={sendToCounterMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                            <Send className="w-3.5 h-3.5" />
                            {t('btn.send_to_billing')}
                          </button>}
                          {showAdvancedAppointmentActions && canApproveDue && (
                            <button
                              onClick={() => approveDueMutation.mutate({ id: appt.id, remarks: 'Approved from appointment scheduler' })}
                              disabled={approveDueMutation.isPending}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                              <Check className="w-3.5 h-3.5" />
                              {t('btn.approve_due')}
                            </button>
                          )}
                        </>
                      )}
                      {showAdvancedAppointmentActions && appt.status === 'scheduled' && (
                        <button
                          onClick={() => checkInMutation.mutate(appt.id)}
                          disabled={checkInMutation.isPending || requiresPayment}
                          title={requiresPayment ? t('tooltip.collect_payment_before_queue') : undefined}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-all shadow-sm ${requiresPayment ? 'text-slate-400 bg-slate-100 border-slate-200 cursor-not-allowed' : 'text-white bg-teal-500 border-teal-600 hover:bg-teal-600'}`}>
                          <LogIn className="w-3.5 h-3.5" />
                          {t('checkIn', { defaultValue: 'Check In' })}
                        </button>
                      )}
                      {(appt.status === 'scheduled' || appt.status === 'checked_in') && (
                        <button
                          onClick={() => updateStatus(appt.id, 'completed')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-all">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t('markCompleted')}
                        </button>
                      )}
                      {appt.status === 'scheduled' && (
                        <button
                          onClick={() => {
                            if (window.confirm(t('confirmNoShow'))) updateStatus(appt.id, 'no_show');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 transition-all">
                          <AlertCircle className="w-3.5 h-3.5" />
                          {t('markNoShow')}
                        </button>
                      )}
                      {showAdvancedAppointmentActions && (appt.status === 'scheduled' || appt.status === 'no_show') && (
                        <button
                          onClick={() => setRescheduleAppt(appt)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-all">
                          <CalendarClock className="w-3.5 h-3.5" />
                          {t('reschedule')}
                        </button>
                      )}
                      {showAdvancedAppointmentActions && appt.status === 'scheduled' && (
                        <button
                          onClick={() => sendReminder(appt)}
                          disabled={reminderMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 hover:border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                          <Bell className="w-3.5 h-3.5" />
                          {t('sendReminder', { defaultValue: 'Remind' })}
                        </button>
                      )}
                      {showAdvancedAppointmentActions && appt.status === 'scheduled' && (
                        <button
                          onClick={() => {
                            if (window.confirm(t('confirmCancel'))) updateStatus(appt.id, 'cancelled');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 transition-all">
                          <XCircle className="w-3.5 h-3.5" />
                          {t('cancelAppointment')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );})}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
