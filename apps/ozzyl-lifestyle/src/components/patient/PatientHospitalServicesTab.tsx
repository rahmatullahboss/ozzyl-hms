import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  FileText,
  FlaskConical,
  History,
  Loader2,
  MessageSquare,
  Receipt,
  Send,
  Star,
  Stethoscope,
  Syringe,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  buildPatientAppointmentBookingGuard,
  buildPatientAppointmentMvpState,
  buildPatientPrescriptionActionState,
  buildPatientTenantPortalPath,
  formatPatientDateMonthYear,
  formatPatientDateTimeMonthYear,
  normalizePatientLiveVisitSummary,
  normalizePatientHospitalRecordSnapshot,
  normalizePatientClinicalDataForDisplay,
  PATIENT_SELECTED_HOSPITAL_STORAGE_KEY,
  type PatientLiveVisitSummary,
} from '../../lib/patientPortalUx';

interface LinkedHospital {
  tenantId: string;
  patientId: number;
  hospitalName: string;
}

interface HospitalSnapshot {
  nextAppointment?: {
    id?: number;
    appt_date?: string;
    appt_time?: string | null;
    doctor_name?: string | null;
    chief_complaint?: string | null;
  } | null;
  latestLabResult?: {
    id?: number;
    order_no?: string | null;
    created_at?: string;
    status?: string | null;
    test_names?: string | null;
  } | null;
  activePrescriptions: number;
  billing: {
    totalDue: number;
    totalPaid: number;
    totalBilled: number;
  };
  totalVisits: number;
}

interface DoctorOption {
  id: number;
  name: string;
  specialty: string | null;
  consultation_fee: number | null;
}

interface AppointmentSlotResponse {
  doctorId?: number;
  date?: string;
  bookedCount?: number;
  bookedSlots?: Array<{ appt_time?: string | null; token_no?: number | string | null }>;
  bookedTimes?: string[];
  availableSlots?: Array<{ time?: string | null; label?: string | null; chamber?: string | null; sessionType?: string | null }>;
  hasSchedule?: boolean;
  canRequestTime?: boolean;
}

interface PrescriptionDetailResponse {
  prescription?: Record<string, any> | null;
  items?: Array<Record<string, any>>;
  actions?: {
    detail_url?: string;
    items_url?: string;
    pdf_url?: string;
    refill_url?: string;
    share_text?: string;
  };
}

interface LabResultDetailResponse {
  order?: Record<string, any> | null;
  items?: Array<Record<string, any>>;
  actions?: {
    pdf_url?: string;
    share_text?: string;
  };
}

interface BillDetailResponse {
  bill?: Record<string, any> | null;
  actions?: {
    receipt_url?: string | null;
    payment_enabled?: boolean;
    payment_message?: string;
  };
}

function formatDate(value: string | null | undefined, _lang: string) {
  return formatPatientDateMonthYear(value, 'N/A');
}

function formatDateTime(value: string | null | undefined, _lang: string) {
  return formatPatientDateTimeMonthYear(value, 'N/A');
}

function formatMoney(value: number | null | undefined) {
  return `৳${Math.round(value ?? 0)}`;
}

function getStatusToneClass(tone: 'slate' | 'amber' | 'cyan' | 'blue' | 'emerald' | 'rose') {
  if (tone === 'amber') return 'bg-amber-50 text-amber-700 border-amber-100';
  if (tone === 'cyan') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (tone === 'blue') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (tone === 'emerald') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (tone === 'rose') return 'bg-rose-50 text-rose-700 border-rose-100';
  return 'bg-slate-50 text-slate-700 border-slate-100';
}

async function fetchPortalJson<T>(path: string, tenantId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'X-Tenant-ID': tenantId,
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { message?: string; error?: string }).message || (data as { error?: string }).error || 'Portal request failed');
  }

  return data as T;
}

export default function PatientHospitalServicesTab() {
  const { t, i18n } = useTranslation(['patients', 'patientPortal']);
  const lang = i18n.language;
  const [hospitals, setHospitals] = useState<LinkedHospital[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'appointment' | 'message' | 'review' | null>(null);
  const [snapshot, setSnapshot] = useState<HospitalSnapshot | null>(null);
  const [liveVisit, setLiveVisit] = useState<PatientLiveVisitSummary | null>(null);
  const [records, setRecords] = useState(() => normalizePatientHospitalRecordSnapshot({}));
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [appointmentForm, setAppointmentForm] = useState({
    doctorId: '',
    apptDate: '',
    apptTime: '',
    chiefComplaint: '',
  });
  const [messageForm, setMessageForm] = useState({
    doctorId: '',
    message: '',
  });
  const [reviewForm, setReviewForm] = useState({
    rating: '5',
    reviewText: '',
  });
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | string | null>(null);
  const [cancelingAppointmentId, setCancelingAppointmentId] = useState<number | string | null>(null);
  const [appointmentSlots, setAppointmentSlots] = useState<AppointmentSlotResponse | null>(null);
  const [loadingAppointmentSlots, setLoadingAppointmentSlots] = useState(false);
  const [selectedPrescriptionDetail, setSelectedPrescriptionDetail] = useState<PrescriptionDetailResponse | null>(null);
  const [loadingPrescriptionDetailId, setLoadingPrescriptionDetailId] = useState<number | string | null>(null);
  const [selectedLabResultDetail, setSelectedLabResultDetail] = useState<LabResultDetailResponse | null>(null);
  const [loadingLabResultDetailId, setLoadingLabResultDetailId] = useState<number | string | null>(null);
  const [selectedBillDetail, setSelectedBillDetail] = useState<BillDetailResponse | null>(null);
  const [loadingBillDetailId, setLoadingBillDetailId] = useState<number | string | null>(null);
  const [refillSubmittingId, setRefillSubmittingId] = useState<number | null>(null);

  const selectedHospital = useMemo(
    () => hospitals.find((hospital) => hospital.tenantId === selectedTenantId) ?? null,
    [hospitals, selectedTenantId],
  );
  const selectedAppointment = useMemo(
    () => records.appointments.find((appointment: any) => String(appointment.id) === String(selectedAppointmentId)) ?? records.appointments[0] ?? null,
    [records.appointments, selectedAppointmentId],
  );
  const selectedAppointmentState = useMemo(
    () => selectedAppointment ? buildPatientAppointmentMvpState(selectedAppointment) : null,
    [selectedAppointment],
  );
  const appointmentBookingGuard = useMemo(
    () => buildPatientAppointmentBookingGuard(appointmentSlots, appointmentForm.apptTime),
    [appointmentForm.apptTime, appointmentSlots],
  );

  useEffect(() => {
    let mounted = true;

    async function loadHospitals() {
      try {
        const response = await fetch('/api/global-portal/hospitals', { credentials: 'include' });
        const data = await response.json() as { hospitals?: Array<{ tenantId: string; patientId: number; hospitalName: string }> };
        if (!response.ok) {
          throw new Error(t('patientPortal:hospitalServices.linkedHospitalsLoadFailed'));
        }

        const nextHospitals = data.hospitals ?? [];
        if (!mounted) return;
        setHospitals(nextHospitals);

        const saved = window.sessionStorage.getItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY);
        const candidate = nextHospitals.some((item) => item.tenantId === saved) ? saved ?? '' : '';
        if (saved && !candidate) {
          window.sessionStorage.removeItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY);
        }
        setSelectedTenantId(candidate);
      } catch (error) {
        if (!mounted) return;
        toast.error(error instanceof Error ? error.message : t('hospitalServices.hospitalListLoadFailed'));
      }
    }

    void loadHospitals();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTenantId || !appointmentForm.doctorId || !appointmentForm.apptDate) {
      setAppointmentSlots(null);
      setLoadingAppointmentSlots(false);
      return;
    }

    let mounted = true;
    async function loadAppointmentSlots() {
      setLoadingAppointmentSlots(true);
      try {
        const data = await fetchPortalJson<AppointmentSlotResponse>(
          `${buildPatientTenantPortalPath(`/available-slots/${appointmentForm.doctorId}`)}?date=${encodeURIComponent(appointmentForm.apptDate)}`,
          selectedTenantId,
        );
        if (mounted) {
          setAppointmentSlots(data);
          setAppointmentForm((current) => {
            const availableTimes = (data.availableSlots ?? [])
              .map((slot) => slot.time)
              .filter((time): time is string => Boolean(time));
            if (availableTimes.length === 0) return current;
            if (current.apptTime && availableTimes.includes(current.apptTime)) return current;
            return { ...current, apptTime: availableTimes[0] ?? '' };
          });
        }
      } catch (error) {
        if (mounted) {
          setAppointmentSlots(null);
          toast.error(error instanceof Error ? error.message : 'Could not check appointment slots');
        }
      } finally {
        if (mounted) setLoadingAppointmentSlots(false);
      }
    }

    void loadAppointmentSlots();

    return () => {
      mounted = false;
    };
  }, [appointmentForm.apptDate, appointmentForm.doctorId, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId) return;

    const interval = window.setInterval(() => {
      setRefreshKey((current) => current + 1);
    }, 20_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [selectedTenantId]);

  useEffect(() => {
    let mounted = true;
    if (!selectedTenantId) {
      setLoading(false);
      setSnapshot(null);
      setLiveVisit(null);
      setDoctors([]);
      setRecords(normalizePatientHospitalRecordSnapshot({}));
      setSelectedAppointmentId(null);
      setSelectedPrescriptionDetail(null);
      setLoadingPrescriptionDetailId(null);
      setSelectedLabResultDetail(null);
      setLoadingLabResultDetailId(null);
      setSelectedBillDetail(null);
      setLoadingBillDetailId(null);
      return;
    }

    window.sessionStorage.setItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY, selectedTenantId);

    async function loadHospitalServices() {
      setLoading(true);
      try {
        const [
          dashboardData,
          liveVisitData,
          appointmentsData,
          prescriptionsData,
          labData,
          billsData,
          timelineData,
          refillData,
          documentData,
          diagnosisData,
          messageData,
          reviewData,
          doctorData,
        ] = await Promise.all([
          fetchPortalJson<HospitalSnapshot>(buildPatientTenantPortalPath('/dashboard'), selectedTenantId),
          fetchPortalJson<{ live_visit: PatientLiveVisitSummary | null }>(buildPatientTenantPortalPath('/live-visit-status'), selectedTenantId),
          fetchPortalJson<{ data?: any[] }>(`${buildPatientTenantPortalPath('/appointments')}?limit=5`, selectedTenantId),
          fetchPortalJson<{ data?: any[] }>(`${buildPatientTenantPortalPath('/prescriptions')}?limit=5`, selectedTenantId),
          fetchPortalJson<{ data?: any[] }>(`${buildPatientTenantPortalPath('/lab-results')}?limit=5`, selectedTenantId),
          fetchPortalJson<{ data?: any[] }>(`${buildPatientTenantPortalPath('/bills')}?limit=5`, selectedTenantId),
          fetchPortalJson<{ data?: any[] }>(`${buildPatientTenantPortalPath('/timeline')}?limit=6`, selectedTenantId),
          fetchPortalJson<{ data?: any[] }>(`${buildPatientTenantPortalPath('/refill-requests')}?limit=5`, selectedTenantId),
          fetchPortalJson<{ data?: any[] }>(`${buildPatientTenantPortalPath('/documents')}?limit=5`, selectedTenantId),
          fetchPortalJson<{ data?: any[] }>(`${buildPatientTenantPortalPath('/diagnoses')}?limit=5`, selectedTenantId),
          fetchPortalJson<{ conversations?: any[] }>(buildPatientTenantPortalPath('/messages'), selectedTenantId),
          fetchPortalJson<{ data?: any[] }>(buildPatientTenantPortalPath('/reviews/mine'), selectedTenantId),
          fetchPortalJson<{ doctors?: DoctorOption[] }>(buildPatientTenantPortalPath('/available-doctors'), selectedTenantId),
        ]);

        if (!mounted) return;

        const clinicalData = normalizePatientClinicalDataForDisplay({
          appointments: appointmentsData.data ?? [],
          prescriptions: prescriptionsData.data ?? [],
          labResults: labData.data ?? [],
          bills: billsData.data ?? [],
        });

        setSnapshot(dashboardData);
        setLiveVisit(normalizePatientLiveVisitSummary(liveVisitData.live_visit));
        setDoctors(doctorData.doctors ?? []);
        setSelectedAppointmentId((current) => {
          if (current && clinicalData.appointments.some((appointment) => String(appointment.id) === String(current))) return current;
          const firstAppointmentId = clinicalData.appointments[0]?.id;
          return firstAppointmentId === undefined || firstAppointmentId === null ? null : String(firstAppointmentId);
        });
        setRecords(normalizePatientHospitalRecordSnapshot({
          selectedHospital: selectedHospital
            ? { tenantId: selectedHospital.tenantId, hospitalName: selectedHospital.hospitalName }
            : { tenantId: selectedTenantId, hospitalName: 'Selected Hospital' },
          appointments: clinicalData.appointments,
          prescriptions: clinicalData.prescriptions,
          labResults: clinicalData.labResults,
          bills: clinicalData.bills,
          timeline: timelineData.data ?? [],
          refillRequests: refillData.data ?? [],
          documents: documentData.data ?? [],
          diagnoses: diagnosisData.data ?? [],
          conversations: messageData.conversations ?? [],
          reviews: reviewData.data ?? [],
        }));

        if (!(appointmentForm.doctorId || messageForm.doctorId) && (doctorData.doctors?.[0]?.id ?? 0) > 0) {
          const firstDoctorId = String(doctorData.doctors?.[0]?.id);
          setAppointmentForm((current) => ({ ...current, doctorId: current.doctorId || firstDoctorId }));
          setMessageForm((current) => ({ ...current, doctorId: current.doctorId || firstDoctorId }));
        }
      } catch (error) {
        if (!mounted) return;
        const errorMsg = error instanceof Error ? error.message : t('patientPortal:hospitalServices.hospitalDataLoadFailed');
        toast.error(errorMsg);
        setSnapshot(null);
        setLiveVisit(null);
        setRecords(normalizePatientHospitalRecordSnapshot({
          selectedHospital: selectedHospital
            ? { tenantId: selectedHospital.tenantId, hospitalName: selectedHospital.hospitalName }
            : null,
        }));
        setSelectedAppointmentId(null);
        setSelectedPrescriptionDetail(null);
        setSelectedLabResultDetail(null);
        setSelectedBillDetail(null);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadHospitalServices();

    return () => {
      mounted = false;
    };
  }, [selectedTenantId, selectedHospital, refreshKey]);

  async function handleBookAppointment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenantId) return;
    if (loadingAppointmentSlots) {
      toast.error('Please wait while appointment slots are checked.');
      return;
    }
    if (!appointmentBookingGuard.canSubmit) {
      toast.error(appointmentBookingGuard.message);
      return;
    }
    setSubmitting('appointment');
    try {
      await fetchPortalJson(buildPatientTenantPortalPath('/book-appointment'), selectedTenantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: Number(appointmentForm.doctorId),
          apptDate: appointmentForm.apptDate,
          apptTime: appointmentForm.apptTime || undefined,
          chiefComplaint: appointmentForm.chiefComplaint || undefined,
        }),
      });
      toast.success(t('hospitalServices.appointmentRequested'));
      setAppointmentForm((current) => ({ ...current, apptDate: '', apptTime: '', chiefComplaint: '' }));
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('hospitalServices.appointmentRequestFailed'));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleCancelAppointment(appointmentId: number | string | null) {
    if (!selectedTenantId || appointmentId === null) return;
    if (!window.confirm('Cancel this appointment request?')) return;
    setCancelingAppointmentId(appointmentId);
    try {
      await fetchPortalJson(buildPatientTenantPortalPath(`/cancel-appointment/${appointmentId}`), selectedTenantId, {
        method: 'POST',
      });
      toast.success('Appointment cancelled');
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not cancel appointment');
    } finally {
      setCancelingAppointmentId(null);
    }
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenantId) return;
    setSubmitting('message');
    try {
      await fetchPortalJson(buildPatientTenantPortalPath('/messages'), selectedTenantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: Number(messageForm.doctorId),
          message: messageForm.message,
        }),
      });
      toast.success(t('hospitalServices.messageSent'));
      setMessageForm((current) => ({ ...current, message: '' }));
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('hospitalServices.messageSendFailed'));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleSubmitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenantId) return;
    setSubmitting('review');
    try {
      await fetchPortalJson(buildPatientTenantPortalPath('/reviews'), selectedTenantId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: Number(reviewForm.rating),
          review_text: reviewForm.reviewText || undefined,
        }),
      });
      toast.success(t('hospitalServices.reviewSubmitted'));
      setReviewForm({ rating: '5', reviewText: '' });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('hospitalServices.reviewSubmitFailed'));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleOpenPrescriptionDetail(prescription: any) {
    const state = buildPatientPrescriptionActionState(prescription);
    if (!selectedTenantId || state.id === null) return;
    setLoadingPrescriptionDetailId(state.id);
    try {
      const detail = await fetchPortalJson<PrescriptionDetailResponse>(state.detailPath, selectedTenantId);
      setSelectedPrescriptionDetail({
        prescription: detail.prescription ?? prescription,
        items: detail.items ?? [],
        actions: detail.actions ?? {
          detail_url: state.detailPath,
          items_url: state.itemsPath,
          pdf_url: state.pdfPath,
          refill_url: state.refillPath,
          share_text: state.shareText,
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load prescription detail');
    } finally {
      setLoadingPrescriptionDetailId(null);
    }
  }

  async function handleSharePrescription(state: ReturnType<typeof buildPatientPrescriptionActionState>) {
    const shareText = state.shareText;
    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator && typeof navigator.share === 'function') {
        await navigator.share({ title: state.title, text: shareText });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        toast.success('Prescription share text copied');
      } else {
        toast.error('Sharing is not supported on this device');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not share prescription');
    }
  }

  async function handleOpenLabResultDetail(lab: any) {
    if (!selectedTenantId || lab?.id === undefined || lab?.id === null) return;
    setLoadingLabResultDetailId(lab.id);
    try {
      const detailPath = buildPatientTenantPortalPath(`/lab-results/${lab.id}`);
      const detail = await fetchPortalJson<LabResultDetailResponse>(detailPath, selectedTenantId);
      setSelectedLabResultDetail({
        order: detail.order ?? lab,
        items: detail.items ?? [],
        actions: detail.actions ?? {
          pdf_url: buildPatientTenantPortalPath(`/lab-results/${lab.id}/pdf`),
          share_text: 'Lab result ' + String(lab.order_no ?? lab.id),
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load lab result detail');
    } finally {
      setLoadingLabResultDetailId(null);
    }
  }

  async function handleShareLabResult(detail: LabResultDetailResponse) {
    const shareText = detail.actions?.share_text ?? 'Lab result';
    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator && typeof navigator.share === 'function') {
        await navigator.share({ title: 'Lab result', text: shareText });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        toast.success('Lab result share text copied');
      } else {
        toast.error('Sharing is not supported on this device');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not share lab result');
    }
  }

  async function handleOpenBillDetail(bill: any) {
    if (!selectedTenantId || bill?.id === undefined || bill?.id === null) return;
    setLoadingBillDetailId(bill.id);
    try {
      const detail = await fetchPortalJson<BillDetailResponse>(buildPatientTenantPortalPath(`/bills/${bill.id}`), selectedTenantId);
      setSelectedBillDetail({
        bill: detail.bill ?? bill,
        actions: detail.actions ?? {
          receipt_url: null,
          payment_enabled: false,
          payment_message: 'Online payment is coming soon. Please contact the billing counter.',
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load bill detail');
    } finally {
      setLoadingBillDetailId(null);
    }
  }

  async function handleRequestRefill(prescriptionId: number) {
    if (!selectedTenantId) return;
    setRefillSubmittingId(prescriptionId);
    try {
      await fetchPortalJson(buildPatientTenantPortalPath(`/prescriptions/${prescriptionId}/refill`), selectedTenantId, {
        method: 'POST',
      });
      toast.success(t('hospitalServices.refillRequested'));
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('hospitalServices.refillRequestFailed'));
    } finally {
      setRefillSubmittingId(null);
    }
  }

  if (hospitals.length === 0 && !loading) {
    return (
      <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t('patientPortal:hospitalServices.noHospitalsFound')}</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {t('patientPortal:hospitalServices.noHospitalsDescription')}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-[0_12px_40px_rgba(8,145,178,0.06)] border border-slate-100 space-y-8 animate-fade-in-up animate-in fade-in duration-500">
      {/* Header Area */}
      <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 sm:p-8 shadow-sm backdrop-blur-md relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-emerald-700/10 rounded-full blur-2xl"></div>
        <div className="absolute -left-12 -bottom-12 w-48 h-48 bg-teal-700/10 rounded-full blur-2xl"></div>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">{t('patientPortal:hospitalServices.eyebrow')}</p>
            <h2 className="mt-2 text-2xl sm:text-3xl font-bold font-manrope text-slate-900 dark:text-white">{t('patientPortal:hospitalServices.title')}</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-lg">
              {t('patientPortal:hospitalServices.description')}
            </p>
          </div>
          <select
            value={selectedTenantId}
            onChange={(event) => setSelectedTenantId(event.target.value)}
            className="min-w-[280px] rounded-2xl border-0 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm bg-white dark:bg-slate-900 px-5 py-4 text-sm font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            aria-label="Select verified hospital"
          >
            <option value="">Select a verified hospital</option>
            {hospitals.map((hospital) => (
              <option key={hospital.tenantId} value={hospital.tenantId}>
                {hospital.hospitalName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedTenantId ? (
        <div className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/70 p-8 text-center shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Select a hospital to continue</h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Choose a verified hospital above before appointments, prescriptions, lab reports, bills, or messages are loaded.
          </p>
        </div>
      ) : loading ? (
        <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-12 text-center backdrop-blur-md shadow-sm">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : (
        <>
          {liveVisit && (
            <section className="rounded-[1.5rem] border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-teal-50 p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">{t('hospitalServices.liveVisitTitle')}</p>
                  <h3 className="mt-2 text-2xl font-bold font-manrope text-slate-900">
                    {liveVisit.queue?.token_no
                      ? `${t('hospitalServices.tokenLabel')} ${liveVisit.queue.token_no}`
                      : t('hospitalServices.bookingActive')}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600">
                    {liveVisit.arrival_guidance?.label || t('hospitalServices.queueWaitingForActivation')}
                  </p>
                  {liveVisit.next_step_label && (
                    <p className="mt-2 text-xs font-medium text-emerald-800">
                      {liveVisit.next_step_label}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-2xl border border-white bg-white/80 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('hospitalServices.liveStatus')}</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{liveVisit.status}</p>
                  </div>
                  <div className="rounded-2xl border border-white bg-white/80 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('hospitalServices.currentServing')}</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{liveVisit.current_serving_token_no || t('hospitalServices.naShort')}</p>
                  </div>
                  <div className="rounded-2xl border border-white bg-white/80 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('hospitalServices.patientsAhead')}</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{liveVisit.patients_ahead ?? 0}</p>
                  </div>
                  <div className="rounded-2xl border border-white bg-white/80 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('hospitalServices.estimatedWait')}</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      {liveVisit.estimated_wait_minutes !== null && liveVisit.estimated_wait_minutes !== undefined
                        ? `${liveVisit.estimated_wait_minutes} ${t('hospitalServices.minutesShort')}`
                        : t('hospitalServices.naShort')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                {liveVisit.appointment?.appt_date && (
                  <span className="rounded-full bg-white px-3 py-1.5 font-semibold">
                    {t('hospitalServices.visitDate')}: {formatDate(liveVisit.appointment.appt_date, lang)} {liveVisit.appointment.appt_time ?? ''}
                  </span>
                )}
                {liveVisit.appointment?.doctor_name && (
                  <span className="rounded-full bg-white px-3 py-1.5 font-semibold">
                    {t('hospitalServices.doctorLabel')}: {liveVisit.appointment.doctor_name}
                  </span>
                )}
                {liveVisit.queue?.counter_no && (
                  <span className="rounded-full bg-white px-3 py-1.5 font-semibold">
                    {t('hospitalServices.counterLabel')}: {liveVisit.queue.counter_no}
                  </span>
                )}
                {liveVisit.visit?.status && (
                  <span className="rounded-full bg-white px-3 py-1.5 font-semibold">
                    {t('hospitalServices.checkInLabel')}: {liveVisit.visit.status}
                  </span>
                )}
                {liveVisit.last_updated_at && (
                  <span className="rounded-full bg-white px-3 py-1.5 font-semibold">
                    {t('hospitalServices.lastUpdated')}: {formatDateTime(liveVisit.last_updated_at, lang)}
                  </span>
                )}
              </div>
              {liveVisit.journey && liveVisit.journey.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t('hospitalServices.visitJourney')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {liveVisit.journey.map((step) => (
                      <span
                        key={step.key}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                          step.state === 'done'
                            ? 'bg-emerald-100 text-emerald-800'
                            : step.state === 'current'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-white text-slate-500'
                        }`}
                      >
                        {step.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Quick Stats Grid */}
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{t('hospitalServices.nextAppointment')}</p>
              <h3 className="mt-3 text-lg font-bold font-manrope text-slate-900 dark:text-white truncate">
                {snapshot?.nextAppointment?.doctor_name || t('hospitalServices.notBooked')}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                {snapshot?.nextAppointment?.appt_date ? `${formatDate(snapshot.nextAppointment.appt_date, lang)} ${snapshot.nextAppointment.appt_time ?? ''}` : t('hospitalServices.bookBelow')}
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{t('hospitalServices.labSummary')}</p>
              <h3 className="mt-3 text-lg font-bold font-manrope text-slate-900 dark:text-white truncate">
                {snapshot?.latestLabResult?.order_no || t('hospitalServices.noRecentLab')}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                {snapshot?.latestLabResult?.test_names || t('hospitalServices.latestTestResults')}
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{t('hospitalServices.activeRx')}</p>
              <h3 className="mt-3 text-3xl font-bold font-manrope text-slate-900 dark:text-white">{snapshot?.activePrescriptions ?? 0}</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('hospitalServices.prescriptionsAvailable')}</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{t('hospitalServices.outstandingDue')}</p>
              <h3 className="mt-3 text-3xl font-bold font-manrope text-slate-900 dark:text-white">{formatMoney(snapshot?.billing?.totalDue)}</h3>
              <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {t('hospitalServices.totalPaid')}: {formatMoney(snapshot?.billing?.totalPaid)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('hospitalServices.totalBilled')}: {formatMoney(snapshot?.billing?.totalBilled)}
              </p>
            </div>
          </section>

          {/* Action Forms Grid */}
          <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Book Appointment */}
            <form onSubmit={handleBookAppointment} className="group rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 space-y-4 backdrop-blur-md shadow-sm hover:shadow-xl hover:shadow-emerald-50 dark:hover:shadow-emerald-900/10 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/30">
                  <Calendar className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="text-lg font-bold font-manrope text-slate-900 dark:text-white">{t('patientPortal:hospitalServices.bookAppointmentTitle')}</h3>
              </div>
              <select
                value={appointmentForm.doctorId}
                onChange={(event) => setAppointmentForm((current) => ({ ...current, doctorId: event.target.value }))}
                disabled={doctors.length === 0}
                className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                {doctors.length === 0 && <option value="">{t("hospitalServices.noDoctorAvailable")}</option>}
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name} {doctor.specialty ? `· ${doctor.specialty}` : ''}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={appointmentForm.apptDate}
                onChange={(event) => setAppointmentForm((current) => ({ ...current, apptDate: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                required
              />
              <div className="space-y-2">
                {appointmentBookingGuard.hasGeneratedSlots && (appointmentSlots?.availableSlots?.length ?? 0) > 0 ? (
                  <select
                    value={appointmentForm.apptTime}
                    onChange={(event) => setAppointmentForm((current) => ({ ...current, apptTime: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    required
                  >
                    {(appointmentSlots?.availableSlots ?? []).map((slot) => (
                      <option key={slot.time ?? slot.label} value={slot.time ?? ''}>
                        {slot.label ?? slot.time}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="time"
                    value={appointmentForm.apptTime}
                    onChange={(event) => setAppointmentForm((current) => ({ ...current, apptTime: event.target.value }))}
                    className={`w-full rounded-xl border bg-white dark:bg-slate-900 dark:border-slate-800 px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none ${appointmentBookingGuard.isSelectedTimeBooked || appointmentBookingGuard.isSelectedTimeOutsideGeneratedSlots ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-200'}`}
                    required
                  />
                )}
                <div className={`rounded-xl px-3 py-2 text-xs ${appointmentBookingGuard.isSelectedTimeBooked ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {loadingAppointmentSlots ? 'Checking booked slots...' : appointmentBookingGuard.message}
                </div>
                {appointmentBookingGuard.hasGeneratedSlots && (appointmentSlots?.availableSlots?.length ?? 0) === 0 && (
                  <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    No available slots are left for this doctor on this date.
                  </div>
                )}
                {appointmentBookingGuard.bookedTimes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {appointmentBookingGuard.bookedTimes.map((time) => (
                      <span key={time} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                        Booked {time}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <textarea
                rows={3}
                value={appointmentForm.chiefComplaint}
                onChange={(event) => setAppointmentForm((current) => ({ ...current, chiefComplaint: event.target.value }))}
                placeholder={t("hospitalServices.symptomsPlaceholder")}
                className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
              />
              <button
                type="submit"
                disabled={submitting === 'appointment' || doctors.length === 0 || loadingAppointmentSlots || !appointmentBookingGuard.canSubmit}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {submitting === 'appointment' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                {t('hospitalServices.confirmBooking')}
              </button>
            </form>

            {/* Secure Message */}
            <form onSubmit={handleSendMessage} className="group rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 space-y-4 backdrop-blur-md shadow-sm hover:shadow-xl hover:shadow-violet-50 dark:hover:shadow-violet-900/10 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-violet-50 dark:bg-violet-900/30">
                  <MessageSquare className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                </div>
                <h3 className="text-lg font-bold font-manrope text-slate-900 dark:text-white">{t('patientPortal:hospitalServices.conciergeDeskTitle')}</h3>
              </div>
              <select
                value={messageForm.doctorId}
                onChange={(event) => setMessageForm((current) => ({ ...current, doctorId: event.target.value }))}
                disabled={doctors.length === 0}
                className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 px-4 py-3 text-sm focus:ring-2 focus:ring-violet-500 outline-none"
              >
                {doctors.length === 0 && <option value="">{t("hospitalServices.noRecipientAvailable")}</option>}
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name} {doctor.specialty ? `· ${doctor.specialty}` : ''}
                  </option>
                ))}
              </select>
              <textarea
                rows={5}
                value={messageForm.message}
                onChange={(event) => setMessageForm((current) => ({ ...current, message: event.target.value }))}
                placeholder={t("hospitalServices.messagePlaceholder")}
                className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 px-4 py-3 text-sm focus:ring-2 focus:ring-violet-500 outline-none resize-none"
                required
              />
              <button
                type="submit"
                disabled={submitting === 'message' || doctors.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-700 transition disabled:opacity-50 mt-auto"
              >
                {submitting === 'message' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t('hospitalServices.sendSecureMessage')}
              </button>
            </form>

            {/* Share Review */}
            <form onSubmit={handleSubmitReview} className="relative overflow-hidden group rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-teal-600 p-6 space-y-4 shadow-sm hover:shadow-xl hover:shadow-teal-600/20 transition-all text-white">
              <div className="absolute -right-12 -top-12 w-48 h-48 bg-teal-500 rounded-full opacity-50 transition-transform group-hover:scale-110"></div>
              <div className="relative z-10 space-y-4 h-full flex flex-col">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-white/20">
                    <Star className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="text-lg font-bold font-manrope">{t('patientPortal:hospitalServices.shareFeedbackTitle')}</h3>
                </div>
                <p className="text-sm opacity-90">{t('patientPortal:hospitalServices.shareFeedbackDescription')}</p>
                <select
                  value={reviewForm.rating}
                  onChange={(event) => setReviewForm((current) => ({ ...current, rating: event.target.value }))}
                  className="w-full rounded-xl border border-white/30 bg-black/10 px-4 py-3 text-sm text-white focus:ring-2 focus:ring-white outline-none [&>option]:text-slate-900"
                >
                  {[5, 4, 3, 2, 1].map((rating) => (
                    <option key={rating} value={rating}>
                      {t('patientPortal:hospitalServices.starRating', { count: rating })}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={4}
                  value={reviewForm.reviewText}
                  onChange={(event) => setReviewForm((current) => ({ ...current, reviewText: event.target.value }))}
                  placeholder={t("hospitalServices.reviewPlaceholder")}
                  className="w-full rounded-xl border border-white/30 bg-black/10 px-4 py-3 text-sm text-white placeholder-white/50 focus:ring-2 focus:ring-white outline-none resize-none"
                />
                <button
                  type="submit"
                  disabled={submitting === 'review'}
                  className="mt-auto w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white text-teal-700 px-4 py-3 text-sm font-bold hover:bg-slate-50 transition disabled:opacity-50"
                >
                  {submitting === 'review' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" fill="currentColor" />}
                  {t('hospitalServices.submitReview')}
                </button>
              </div>
            </form>
          </section>

          {/* History Sections */}
          <section className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <Stethoscope className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                </div>
                <h3 className="text-lg font-bold font-manrope text-slate-900 dark:text-white">{t('hospitalServices.carePathHistory')}</h3>
              </div>
              <div className="space-y-4">
                {records.prescriptions.slice(0, 3).map((prescription: any) => {
                  const prescriptionState = buildPatientPrescriptionActionState(prescription);
                  return (
                  <div key={prescription.id} className="relative flex gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                    <div className="w-10 h-10 shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 ring-4 ring-white dark:ring-slate-900">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <div>
                           <p className="text-sm font-bold text-slate-900 dark:text-white">{prescriptionState.title}</p>
                           <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{prescriptionState.doctorLabel} • {prescriptionState.dateLabel}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleRequestRefill(Number(prescriptionState.id))}
                            disabled={!prescriptionState.canRequestRefill || refillSubmittingId === Number(prescriptionState.id)}
                            className="px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-100 transition disabled:opacity-50"
                          >
                            {refillSubmittingId === Number(prescriptionState.id) ? t('hospitalServices.requesting') : t('hospitalServices.requestRefill')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleOpenPrescriptionDetail(prescription)}
                            disabled={loadingPrescriptionDetailId === prescriptionState.id}
                            className="px-2.5 py-1 rounded-md bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 transition disabled:opacity-50"
                          >
                            {loadingPrescriptionDetailId === prescriptionState.id ? 'Loading' : 'Detail'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSharePrescription(prescriptionState)}
                            className="px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 transition"
                          >
                            Share
                          </button>
                          <a href={prescriptionState.pdfPath} className="px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-100 transition">{t('patientPortal:hospitalServices.viewAction')}</a>
                        </div>
                      </div>
                      {prescription.diagnosis && (
                         <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs text-slate-600 dark:text-slate-400 border-l-2 border-emerald-400">
                           {prescription.diagnosis}
                         </div>
                      )}
                    </div>
                  </div>
                  );
                })}
                
                {selectedPrescriptionDetail && (() => {
                  const detailPrescription = selectedPrescriptionDetail.prescription ?? {};
                  const detailState = buildPatientPrescriptionActionState(detailPrescription);
                  const detailItems = selectedPrescriptionDetail.items ?? [];
                  return (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Prescription detail</p>
                          <h4 className="mt-1 text-base font-bold text-slate-900">{detailState.title}</h4>
                          <p className="mt-1 text-xs text-slate-600">{detailState.doctorLabel} • {detailState.dateLabel}</p>
                          {detailState.followUpLabel !== '—' && (
                            <p className="mt-1 text-xs font-semibold text-emerald-700">Follow-up: {detailState.followUpLabel}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => void handleSharePrescription(detailState)} className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                            Share
                          </button>
                          <a href={detailState.pdfPath} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                            Download PDF
                          </a>
                          <button type="button" onClick={() => setSelectedPrescriptionDetail(null)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                            Close
                          </button>
                        </div>
                      </div>
                      {(detailState.diagnosis || detailState.advice) && (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {detailState.diagnosis && <div className="rounded-xl bg-white p-3 text-xs text-slate-600"><span className="font-bold text-slate-800">Diagnosis:</span> {detailState.diagnosis}</div>}
                          {detailState.advice && <div className="rounded-xl bg-white p-3 text-xs text-slate-600"><span className="font-bold text-slate-800">Advice:</span> {detailState.advice}</div>}
                        </div>
                      )}
                      <div className="mt-4 space-y-2">
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Medicines</p>
                        {detailItems.length > 0 ? detailItems.map((item) => (
                          <div key={String(item.id ?? item.medicine_name)} className="rounded-xl bg-white p-3 text-xs text-slate-600">
                            <p className="font-bold text-slate-900">{String(item.medicine_name ?? 'Medicine')}</p>
                            <p className="mt-1">{[item.dosage, item.frequency, item.duration].filter(Boolean).join(' • ') || 'Dose details not specified'}</p>
                            {item.instructions && <p className="mt-1 text-slate-500">{String(item.instructions)}</p>}
                          </div>
                        )) : (
                          <div className="rounded-xl border border-dashed border-emerald-200 bg-white/70 p-3 text-center text-xs text-slate-500">No medicines listed</div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {records.prescriptions.length === 0 && (
                  <div className="p-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500">
                    {t('hospitalServices.noPrescriptionHistory')}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <FlaskConical className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                </div>
                <h3 className="text-lg font-bold font-manrope text-slate-900 dark:text-white">{t('patientPortal:hospitalServices.diagnosticResultsTitle')}</h3>
              </div>
              <div className="space-y-4">
                {records.labResults.slice(0, 4).map((lab: any) => (
                  <div key={`lab-${lab.id}`} className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                    <div className="flex items-center gap-4">
                       <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                       <div>
                         <p className="text-sm font-bold text-slate-900 dark:text-white">{lab.test_name || lab.order_no || t('patientPortal:hospitalServices.labPanelLabel')}</p>
                         <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{lab.result || lab.result_numeric || t('patientPortal:hospitalServices.resultDocumented')}</p>
                         {(lab.unit || lab.normal_range || lab.abnormal_flag) && (
                           <p className="mt-1 text-[11px] text-slate-500">{[lab.unit, lab.normal_range, lab.abnormal_flag].filter(Boolean).join(' • ')}</p>
                         )}
                       </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleOpenLabResultDetail(lab)}
                        disabled={loadingLabResultDetailId === lab.id}
                        className="text-xs font-semibold text-slate-700 px-3 py-1.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition disabled:opacity-50"
                      >
                        {loadingLabResultDetailId === lab.id ? 'Loading' : 'Detail'}
                      </button>
                      <a href={buildPatientTenantPortalPath(`/lab-results/${lab.id}/pdf`)} className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-100 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition">{t('patientPortal:hospitalServices.downloadAction')}</a>
                    </div>
                  </div>
                ))}

                {selectedLabResultDetail && (() => {
                  const order = selectedLabResultDetail.order ?? {};
                  const items = selectedLabResultDetail.items ?? [];
                  const pdfUrl = selectedLabResultDetail.actions?.pdf_url ?? buildPatientTenantPortalPath(`/lab-results/${String(order.id ?? '')}/pdf`);
                  return (
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Lab result detail</p>
                          <h4 className="mt-1 text-base font-bold text-slate-900">{String(order.order_no ?? 'Lab report')}</h4>
                          <p className="mt-1 text-xs text-slate-600">{formatDate(order.created_at, lang)} • {String(order.status ?? 'released')}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => void handleShareLabResult(selectedLabResultDetail)} className="rounded-lg bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-200">
                            Share
                          </button>
                          <a href={pdfUrl} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                            Download PDF
                          </a>
                          <button type="button" onClick={() => setSelectedLabResultDetail(null)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                            Close
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2">
                        {items.length > 0 ? items.map((item) => (
                          <div key={String(item.id ?? item.test_name)} className="rounded-xl bg-white p-3 text-xs text-slate-600">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-bold text-slate-900">{String(item.test_name ?? 'Test')}</p>
                                <p className="mt-1">Result: {String(item.result ?? item.result_numeric ?? '—')} {String(item.unit ?? '')}</p>
                                {item.normal_range && <p className="mt-1 text-slate-500">Reference range: {String(item.normal_range)}</p>}
                              </div>
                              <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{String(item.severity ?? item.abnormal_flag ?? 'normal')}</span>
                            </div>
                            {item.explanation && <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-blue-800">{String(item.explanation)}</p>}
                          </div>
                        )) : (
                          <div className="rounded-xl border border-dashed border-blue-200 bg-white/70 p-3 text-center text-xs text-slate-500">No released result items</div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {records.labResults.length === 0 && (
                  <div className="p-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500">
                    {t('hospitalServices.noDiagnosticLabs')}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <Calendar className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                </div>
                <h3 className="text-lg font-bold font-manrope text-slate-900 dark:text-white">{t('hospitalServices.recentAppointments')}</h3>
              </div>
              <div className="space-y-3">
                {records.appointments.slice(0, 4).map((appointment: any) => {
                  const appointmentState = buildPatientAppointmentMvpState(appointment);
                  const isSelected = selectedAppointmentState?.id !== null && String(selectedAppointmentState?.id) === String(appointmentState.id);
                  return (
                    <button
                      type="button"
                      key={`appointment-${appointment.id}`}
                      onClick={() => setSelectedAppointmentId(appointmentState.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${isSelected ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-100'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{appointmentState.title}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {formatDate(appointmentState.dateLabel, lang)} {appointmentState.timeLabel}
                          </p>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusToneClass(appointmentState.status.tone)}`}>
                          {appointmentState.status.label}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {appointmentState.status.details.map((detail) => (
                          <span key={`${appointment.id}-${detail}`} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                            {detail}
                          </span>
                        ))}
                        {appointmentState.subtitle && (
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                            {appointmentState.subtitle}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {records.appointments.length === 0 && (
                  <div className="p-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500">
                    {t('hospitalServices.noAppointmentsYet')}
                  </div>
                )}
              </div>

              {selectedAppointmentState && (
                <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Appointment detail</p>
                      <h4 className="mt-1 text-base font-extrabold text-slate-900">{selectedAppointmentState.title}</h4>
                      <p className="mt-1 text-xs text-slate-600">{selectedAppointmentState.subtitle}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusToneClass(selectedAppointmentState.status.tone)}`}>
                      {selectedAppointmentState.status.label}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-xl bg-white px-3 py-2"><span className="block text-slate-500">Date</span><b>{formatDate(selectedAppointmentState.dateLabel, lang)}</b></div>
                    <div className="rounded-xl bg-white px-3 py-2"><span className="block text-slate-500">Time</span><b>{selectedAppointmentState.timeLabel || 'N/A'}</b></div>
                    <div className="rounded-xl bg-white px-3 py-2"><span className="block text-slate-500">Token</span><b>{selectedAppointmentState.queue.token || 'N/A'}</b></div>
                    <div className="rounded-xl bg-white px-3 py-2"><span className="block text-slate-500">Counter</span><b>{selectedAppointmentState.queue.counter || 'N/A'}</b></div>
                    <div className="rounded-xl bg-white px-3 py-2"><span className="block text-slate-500">ETA</span><b>{selectedAppointmentState.queue.estimatedWaitMinutes ?? 'N/A'}</b></div>
                    <div className="rounded-xl bg-white px-3 py-2"><span className="block text-slate-500">Reschedule</span><b>{selectedAppointmentState.reschedule.label}</b></div>
                  </div>
                  {selectedAppointmentState.chiefComplaint && (
                    <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">{selectedAppointmentState.chiefComplaint}</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!selectedAppointmentState.canCancel || cancelingAppointmentId === selectedAppointmentState.id}
                      onClick={() => void handleCancelAppointment(selectedAppointmentState.id)}
                      className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {cancelingAppointmentId === selectedAppointmentState.id ? 'Cancelling...' : 'Cancel appointment'}
                    </button>
                    <button
                      type="button"
                      disabled
                      className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-500 ring-1 ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {selectedAppointmentState.reschedule.label}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <Receipt className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                </div>
                <h3 className="text-lg font-bold font-manrope text-slate-900 dark:text-white">{t('hospitalServices.billingHistory')}</h3>
              </div>
              <div className="space-y-3">
                {records.bills.slice(0, 4).map((bill: any) => (
                  <div key={`bill-${bill.id}`} className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {bill.invoice_no || `${t('hospitalServices.bill')} #${bill.id}`}
                      </p>
                      <span className={`text-xs font-semibold ${(bill.due ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {(bill.due ?? 0) > 0 ? `Due ${formatMoney(bill.due)}` : 'Paid'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {t('hospitalServices.totalBilled')}: {formatMoney(bill.total)} • {t('hospitalServices.totalPaid')}: {formatMoney(bill.paid)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void handleOpenBillDetail(bill)} disabled={loadingBillDetailId === bill.id} className="rounded-lg border border-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        {loadingBillDetailId === bill.id ? 'Loading' : 'Detail'}
                      </button>
                      <button type="button" disabled className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400">Payment coming soon</button>
                    </div>
                  </div>
                ))}
                {selectedBillDetail && (() => {
                  const bill = selectedBillDetail.bill ?? {};
                  const actions = selectedBillDetail.actions ?? {};
                  const due = Number(bill.due ?? 0);
                  return (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Bill detail</p>
                          <h4 className="mt-1 text-base font-bold text-slate-900">{String(bill.invoice_no ?? `${t('hospitalServices.bill')} #${bill.id ?? ''}`)}</h4>
                          <p className="mt-1 text-xs text-slate-600">{formatDate(bill.created_at, lang)} • {String(bill.status ?? 'open')}</p>
                        </div>
                        <button type="button" onClick={() => setSelectedBillDetail(null)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Close</button>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl bg-white p-3 text-xs text-slate-600"><span className="font-bold text-slate-800">Total:</span> {formatMoney(Number(bill.total ?? 0))}</div>
                        <div className="rounded-xl bg-white p-3 text-xs text-slate-600"><span className="font-bold text-slate-800">Paid:</span> {formatMoney(Number(bill.paid ?? 0))}</div>
                        <div className="rounded-xl bg-white p-3 text-xs text-slate-600"><span className="font-bold text-slate-800">Due:</span> {formatMoney(due)}</div>
                      </div>
                      <div className="mt-4 rounded-xl border border-dashed border-amber-200 bg-white/70 p-3 text-xs text-slate-600">
                        {actions.payment_enabled ? 'Online payment is available.' : actions.payment_message ?? 'Online payment is coming soon. Please contact the billing counter.'}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {actions.receipt_url ? (
                          <a href={actions.receipt_url} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Download receipt</a>
                        ) : (
                          <button type="button" disabled className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-400">Receipt from counter</button>
                        )}
                        <button type="button" disabled={!actions.payment_enabled} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-400">Pay online</button>
                      </div>
                    </div>
                  );
                })()}

                {records.bills.length === 0 && (
                  <div className="p-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500">
                    {t('hospitalServices.noBillsYet')}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <MessageSquare className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                </div>
                <h3 className="text-lg font-bold font-manrope text-slate-900 dark:text-white">{t('hospitalServices.messageUpdates')}</h3>
              </div>
              <div className="space-y-3">
                {records.conversations.slice(0, 4).map((conversation: any) => (
                  <div key={`conversation-${conversation.doctor_id}`} className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {conversation.doctor_name || t('hospitalServices.conciergeDesk')}
                      </p>
                      {Number(conversation.unread_count ?? 0) > 0 && (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                          {conversation.unread_count} {t('hospitalServices.unread')}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                      {conversation.last_message || t('hospitalServices.noMessagePreview')}
                    </p>
                  </div>
                ))}
                {records.conversations.length === 0 && (
                  <div className="p-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500">
                    {t('hospitalServices.noMessagesYet')}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <Syringe className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                </div>
                <h3 className="text-lg font-bold font-manrope text-slate-900 dark:text-white">{t('hospitalServices.refillTracker')}</h3>
              </div>
              <div className="space-y-3">
                {records.refillRequests.slice(0, 4).map((request: any) => (
                  <div key={`refill-${request.id}`} className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {request.rx_no || t('hospitalServices.refillRequest')}
                      </p>
                      <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                        {request.status || t('hospitalServices.statusUnknown')}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {request.doctor_name || t('hospitalServices.pharmacyDesk')} • {formatDate(request.created_at, lang)}
                    </p>
                  </div>
                ))}
                {records.refillRequests.length === 0 && (
                  <div className="p-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500">
                    {t('hospitalServices.noRefillRequests')}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <History className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                </div>
                <h3 className="text-lg font-bold font-manrope text-slate-900 dark:text-white">{t('hospitalServices.healthTimeline')}</h3>
              </div>
              <div className="space-y-3">
                {records.timeline.slice(0, 5).map((event: any) => (
                  <div key={`timeline-${event.event_type}-${event.id}`} className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{event.title || t('hospitalServices.healthEvent')}</p>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(event.event_date, lang)}</span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">{event.detail || event.event_type}</p>
                    {event.description && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{event.description}</p>
                    )}
                  </div>
                ))}
                {records.timeline.length === 0 && (
                  <div className="p-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500">
                    {t('hospitalServices.noTimelineYet')}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
