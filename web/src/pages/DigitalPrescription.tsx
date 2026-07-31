import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, useLocation, Link } from 'react-router';
import {
  Stethoscope, Plus, Trash2, Printer, Save, CheckCircle2,
  FlaskConical, FileText, ArrowLeft, AlertCircle, X,
  Share2, Copy, Search
} from 'lucide-react';

import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/apiClient';
import { formatDoctorName } from '../lib/doctor-display';
import { formatAgeFromDateOfBirth } from '../lib/age';
import {
  buildDischargePrescriptionHandoff,
  type DischargePrescriptionHandoff,
} from '../lib/dischargePrescriptionHandoff';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PrescriptionItem {
  id?: number;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  quantity?: number | '';
  medicineId?: number;
}

interface Patient {
  id: number;
  name: string;
  patient_code: string;
  mobile?: string;
  date_of_birth?: string;
  gender?: string;
}

interface Doctor {
  id: number;
  name: string;
  specialty?: string;
  qualifications?: string;
}

interface MedicineSearchResult {
  name: string;
  generic?: string | null;
  manufacturer?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  default_frequency?: string | null;
  default_duration?: string | null;
  default_instructions?: string | null;
  medicine_id?: number | null;
  usage_count?: number;
}

interface LabTestSearchResult {
  id: number;
  code?: string | null;
  name: string;
  category?: string | null;
  price?: number | null;
}

type ChartSummaryItem = Record<string, unknown> & {
  id?: number | string;
  allergen?: string;
  description?: string;
  medication_name?: string;
  dosage?: string;
  frequency?: string;
  label?: string;
  severity?: string;
  test_name?: string;
  result?: string | number | null;
  abnormal_flag?: string | null;
  unit?: string | null;
  title?: string;
  subtitle?: string;
  status?: string;
  date?: string;
};

interface PrescriptionChartSummary {
  snapshot?: {
    allergies?: ChartSummaryItem[];
    activeProblems?: ChartSummaryItem[];
    currentMedications?: ChartSummaryItem[];
    riskFlags?: ChartSummaryItem[];
  };
  careAlerts?: ChartSummaryItem[];
  recentLabs?: {
    abnormal?: ChartSummaryItem[];
    recent?: ChartSummaryItem[];
    pending?: ChartSummaryItem[];
  };
  timeline?: ChartSummaryItem[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const QUICK_MEDICINES = [
  { medicine_name: 'Paracetamol 500mg', dosage: '500mg', frequency: '1+1+1', duration: '5 Days', instructions: 'After Food' },
  { medicine_name: 'Amoxicillin 500mg', dosage: '500mg', frequency: '1+0+1', duration: '7 Days', instructions: 'After Food' },
  { medicine_name: 'Metformin 500mg',   dosage: '500mg', frequency: '0+1+1', duration: '30 Days', instructions: 'After Food' },
  { medicine_name: 'Omeprazole 20mg',   dosage: '20mg',  frequency: '1+0+0', duration: '14 Days', instructions: 'Before Breakfast' },
  { medicine_name: 'Cetirizine 10mg',   dosage: '10mg',  frequency: '0+0+1', duration: '5 Days', instructions: 'At Night' },
];

const FREQUENCY_OPTIONS = ['1+0+0', '0+1+0', '0+0+1', '1+1+0', '1+0+1', '0+1+1', '1+1+1', 'SOS', 'Once Daily', 'Twice Daily'];
const FOLLOW_UP_SHORTCUTS = [
  { key: '7d', labelKey: 'rx.followUpShortcut.7d', defaultValue: '7 days', days: 7 },
  { key: '15d', labelKey: 'rx.followUpShortcut.15d', defaultValue: '15 days', days: 15 },
  { key: '1m', labelKey: 'rx.followUpShortcut.1m', defaultValue: '1 month', months: 1 },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calcAge(dob?: string): string {
  return formatAgeFromDateOfBirth(dob);
}

function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addCalendarMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDayOfTargetMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return next;
}

function compactText(value: unknown, fallback = '—'): string {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DigitalPrescription() {
  const { t } = useTranslation(['patients', 'common']);

  const { slug, rxId: rxIdRouteParam } = useParams<{ slug: string; rxId?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const basePath = `/h/${slug}`;

  // IDs from query params / route params
  const patientIdParam = Number(searchParams.get('patient') ?? 0);
  const apptIdParam    = Number(searchParams.get('appt') ?? 0);
  const admissionIdParam = Number(searchParams.get('admission') ?? 0);
  const reconciliationIdParam = Number(searchParams.get('reconciliation') ?? 0);
  const repeatFromParam = Number(searchParams.get('repeatFrom') ?? 0);
  // Edit mode: rx ID comes from route :rxId param
  const rxIdParam      = Number(rxIdRouteParam ?? 0);

  // Patient / Doctor info
  const [patient, setPatient] = useState<Patient | null>(null);
  const [doctor,  setDoctor]  = useState<Doctor | null>(null);
  // appointment id for payload (ref avoids re-renders)
  const appointmentIdRef = useRef<number>(apptIdParam);

  // Vitals
  const [bp,          setBp]          = useState('');
  const [temperature, setTemperature] = useState('');
  const [weight,      setWeight]      = useState('');
  const [spo2,        setSpo2]        = useState('');

  // Clinical
  const [chiefComplaint,    setChiefComplaint]    = useState('');
  const [diagnosis,         setDiagnosis]         = useState('');
  const [examinationNotes,  setExaminationNotes]  = useState('');
  const [advice,            setAdvice]            = useState('');
  const [labTests,          setLabTests]          = useState<string[]>([]);
  const [followUpDate,      setFollowUpDate]      = useState('');

  // Medicines
  const [items,      setItems]       = useState<PrescriptionItem[]>([]);
  const [medSearch,  setMedSearch]   = useState('');
  const [medResults, setMedResults]  = useState<MedicineSearchResult[]>([]);
  const [labSearch, setLabSearch] = useState('');
  const [labResults, setLabResults] = useState<LabTestSearchResult[]>([]);
  const [selectedLabTestCatalog, setSelectedLabTestCatalog] = useState<Record<string, LabTestSearchResult>>({});
  const [frequentMedicines, setFrequentMedicines] = useState<MedicineSearchResult[]>([]);
  const [frequentLabTests, setFrequentLabTests] = useState<string[]>([]);
  const [externalMedSearchLoading, setExternalMedSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const labSearchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loadedReconciliationRef = useRef<number | null>(null);

  // UI state
  const [saving,        setSaving]        = useState(false);
  const [rxId,          setRxId]          = useState<number | null>(rxIdParam || null);
  const [rxNo,          setRxNo]          = useState('');
  const [shareUrl,      setShareUrl]      = useState<string | null>(null);
  const [sharing,       setSharing]       = useState(false);
  const [chartSummary,  setChartSummary]  = useState<PrescriptionChartSummary | null>(null);
  const [chartSummaryLoading, setChartSummaryLoading] = useState(false);
  const [dischargeHandoff, setDischargeHandoff] = useState<DischargePrescriptionHandoff | null>(null);
  const [dischargeHandoffLoading, setDischargeHandoffLoading] = useState(false);
  const [dischargeHandoffError, setDischargeHandoffError] = useState<string | null>(null);

  // ── Load initial data ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!patientIdParam) return;
    api.get<{ patient?: Patient } & Patient>(`/api/patients/${patientIdParam}`)
      .then(r => setPatient((r as { patient?: Patient }).patient ?? r as Patient))
      .catch(() => toast.error(t('rxToast.loadPatientFailed', { ns: 'patients', defaultValue: 'Failed to load patient' })));
  }, [patientIdParam]);

  useEffect(() => {
    if (!patientIdParam) return;
    let cancelled = false;
    setChartSummaryLoading(true);
    api.get<PrescriptionChartSummary>(`/api/patients/${patientIdParam}/chart`)
      .then((data) => { if (!cancelled) setChartSummary(data); })
      .catch(() => { if (!cancelled) setChartSummary(null); })
      .finally(() => { if (!cancelled) setChartSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [patientIdParam]);

  useEffect(() => {
    if (!apptIdParam) return;
    api.get<{ id: number; chief_complaint?: string; doctor_id?: number }>(`/api/appointments/${apptIdParam}`)
      .then(appt => {
        appointmentIdRef.current = appt.id;
        if (appt.chief_complaint) setChiefComplaint(appt.chief_complaint);
        if (appt.doctor_id) {
          api.get<{ doctor?: Doctor } & Doctor>(`/api/doctors/${appt.doctor_id}`)
            .then(d => setDoctor((d as { doctor?: Doctor }).doctor ?? d as Doctor))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [apptIdParam]);

  useEffect(() => {
    if (doctor || rxIdParam) return;
    api.get<{ doctor?: Doctor }>('/api/doctors/dashboard')
      .then((data) => {
        if (data.doctor?.id) setDoctor(data.doctor);
      })
      .catch(() => {});
  }, [doctor, rxIdParam]);

  // Load existing prescription (edit mode)
  useEffect(() => {
    if (!rxIdParam) return;
    api.get<Record<string, unknown>>(`/api/prescriptions/${rxIdParam}`)
      .then(rx => {
        setRxNo(rx.rx_no as string);
        setBp((rx.bp as string) ?? '');
        setTemperature((rx.temperature as string) ?? '');
        setWeight((rx.weight as string) ?? '');
        setSpo2((rx.spo2 as string) ?? '');
        setChiefComplaint((rx.chief_complaint as string) ?? '');
        setDiagnosis((rx.diagnosis as string) ?? '');
        setExaminationNotes((rx.examination_notes as string) ?? '');
        setAdvice((rx.advice as string) ?? '');
        // Safe JSON parse — guard against corrupted or empty string
        try { setLabTests(JSON.parse((rx.lab_tests as string) || '[]')); } catch { setLabTests([]); }
        setFollowUpDate((rx.follow_up_date as string) ?? '');
        setItems(((rx.items as Array<PrescriptionItem & { medicine_id?: number | null }>) ?? []).map((item) => ({
          ...item,
          medicineId: item.medicineId ?? item.medicine_id ?? undefined,
          quantity: item.quantity || '',
        })));
      })
      .catch(() => toast.error(t('rxToast.loadPrescriptionFailed', { ns: 'patients', defaultValue: 'Failed to load prescription' })));
  }, [rxIdParam]);

  // Load repeated prescription data
  useEffect(() => {
    const stateData = (location.state as { repeatData?: Record<string, unknown> } | null)?.repeatData;

    const applyRepeatData = (data: Record<string, unknown>) => {
      if (data.chief_complaint) setChiefComplaint(data.chief_complaint as string);
      if (data.diagnosis) setDiagnosis(data.diagnosis as string);
      if (data.examination_notes) setExaminationNotes(data.examination_notes as string);
      if (data.advice) setAdvice(data.advice as string);
      if (data.follow_up_date) setFollowUpDate(data.follow_up_date as string);
      if (Array.isArray(data.lab_tests)) setLabTests(data.lab_tests as string[]);
      if (Array.isArray(data.items)) setItems(data.items as PrescriptionItem[]);
    };

    if (stateData) {
      applyRepeatData(stateData);
      return;
    }

    if (!repeatFromParam || rxIdParam) return;
    api.get<{ prescription: Record<string, unknown>; items: PrescriptionItem[] }>(`/api/prescriptions/${repeatFromParam}/repeat`)
      .then(r => applyRepeatData({ ...r.prescription, items: r.items ?? [] }))
      .catch(() => toast.error(t('rxToast.repeatFailed', { ns: 'patients', defaultValue: 'Failed to load prescription for repeat' })));
  }, [repeatFromParam, rxIdParam, location.state]);

  useEffect(() => {
    if (!reconciliationIdParam || !patientIdParam || !admissionIdParam || rxIdParam || repeatFromParam) return;
    if (loadedReconciliationRef.current === reconciliationIdParam) return;

    loadedReconciliationRef.current = reconciliationIdParam;
    let cancelled = false;
    setDischargeHandoffLoading(true);
    setDischargeHandoffError(null);
    api.get<{ Results?: Record<string, unknown> & { items?: Record<string, unknown>[] } }>(
      `/api/nursing/medication-reconciliation/${reconciliationIdParam}`,
    )
      .then((response) => {
        if (!response.Results) throw new Error('Medication reconciliation was not found');
        if (cancelled) return;
        const handoff = buildDischargePrescriptionHandoff(response.Results, patientIdParam);
        setDischargeHandoff(handoff);
        setItems((current) => current.length > 0 ? current : handoff.items);
        setAdvice((current) => {
          if (current.includes(handoff.advice)) return current;
          return current.trim() ? `${current.trim()}\n\n${handoff.advice}` : handoff.advice;
        });
      })
      .catch((error) => {
        loadedReconciliationRef.current = null;
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load discharge medication reconciliation';
          setDischargeHandoff(null);
          setDischargeHandoffError(message);
          toast.error(message);
        }
      })
      .finally(() => { if (!cancelled) setDischargeHandoffLoading(false); });

    return () => { cancelled = true; };
  }, [admissionIdParam, patientIdParam, reconciliationIdParam, repeatFromParam, rxIdParam]);

  // ── Medicine search (debounced) ────────────────────────────────────────────
  useEffect(() => {
    if (medSearch.length < 2) { setMedResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.get<{ medicines: MedicineSearchResult[] }>(`/api/e-prescribing/formulary/search?q=${encodeURIComponent(medSearch)}`)
        .then(r => setMedResults(r.medicines ?? []))
        .catch(() => setMedResults([]));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [medSearch]);

  useEffect(() => {
    if (labSearch.trim().length < 2) { setLabResults([]); return; }
    clearTimeout(labSearchDebounceRef.current);
    labSearchDebounceRef.current = setTimeout(() => {
      api.get<{ tests: LabTestSearchResult[] }>(`/api/lab?search=${encodeURIComponent(labSearch)}`)
        .then(r => setLabResults(r.tests ?? []))
        .catch(() => setLabResults([]));
    }, 300);
    return () => clearTimeout(labSearchDebounceRef.current);
  }, [labSearch]);

  useEffect(() => {
    api.get<{ medicines: MedicineSearchResult[] }>('/api/e-prescribing/formulary/frequent?limit=8')
      .then(r => setFrequentMedicines(r.medicines ?? []))
      .catch(() => setFrequentMedicines([]));

    api.get<{ tests: Array<{ name: string }> }>('/api/prescriptions/frequent-lab-tests?limit=10')
      .then(r => setFrequentLabTests((r.tests ?? []).map(test => test.name).filter(Boolean)))
      .catch(() => setFrequentLabTests([]));
  }, []);

  const quickMedicineOptions = useMemo(() => (
    frequentMedicines.length > 0
      ? frequentMedicines.map((medicine) => ({
        medicine_name: medicine.name,
        dosage: medicine.strength ?? '',
        frequency: medicine.default_frequency ?? '1+1+1',
        duration: medicine.default_duration ?? '',
        instructions: medicine.default_instructions ?? '',
        medicineId: medicine.medicine_id ?? undefined,
        label: [medicine.name, medicine.strength, medicine.dosage_form].filter(Boolean).join(' '),
      }))
      : QUICK_MEDICINES.map((medicine) => ({ ...medicine, label: medicine.medicine_name }))
  ), [frequentMedicines]);

  const selectedLabTestDetails = useMemo(() => (
    labTests.map((name) => selectedLabTestCatalog[name] ?? { id: 0, name })
  ), [labTests, selectedLabTestCatalog]);

  const ehrHighlightGroups = useMemo(() => {
    const allergies = chartSummary?.snapshot?.allergies ?? [];
    const activeProblems = chartSummary?.snapshot?.activeProblems ?? [];
    const currentMedications = chartSummary?.snapshot?.currentMedications ?? [];
    const alertItems = [...(chartSummary?.careAlerts ?? []), ...(chartSummary?.snapshot?.riskFlags ?? [])];
    const abnormalLabs = chartSummary?.recentLabs?.abnormal ?? [];
    const timeline = chartSummary?.timeline ?? [];

    return [
      {
        key: 'alerts',
        label: t('rx.ehrAlerts', { ns: 'patients', defaultValue: 'Alerts' }),
        empty: t('rx.ehrNoAlerts', { ns: 'patients', defaultValue: 'No active alerts' }),
        items: alertItems.slice(0, 3).map((item) => ({
          title: compactText(item.label ?? item.description),
          meta: compactText(item.severity ?? item.type, ''),
        })),
      },
      {
        key: 'allergies',
        label: t('rx.ehrAllergies', { ns: 'patients', defaultValue: 'Allergies' }),
        empty: t('rx.ehrNoAllergies', { ns: 'patients', defaultValue: 'No allergies recorded' }),
        items: allergies.slice(0, 3).map((item) => ({
          title: compactText(item.allergen ?? item.description),
          meta: compactText(item.severity, ''),
        })),
      },
      {
        key: 'problems',
        label: t('rx.ehrActiveProblems', { ns: 'patients', defaultValue: 'Active problems' }),
        empty: t('rx.ehrNoProblems', { ns: 'patients', defaultValue: 'No active problems' }),
        items: activeProblems.slice(0, 3).map((item) => ({
          title: compactText(item.description),
          meta: compactText(item.severity ?? item.status, ''),
        })),
      },
      {
        key: 'medications',
        label: t('rx.ehrCurrentMeds', { ns: 'patients', defaultValue: 'Current meds' }),
        empty: t('rx.ehrNoMeds', { ns: 'patients', defaultValue: 'No current medicines' }),
        items: currentMedications.slice(0, 3).map((item) => ({
          title: compactText(item.medication_name ?? item.description),
          meta: [item.dosage, item.frequency].map((part) => compactText(part, '')).filter(Boolean).join(' · '),
        })),
      },
      {
        key: 'labs',
        label: t('rx.ehrAbnormalLabs', { ns: 'patients', defaultValue: 'Abnormal labs' }),
        empty: t('rx.ehrNoAbnormalLabs', { ns: 'patients', defaultValue: 'No abnormal labs' }),
        items: abnormalLabs.slice(0, 3).map((item) => ({
          title: compactText(item.test_name ?? item.description),
          meta: [item.result, item.unit, item.abnormal_flag].map((part) => compactText(part, '')).filter(Boolean).join(' '),
        })),
      },
      {
        key: 'timeline',
        label: t('rx.ehrRecentTimeline', { ns: 'patients', defaultValue: 'Recent chart' }),
        empty: t('rx.ehrNoTimeline', { ns: 'patients', defaultValue: 'No recent chart events' }),
        items: timeline.slice(0, 3).map((item) => ({
          title: compactText(item.title ?? item.description),
          meta: compactText(item.subtitle ?? item.status ?? item.date, ''),
        })),
      },
    ];
  }, [chartSummary, t]);

  // ── Item helpers ───────────────────────────────────────────────────────────
  const addItem = useCallback((med?: Partial<PrescriptionItem>) => {
    setItems(prev => [...prev, {
      medicine_name: med?.medicine_name ?? '',
      dosage:        med?.dosage ?? '',
      frequency:     med?.frequency ?? '1+1+1',
      duration:      med?.duration ?? '',
      instructions:  med?.instructions ?? '',
      quantity:      med?.quantity ?? '',
      medicineId:    med?.medicineId,
    }]);
  }, []);

  const updateItem = useCallback((idx: number, field: keyof PrescriptionItem, val: string | number) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  }, []);

  const removeItem = useCallback((idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const searchExternalMedicines = useCallback(async () => {
    const search = medSearch.trim();
    if (search.length < 2 || externalMedSearchLoading) return;

    setExternalMedSearchLoading(true);
    try {
      const result = await api.get<{ medicines: MedicineSearchResult[] }>(`/api/e-prescribing/formulary/external-search?q=${encodeURIComponent(search)}`);
      setMedResults(result.medicines ?? []);
      if (!result.medicines?.length) {
        toast.error(t('rx.noExternalMedicineFound', { ns: 'patients', defaultValue: 'No external medicine found' }));
      }
    } catch {
      toast.error(t('rx.externalMedicineSearchFailed', { ns: 'patients', defaultValue: 'External medicine search failed' }));
    } finally {
      setExternalMedSearchLoading(false);
    }
  }, [externalMedSearchLoading, medSearch, t]);

  const toggleLabTest = useCallback((test: string) => {
    setLabTests(prev => prev.includes(test) ? prev.filter(t => t !== test) : [...prev, test]);
  }, []);

  const addLabTestFromCatalog = useCallback((test: LabTestSearchResult) => {
    const name = test.name.trim();
    if (!name) return;
    setSelectedLabTestCatalog(prev => ({ ...prev, [name]: test }));
    setLabTests(prev => prev.includes(name) ? prev : [...prev, name]);
    setLabSearch('');
    setLabResults([]);
  }, []);

  const removeLabTest = useCallback((testName: string) => {
    setLabTests(prev => prev.filter(name => name !== testName));
  }, []);

  const applyFollowUpShortcut = useCallback((shortcut: typeof FOLLOW_UP_SHORTCUTS[number]) => {
    const next = 'months' in shortcut
      ? addCalendarMonths(new Date(), shortcut.months)
      : new Date();
    if ('days' in shortcut) next.setDate(next.getDate() + shortcut.days);
    setFollowUpDate(toLocalDateInputValue(next));
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const buildPayload = (status: 'draft' | 'final') => ({
    patientId:        patientIdParam || patient?.id,
    doctorId:         doctor?.id,
    appointmentId:    appointmentIdRef.current || undefined,
    admissionId:      admissionIdParam || undefined,
    sourceReconciliationId: reconciliationIdParam || undefined,
    bp, temperature, weight, spo2,
    chiefComplaint, diagnosis, examinationNotes, advice,
    labTests, followUpDate,
    status,
    items: items.map(({ quantity, ...it }, idx) => ({
      ...it,
      ...(typeof quantity === 'number' && quantity > 0 ? { quantity } : {}),
      sort_order: idx,
    })),
  });

  const save = async (status: 'draft' | 'final'): Promise<{ id: number; rxNo?: string } | undefined> => {
    if (!patientIdParam && !patient?.id) { toast.error(t('rxToast.patientRequired', { ns: 'patients', defaultValue: 'Patient required' })); return; }
    if (reconciliationIdParam && !dischargeHandoff) {
      toast.error(dischargeHandoffError || 'Wait for the discharge medication reconciliation to load before saving.');
      return;
    }
    setSaving(true);
    try {
      if (rxId) {
        await api.put(`/api/prescriptions/${rxId}`, buildPayload(status));
        toast.success(status === 'final' ? t('rxToast.prescriptionFinalised', { ns: 'patients', defaultValue: 'Prescription finalised!' }) : t('rxToast.draftSaved', { ns: 'patients', defaultValue: 'Draft saved' }));
        return { id: rxId, rxNo };
      } else {
        const r = await api.post<{ id: number; rxNo: string }>('/api/prescriptions', buildPayload(status));
        setRxId(r.id);
        setRxNo(r.rxNo);
        toast.success(status === 'final' ? t('rxToast.prescriptionCreated', { ns: 'patients', defaultValue: 'Prescription created!' }) : t('rxToast.draftSaved', { ns: 'patients', defaultValue: 'Draft saved' }));
        return r;
      }
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : t('rxToast.savePrescriptionFailed', { ns: 'patients', defaultValue: 'Failed to save prescription' });
      toast.error(message);
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async () => {
    if (!rxId) { toast.error(t('rxToast.saveFirst', { ns: 'patients', defaultValue: 'Save the prescription first' })); return; }
    setSharing(true);
    try {
      const r = await api.post<{ token: string; url?: string }>(`/api/prescriptions/${rxId}/share`, {});
      const url = r.url
        ? (r.url.startsWith('http') ? r.url : `${window.location.origin}${r.url}`)
        : `${window.location.origin}/api/rx/${r.token}`;
      setShareUrl(url);
      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success(t('rxToast.shareLinkCopied', { ns: 'patients', defaultValue: 'Share link copied to clipboard!' }));
    } catch {
      toast.error(t('rxToast.shareLinkFailed', { ns: 'patients', defaultValue: 'Failed to generate share link' }));
    } finally {
      setSharing(false);
    }
  };

  const handlePrint = () => {
    if (!rxId) { toast.error(t('rxToast.saveBeforePrint', { ns: 'patients', defaultValue: 'Save first before printing' })); return; }
    window.open(`${basePath}/prescriptions/${rxId}/print`, '_blank');
  };

  const handleSaveAndPrint = async () => {
    const saved = await save('final');
    const printableId = saved?.id ?? rxId;
    if (printableId) {
      window.open(`${basePath}/prescriptions/${printableId}/print`, '_blank');
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' });
  const prescriptionSaveBlocked = saving || Boolean(reconciliationIdParam && !dischargeHandoff);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[var(--color-border)] px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
        <Link to={searchParams.get('from') ? `${basePath}/${searchParams.get('from')}` : `${basePath}/appointments`} className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2">
          <Stethoscope className="w-5 h-5 text-[var(--color-primary)]" />
          <h1 className="text-lg font-semibold text-[var(--color-text)]">{t('digitalPrescription', { ns: 'patients', defaultValue: 'Digital Prescription' })}</h1>
          {rxNo && <span className="text-xs bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-2 py-0.5 rounded-full font-mono">{rxNo}</span>}
        </div>
        <div className="ml-auto text-sm text-[var(--color-text-muted)]">{today}</div>
      </div>

      <div className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6 pb-28">

        {/* ── Patient Header Card ──────────────────────────────────────── */}
        <div className="card p-5">
          <div className="flex flex-wrap gap-6 items-start">
            {/* Patient info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-lg">
                  {patient?.name?.[0] ?? '?'}
                </div>
                <div>
                  <div className="font-semibold text-[var(--color-text)] text-lg">{patient?.name ?? '—'}</div>
                  <div className="text-sm text-[var(--color-text-muted)] flex gap-3">
                    <span>{patient?.patient_code ?? ''}</span>
                    <span>{calcAge(patient?.date_of_birth)}</span>
                    <span className="capitalize">{patient?.gender ?? ''}</span>
                    {patient?.mobile && <span>{patient.mobile}</span>}
                  </div>
                </div>
              </div>
              {chiefComplaint && (
                <div className="mt-2 text-sm text-[var(--color-text-muted)] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="font-medium text-amber-700">{t('rx.chiefComplaint', { ns: 'patients', defaultValue: 'Chief Complaint: ' })}</span>{chiefComplaint}
                </div>
              )}
            </div>
            {/* Doctor info */}
            {doctor && (
              <div className="text-right text-sm">
                <div className="font-semibold text-[var(--color-text)]">{formatDoctorName(doctor.name)}</div>
                <div className="text-[var(--color-text-muted)]">{doctor.specialty}</div>
                {doctor.qualifications && <div className="text-xs text-[var(--color-text-muted)]">{doctor.qualifications}</div>}
              </div>
            )}
          </div>

          {/* Vitals row */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: t('rx.bp', { ns: 'patients', defaultValue: 'BP (mmHg)' }),  value: bp,          set: setBp,          placeholder: '120/80' },
              { label: t('rx.temperature', { ns: 'patients', defaultValue: 'Temp (F)' }),  value: temperature,  set: setTemperature, placeholder: '98.6' },
              { label: t('rx.weight', { ns: 'patients', defaultValue: 'Weight' }),     value: weight,       set: setWeight,      placeholder: '70 kg' },
              { label: t('rx.spo2', { ns: 'patients', defaultValue: 'SpO2 (%)' }),   value: spo2,         set: setSpo2,        placeholder: '98' },
            ].map(v => (
              <div key={v.label} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">{v.label}</label>
                <input
                  value={v.value} onChange={e => v.set(e.target.value)}
                  placeholder={v.placeholder}
                  className="input text-sm py-1.5"
                />
              </div>
            ))}
          </div>
        </div>

        {(dischargeHandoffLoading || dischargeHandoff || dischargeHandoffError) && (
          <div className="card p-4 border border-amber-200 bg-amber-50/70" data-testid="discharge-reconciliation-handoff">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-sm text-amber-900">Discharge medication reconciliation hand-off</h2>
                {dischargeHandoffLoading ? (
                  <p className="text-xs text-amber-800 mt-1">Loading completed reconciliation… Prescription saving is temporarily disabled.</p>
                ) : dischargeHandoffError ? (
                  <p className="text-xs text-red-700 mt-1">
                    {dischargeHandoffError}. Prescription saving is blocked until the reconciliation can be verified.
                  </p>
                ) : dischargeHandoff ? (
                  <>
                    <p className="text-xs text-amber-800 mt-1">
                      Reconciliation #{dischargeHandoff.reconciliationId} prefilled this prescription. Verify every medicine, dose, frequency, duration and instruction before finalizing.
                    </p>
                    {dischargeHandoff.stoppedMedications.length > 0 && (
                      <div className="mt-2 text-xs text-amber-900">
                        <span className="font-semibold">Stopped medicines:</span>{' '}
                        {dischargeHandoff.stoppedMedications.map((medication) => (
                          `${medication.name}${medication.reason ? ` (${medication.reason})` : ''}`
                        )).join(', ')}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {patientIdParam > 0 && (
          <div className="card p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-sm text-[var(--color-text)] flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('rx.ehrHighlights', { ns: 'patients', defaultValue: 'EHR Highlights' })}
                </h2>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {t('rx.ehrHighlightsHint', { ns: 'patients', defaultValue: 'Programmatic chart snapshot from verified records. No AI summary is used here.' })}
                </p>
              </div>
              <Link to={`${basePath}/patients/${patientIdParam}/chart`} className="btn border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] text-xs">
                {t('rx.openFullChart', { ns: 'patients', defaultValue: 'Open full chart' })}
              </Link>
            </div>

            {chartSummaryLoading ? (
              <div className="mt-3 grid grid-cols-2 lg:grid-cols-6 gap-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-20 rounded-lg bg-[var(--color-bg)] animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
                {ehrHighlightGroups.map((group) => (
                  <div key={group.key} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]/70 p-3 min-h-[92px]">
                    <p className="text-[11px] uppercase tracking-wide font-semibold text-[var(--color-text-muted)]">{group.label}</p>
                    {group.items.length > 0 ? (
                      <ul className="mt-2 space-y-1.5">
                        {group.items.map((item, index) => (
                          <li key={`${group.key}-${index}`} className="text-xs">
                            <span className="block font-medium text-[var(--color-text)] truncate">{item.title}</span>
                            {item.meta && <span className="block text-[var(--color-text-muted)] truncate">{item.meta}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">{group.empty}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Main 2-col layout ────────────────────────────────────────── */}
        <div className="grid lg:grid-cols-5 gap-6">

          {/* LEFT -- Rx / Medicines (3/5) */}
          <div className="lg:col-span-3 space-y-4">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[var(--color-text)] flex items-center gap-2">
                  <span className="text-2xl font-serif italic text-[var(--color-primary)]">Rx</span>
                  Medicines
                </h2>
                <button onClick={() => addItem()} className="btn-primary text-xs flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> {t('rx.addMedicine', { ns: 'patients', defaultValue: 'Add' })}
                </button>
              </div>

              {/* Medicine search */}
              <div className="relative mb-3">
                <input
                  value={medSearch}
                  onChange={e => setMedSearch(e.target.value)}
                  placeholder={t('rx.searchMedicine', { ns: 'patients', defaultValue: 'Search medicine to add...' })}
                  className="input w-full pr-8 text-sm"
                />
                {medResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-[var(--color-border)] rounded-lg shadow-lg">
                    {medResults.map((m, i) => (
                      <button key={`${m.name}-${i}`} onClick={() => { addItem({
                          medicine_name: m.name,
                          dosage: m.strength ?? '',
                          frequency: m.default_frequency ?? '1+1+1',
                          duration: m.default_duration ?? '',
                          instructions: m.default_instructions ?? '',
                          medicineId: m.medicine_id ?? undefined,
                        }); setMedSearch(''); setMedResults([]); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-primary)]/5 transition-colors">
                        <span className="font-medium">{m.name}</span>
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {[m.strength, m.dosage_form].filter(Boolean).map((detail) => (
                            <span key={detail} className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-text)]">
                              {detail}
                            </span>
                          ))}
                        </span>
                        {(m.generic || m.manufacturer) && (
                          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                            {[m.generic, m.manufacturer].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </button>
                    ))}
                    <button onClick={() => setMedResults([])} className="w-full text-center text-xs text-[var(--color-text-muted)] py-1 border-t border-[var(--color-border)]">
                      <X className="w-3 h-3 inline mr-1" />{t('common.close', { defaultValue: 'Close' })}
                    </button>
                  </div>
                )}
                {medSearch.trim().length >= 2 && medResults.length === 0 && (
                  <button
                    type="button"
                    onClick={searchExternalMedicines}
                    disabled={externalMedSearchLoading}
                    className="mt-2 text-xs text-[var(--color-primary)] hover:underline disabled:opacity-60"
                  >
                    {externalMedSearchLoading ? 'Searching external catalog...' : 'Search MedEx and cache'}
                  </button>
                )}
              </div>

              {/* Quick select */}
              <div className="flex flex-wrap gap-2 mb-4">
                {quickMedicineOptions.map(m => (
                  <button key={m.medicine_name}
                    onClick={() => addItem(m)}
                    className="text-xs border border-[var(--color-primary)] text-[var(--color-primary)] rounded-full px-3 py-1 hover:bg-[var(--color-primary)] hover:text-white transition-colors">
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Medicine table */}
              {items.length === 0 ? (
                <div className="text-center py-8 text-[var(--color-text-muted)] border-2 border-dashed border-[var(--color-border)] rounded-xl">
                  <FlaskConical className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  {t('rx.noMedicines', { ns: 'patients', defaultValue: 'No medicines added yet' })}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                        <th className="text-left py-2 pr-3 font-medium">{t('rx.medicine', { ns: 'patients', defaultValue: 'Medicine' })}</th>
                        <th className="text-left py-2 pr-3 font-medium w-24">{t('rx.dosage', { ns: 'patients', defaultValue: 'Dosage' })}</th>
                        <th className="text-left py-2 pr-3 font-medium w-28">{t('rx.frequency', { ns: 'patients', defaultValue: 'Frequency' })}</th>
                        <th className="text-left py-2 pr-3 font-medium w-24">{t('rx.duration', { ns: 'patients', defaultValue: 'Duration' })}</th>
                        <th className="text-left py-2 pr-3 font-medium w-20">{t('rx.quantity', { ns: 'patients', defaultValue: 'Qty' })}</th>
                        <th className="text-left py-2 pr-3 font-medium">{t('rx.instructions', { ns: 'patients', defaultValue: 'Instructions' })}</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <tr key={idx} className={idx % 2 === 0 ? 'bg-[var(--color-bg)]' : 'bg-white'}>
                          <td className="py-1.5 pr-3">
                            <input value={it.medicine_name} onChange={e => updateItem(idx, 'medicine_name', e.target.value)}
                              className="input w-full text-xs py-1" placeholder={t('rx.medicineNamePlaceholder', { ns: 'patients', defaultValue: 'Medicine name' })} />
                          </td>
                          <td className="py-1.5 pr-3">
                            <input value={it.dosage} onChange={e => updateItem(idx, 'dosage', e.target.value)}
                              className="input w-full text-xs py-1" placeholder={t("common.500mg")} />
                          </td>
                          <td className="py-1.5 pr-3">
                            <select value={it.frequency} onChange={e => updateItem(idx, 'frequency', e.target.value)}
                              className="input w-full text-xs py-1">
                              {it.frequency && !FREQUENCY_OPTIONS.includes(it.frequency) && (
                                <option value={it.frequency}>{it.frequency}</option>
                              )}
                              {FREQUENCY_OPTIONS.map(f => <option key={f}>{f}</option>)}
                            </select>
                          </td>
                          <td className="py-1.5 pr-3">
                            <input value={it.duration} onChange={e => updateItem(idx, 'duration', e.target.value)}
                              className="input w-full text-xs py-1" placeholder={t('rx.durationPlaceholder', { ns: 'patients', defaultValue: '5 Days' })} />
                          </td>
                          <td className="py-1.5 pr-3">
                            <input
                              type="number"
                              min={1}
                              value={it.quantity ?? ''}
                              onChange={e => updateItem(idx, 'quantity', e.target.value ? Number(e.target.value) : '')}
                              className="input w-full text-xs py-1"
                              placeholder={t('rx.quantityPlaceholder', { ns: 'patients', defaultValue: 'Qty' })}
                            />
                          </td>
                          <td className="py-1.5 pr-3">
                            <input value={it.instructions} onChange={e => updateItem(idx, 'instructions', e.target.value)}
                              className="input w-full text-xs py-1" placeholder={t('rx.instructionsPlaceholder', { ns: 'patients', defaultValue: 'After Food' })} />
                          </td>
                          <td className="py-1.5">
                            <button onClick={() => removeItem(idx)}
                              className="text-red-400 hover:text-red-600 transition-colors p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT -- Clinical Notes (2/5) */}
          <div className="lg:col-span-2 space-y-4">

            {/* Diagnosis */}
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-primary)]" />Diagnosis / ICD-10
              </h3>
              <input
                value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
                placeholder={t('rx.diagnosisPlaceholder', { ns: 'patients', defaultValue: 'e.g. J00 -- Common Cold, E11 -- Type 2 Diabetes' })}
                className="input w-full text-sm"
              />
            </div>

            {/* Examination Notes */}
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3">{t('rx.examination', { ns: 'patients', defaultValue: 'Examination / Findings' })}</h3>
              <textarea
                value={examinationNotes} onChange={e => setExaminationNotes(e.target.value)}
                rows={4} placeholder={t('rx.examinationPlaceholder', { ns: 'patients', defaultValue: 'Clinical examination findings...' })}
                className="input w-full text-sm resize-none"
              />
            </div>

            {/* Lab Tests */}
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />{t('rx.labTests', { ns: 'patients', defaultValue: 'Lab Tests Ordered' })}
              </h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
                <input
                  value={labSearch}
                  onChange={e => setLabSearch(e.target.value)}
                  placeholder={t('rx.searchLabTests', { ns: 'patients', defaultValue: 'Search lab tests from catalog...' })}
                  className="input w-full pl-9 text-sm"
                />
                {labSearch.trim().length >= 2 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-[var(--color-border)] rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {labResults.length > 0 ? labResults.map((test) => (
                      <button
                        key={test.id}
                        type="button"
                        onClick={() => addLabTestFromCatalog(test)}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--color-primary)]/5 transition-colors border-b border-[var(--color-border)] last:border-0"
                      >
                        <span className="text-sm font-medium text-[var(--color-text)]">{test.name}</span>
                        <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                          {[test.code, test.category, test.price != null ? `৳${Number(test.price)}` : null].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    )) : (
                      <div className="px-3 py-3 text-sm text-[var(--color-text-muted)]">
                        {t('rx.noLabTestsFound', { ns: 'patients', defaultValue: 'No matching catalog test found' })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {frequentLabTests.length > 0 && labSearch.trim().length < 2 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                    {t('rx.frequentLabTests', { ns: 'patients', defaultValue: 'Frequently used' })}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {frequentLabTests.map(test => (
                      <button
                        key={test}
                        type="button"
                        onClick={() => toggleLabTest(test)}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                          labTests.includes(test)
                            ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                            : 'bg-white text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                        }`}
                      >
                        {test}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedLabTestDetails.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedLabTestDetails.map(test => (
                    <span key={test.name} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-2.5 py-1 text-xs text-[var(--color-text)]">
                      <span>{test.name}</span>
                      {test.category ? <span className="text-[var(--color-text-muted)]">· {test.category}</span> : null}
                      <button
                        type="button"
                        onClick={() => removeLabTest(test.name)}
                        className="text-[var(--color-text-muted)] hover:text-red-600"
                        aria-label={`Remove ${test.name}`}
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                  {t('rx.searchLabTestsHint', { ns: 'patients', defaultValue: 'Search and select tests from the hospital lab catalog.' })}
                </p>
              )}
            </div>

            {/* Advice + Follow-up */}
            <div className="card p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-sm text-[var(--color-text)] mb-2">{t('rx.advice', { ns: 'patients', defaultValue: 'Advice to Patient' })}</h3>
                <textarea
                  value={advice} onChange={e => setAdvice(e.target.value)}
                  rows={3} placeholder={t('rx.advicePlaceholder', { ns: 'patients', defaultValue: 'Diet, rest, lifestyle advice...' })}
                  className="input w-full text-sm resize-none"
                />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-[var(--color-text)] mb-2">{t('rx.followUp', { ns: 'patients', defaultValue: 'Follow-up Date' })}</h3>
                <input
                  type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)}
                  className="input w-full text-sm"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {FOLLOW_UP_SHORTCUTS.map((shortcut) => (
                    <button
                      key={shortcut.key}
                      type="button"
                      onClick={() => applyFollowUpShortcut(shortcut)}
                      className="px-2.5 py-1 text-xs rounded-full border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                    >
                      {t(shortcut.labelKey, { ns: 'patients', defaultValue: shortcut.defaultValue })}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Share Link Card */}
            {shareUrl && (
              <div className="card p-4 border border-blue-200 bg-blue-50">
                <div className="flex items-center gap-2 mb-2">
                  <Share2 className="w-4 h-4 text-blue-600" />
                  <h3 className="font-semibold text-sm text-blue-800">{t('rx.shareLink', { ns: 'patients', defaultValue: 'Share Link (24h)' })}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <input readOnly value={shareUrl}
                    className="input flex-1 text-xs bg-white" />
                  <button onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success(t('rx.copied', { ns: 'patients', defaultValue: 'Copied!' })); }}
                    className="btn border border-blue-300 text-blue-700 p-2">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>


      {/* ── Sticky Action Bar ────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--color-border)] px-6 py-3 flex items-center justify-end gap-3 z-20 shadow-lg">
        {items.length === 0 && (
          <div className="flex items-center gap-1.5 text-amber-600 text-sm mr-auto">
            <AlertCircle className="w-4 h-4" />
            {t('rx.noMedicinesAdded', { ns: 'patients', defaultValue: 'No medicines added' })}
          </div>
        )}
        <button
          onClick={handleShare}
          disabled={sharing || !rxId}
          className="btn border border-blue-300 text-blue-700 hover:bg-blue-50 flex items-center gap-2 text-sm">
          <Share2 className="w-4 h-4" />
          {sharing ? t('rx.gettingLink', { ns: 'patients', defaultValue: 'Getting link...' }) : t('rx.share', { ns: 'patients', defaultValue: 'Share' })}
        </button>
        <button
          onClick={() => save('draft')}
          disabled={prescriptionSaveBlocked}
          className="btn border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] flex items-center gap-2 text-sm">
          <Save className="w-4 h-4" />
          {t('rx.saveDraft', { ns: 'patients', defaultValue: 'Save Draft' })}
        </button>
        <button
          onClick={handlePrint}
          className="btn border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 flex items-center gap-2 text-sm">
          <Printer className="w-4 h-4" />
          {t('common.print', { defaultValue: 'Print' })}
        </button>
        <button
          onClick={() => save('final')}
          disabled={prescriptionSaveBlocked}
          className="btn-primary flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {saving ? t('common.saving', { ns: 'patients', defaultValue: 'Saving...' }) : t('rx.finaliseRx', { ns: 'patients', defaultValue: 'Finalise Rx' })}
        </button>
        <button
          onClick={handleSaveAndPrint}
          disabled={prescriptionSaveBlocked}
          className="btn bg-gradient-to-r from-[var(--color-primary)] to-cyan-400 text-white flex items-center gap-2 shadow-md shadow-cyan-500/20">
          <Printer className="w-4 h-4" />
          {t('common.saveAndPrint', { defaultValue: 'Save & Print' })}
        </button>
      </div>
    </div>
  );
}
