import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Activity, ArrowRight, Bed, BookTemplate, CalendarPlus, ChevronDown, ChevronRight, ClipboardCheck, FlaskConical, FileText, PanelLeftClose, PanelLeftOpen, Pill, Plus, Printer, Save, ShieldAlert, Sparkles, Stethoscope, Trash2, UserRound, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/apiClient';
import { useAutoSave } from '../../hooks/useAutoSave';
import { AIScribe } from './AIScribe';
import { PatientAIWidget } from './PatientAIWidget';
import { PatientHeader } from './PatientHeader';
import { DoctorOrderStatusPanel, type DoctorOrderStatusItem } from './DoctorOrderStatusPanel';
import { DoctorPrescriptionSafetyPanel, type ClinicalSafetyFinding, type RxValidationWarning, safetyUiLevel } from './DoctorPrescriptionSafetyPanel';
import { buildMedicationSafetyPayload, buildPatientSafetyContext } from './doctorPrescriptionSafety';
import { PatientLabTrendsPanel } from './PatientLabTrendsPanel';
import { PatientSafetyOverrideHistoryPanel } from './PatientSafetyOverrideHistoryPanel';
import { ReportReviewPanel } from './ReportReviewPanel';
import { SmartPhrases } from './SmartPhrases';
import { QuickCodedDiagnosis, type CodedDiagnosisSelection } from './QuickCodedDiagnosis';
import type { Doctor, QueueItem } from './types';
import { formatDisplayDate } from '../../lib/date-utils';

interface DoctorWorkspaceDrawerProps {
  item: QueueItem;
  basePath: string;
  currentDoctor?: Doctor;
  availableDoctors: Doctor[];
  onClose: () => void;
  onRefresh: () => void;
  onComplete?: () => void;
  onUpdateStatus: (apptId: number, status: string) => void;
  onReassign: (apptId: number, doctorId: number, reason?: string) => void;
}

type SoapField = 'subjective' | 'objective' | 'assessment' | 'plan';

interface LabCatalogItem {
  id: number;
  name: string;
  code?: string;
  category?: string;
}

interface OrderedQuickItem {
  id: number;
  label: string;
  type: 'lab' | 'imaging';
  orderNo?: string;
  invoiceNo?: string;
  billingStatus?: string;
  total?: number;
  status?: string;
  orderedAt?: string;
  reportReady?: boolean;
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

interface QuickRxItem {
  medicine_name: string;
  medicineId?: number | null;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

interface PrescriptionSummary {
  id: number;
  rx_no?: string;
  status?: string;
}

interface PrescriptionDetail {
  items?: QuickRxItem[];
  advice?: string | null;
  diagnosis?: string | null;
  examination_notes?: string | null;
}

interface QuickOrderResponse {
  id: number;
  orderNo?: string;
  accessionNo?: string;
  invoiceNo?: string;
  total?: number;
  billingStatus?: string;
}

const CHIEF_COMPLAINT_CHIPS = ['Fever', 'Cough', 'Chest pain', 'Abdominal pain', 'Headache', 'Vomiting', 'Loose motion', 'Weakness', 'Follow up', 'Report show'];

const DIAGNOSIS_TEMPLATES = [
  {
    label: 'Fever',
    complaint: 'Fever',
    subjective: 'Fever with body ache. No danger sign reported.',
    assessment: 'Acute febrile illness',
    plan: 'Hydration, temperature monitoring, warning signs explained.',
  },
  {
    label: 'DM',
    complaint: 'Diabetes follow-up',
    subjective: 'Known diabetes mellitus. Review medication adherence and home glucose record.',
    assessment: 'Type 2 Diabetes Mellitus',
    plan: 'Continue diabetic diet, regular walking, glucose monitoring, follow-up with reports.',
  },
  {
    label: 'HTN',
    complaint: 'Hypertension follow-up',
    subjective: 'Known hypertension. Review BP record and medication adherence.',
    assessment: 'Hypertension',
    plan: 'Low-salt diet, BP monitoring, medication adherence, follow-up as advised.',
  },
  {
    label: 'Gastritis',
    complaint: 'Epigastric discomfort',
    subjective: 'Upper abdominal discomfort with acidity symptoms.',
    assessment: 'Dyspepsia / gastritis',
    plan: 'Avoid spicy food, tea/coffee excess and NSAID misuse. Review if alarm symptoms.',
  },
  {
    label: 'Child fever',
    complaint: 'Child fever',
    subjective: 'Fever in child. Feeding, activity, urine output and danger signs reviewed.',
    assessment: 'Acute febrile illness',
    plan: 'Hydration, tepid sponging if needed, danger signs explained to guardian.',
  },
  {
    label: 'ENT',
    complaint: 'ENT symptoms',
    subjective: 'Sore throat / nasal symptoms. Duration and fever history reviewed.',
    assessment: 'Upper respiratory tract infection',
    plan: 'Warm saline gargle, hydration, avoid cold exposure, review if breathing difficulty.',
  },
  {
    label: 'Skin allergy',
    complaint: 'Itching / rash',
    subjective: 'Itching/rash. Trigger, drug/food history and allergy history reviewed.',
    assessment: 'Allergic skin reaction',
    plan: 'Avoid suspected trigger. Review urgently if facial swelling or breathing difficulty.',
  },
];

const COMMON_LABS = ['CBC', 'RBS', 'HbA1c', 'Creatinine', 'Lipid Profile', 'TSH'];
const LAB_ALIASES: Record<string, string[]> = {
  RBS: ['RBS', 'Random Blood Sugar', 'Blood Sugar', 'Glucose Random', 'Glucose'],
  Creatinine: ['Creatinine', 'CREAT', 'Serum Creatinine'],
  HbA1c: ['HbA1c', 'HBA1C', 'Glycated Hemoglobin'],
  TSH: ['TSH', 'Thyroid Stimulating Hormone'],
};
const COMMON_IMAGING = [
  { label: 'CXR', type: 'X-Ray', item: 'Chest X-Ray PA View' },
  { label: 'USG Abdomen', type: 'Ultrasound', item: 'USG Whole Abdomen' },
  { label: 'USG KUB', type: 'Ultrasound', item: 'USG KUB' },
];
const PLAN_SHORTCUTS = ['Follow up after 7 days', 'Come earlier if symptoms worsen', 'Bring all previous reports', 'Lifestyle and diet advice explained'];
const RX_TEMPLATES: QuickRxItem[] = [
  { medicine_name: 'Paracetamol 500mg', dosage: '500mg', frequency: '1+1+1', duration: '5 days', instructions: 'After meal' },
  { medicine_name: 'Omeprazole 20mg', dosage: '20mg', frequency: '1+0+0', duration: '14 days', instructions: 'Before breakfast' },
  { medicine_name: 'Cetirizine 10mg', dosage: '10mg', frequency: '0+0+1', duration: '5 days', instructions: 'At night' },
  { medicine_name: 'ORS', dosage: '1 sachet', frequency: 'As needed', duration: '3 days', instructions: 'Mix with clean water' },
  { medicine_name: 'Metformin 500mg', dosage: '500mg', frequency: '0+1+1', duration: '1 month', instructions: 'After meal' },
  { medicine_name: 'Amlodipine 5mg', dosage: '5mg', frequency: '1+0+0', duration: '1 month', instructions: 'After breakfast' },
];
const DOSE_SHORTCUTS = ['1+0+0', '0+1+0', '0+0+1', '1+0+1', '1+1+1', 'SOS'];
const DURATION_SHORTCUTS = ['3 days', '5 days', '7 days', '10 days', '14 days', '1 month', 'Continue'];
const INSTRUCTION_SHORTCUTS = ['After meal', 'Before meal', 'Before sleep', 'Empty stomach', 'With water'];
const ADVICE_CHIPS = ['Drink plenty of water', 'Avoid oily food', 'Low salt diet', 'Diabetic diet', 'Bed rest', 'Report with test', 'Emergency if condition worsens'];

function appendLine(existing: string, next: string): string {
  return [existing, next].filter(Boolean).join(existing ? '\n' : '');
}

function initialSoapForItem(item: QueueItem) {
  return {
    chiefComplaint: item.chief_complaint ?? '',
    subjective: item.chief_complaint ? `Chief complaint: ${item.chief_complaint}` : '',
    objective: '',
    assessment: item.last_diagnosis ?? '',
    plan: '',
  };
}

function mapQuickOrdersToStatusItems(orders: OrderedQuickItem[]): DoctorOrderStatusItem[] {
  return orders.map((order) => ({
    id: order.id,
    type: order.type,
    label: order.label,
    orderNo: order.orderNo,
    invoiceNo: order.invoiceNo,
    billingStatus: order.billingStatus,
    status: order.status,
    total: order.total,
    orderedAt: order.orderedAt,
    reportReady: order.reportReady,
  }));
}

function normalizeCatalogText(value?: string | null): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findCatalogMatch(tests: LabCatalogItem[], label: string): LabCatalogItem | undefined {
  const aliases = [label, ...(LAB_ALIASES[label] ?? [])];
  const normalizedAliases = aliases.map(normalizeCatalogText).filter(Boolean);
  return tests.find((test) => {
    const name = normalizeCatalogText(test.name);
    const code = normalizeCatalogText(test.code);
    return normalizedAliases.some((alias) => name === alias || code === alias || name.includes(alias) || alias.includes(name));
  });
}

export function DoctorWorkspaceDrawer({
  item,
  basePath,
  currentDoctor,
  availableDoctors,
  onClose,
  onRefresh,
  onComplete,
  onUpdateStatus,
  onReassign,
}: DoctorWorkspaceDrawerProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeSoapField, setActiveSoapField] = useState<SoapField>('subjective');
  const appointmentId = item.appointment_id ?? null;
  const hasAppointmentId = appointmentId != null;
  const missingAppointmentMessage = t('missingAppointmentId', {
    defaultValue: 'Cannot continue: appointment id is missing for this queue entry.',
  });
  const isReportShow = item.visit_type === 'report_show';
  const [showFullConsultation, setShowFullConsultation] = useState(false);

  const initialSoapForm = useMemo(() => initialSoapForItem(item), [item.id, item.chief_complaint, item.last_diagnosis]);
  const [soapForm, setSoapForm] = useState(() => initialSoapForItem(item));
  const [codedDiagnosis, setCodedDiagnosis] = useState<CodedDiagnosisSelection | null>(null);
  // Re-seed patient-scoped draft state when the queue item changes so documentation
  // from a previous patient cannot carry over into the next consultation.
  useEffect(() => {
    setSoapForm(initialSoapForm);
    setCodedDiagnosis(null);
  }, [initialSoapForm]);
  const [labSearch, setLabSearch] = useState('');
  const [labOptions, setLabOptions] = useState<LabCatalogItem[]>([]);
  const [labTestId, setLabTestId] = useState('');
  const [labTestLabel, setLabTestLabel] = useState('');
  const [labInstructions, setLabInstructions] = useState('');
  const [orderedQuickItems, setOrderedQuickItems] = useState<OrderedQuickItem[]>([]);
  const [clinicalOrders, setClinicalOrders] = useState<DoctorOrderStatusItem[]>([]);
  const [clinicalOrdersLoading, setClinicalOrdersLoading] = useState(false);
  const [rxItems, setRxItems] = useState<QuickRxItem[]>([]);
  const [rxAdvice, setRxAdvice] = useState('');
  const [rxSearch, setRxSearch] = useState('');
  const [rxResults, setRxResults] = useState<MedicineSearchResult[]>([]);
  const [frequentMedicines, setFrequentMedicines] = useState<MedicineSearchResult[]>([]);
  const [externalRxSearchLoading, setExternalRxSearchLoading] = useState(false);
  const [rxId, setRxId] = useState<number | null>(null);
  const [rxNo, setRxNo] = useState('');
  const [rxStatus, setRxStatus] = useState<'draft' | 'final' | null>(null);
  const [radiologyForm, setRadiologyForm] = useState({ imaging_type_name: 'X-Ray', imaging_item_name: '', urgency: 'normal', requisition_remarks: '' });
  const [followUpForm, setFollowUpForm] = useState({ apptDate: '', apptTime: '', notes: '' });
  const [admitForm, setAdmitForm] = useState({ admissionReason: '', notes: '' });
  const [admissionNo, setAdmissionNo] = useState('');
  const [reassignDoctorId, setReassignDoctorId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [clinicalFindings, setClinicalFindings] = useState<ClinicalSafetyFinding[]>([]);
  const [safetyCheckId, setSafetyCheckId] = useState<number | null>(null);
  const [safetyOverrideReason, setSafetyOverrideReason] = useState('');
  const [showSafetyOverrideModal, setShowSafetyOverrideModal] = useState(false);
  const [pendingFinalize, setPendingFinalize] = useState(false);
  const [pendingComplete, setPendingComplete] = useState(false);
  const [safetyChecking, setSafetyChecking] = useState(false);
  const [rxAutoSaveState, setRxAutoSaveState] = useState<'idle' | 'creating' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [lastRxAutoSavedAt, setLastRxAutoSavedAt] = useState<string | null>(null);
  const initialDraftTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const initialDraftCreatingRef = useRef(false);
  const completionIdempotencyKeyRef = useRef<string | null>(null);
  const rxSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    completionIdempotencyKeyRef.current = null;
  }, [appointmentId]);

  function getCompletionIdempotencyKey(): string {
    if (!completionIdempotencyKeyRef.current) {
      const nonce = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      completionIdempotencyKeyRef.current = `doctor-completion:${appointmentId ?? 'unknown'}:${nonce}`;
    }
    return completionIdempotencyKeyRef.current;
  }

  function toggleSection(id: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function CollapsibleSection({ id, title, icon, children }: {
    id: string;
    title: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
  }) {
    const isOpen = expandedSections.has(id);
    return (
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <button type="button" onClick={() => toggleSection(id)} className="flex w-full items-center justify-between gap-2 text-left">
          <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
            {icon}
            {title}
          </h3>
          {isOpen ? <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" /> : <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />}
        </button>
        {isOpen && <div className="mt-3 space-y-3">{children}</div>}
      </section>
    );
  }
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [activeMobileTab, setActiveMobileTab] = useState<'facesheet' | 'soap' | 'rx'>('soap');
  const [activeDesktopWorkflow, setActiveDesktopWorkflow] = useState<'consult' | 'orders' | 'rx' | 'disposition'>('consult');

  const showCenterWorkflow = activeDesktopWorkflow === 'consult' || activeDesktopWorkflow === 'orders';
  const showRightWorkflow = activeDesktopWorkflow === 'rx' || activeDesktopWorkflow === 'disposition';
  const mainWorkflowSpanClass = leftPanelOpen ? 'md:col-span-8 lg:col-span-9' : 'md:col-span-12';
  const workflowVisibilityClass = (visible: boolean) => visible ? 'md:block' : 'md:hidden';
  const dispositionSectionClass = activeDesktopWorkflow === 'disposition' ? 'md:block' : 'md:hidden';

  const rxWarnings = useMemo(() => {
    const warnings: RxValidationWarning[] = [];
    const hasMeds = rxItems.some(rxItem => rxItem.medicine_name.trim());
    if (!hasMeds) {
      warnings.push({ field: 'items', severity: 'warning', message: t('warnNoMedicines', { defaultValue: 'No medicines prescribed' }) });
    }
    for (const rxItem of rxItems) {
      if (rxItem.medicine_name.trim() && !rxItem.dosage.trim()) {
        warnings.push({ field: 'dose', severity: 'warning', message: `${t('warnDoseMissing', { defaultValue: 'Dose missing' })}: ${rxItem.medicine_name}` });
      }
      if (rxItem.medicine_name.trim() && !rxItem.duration.trim()) {
        warnings.push({ field: 'duration', severity: 'warning', message: `${t('warnDurationMissing', { defaultValue: 'Duration missing' })}: ${rxItem.medicine_name}` });
      }
    }
    if (!soapForm.assessment?.trim()) {
      warnings.push({ field: 'diagnosis', severity: 'info', message: t('warnNoDiagnosis', { defaultValue: 'Diagnosis is empty' }) });
    }
    return warnings;
  }, [rxItems, soapForm.assessment, t]);

  const hasBlockingRxValidation = rxWarnings.some(w => w.severity === 'error');
  const hasBlockingClinicalSafety = clinicalFindings.some((finding) => safetyUiLevel(finding) === 'error');
  const hasBlockingWarning = hasBlockingRxValidation || hasBlockingClinicalSafety;

  const patientRiskFactors = useMemo(() => {
    const conditions = (item.medical_snapshot?.chronicConditions ?? []).map((value) => value.toLowerCase());
    return {
      isDiabetic: conditions.some((value) => value.includes('diabet') || value.includes('dm')),
      isHypertensive: conditions.some((value) => value.includes('hypertens') || value.includes('htn')),
      isPregnant: conditions.some((value) => value.includes('pregnan')),
      hasCKD: conditions.some((value) => value.includes('ckd') || value.includes('kidney') || value.includes('renal')),
      hasAsthma: conditions.some((value) => value.includes('asthma')),
      hasHeartDisease: conditions.some((value) => value.includes('heart') || value.includes('cardiac') || value.includes('chf')),
    };
  }, [item.medical_snapshot?.chronicConditions]);

  const patientSafetyContext = useMemo(() => buildPatientSafetyContext(item), [item]);

  useEffect(() => {
    const medicines = buildMedicationSafetyPayload(rxItems);

    if (medicines.length === 0) {
      setClinicalFindings([]);
      setSafetyCheckId(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSafetyChecking(true);
      try {
        const result = await api.post<{
          findings?: ClinicalSafetyFinding[];
          warnings?: ClinicalSafetyFinding[];
          safety_check_id?: number;
        }>('/api/e-prescribing/check-safety', {
          patient_id: item.patient_id,
          medications: medicines,
          prescription_id: rxId ?? undefined,
          patient_context: patientSafetyContext,
        });
        if (cancelled) return;
        setClinicalFindings(result.findings ?? result.warnings ?? []);
        setSafetyCheckId(result.safety_check_id ?? null);
      } catch {
        if (!cancelled) {
          setClinicalFindings([]);
          setSafetyCheckId(null);
        }
      } finally {
        if (!cancelled) setSafetyChecking(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [item.patient_id, patientSafetyContext, rxId, rxItems]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        if (rxStatus !== 'final' && hasPrescriptionContent()) {
          savePrescription('draft');
        }
      }
      if (e.altKey && key === 'm') {
        e.preventDefault();
        setActiveMobileTab('rx');
        setActiveDesktopWorkflow('rx');
        window.setTimeout(() => rxSearchInputRef.current?.focus(), 0);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rxStatus, rxItems, rxAdvice]);

  async function saveAsTemplate() {
    if (!templateName.trim()) {
      toast.error(t('enterTemplateName', { defaultValue: 'Enter template name' }));
      return;
    }
    setTemplateSaving(true);
    try {
      const items = rxItems
        .filter(rxItem => rxItem.medicine_name.trim())
        .map(rxItem => ({
          medicine: rxItem.medicine_name,
          dose: rxItem.dosage,
          frequency: rxItem.frequency,
          duration: rxItem.duration,
          instruction: rxItem.instructions,
        }));
      await api.post('/api/order-sets', {
        name: templateName,
        category: 'prescription',
        specialty: currentDoctor?.specialty ?? null,
        items: items.map(rxItem => ({
          item_type: 'medication',
          item_name: rxItem.medicine,
          item_details: JSON.stringify({
            dose: rxItem.dose,
            frequency: rxItem.frequency,
            duration: rxItem.duration,
            instruction: rxItem.instruction,
          }),
        })),
      });
      toast.success(t('templateSaved', { defaultValue: 'Template saved' }));
      setShowTemplateModal(false);
      setTemplateName('');
    } catch {
      toast.error(t('templateSaveFailed', { defaultValue: 'Failed to save template' }));
    } finally {
      setTemplateSaving(false);
    }
  }

  useEffect(() => {
    if (labSearch.trim().length < 2) {
      setLabOptions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.get<{ tests: LabCatalogItem[] }>(`/api/lab?search=${encodeURIComponent(labSearch.trim())}`)
        .then((data) => { if (!cancelled) setLabOptions(data.tests ?? []); })
        .catch(() => { if (!cancelled) setLabOptions([]); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [labSearch]);

  useEffect(() => {
    if (rxSearch.trim().length < 2) {
      setRxResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.get<{ medicines: MedicineSearchResult[] }>(`/api/e-prescribing/formulary/search?q=${encodeURIComponent(rxSearch.trim())}`)
        .then((data) => { if (!cancelled) setRxResults(data.medicines ?? []); })
        .catch(() => { if (!cancelled) setRxResults([]); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [rxSearch]);

  useEffect(() => {
    api.get<{ medicines: MedicineSearchResult[] }>('/api/e-prescribing/formulary/frequent?limit=8')
      .then((data) => setFrequentMedicines(data.medicines ?? []))
      .catch(() => setFrequentMedicines([]));
  }, []);

  const quickRxTemplates = useMemo<QuickRxItem[]>(() => (
    frequentMedicines.length > 0
      ? frequentMedicines.map((medicine) => ({
        medicine_name: medicine.name,
        dosage: medicine.strength ?? '',
        frequency: medicine.default_frequency ?? '1+1+1',
        duration: medicine.default_duration ?? '',
        instructions: medicine.default_instructions ?? 'After meal',
      }))
      : RX_TEMPLATES
  ), [frequentMedicines]);

  const searchExternalRxMedicines = useCallback(async () => {
    const search = rxSearch.trim();
    if (search.length < 2 || externalRxSearchLoading) return;

    setExternalRxSearchLoading(true);
    try {
      const data = await api.get<{ medicines: MedicineSearchResult[] }>(`/api/e-prescribing/formulary/external-search?q=${encodeURIComponent(search)}`);
      setRxResults(data.medicines ?? []);
      if (!data.medicines?.length) {
        toast.error(t('noExternalMedicineFound', { defaultValue: 'No external medicine found' }));
      }
    } catch {
      toast.error(t('externalMedicineSearchFailed', { defaultValue: 'External medicine search failed' }));
    } finally {
      setExternalRxSearchLoading(false);
    }
  }, [externalRxSearchLoading, rxSearch, t]);

  const updateSoap = useCallback((field: SoapField, value: string) => {
    setActiveSoapField(field);
    setSoapForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const appendToSoap = useCallback((text: string) => {
    setSoapForm(prev => ({
      ...prev,
      [activeSoapField]: appendLine(prev[activeSoapField], text),
    }));
  }, [activeSoapField]);

  const applyTemplate = useCallback((template: typeof DIAGNOSIS_TEMPLATES[number]) => {
    setSoapForm(prev => ({
      chiefComplaint: prev.chiefComplaint || template.complaint,
      subjective: appendLine(prev.subjective, template.subjective),
      objective: prev.objective,
      assessment: prev.assessment || template.assessment,
      plan: appendLine(prev.plan, template.plan),
    }));
    setActiveSoapField('plan');
  }, []);

  const addChiefComplaint = useCallback((complaint: string) => {
    setSoapForm(prev => ({
      ...prev,
      chiefComplaint: prev.chiefComplaint ? `${prev.chiefComplaint}, ${complaint}` : complaint,
      subjective: appendLine(prev.subjective, `Chief complaint: ${complaint}`),
    }));
    setActiveSoapField('subjective');
  }, []);

  const addRxItem = useCallback((itemToAdd?: Partial<QuickRxItem>) => {
    setRxItems(prev => [...prev, {
      medicine_name: itemToAdd?.medicine_name ?? '',
      dosage: itemToAdd?.dosage ?? '',
      frequency: itemToAdd?.frequency ?? '1+1+1',
      duration: itemToAdd?.duration ?? '',
      instructions: itemToAdd?.instructions ?? '',
    }]);
  }, []);

  const addMedicineSearchResult = useCallback((medicine: MedicineSearchResult) => {
    addRxItem({
      medicine_name: medicine.name,
      medicineId: medicine.medicine_id ?? undefined,
      dosage: medicine.strength ?? '',
      frequency: medicine.default_frequency ?? '1+1+1',
      duration: medicine.default_duration ?? '',
      instructions: medicine.default_instructions ?? 'After meal',
    });
    setRxSearch('');
    setRxResults([]);
  }, [addRxItem]);

  const handleRxSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const firstResult = rxResults[0];
    if (!firstResult) return;
    event.preventDefault();
    addMedicineSearchResult(firstResult);
  }, [addMedicineSearchResult, rxResults]);

  const updateRxItem = useCallback((index: number, field: keyof QuickRxItem, value: string) => {
    setRxItems(prev => prev.map((rxItem, rxIndex) => rxIndex === index ? { ...rxItem, [field]: value } : rxItem));
  }, []);

  const removeRxItem = useCallback((index: number) => {
    setRxItems(prev => prev.filter((_, rxIndex) => rxIndex !== index));
  }, []);

  const appendRxAdvice = useCallback((advice: string) => {
    setRxAdvice(prev => appendLine(prev, advice));
  }, []);

  async function runAction(key: string, action: () => Promise<void>, success: string, failure: string) {
    setSaving(key);
    try {
      await action();
      toast.success(success);
      onRefresh();
      return true;
    } catch (error: any) {
      console.error(`[DoctorWorkspaceDrawer] ${key} failed`, error);
      const backendMessage = error?.message || error?.data?.message;
      if (backendMessage && backendMessage.includes('Prescription blocked')) {
        toast.error(backendMessage, { duration: 6000, icon: '⚠️' });
      } else {
        toast.error(backendMessage || failure);
      }
      return false;
    } finally {
      setSaving(null);
    }
  }

  const buildPrescriptionPayload = useCallback((status: 'draft' | 'final', options: { includeId?: boolean } = {}) => {
    const medicineItems = rxItems
      .filter(rxItem => rxItem.medicine_name.trim())
      .map((rxItem, index) => ({
        ...rxItem,
        sort_order: index,
      }));
    const orderedTests = orderedQuickItems
      .filter(order => order.type === 'lab')
      .map(order => order.label);

    return {
      patientId: item.patient_id,
      doctorId: currentDoctor?.id,
      appointmentId: appointmentId ?? undefined,
      chiefComplaint: soapForm.chiefComplaint || undefined,
      diagnosis: soapForm.assessment || undefined,
      examinationNotes: soapForm.objective || undefined,
      advice: [soapForm.plan, rxAdvice].filter(Boolean).join('\n') || undefined,
      labTests: orderedTests.length ? orderedTests : undefined,
      followUpDate: followUpForm.apptDate || undefined,
      status,
      items: medicineItems,
      ...(status === 'final' && safetyCheckId && safetyOverrideReason.trim()
        ? { safetyCheckId, safetyOverrideReason: safetyOverrideReason.trim() }
        : {}),
      ...(options.includeId && rxId ? { id: rxId } : {}),
    };
  }, [
    currentDoctor?.id,
    followUpForm.apptDate,
    appointmentId,
    item.patient_id,
    orderedQuickItems,
    rxAdvice,
    rxId,
    rxItems,
    safetyCheckId,
    safetyOverrideReason,
    soapForm.assessment,
    soapForm.chiefComplaint,
    soapForm.objective,
    soapForm.plan,
  ]);

  const { save: autoSavePrescriptionDraft, isPending: autoSavePending, isDirty: autoSaveDirty, isError: autoSaveError } = useAutoSave({
    endpoint: rxId ? `/api/prescriptions/${rxId}/auto-save` : '/api/prescriptions/0/auto-save',
    debounceMs: 3000,
    handleVisibilityChange: true,
    handleBeforeUnload: true,
    onSuccess: () => {
      setRxAutoSaveState('saved');
      setLastRxAutoSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    },
    onError: () => setRxAutoSaveState('error'),
  });

  const draftAutoSavePayload = useMemo(() => buildPrescriptionPayload('draft'), [buildPrescriptionPayload]);


  const hasMeaningfulRxDraftContent = useMemo(() => Boolean(
    rxItems.some(rxItem => rxItem.medicine_name.trim())
      || rxAdvice.trim()
      || followUpForm.apptDate
      || orderedQuickItems.some(order => order.type === 'lab'),
  ), [followUpForm.apptDate, orderedQuickItems, rxAdvice, rxItems]);

  const hasUnsavedNonRxClinicalWork = useMemo(() => {
    const soapChanged = (Object.keys(initialSoapForm) as Array<keyof typeof initialSoapForm>)
      .some((key) => soapForm[key] !== initialSoapForm[key]);
    return soapChanged
      || Boolean(codedDiagnosis)
      || Boolean(labTestId || labTestLabel.trim() || labInstructions.trim())
      || Boolean(radiologyForm.imaging_item_name.trim() || radiologyForm.requisition_remarks.trim())
      || Object.values(followUpForm).some((value) => value.trim())
      || Object.values(admitForm).some((value) => value.trim());
  }, [admitForm, codedDiagnosis, followUpForm, initialSoapForm, labInstructions, labTestId, labTestLabel, radiologyForm, soapForm]);

  const hasUnsavedClinicalWork = hasUnsavedNonRxClinicalWork || Boolean(
    autoSaveDirty
      || (hasMeaningfulRxDraftContent && rxStatus !== 'final' && (
        !rxId || ['dirty', 'creating', 'saving', 'error'].includes(rxAutoSaveState)
      )),
  );

  const requestClose = useCallback(() => {
    if (hasUnsavedClinicalWork) {
      const confirmed = window.confirm(t('confirmCloseUnsavedClinicalWork', {
        defaultValue: 'You have unsaved clinical work. Close this consultation and discard those changes?',
      }));
      if (!confirmed) return;
    }
    onClose();
  }, [hasUnsavedClinicalWork, onClose, t]);

  useEffect(() => {
    if (!hasUnsavedClinicalWork) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedClinicalWork]);

  useEffect(() => {
    if (rxStatus === 'final') return;
    if (!hasAppointmentId || appointmentId == null) return;
    if (rxId || !hasMeaningfulRxDraftContent || initialDraftCreatingRef.current) return;

    if (initialDraftTimerRef.current) window.clearTimeout(initialDraftTimerRef.current);
    setRxAutoSaveState('dirty');

    initialDraftTimerRef.current = window.setTimeout(async () => {
      if (initialDraftCreatingRef.current || rxId) return;
      initialDraftCreatingRef.current = true;
      setRxAutoSaveState('creating');
      try {
        const result = await api.post<{
          prescription?: { id?: number; rxNo?: string; status?: 'draft' | 'final' } | null;
        }>(`/api/doctors/dashboard/appointments/${appointmentId}/complete-consultation`, {
          prescription: buildPrescriptionPayload('draft'),
          completeVisit: false,
        });
        if (result.prescription?.id) {
          setRxId(result.prescription.id);
          setRxNo(result.prescription.rxNo ?? rxNo);
          setRxStatus(result.prescription.status ?? 'draft');
          setRxAutoSaveState('saved');
          setLastRxAutoSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } else {
          setRxAutoSaveState('error');
        }
      } catch (error) {
        console.error('[DoctorWorkspaceDrawer] initial draft auto-create failed', error);
        setRxAutoSaveState('error');
      } finally {
        initialDraftCreatingRef.current = false;
      }
    }, 1800);

    return () => {
      if (initialDraftTimerRef.current) window.clearTimeout(initialDraftTimerRef.current);
    };
  }, [appointmentId, buildPrescriptionPayload, hasAppointmentId, hasMeaningfulRxDraftContent, rxId, rxNo, rxStatus]);

  useEffect(() => {
    if (!rxId || rxStatus !== 'draft') return;
    const hasDraftContent = Boolean(
      draftAutoSavePayload.items.length
        || draftAutoSavePayload.advice
        || draftAutoSavePayload.diagnosis
        || draftAutoSavePayload.chiefComplaint
        || draftAutoSavePayload.examinationNotes
        || draftAutoSavePayload.labTests?.length,
    );
    if (!hasDraftContent) return;
    autoSavePrescriptionDraft(draftAutoSavePayload as Record<string, unknown>);
  }, [autoSavePrescriptionDraft, draftAutoSavePayload, rxId, rxStatus]);


  useEffect(() => {
    if (autoSavePending) setRxAutoSaveState('saving');
    else if (autoSaveError) setRxAutoSaveState('error');
    else if (autoSaveDirty) setRxAutoSaveState('dirty');
  }, [autoSaveDirty, autoSaveError, autoSavePending]);

  const hasPrescriptionContent = useCallback((): boolean => {
    return rxItems.some(rxItem => rxItem.medicine_name.trim()) || Boolean(rxAdvice.trim());
  }, [rxItems, rxAdvice]);

  const hasOrderContent = orderedQuickItems.length > 0;
  const hasSoapContent = useMemo(() => Object.values(soapForm).some(value => String(value ?? '').trim()), [soapForm]);
  const hasClinicalDocumentation = useMemo(
    () => hasSoapContent || Boolean(codedDiagnosis) || hasPrescriptionContent() || hasOrderContent,
    [codedDiagnosis, hasOrderContent, hasSoapContent, hasPrescriptionContent],
  );
  const displayedOrderStatusItems = useMemo(() => (
    clinicalOrders.length > 0 ? clinicalOrders : mapQuickOrdersToStatusItems(orderedQuickItems)
  ), [clinicalOrders, orderedQuickItems]);

  useEffect(() => {
    let cancelled = false;
    if (!hasAppointmentId || appointmentId == null) {
      setClinicalOrders([]);
      setClinicalOrdersLoading(false);
      return () => { cancelled = true; };
    }
    async function loadClinicalOrders() {
      setClinicalOrdersLoading(true);
      try {
        const result = await api.get<{ orders?: DoctorOrderStatusItem[] }>(`/api/doctors/dashboard/appointments/${appointmentId}/clinical-orders`);
        if (!cancelled) setClinicalOrders(result.orders ?? []);
      } catch (error) {
        if (!cancelled) setClinicalOrders([]);
      } finally {
        if (!cancelled) setClinicalOrdersLoading(false);
      }
    }
    loadClinicalOrders();
    return () => { cancelled = true; };
  }, [appointmentId, hasAppointmentId, orderedQuickItems.length]);

  async function persistPrescription(status: 'draft' | 'final') {
    if (appointmentId == null) {
      throw new Error(missingAppointmentMessage);
    }
    const payload = buildPrescriptionPayload(status);
    if (!payload.items.length && !payload.advice && !payload.diagnosis) {
      throw new Error('Add medicine, advice, or diagnosis before saving prescription');
    }
    if (rxStatus === 'final') return { id: rxId, rxNo };

    if (rxId) {
      await api.put(`/api/prescriptions/${rxId}`, payload);
      setRxStatus(status);
      return { id: rxId, rxNo };
    }

    const created = await api.post<{ id: number; rxNo: string }>('/api/prescriptions', payload);
    setRxId(created.id);
    setRxNo(created.rxNo);
    setRxStatus(status);
    return created;
  }

  async function recordSafetyOverrideIfNeeded(): Promise<boolean> {
    if (!hasBlockingClinicalSafety) return true;
    if (!safetyCheckId) return false;
    if (!safetyOverrideReason.trim()) {
      setShowSafetyOverrideModal(true);
      return false;
    }
    await api.put(`/api/e-prescribing/safety-checks/${safetyCheckId}/override`, {
      action_taken: 'overridden',
      override_reason: safetyOverrideReason.trim(),
    });
    return true;
  }

  async function savePrescription(status: 'draft' | 'final') {
    if (status === 'final' && hasBlockingClinicalSafety && !safetyOverrideReason.trim()) {
      setPendingFinalize(true);
      setShowSafetyOverrideModal(true);
      return;
    }

    await runAction(
      `rx-${status}`,
      async () => {
        if (status === 'final') {
          const allowed = await recordSafetyOverrideIfNeeded();
          if (!allowed) throw new Error('Clinical safety override required');
        }
        await persistPrescription(status);
        if (status === 'final') {
          setSafetyOverrideReason('');
          setPendingFinalize(false);
        }
      },
      status === 'final'
        ? t('prescriptionFinalized', { defaultValue: 'Prescription finalized' })
        : t('prescriptionDraftSaved', { defaultValue: 'Prescription draft saved' }),
      status === 'final'
        ? t('prescriptionFinalizeFailed', { defaultValue: 'Failed to finalize prescription' })
        : t('prescriptionSaveFailed', { defaultValue: 'Failed to save prescription' }),
    );
  }

  async function repeatLastPrescription() {
    await runAction(
      'repeat-rx',
      async () => {
        const list = await api.get<{ prescriptions?: PrescriptionSummary[] }>(`/api/prescriptions?patient=${item.patient_id}`);
        const last = list.prescriptions?.find(prescription => prescription.id && prescription.id !== rxId);
        if (!last?.id) throw new Error('No previous prescription found');
        const detail = await api.get<PrescriptionDetail>(`/api/prescriptions/${last.id}`);
        const previousItems = (detail.items ?? [])
          .filter(rxItem => rxItem.medicine_name)
          .map(rxItem => ({
            medicine_name: rxItem.medicine_name,
            dosage: rxItem.dosage ?? '',
            frequency: rxItem.frequency ?? '1+1+1',
            duration: rxItem.duration ?? '',
            instructions: rxItem.instructions ?? '',
          }));
        if (!previousItems.length) throw new Error('Previous prescription has no medicines');
        setRxItems(previousItems);
        if (detail.advice) setRxAdvice(detail.advice);
        setSoapForm(prev => ({
          ...prev,
          assessment: prev.assessment || detail.diagnosis || '',
          objective: prev.objective || detail.examination_notes || '',
        }));
      },
      'Previous prescription loaded',
      'No previous prescription to repeat',
    );
  }

  function printPrescription() {
    if (!rxId) {
      toast.error(t('savePrescriptionFirst', { defaultValue: 'Save prescription first' }));
      return;
    }
    window.open(`${basePath}/prescriptions/${rxId}/print`, '_blank');
  }

  async function saveSoap(e: React.FormEvent) {
    e.preventDefault();
    if (codedDiagnosis) {
      if (appointmentId == null) {
        toast.error(missingAppointmentMessage);
        return;
      }
      const hasSoap = Object.values(soapForm).some((value) => String(value ?? '').trim());
      await runAction(
        'soap',
        () => api.post(`/api/doctors/dashboard/appointments/${appointmentId}/complete-consultation`, {
          soap: hasSoap ? soapForm : undefined,
          codedDiagnosis,
          completeVisit: false,
        }),
        t('soapDiagnosisSaved', { defaultValue: 'SOAP note and coded diagnosis saved' }),
        t('soapSaveFailed', { defaultValue: 'Failed to save SOAP note' }),
      );
      return;
    }

    await runAction(
      'soap',
      () => api.post(`/api/patients/${item.patient_id}/chart/soap`, soapForm),
      t('soapSaved', { defaultValue: 'SOAP note saved' }),
      t('soapSaveFailed', { defaultValue: 'Failed to save SOAP note' }),
    );
  }

  async function orderLab(e: React.FormEvent) {
    e.preventDefault();
    if (!labTestId) return;
    await runAction(
      'lab',
      async () => {
        const result = await api.post<QuickOrderResponse>(`/api/patients/${item.patient_id}/chart/lab-order`, {
          tests: [{ lab_test_id: Number(labTestId), instructions: labInstructions || undefined }],
          notes: labInstructions || undefined,
        });
        setOrderedQuickItems(prev => [...prev, { id: result.id ?? Date.now(), label: labTestLabel || labSearch || `Test #${labTestId}`, type: 'lab', orderNo: result.orderNo, invoiceNo: result.invoiceNo, billingStatus: result.billingStatus, total: result.total }]);
      },
      t('labOrderCreated', { defaultValue: 'Lab order created' }),
      t('labOrderFailed', { defaultValue: 'Failed to create lab order' }),
    );
    setLabTestId('');
    setLabTestLabel('');
    setLabInstructions('');
    setLabSearch('');
  }

  async function orderCommonLab(testName: string) {
    await runAction(
      `lab-${testName}`,
      async () => {
        const aliases = [testName, ...(LAB_ALIASES[testName] ?? [])];
        const results = await Promise.all(aliases.map((term) => api.get<{ tests: LabCatalogItem[] }>(`/api/lab?search=${encodeURIComponent(term)}`).catch(() => ({ tests: [] }))));
        const tests = results.flatMap((result) => result.tests ?? []);
        const match = findCatalogMatch(tests, testName);
        if (!match?.id) {
          throw new Error(`No lab catalog match for ${testName}`);
        }
        const result = await api.post<QuickOrderResponse>(`/api/patients/${item.patient_id}/chart/lab-order`, {
          tests: [{ lab_test_id: Number(match.id) }],
          notes: `Quick order: ${match.name}`,
        });
        setOrderedQuickItems(prev => [...prev, { id: result.id ?? Date.now(), label: match.name, type: 'lab', orderNo: result.orderNo, invoiceNo: result.invoiceNo, billingStatus: result.billingStatus, total: result.total }]);
      },
      t('quickLabOrderCreated', { testName, defaultValue: `${testName} order created` }),
      t('quickLabOrderFailed', { testName, defaultValue: `${testName} is not configured in the lab catalog` }),
    );
  }

  async function orderImaging(e: React.FormEvent) {
    e.preventDefault();
    if (!radiologyForm.imaging_item_name.trim()) return;
    await runAction(
      'imaging',
      async () => {
        const result = await api.post<QuickOrderResponse>(`/api/patients/${item.patient_id}/chart/radiology-order`, radiologyForm);
        setOrderedQuickItems(prev => [...prev, { id: result.id ?? Date.now(), label: radiologyForm.imaging_item_name, type: 'imaging', orderNo: result.accessionNo, invoiceNo: result.invoiceNo, billingStatus: result.billingStatus, total: result.total }]);
      },
      t('imagingOrderCreated', { defaultValue: 'Imaging order created' }),
      t('imagingOrderFailed', { defaultValue: 'Failed to create imaging order' }),
    );
    setRadiologyForm({ imaging_type_name: 'X-Ray', imaging_item_name: '', urgency: 'normal', requisition_remarks: '' });
  }

  async function orderCommonImaging(imaging: typeof COMMON_IMAGING[number]) {
    await runAction(
      `imaging-${imaging.label}`,
      async () => {
        const result = await api.post<QuickOrderResponse>(`/api/patients/${item.patient_id}/chart/radiology-order`, {
          imaging_type_name: imaging.type,
          imaging_item_name: imaging.item,
          urgency: 'normal',
          requisition_remarks: `Quick order: ${imaging.item}`,
        });
        setOrderedQuickItems(prev => [...prev, { id: result.id ?? Date.now(), label: imaging.item, type: 'imaging', orderNo: result.accessionNo, invoiceNo: result.invoiceNo, billingStatus: result.billingStatus, total: result.total }]);
      },
      t('quickImagingOrderCreated', { label: imaging.label, defaultValue: `${imaging.label} order created` }),
      t('quickImagingOrderFailed', { label: imaging.label, defaultValue: `Failed to order ${imaging.label}` }),
    );
  }

  async function scheduleFollowUp(e: React.FormEvent) {
    e.preventDefault();
    await submitFollowUp();
  }

  async function admitPatient() {
    const emergency = String(item.visit_type ?? '').includes('emergency') || item.queue_priority === 'emergency';
    const reason = admitForm.admissionReason.trim() || soapForm.assessment || soapForm.chiefComplaint || item.chief_complaint || 'Advised admission from OPD consultation';
    await runAction(
      'admit',
      async () => {
        const result = await api.post<{ admission_no?: string; admission_id?: number }>('/api/admissions', {
          patient_id: item.patient_id,
          doctor_id: currentDoctor?.id,
          admission_type: emergency ? 'emergency' : 'planned',
          admit_source: 'opd_referral',
          referral_doctor: currentDoctor?.name,
          admission_reason: reason,
          is_emergency: emergency,
          provisional_diagnosis: soapForm.assessment || undefined,
          notes: admitForm.notes.trim() || soapForm.plan || undefined,
          idempotencyKey: `doctor-admit-${appointmentId}-${item.patient_id}`,
        });
        setAdmissionNo(result.admission_no ?? '');
      },
      t('admissionRequestSent', { defaultValue: 'Admission request sent to IPD' }),
      t('admissionRequestFailed', { defaultValue: 'Failed to admit patient' }),
    );
  }

  async function submitFollowUp() {
    if (!followUpForm.apptDate) return;
    await runAction(
      'follow-up',
      () => api.post(`/api/patients/${item.patient_id}/chart/follow-up`, followUpForm),
      t('followUpScheduled', { defaultValue: 'Follow-up scheduled' }),
      t('followUpFailed', { defaultValue: 'Failed to schedule follow-up' }),
    );
    setFollowUpForm({ apptDate: '', apptTime: '', notes: '' });
  }

  async function saveSoapAndComplete() {
    if (appointmentId == null) {
      toast.error(missingAppointmentMessage);
      return;
    }
    if (!hasClinicalDocumentation) {
      toast.error(t('completeBlockedByDocumentation', { defaultValue: 'Add a SOAP note, coded diagnosis, prescription, or clinical order before completing the visit.' }));
      setActiveMobileTab('soap');
      setActiveDesktopWorkflow('consult');
      return;
    }
    if (hasBlockingRxValidation) {
      toast.error(t('completeBlockedBySafety', { defaultValue: 'Fix prescription safety warnings before completing the visit.' }));
      return;
    }
    if (hasBlockingClinicalSafety) {
      if (!safetyOverrideReason.trim()) {
        setPendingComplete(true);
        setShowSafetyOverrideModal(true);
        return;
      }
      const allowed = await recordSafetyOverrideIfNeeded();
      if (!allowed) {
        setPendingComplete(true);
        return;
      }
    }
    const completed = await runAction(
      'complete',
      async () => {
        const hasSoap = Object.values(soapForm).some(value => String(value ?? '').trim());
        const result = await api.post<{
          prescription?: { id?: number; rxNo?: string; status?: 'draft' | 'final' } | null;
        }>(`/api/doctors/dashboard/appointments/${appointmentId}/complete-consultation`, {
          soap: hasSoap ? soapForm : undefined,
          codedDiagnosis: codedDiagnosis ?? undefined,
          prescription: hasPrescriptionContent() && rxStatus !== 'final'
            ? buildPrescriptionPayload('final', { includeId: true })
            : undefined,
          orderSummary: hasOrderContent ? { count: orderedQuickItems.length } : undefined,
          completionIdempotencyKey: getCompletionIdempotencyKey(),
          completeVisit: true,
        });
        if (result.prescription?.id) {
          setRxId(result.prescription.id);
          setRxNo(result.prescription.rxNo ?? rxNo);
          setRxStatus(result.prescription.status ?? 'final');
        }
      },
      t('visitCompleted', { defaultValue: 'Visit completed' }),
      t('visitCompleteFailed', { defaultValue: 'Failed to complete visit' }),
    );
    if (!completed) return;
    completionIdempotencyKeyRef.current = null;
    onClose();
    onComplete?.();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <div className="w-full max-w-6xl h-full bg-[var(--color-bg)] shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-20 bg-[var(--color-bg)] border-b border-[var(--color-border)]">
          <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3 border-b border-[var(--color-border)]">
            <h2 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
              {t('consultationWorkspace', { defaultValue: 'Consultation Workspace' })}
            </h2>
            <div className="flex items-center gap-2 flex-wrap justify-end">
            {isReportShow && (
              <button
                type="button"
                onClick={() => setShowFullConsultation((prev) => !prev)}
                className="btn-ghost text-sm text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100"
              >
                {showFullConsultation ? 'Back to Report Review' : 'Switch to Full Consultation'}
              </button>
            )}
            <Link to={`${basePath}/patients/${item.patient_id}/chart`} className="btn-ghost text-sm">
              {t('openFullChart', { defaultValue: 'Full Chart' })} <ArrowRight className="w-4 h-4" />
            </Link>
            <button onClick={requestClose} className="btn-ghost p-2" aria-label={t('common:close', { defaultValue: 'Close' })}>
              <X className="w-5 h-5" />
            </button>
            </div>
          </div>
          <PatientHeader
            patient={item}
            bloodGroup={item.medical_snapshot?.bloodGroup ?? undefined}
            riskFactors={patientRiskFactors}
          />
        </div>

        {isReportShow && !showFullConsultation ? (
          <div className="p-4 sm:p-6 pb-28">
            {appointmentId != null ? (
              <ReportReviewPanel
                patientId={item.patient_id}
                appointmentId={appointmentId}
                onComplete={() => { onClose(); onComplete?.(); }}
              />
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                {missingAppointmentMessage}
              </div>
            )}
          </div>
        ) : (
        <>
        {/* Mobile tabs - visible below md (768px) */}
        <div className="md:hidden sticky top-[57px] z-10 bg-[var(--color-bg)] border-b border-[var(--color-border)] px-4 py-2 flex gap-1">
          {([['facesheet', 'Face Sheet'], ['soap', 'SOAP & Orders'], ['rx', 'Rx & Admit']] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveMobileTab(tab)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeMobileTab === tab
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="hidden md:flex px-4 sm:px-6 pt-4 gap-2">
          {([
            ['consult', 'Consult'],
            ['orders', 'Orders'],
            ['rx', 'Rx'],
            ['disposition', 'Disposition'],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveDesktopWorkflow(tab)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                activeDesktopWorkflow === tab
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-6 pb-28 grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Left panel - Face Sheet + AI Summary + Queue Controls */}
          <div className={`md:col-span-4 lg:col-span-3 space-y-4 ${activeMobileTab === 'facesheet' ? '' : 'hidden md:block'} ${leftPanelOpen ? '' : 'md:hidden'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Patient Info</span>
              <button type="button" onClick={() => setLeftPanelOpen(false)} className="btn-ghost p-1.5" aria-label="Close panel">
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            <section data-testid="clinical-context-panel" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--color-primary)]" />
                {t('clinicalContext', { defaultValue: 'Smart Face Sheet' })}
              </h3>
              <div className="space-y-2 text-xs">
                <div className="rounded bg-[var(--color-bg)] p-2">
                  <span className="text-[var(--color-text-muted)]">ALLERGY</span>
                  <div className="font-semibold text-red-700">{item.allergy_summary || (Number(item.allergy_count ?? 0) > 0 ? `${item.allergy_count} recorded` : 'None recorded')}</div>
                </div>
                <div className="rounded bg-[var(--color-bg)] p-2">
                  <span className="text-[var(--color-text-muted)]">Latest vitals</span>
                  <div className="font-semibold">{item.latest_vitals_summary || (Number(item.vitals_count ?? 0) > 0 ? `${item.vitals_count} entries` : 'Not recorded')}</div>
                </div>
                <div className="rounded bg-[var(--color-bg)] p-2">
                  <span className="text-[var(--color-text-muted)]">Current medicine</span>
                  <div className="font-semibold">{item.current_medicine_summary || (Number(item.active_rx_count ?? 0) > 0 ? `${item.active_rx_count} active Rx` : 'None recorded')}</div>
                </div>
                <div className="rounded bg-[var(--color-bg)] p-2">
                  <span className="text-[var(--color-text-muted)]">Last diagnosis</span>
                  <div className="font-semibold">{item.last_diagnosis || 'Not recorded'}</div>
                </div>
                <div className="rounded bg-[var(--color-bg)] p-2">
                  <span className="text-[var(--color-text-muted)]">Last abnormal lab</span>
                  <div className="font-semibold text-amber-700">{item.latest_abnormal_lab_summary || 'None flagged'}</div>
                </div>
              </div>
              {item.last_visit_at && <p className="text-xs text-[var(--color-text-muted)] mt-3">Last visit: {formatDisplayDate(item.last_visit_at)}</p>}
              <Link to={`${basePath}/patients/${item.patient_id}/chart`} className="mt-3 inline-flex text-xs text-[var(--color-primary)] hover:underline">
                View full history <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </section>

            <PatientLabTrendsPanel patientId={item.patient_id} />
            <PatientSafetyOverrideHistoryPanel patientId={item.patient_id} />

            <section className="rounded-lg border border-purple-100 bg-purple-50/70 p-4">
              <h3 className="text-sm font-semibold text-purple-900 mb-2 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Summary
              </h3>
              <PatientAIWidget patientId={item.patient_id} tenantHasAi={true} />
              <p className="mt-2 text-[11px] leading-relaxed text-purple-800">
                Record summary only. Verify source chart before clinical decisions.
              </p>
            </section>

            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">{t('queueControls', { defaultValue: 'Queue Controls' })}</h3>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost text-xs" disabled={!hasAppointmentId || item.status !== 'waiting'} title={!hasAppointmentId ? missingAppointmentMessage : undefined} onClick={() => { if (appointmentId == null) { toast.error(missingAppointmentMessage); return; } onUpdateStatus(appointmentId, 'in_progress'); }}>{t('start')}</button>
                <button className="btn-primary text-xs" disabled={!hasAppointmentId || item.status !== 'in_progress' || saving === 'complete' || hasBlockingRxValidation || !hasClinicalDocumentation} title={!hasAppointmentId ? missingAppointmentMessage : undefined} onClick={saveSoapAndComplete}>{t('saveCompleteShort', { defaultValue: 'Save & Complete' })}</button>
                <button className="btn-ghost text-xs text-zinc-600" disabled={!hasAppointmentId || ['completed', 'cancelled', 'no_show'].includes(item.status)} title={!hasAppointmentId ? missingAppointmentMessage : undefined} onClick={() => { if (appointmentId == null) { toast.error(missingAppointmentMessage); return; } onUpdateStatus(appointmentId, 'no_show'); }}>{t('noShow', { defaultValue: 'No-show' })}</button>
              </div>
              <div className="mt-4 space-y-2">
                <select className="input text-sm" value={reassignDoctorId} onChange={(e) => setReassignDoctorId(e.target.value)}>
                  <option value="">{t('selectDoctor', { defaultValue: 'Select doctor' })}</option>
                  {availableDoctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
                </select>
                <input className="input text-sm" value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} placeholder={t('reassignReason', { defaultValue: 'Reason (optional)' })} />
                <button
                  className="btn-ghost text-xs w-full"
                  disabled={!hasAppointmentId || !reassignDoctorId || item.status === 'completed'}
                  onClick={() => {
                    onReassign(appointmentId!, Number(reassignDoctorId), reassignReason || undefined);
                    setReassignDoctorId('');
                    setReassignReason('');
                  }}
                >
                  {t('reassignDoctor', { defaultValue: 'Reassign Doctor' })}
                </button>
              </div>
            </section>

            <AIScribe onTranscriptReady={appendToSoap} />
          </div>

          {/* Toggle button for left panel on tablet (hidden when panel is open or on mobile/desktop) */}
          {!leftPanelOpen && (
            <button
              type="button"
              onClick={() => setLeftPanelOpen(true)}
              className="hidden md:flex fixed left-2 top-1/2 -translate-y-1/2 z-20 btn-ghost p-2 rounded-lg shadow-md bg-[var(--color-surface)] border border-[var(--color-border)]"
              aria-label="Show patient panel"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}

          {/* Center panel - SOAP & Orders */}
          <div className={`${mainWorkflowSpanClass} space-y-4 ${activeMobileTab === 'soap' ? '' : 'hidden'} ${showCenterWorkflow ? 'md:block' : 'md:hidden'}`}>
            <div className={workflowVisibilityClass(activeDesktopWorkflow === 'consult')}>
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                {t('structuredSoap', { defaultValue: 'Structured SOAP Note' })}
              </h3>
              <div className="mb-3 flex flex-wrap gap-2">
                {CHIEF_COMPLAINT_CHIPS.map(complaint => (
                  <button
                    key={complaint}
                    type="button"
                    onClick={() => addChiefComplaint(complaint)}
                    className="rounded-full bg-[var(--color-bg)] px-3 py-1 text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                  >
                    {complaint}
                  </button>
                ))}
              </div>
              <form className="space-y-3" onSubmit={saveSoap}>
                <input className="input" placeholder={t('chiefComplaint', { defaultValue: 'Chief complaint' })} value={soapForm.chiefComplaint} onChange={(e) => setSoapForm(prev => ({ ...prev, chiefComplaint: e.target.value }))} />
                <textarea className="input min-h-24" placeholder="Subjective" value={soapForm.subjective} onFocus={() => setActiveSoapField('subjective')} onChange={(e) => updateSoap('subjective', e.target.value)} />
                <textarea className="input min-h-24" placeholder="Objective" value={soapForm.objective} onFocus={() => setActiveSoapField('objective')} onChange={(e) => updateSoap('objective', e.target.value)} />
                <textarea className="input min-h-24" placeholder="Assessment" value={soapForm.assessment} onFocus={() => setActiveSoapField('assessment')} onChange={(e) => updateSoap('assessment', e.target.value)} />
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                    {t('codedDiagnosisOptional', { defaultValue: 'Optional coded diagnosis' })}
                  </p>
                  <QuickCodedDiagnosis
                    value={codedDiagnosis}
                    disabled={saving === 'complete'}
                    onChange={(selection) => {
                      setCodedDiagnosis(selection);
                      if (selection) {
                        setSoapForm((previous) => previous.assessment.trim()
                          ? previous
                          : { ...previous, assessment: selection.description });
                      }
                    }}
                  />
                </div>
                <textarea className="input min-h-24" placeholder="Plan" value={soapForm.plan} onFocus={() => setActiveSoapField('plan')} onChange={(e) => updateSoap('plan', e.target.value)} />
                <div className="flex justify-end">
                  <button className="btn-primary" disabled={saving === 'soap'}>{saving === 'soap' ? t('saving', { defaultValue: 'Saving...' }) : t('saveSoap', { defaultValue: 'Save SOAP' })}</button>
                </div>
              </form>
            </section>
            </div>

            <div className={workflowVisibilityClass(activeDesktopWorkflow === 'orders')}>
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                {t('orders', { defaultValue: 'Orders' })}
              </h3>
              <div className="space-y-5">
                <form className="space-y-2" onSubmit={orderLab}>
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('lab', { defaultValue: 'Lab' })}</p>
                  <div className="flex flex-wrap gap-2">
                    {COMMON_LABS.map(test => (
                      <button
                        key={test}
                        type="button"
                        onClick={() => orderCommonLab(test)}
                        disabled={saving === `lab-${test}`}
                        className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                      >
                        {test}
                      </button>
                    ))}
                  </div>
                  <input className="input" value={labSearch} onChange={(e) => setLabSearch(e.target.value)} placeholder={t('searchLabTest', { defaultValue: 'Search lab test' })} />
                  {labOptions.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                      {labOptions.slice(0, 6).map(test => (
                        <button type="button" key={test.id} onClick={() => { setLabTestId(String(test.id)); setLabTestLabel(test.name); setLabSearch(test.name); setLabOptions([]); }} className="flex w-full justify-between rounded px-2 py-2 text-left hover:bg-[var(--color-surface)]">
                          <span className="text-sm font-medium">{test.name}</span>
                          <span className="text-xs text-[var(--color-text-muted)]">{test.code ?? test.category}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-2">
                    <input className="input" value={labTestLabel || labTestId} onChange={(e) => { setLabTestId(e.target.value); setLabTestLabel(''); }} placeholder={t('selectedTest', { defaultValue: 'Selected test' })} />
                    <input className="input" value={labInstructions} onChange={(e) => setLabInstructions(e.target.value)} placeholder={t('instructions', { defaultValue: 'Instructions' })} />
                  </div>
                  <div className="flex justify-end"><button className="btn-primary" disabled={!labTestId || saving === 'lab'}><FlaskConical className="w-4 h-4" />{t('orderLab', { defaultValue: 'Order Lab' })}</button></div>
                </form>

                <DoctorOrderStatusPanel
                  orders={displayedOrderStatusItems}
                  loading={clinicalOrdersLoading}
                  title={t('orderStatus', { defaultValue: 'Order status' })}
                />

                <form className="space-y-2" onSubmit={orderImaging}>
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('imaging', { defaultValue: 'Imaging' })}</p>
                  <div className="flex flex-wrap gap-2">
                    {COMMON_IMAGING.map(imaging => (
                      <button
                        key={imaging.label}
                        type="button"
                        onClick={() => orderCommonImaging(imaging)}
                        disabled={saving === `imaging-${imaging.label}`}
                        className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-60"
                      >
                        {imaging.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <select className="input" value={radiologyForm.imaging_type_name} onChange={(e) => setRadiologyForm(prev => ({ ...prev, imaging_type_name: e.target.value }))}>
                      <option value="X-Ray">X-Ray</option><option value="Ultrasound">Ultrasound</option><option value="CT">CT</option><option value="MRI">MRI</option>
                    </select>
                    <select className="input" value={radiologyForm.urgency} onChange={(e) => setRadiologyForm(prev => ({ ...prev, urgency: e.target.value }))}>
                      <option value="normal">Normal</option><option value="urgent">Urgent</option><option value="stat">STAT</option>
                    </select>
                  </div>
                  <input className="input" value={radiologyForm.imaging_item_name} onChange={(e) => setRadiologyForm(prev => ({ ...prev, imaging_item_name: e.target.value }))} placeholder={t('imagingItem', { defaultValue: 'Imaging item name' })} />
                  <div className="flex justify-end"><button className="btn-primary" disabled={!radiologyForm.imaging_item_name.trim() || saving === 'imaging'}>{t('orderImaging', { defaultValue: 'Order Imaging' })}</button></div>
                </form>
              </div>
            </section>
            </div>
          </div>

          <div className={`${mainWorkflowSpanClass} space-y-4 ${activeMobileTab === 'rx' ? '' : 'hidden'} ${showRightWorkflow ? 'md:block' : 'md:hidden'}`}>
            <div className={workflowVisibilityClass(activeDesktopWorkflow === 'rx')}>
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
                  <Pill className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('prescriptionCart', { defaultValue: 'Prescription Cart' })}
                </h3>
                <div className="flex items-center gap-2">
                  {rxAutoSaveState !== 'idle' && rxStatus !== 'final' && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      rxAutoSaveState === 'error' ? 'bg-red-50 text-red-700'
                        : rxAutoSaveState === 'dirty' ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      {rxAutoSaveState === 'creating' ? 'Creating draft…'
                        : rxAutoSaveState === 'saving' ? 'Saving…'
                          : rxAutoSaveState === 'dirty' ? 'Unsaved changes'
                            : rxAutoSaveState === 'error' ? 'Auto-save failed'
                              : lastRxAutoSavedAt ? `Saved ${lastRxAutoSavedAt}` : 'Saved'}
                    </span>
                  )}
                  {rxNo && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{rxNo}</span>}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <input
                    ref={rxSearchInputRef}
                    className="input text-sm"
                    value={rxSearch}
                    onChange={(e) => setRxSearch(e.target.value)}
                    onKeyDown={handleRxSearchKeyDown}
                    placeholder={t('searchMedicine', { defaultValue: 'Search medicine by brand or generic' })}
                  />
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[var(--color-text-muted)]">
                    <span>Alt+M focus medicine</span>
                    <span>Enter add first result</span>
                    <span>Ctrl+S save draft</span>
                  </div>
                  {rxResults.length > 0 && (
                    <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-sm">
                      {rxResults.slice(0, 7).map((medicine, index) => (
                        <button
                          key={`${medicine.name}-${index}`}
                          type="button"
                          onClick={() => addMedicineSearchResult(medicine)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-surface)]"
                        >
                          <span className="font-medium text-[var(--color-text)]">{medicine.name}</span>
                          <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                            {[medicine.strength, medicine.dosage_form].filter(Boolean).map((detail) => (
                              <span key={detail} className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-text)]">
                                {detail}
                              </span>
                            ))}
                          </span>
                          {(medicine.generic || medicine.manufacturer) && (
                            <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                              {[medicine.generic, medicine.manufacturer].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {rxSearch.trim().length >= 2 && rxResults.length === 0 && (
                    <button
                      type="button"
                      onClick={searchExternalRxMedicines}
                      disabled={externalRxSearchLoading}
                      className="mt-2 text-xs text-[var(--color-primary)] hover:underline disabled:opacity-60"
                    >
                      {externalRxSearchLoading ? 'Searching external catalog...' : 'Search MedEx and cache'}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {quickRxTemplates.map(template => (
                    <button
                      key={template.medicine_name}
                      type="button"
                      onClick={() => addRxItem(template)}
                      className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      {template.medicine_name}
                    </button>
                  ))}
                </div>

                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                  {rxItems.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">
                      <Pill className="mx-auto mb-2 h-7 w-7 opacity-30" />
                      {t('noMedicineAdded', { defaultValue: 'No medicine added. Search or tap a quick medicine.' })}
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--color-border)]">
                      {rxItems.map((rxItem, index) => (
                        <div key={`${rxItem.medicine_name}-${index}`} className="space-y-2 p-3">
                          <div className="flex items-center gap-2">
                            <input
                              className="input flex-1 text-sm"
                              value={rxItem.medicine_name}
                              onChange={(event) => updateRxItem(index, 'medicine_name', event.target.value)}
                              placeholder={t('medicineName', { defaultValue: 'Medicine name' })}
                            />
                            <button type="button" onClick={() => removeRxItem(index)} className="btn-ghost p-2 text-red-500" aria-label={t('removeMedicine', { defaultValue: 'Remove medicine' })}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input className="input text-xs" value={rxItem.dosage} onChange={(event) => updateRxItem(index, 'dosage', event.target.value)} placeholder={t('dose', { defaultValue: 'Dose' })} />
                            <select className="input text-xs" value={rxItem.frequency} onChange={(event) => updateRxItem(index, 'frequency', event.target.value)}>
                              {DOSE_SHORTCUTS.map(dose => <option key={dose} value={dose}>{dose}</option>)}
                            </select>
                            <select className="input text-xs" value={rxItem.duration} onChange={(event) => updateRxItem(index, 'duration', event.target.value)}>
                              <option value="">{t('duration', { defaultValue: 'Duration' })}</option>
                              {DURATION_SHORTCUTS.map(duration => <option key={duration} value={duration}>{duration}</option>)}
                            </select>
                            <select className="input text-xs" value={rxItem.instructions} onChange={(event) => updateRxItem(index, 'instructions', event.target.value)}>
                              <option value="">{t('instruction', { defaultValue: 'Instruction' })}</option>
                              {INSTRUCTION_SHORTCUTS.map(instruction => <option key={instruction} value={instruction}>{instruction}</option>)}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button type="button" onClick={() => addRxItem()} className="btn-ghost w-full justify-center text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  {t('addBlankMedicine', { defaultValue: 'Add blank medicine' })}
                </button>

                <div className="rounded-lg bg-[var(--color-bg)] p-3 text-xs">
                  <div className="font-semibold text-[var(--color-text)]">{t('liveSummary', { defaultValue: 'Live summary' })}</div>
                  <div className="mt-1 text-[var(--color-text-muted)]">
                    Rx {rxItems.filter(rxItem => rxItem.medicine_name.trim()).length} item(s)
                    {orderedQuickItems.length > 0 ? ` · Orders ${orderedQuickItems.length}` : ''}
                    {rxStatus ? ` · ${rxStatus}` : ''}
                  </div>
                  {rxItems.some(rxItem => rxItem.medicine_name.trim()) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {rxItems.filter(rxItem => rxItem.medicine_name.trim()).map((rxItem, index) => (
                        <span key={`${rxItem.medicine_name}-${index}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          {rxItem.medicine_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <DoctorPrescriptionSafetyPanel
                  rxWarnings={rxWarnings}
                  clinicalFindings={clinicalFindings}
                  checking={safetyChecking}
                  title={t('safetyCheck', { defaultValue: 'Safety Check' })}
                />

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={repeatLastPrescription} className="btn-ghost justify-center text-xs" disabled={saving === 'repeat-rx'}>
                    {t('repeatLastRx', { defaultValue: 'Repeat Last Rx' })}
                  </button>
                  <button type="button" onClick={() => setShowTemplateModal(true)} className="btn-ghost justify-center text-xs">
                    <BookTemplate className="h-3.5 w-3.5" />
                    {t('saveAsTemplate', { defaultValue: 'Save as Template' })}
                  </button>
                  <button type="button" onClick={() => savePrescription('draft')} className="btn-ghost justify-center text-xs" disabled={!hasAppointmentId || saving === 'rx-draft' || rxStatus === 'final'} title={!hasAppointmentId ? missingAppointmentMessage : undefined}>
                    <Save className="h-3.5 w-3.5" />
                    {t('saveDraft', { defaultValue: 'Save Draft' })}
                  </button>
                  <button type="button" onClick={() => savePrescription('final')} className="btn-primary justify-center text-xs" disabled={!hasAppointmentId || saving === 'rx-final' || rxStatus === 'final' || hasBlockingRxValidation} title={!hasAppointmentId ? missingAppointmentMessage : undefined}>
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    {t('finalizeRx', { defaultValue: 'Finalize Rx' })}
                  </button>
                  <button type="button" onClick={printPrescription} className="btn-ghost justify-center text-xs col-span-2" disabled={!rxId}>
                    <Printer className="h-3.5 w-3.5" />
                    {t('print', { defaultValue: 'Print' })}
                  </button>
                </div>
              </div>
            </section>
            </div>

            <div className={dispositionSectionClass}>
            <CollapsibleSection id="rx-advice" title={t('advice', { defaultValue: 'Advice' })} icon={<FileText className="w-4 h-4 text-[var(--color-primary)]" />}>
              <textarea
                className="input min-h-20 text-sm"
                value={rxAdvice}
                onChange={(event) => setRxAdvice(event.target.value)}
                placeholder={t('advicePlaceholder', { defaultValue: 'Advice, diet, warning signs, follow-up notes' })}
              />
              <div className="flex flex-wrap gap-2">
                {ADVICE_CHIPS.map(advice => (
                  <button
                    key={advice}
                    type="button"
                    onClick={() => appendRxAdvice(advice)}
                    className="rounded-full bg-[var(--color-bg)] px-2.5 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                  >
                    {advice}
                  </button>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection id="rx-follow-up" title={t('followUp', { defaultValue: 'Follow-up' })} icon={<CalendarPlus className="w-4 h-4 text-[var(--color-primary)]" />}>
              <form className="space-y-2" onSubmit={scheduleFollowUp}>
                <div className="grid sm:grid-cols-2 gap-2">
                  <input className="input" type="date" value={followUpForm.apptDate} onChange={(e) => setFollowUpForm(prev => ({ ...prev, apptDate: e.target.value }))} />
                  <input className="input" type="time" value={followUpForm.apptTime} onChange={(e) => setFollowUpForm(prev => ({ ...prev, apptTime: e.target.value }))} />
                </div>
                <input className="input" value={followUpForm.notes} onChange={(e) => setFollowUpForm(prev => ({ ...prev, notes: e.target.value }))} placeholder={t('notes', { defaultValue: 'Notes' })} />
                <div className="flex justify-end"><button className="btn-primary" disabled={!followUpForm.apptDate || saving === 'follow-up'}>{t('scheduleFollowup', { defaultValue: 'Schedule Follow-up' })}</button></div>
              </form>
            </CollapsibleSection>

            <CollapsibleSection id="rx-admit" title="Admit / Refer" icon={<Bed className="w-4 h-4 text-[var(--color-primary)]" />}>
              <div className="space-y-2">
                {admissionNo && (
                  <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                    IPD admission created: {admissionNo}
                  </div>
                )}
                <textarea
                  className="input min-h-20 text-sm"
                  value={admitForm.admissionReason}
                  onChange={(event) => setAdmitForm(prev => ({ ...prev, admissionReason: event.target.value }))}
                  placeholder="Admission reason / provisional diagnosis"
                />
                <input
                  className="input text-sm"
                  value={admitForm.notes}
                  onChange={(event) => setAdmitForm(prev => ({ ...prev, notes: event.target.value }))}
                  placeholder="Initial IPD order or nursing instruction"
                />
                <button type="button" className="btn-primary w-full justify-center text-xs" onClick={admitPatient} disabled={saving === 'admit' || Boolean(admissionNo)}>
                  <Bed className="h-3.5 w-3.5" />
                  Admit to IPD
                </button>
                <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  Bed and deposit can be completed from IPD/Reception after the doctor handoff.
                </p>
              </div>
            </CollapsibleSection>

            <CollapsibleSection id="rx-more-tools" title={t('moreTools', { defaultValue: 'More Tools' })} icon={<Sparkles className="w-4 h-4 text-[var(--color-primary)]" />}>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text)] mb-2">{t('diagnosisTemplates', { defaultValue: 'Diagnosis Templates' })}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {DIAGNOSIS_TEMPLATES.map(template => (
                      <button
                        type="button"
                        key={template.label}
                        onClick={() => applyTemplate(template)}
                        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left text-xs font-medium text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text)] mb-2">{t('planShortcuts', { defaultValue: 'Plan Shortcuts' })}</p>
                  <div className="flex flex-wrap gap-2">
                    {PLAN_SHORTCUTS.map(shortcut => (
                      <button
                        type="button"
                        key={shortcut}
                        onClick={() => updateSoap('plan', appendLine(soapForm.plan, shortcut))}
                        className="rounded-full bg-[var(--color-bg)] px-3 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                      >
                        {shortcut}
                      </button>
                    ))}
                  </div>
                </div>
                <SmartPhrases onSelectPhrase={appendToSoap} />
              </div>
            </CollapsibleSection>
            </div>
          </div>
        </div>
        </>
        )}

        <div className="sticky bottom-0 z-10 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 sm:px-6 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-[var(--color-text-muted)]">
              {item.patient_name} · {item.patient_code} · {item.status?.replace(/_/g, ' ')}
              {!hasClinicalDocumentation && <span className="ml-2 font-medium text-amber-700">Add SOAP, coded diagnosis, Rx or order before completing</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => savePrescription('draft')} className="btn-ghost text-sm" disabled={!hasAppointmentId || saving === 'rx-draft' || rxStatus === 'final'} title={!hasAppointmentId ? missingAppointmentMessage : undefined}>
                <Save className="w-4 h-4" />
                Save Rx
              </button>
              <button type="button" onClick={printPrescription} className="btn-ghost text-sm" disabled={!rxId}>
                <Printer className="w-4 h-4" />
                Print
              </button>
              {appointmentId != null ? (
                <Link to={`${basePath}/prescriptions/new?patient=${item.patient_id}&appt=${appointmentId}&from=doctor/dashboard`} className="btn-ghost text-sm">
                  <Pill className="w-4 h-4" />
                  Full Rx Page
                </Link>
              ) : (
                <button type="button" disabled className="btn-ghost text-sm opacity-50" title={missingAppointmentMessage}>
                  <Pill className="w-4 h-4" />
                  Full Rx Page
                </button>
              )}
              <Link to={`${basePath}/patients/${item.patient_id}/chart`} className="btn-ghost text-sm">
                <FileText className="w-4 h-4" />
                Full History
              </Link>
              <button type="button" onClick={submitFollowUp} className="btn-ghost text-sm" disabled={!followUpForm.apptDate || saving === 'follow-up'}>
                <CalendarPlus className="w-4 h-4" />
                Follow-up
              </button>
              <button type="button" onClick={saveSoapAndComplete} className="btn-primary text-sm" disabled={!hasAppointmentId || saving === 'complete' || hasBlockingRxValidation || !hasClinicalDocumentation} title={!hasAppointmentId ? missingAppointmentMessage : undefined}>
                <ClipboardCheck className="w-4 h-4" />
                Save & Complete
              </button>
            </div>
          </div>
        </div>
      </div>

      {showSafetyOverrideModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setShowSafetyOverrideModal(false)}>
          <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-red-700 mb-2 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              {t('clinicalSafetyOverride', { defaultValue: 'Clinical safety override required' })}
            </h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-3">
              {t('overrideReasonPrompt', { defaultValue: 'Document why you are proceeding despite the safety alert.' })}
            </p>
            <textarea
              className="input w-full min-h-24 mb-4"
              value={safetyOverrideReason}
              onChange={(event) => setSafetyOverrideReason(event.target.value)}
              placeholder={t('overrideReasonPlaceholder', { defaultValue: 'Clinical justification' })}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowSafetyOverrideModal(false); setPendingFinalize(false); setPendingComplete(false); }} className="btn-ghost text-sm">
                {t('cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={!safetyOverrideReason.trim() || saving === 'rx-final' || saving === 'complete'}
                onClick={async () => {
                  setShowSafetyOverrideModal(false);
                  if (pendingComplete) {
                    setPendingComplete(false);
                    await saveSoapAndComplete();
                  } else if (pendingFinalize) {
                    setPendingFinalize(false);
                    await savePrescription('final');
                  }
                }}
              >
                {t('confirmOverride', { defaultValue: 'Confirm & Finalize' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTemplateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setShowTemplateModal(false)}>
          <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[var(--color-text)] mb-3">
              {t('saveAsTemplate', { defaultValue: 'Save as Template' })}
            </h3>
            <input
              type="text"
              className="input w-full mb-3"
              placeholder={t('templateNamePlaceholder', { defaultValue: 'e.g., Fever Treatment, DM Follow-up' })}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              autoFocus
            />
            <div className="text-xs text-[var(--color-text-muted)] mb-4">
              {t('templateWillSave', { defaultValue: 'Will save' })}: {rxItems.filter(rxItem => rxItem.medicine_name.trim()).length} {t('medicines', { defaultValue: 'medicines' })}
              {soapForm.assessment ? ` · ${soapForm.assessment}` : ''}
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowTemplateModal(false)} className="btn-ghost text-sm">
                {t('cancel', { defaultValue: 'Cancel' })}
              </button>
              <button type="button" onClick={saveAsTemplate} className="btn-primary text-sm" disabled={templateSaving}>
                {templateSaving ? t('saving', { defaultValue: 'Saving...' }) : t('saveTemplate', { defaultValue: 'Save Template' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
