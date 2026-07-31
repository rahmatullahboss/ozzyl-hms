import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  Brain,
  Calendar,
  ChevronRight,
  ClipboardList,
  FlaskConical,
  Pill,
  Printer,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  User,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import VitalsTrend from '../components/VitalsTrend';
import { authHeader } from '../utils/auth';
import { getRoleBasePath } from '../lib/handover';

interface Patient {
  id: number;
  patient_code: string;
  name: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  mobile?: string;
  date_of_birth?: string;
}

interface BasicItem {
  id?: number | string;
  description?: string;
  severity?: string;
  status?: string;
  status_reason?: string;
  allergen?: string;
  reaction?: string;
  verified_at?: string;
  medication_name?: string;
  dosage?: string;
  frequency?: string;
  end_date?: string;
  diagnosis?: string;
  doctor_name?: string;
  created_at?: string;
  updated_at?: string;
  reviewed_at?: string | null;
  reviewed_by?: string | number | null;
  provenance?: {
    category: string;
    badge_text: string;
    review_status: string;
    reviewed_at?: string | null;
    reviewed_by?: string | number | null;
    source_label?: string;
  };
}

interface TimelineItem {
  id: string;
  type: 'visit' | 'prescription' | 'lab' | 'admission' | 'appointment' | 'document' | 'referral' | 'discharge' | 'consultation' | 'radiology_order' | 'radiology_report' | 'patient_reported_adr' | 'patient_reported_lifestyle';
  title: string;
  subtitle?: string;
  doctor_name?: string;
  status?: string;
  date: string;
  provenance?: {
    category: string;
    badge_text: string;
    review_status: string;
  };
}

interface CitationItem {
  id: string;
  type: string;
  date: string;
  title: string;
  subtitle?: string;
  status?: string;
}

interface SourceDetail {
  source: {
    id: string;
    type: string;
    title: string;
    date?: string | null;
    status?: string | null;
    summary?: string;
    provenance?: {
      category: string;
      badge_text: string;
      review_status: string;
      reviewed_at?: string | null;
      reviewed_by?: string | number | null;
      source_label?: string;
    } | null;
    sections: Array<{ label: string; value: string }>;
  };
}

type ProvenanceRecord = Record<string, unknown> & {
  provenance?: {
    category: string;
    badge_text: string;
    review_status: string;
    reviewed_at?: string | null;
    reviewed_by?: string | number | null;
    source_label?: string;
  };
};

interface LabCatalogItem {
  id: number;
  code?: string;
  name: string;
  category?: string;
  price?: number;
}

interface ChartResponse {
  patient: Patient;
  snapshot: {
    allergies: BasicItem[];
    activeProblems: BasicItem[];
    currentMedications: BasicItem[];
    riskFlags: Array<{ type: string; label: string; severity?: string }>;
    lastVisit?: Record<string, unknown> | null;
    lastAdmission?: Record<string, unknown> | null;
    primaryDoctor?: { name: string } | null;
  };
  timeline: TimelineItem[];
  careAlerts?: Array<{ code: string; severity: string; label: string }>;
  problemSummary?: {
    active: BasicItem[];
    resolved: BasicItem[];
    inactive?: BasicItem[];
  };
  medicationHistory?: {
    current: BasicItem[];
    stopped: BasicItem[];
  };
  allergySummary?: {
    verifiedCount: number;
    unverifiedCount: number;
  };
  recentLabs: {
    abnormal: ProvenanceRecord[];
    pending: Array<Record<string, unknown>>;
    recent: ProvenanceRecord[];
  };
  tasks: {
    pendingFollowUps: Array<Record<string, unknown>>;
    pendingOrders: Array<Record<string, unknown>>;
    activeConsultation?: Record<string, unknown> | null;
    vitalAlerts?: Array<Record<string, unknown>>;
    chronicCareReminders?: Array<Record<string, unknown>>;
  };
  diagnoses: ProvenanceRecord[];
  consultations?: Array<Record<string, unknown>>;
  soapNotes?: Array<Record<string, unknown>>;
  radiologyOrders?: ProvenanceRecord[];
  radiologyReports?: ProvenanceRecord[];
  dischargeSummaries?: ProvenanceRecord[];
  referrals?: ProvenanceRecord[];
  documents: ProvenanceRecord[];
  familyRiskSummary?: {
    status: string;
    headline: string;
    summary: string;
    insights: Array<{ label: string; severity: string; rationale: string; risk_score?: number; screening_priority?: string; screening_prompts?: string[]; care_context?: string }>;
  };
  aiSummary: {
    status: 'ready' | 'fallback' | 'not_requested' | 'unavailable';
    generatedAt: string | null;
    citations: CitationItem[];
    summary: null | {
      oneLiner?: string;
      activeIssues?: Array<{ text: string; priority?: string; citationIds?: string[]; provenance?: string }>;
      familyHistory?: Array<{ text: string; priority?: string; citationIds?: string[]; provenance?: string }>;
      patientContext?: Array<{ text: string; priority?: string; citationIds?: string[]; provenance?: string }>;
      recentChanges?: Array<{ text: string; priority?: string; citationIds?: string[]; provenance?: string }>;
      medicationFocus?: Array<{ text: string; priority?: string; citationIds?: string[]; provenance?: string }>;
      abnormalFindings?: Array<{ text: string; priority?: string; citationIds?: string[]; provenance?: string }>;
      followUpRisks?: Array<{ text: string; priority?: string; citationIds?: string[]; provenance?: string }>;
      cautions?: Array<{ text: string; priority?: string; citationIds?: string[]; provenance?: string }>;
      provenanceFlags?: Array<{ text: string; priority?: string; citationIds?: string[]; provenance?: string }>;
    };
  };
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  closed: 'bg-slate-100 text-slate-700',
  severe: 'bg-red-100 text-red-700',
  critical: 'bg-red-100 text-red-700',
  attention: 'bg-red-100 text-red-700',
  watch: 'bg-amber-100 text-amber-700',
  life_threatening: 'bg-red-100 text-red-700',
};

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function patientAge(patient?: Patient | null): string {
  if (!patient) return '—';
  if (patient.age) return `${patient.age}y`;
  if (!patient.date_of_birth) return '—';
  const dob = new Date(patient.date_of_birth);
  if (Number.isNaN(dob.getTime())) return '—';
  return `${Math.max(0, Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)))}y`;
}

function sourceLabel(type?: string) {
  switch (type) {
    case 'consultation':
      return 'Consultation';
    case 'soap':
      return 'SOAP Note';
    case 'problem':
      return 'Problem';
    case 'medication':
      return 'Medication';
    case 'allergy':
      return 'Allergy';
    case 'radiology_order':
      return 'Radiology Order';
    case 'radiology_report':
      return 'Radiology Report';
    case 'discharge':
      return 'Discharge';
    case 'document':
      return 'Document';
    case 'referral':
      return 'Referral';
    case 'lab':
      return 'Lab';
    case 'prescription':
      return 'Prescription';
    case 'admission':
      return 'Admission';
    case 'appointment':
      return 'Appointment';
    case 'patient_reported_adr':
      return 'Patient ADR';
    case 'patient_reported_lifestyle':
      return 'Lifestyle Log';
    default:
      return 'Visit';
  }
}

function provenanceBadge(provenance?: string) {
  switch (provenance) {
    case 'patient_reported':
      return 'bg-amber-50 text-amber-700 border border-amber-200';
    case 'clinician_verified':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    case 'mixed':
      return 'bg-violet-50 text-violet-700 border border-violet-200';
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200';
  }
}

function provenanceCategoryBadge(category?: string) {
  switch (category) {
    case 'patient_reported':
      return 'bg-amber-50 text-amber-700 border border-amber-200';
    case 'clinician_verified':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    case 'imported_record':
      return 'bg-sky-50 text-sky-700 border border-sky-200';
    case 'family_history':
      return 'bg-rose-50 text-rose-700 border border-rose-200';
    case 'system_derived':
      return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
    case 'mixed':
      return 'bg-violet-50 text-violet-700 border border-violet-200';
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200';
  }
}

export default function PatientChartWorkspace({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('clinical');
  const { slug = '', id = '' } = useParams<{ slug: string; id: string }>();
  const basePath = getRoleBasePath(slug, role);
  const patientListPath = role === 'reception' ? `${basePath}/patients` : `/h/${slug}/patients`;
  const patientDetailPath = role === 'reception' ? `${basePath}/patients/${id}` : `/h/${slug}/patients/${id}`;
  const canOpenPatientDetail = role === 'hospital_admin' || role === 'reception';
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sourceDetail, setSourceDetail] = useState<SourceDetail | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [soapSaving, setSoapSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [soapForm, setSoapForm] = useState({
    chiefComplaint: '',
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
  });
  const [soapTemplates, setSoapTemplates] = useState<Array<{ id: number; name: string; name_bn?: string; chief_complaint: string; subjective?: string; objective?: string; assessment?: string; plan?: string; specialty?: string }>>([]);
  const [soapEditId, setSoapEditId] = useState<number | null>(null);
  const [problemForm, setProblemForm] = useState({ description: '', severity: 'moderate', comments: '' });
  const [medicationForm, setMedicationForm] = useState({ medication_name: '', dosage: '', frequency: '', duration: '', instructions: '' });
  const [allergyForm, setAllergyForm] = useState({ allergen: '', allergy_type: 'drug', severity: 'mild', reaction: '' });
  const [labOrderForm, setLabOrderForm] = useState({ lab_test_id: '', instructions: '', notes: '' });
  const [radiologyOrderForm, setRadiologyOrderForm] = useState({ imaging_type_name: 'X-Ray', imaging_item_name: '', urgency: 'normal', requisition_remarks: '' });
  const [followUpForm, setFollowUpForm] = useState({ apptDate: '', apptTime: '', notes: '' });
  const [encounterCloseForm, setEncounterCloseForm] = useState({
    consultation_id: '',
    summary: '',
    diagnosis: '',
    prescription: '',
    reconciliation_summary: '',
    medication_reconciliation_done: true,
    followup_date: '',
    followup_time: '',
    followup_notes: '',
    book_followup: true,
  });
  const [labSearch, setLabSearch] = useState('');
  const [labOptions, setLabOptions] = useState<LabCatalogItem[]>([]);
  const [labSearchLoading, setLabSearchLoading] = useState(false);

  const fetchChart = useCallback(async (includeAiSummary = false) => {
    if (!id) return;
    if (includeAiSummary) setAiLoading(true);
    else setLoading(true);

    try {
      const { data: res } = await axios.get<ChartResponse>(
        `/api/patients/${id}/chart${includeAiSummary ? '?includeAiSummary=1' : ''}`,
        { headers: authHeader() },
      );
      setData(res);
      if (!selectedSourceId && res.aiSummary.citations.length > 0) {
        setSelectedSourceId(res.aiSummary.citations[0].id);
      }
    } catch (error) {
      console.error('[PatientChartWorkspace] fetch failed', error);
      toast.error(includeAiSummary ? t('toast.aiBriefFailed') : t('toast.chartLoadFailed'));
    } finally {
      if (includeAiSummary) setAiLoading(false);
      else setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchChart(false);
    // Fetch SOAP templates
    axios.get('/api/patients/soap-templates', { headers: authHeader() })
      .then(({ data }) => setSoapTemplates(data.templates ?? []))
      .catch(() => {});
  }, [fetchChart]);

  useEffect(() => {
    if (!id || !selectedSourceId) {
      setSourceDetail(null);
      return;
    }

    let cancelled = false;
    setSourceLoading(true);

    void axios.get<SourceDetail>(`/api/patients/${id}/chart/source/${selectedSourceId}`, {
      headers: authHeader(),
    }).then(({ data: res }) => {
      if (!cancelled) setSourceDetail(res);
    }).catch(() => {
      if (!cancelled) setSourceDetail(null);
    }).finally(() => {
      if (!cancelled) setSourceLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [id, selectedSourceId]);

  useEffect(() => {
    if (labSearch.trim().length < 2) {
      setLabOptions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLabSearchLoading(true);
      void axios.get<{ tests: LabCatalogItem[] }>(`/api/lab?search=${encodeURIComponent(labSearch.trim())}`, {
        headers: authHeader(),
      }).then(({ data }) => {
        if (!cancelled) setLabOptions(data.tests ?? []);
      }).catch(() => {
        if (!cancelled) setLabOptions([]);
      }).finally(() => {
        if (!cancelled) setLabSearchLoading(false);
      });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [labSearch]);

  useEffect(() => {
    const activeConsultation = data?.tasks.activeConsultation;
    if (!activeConsultation) return;

    setEncounterCloseForm((prev) => ({
      ...prev,
      consultation_id: String(activeConsultation.id ?? prev.consultation_id),
      followup_date: String(activeConsultation.followup_date ?? prev.followup_date ?? ''),
      prescription: prev.prescription || String(activeConsultation.prescription ?? ''),
      summary: prev.summary || String(activeConsultation.notes ?? ''),
      followup_notes: prev.followup_notes || String(activeConsultation.notes ?? ''),
    }));
  }, [data?.tasks.activeConsultation]);

  function buildMedicationReconciliationSummary() {
    const current = (data?.medicationHistory?.current ?? snapshot.currentMedications)
      .map((med) => `${med.medication_name}${med.dosage ? ` ${med.dosage}` : ''}${med.frequency ? ` ${med.frequency}` : ''}${med.status ? ` [${med.status}]` : ''}`)
      .join(', ');
    const stopped = (data?.medicationHistory?.stopped ?? [])
      .slice(0, 3)
      .map((med) => `${med.medication_name}${med.status_reason ? ` (${med.status_reason})` : ''}`)
      .join(', ');
    return [
      current ? `Current: ${current}` : null,
      stopped ? `Recent stopped: ${stopped}` : null,
    ].filter(Boolean).join(' | ');
  }

  function buildPrescriptionDraft() {
    return (data?.medicationHistory?.current ?? snapshot.currentMedications)
      .map((med) => `${med.medication_name}${med.dosage ? ` ${med.dosage}` : ''}${med.frequency ? ` ${med.frequency}` : ''}${med.end_date ? ` until ${med.end_date}` : ''}`)
      .join('\n');
  }

  async function saveSoapNote(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSoapSaving(true);
    try {
      if (soapEditId) {
        await axios.put(`/api/patients/${id}/chart/soap/${soapEditId}`, soapForm, { headers: authHeader() });
        toast.success(t('toast.soapUpdated'));
        setSoapEditId(null);
      } else {
        await axios.post(`/api/patients/${id}/chart/soap`, soapForm, { headers: authHeader() });
        toast.success(t('toast.soapSaved'));
      }
      setSoapForm({ chiefComplaint: '', subjective: '', objective: '', assessment: '', plan: '' });
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] save SOAP failed', error);
      toast.error(t('toast.soapSaveFailed'));
    } finally {
      setSoapSaving(false);
    }
  }

  async function addProblem(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !problemForm.description.trim()) return;
    setActionLoading('problem-add');
    try {
      await axios.post('/api/clinical/problems', {
        PatientId: Number(id),
        Description: problemForm.description,
        Severity: problemForm.severity,
        Comments: problemForm.comments || undefined,
        Status: 'active',
      }, { headers: authHeader() });
      toast.success(t('toast.problemAdded'));
      setProblemForm({ description: '', severity: 'moderate', comments: '' });
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] add problem failed', error);
      toast.error(t('toast.problemAddFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function resolveProblem(problemId?: number | string) {
    if (!problemId) return;
    setActionLoading(`problem-${problemId}`);
    try {
      await axios.put(`/api/clinical/problems/${problemId}/resolve`, {}, { headers: authHeader() });
      toast.success(t('toast.problemResolved'));
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] resolve problem failed', error);
      toast.error(t('toast.problemResolveFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function addMedication(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !medicationForm.medication_name.trim()) return;
    setActionLoading('medication-add');
    try {
      await axios.post(`/api/e-prescribing/patient/${id}/medications`, {
        ...medicationForm,
        source: 'prescribed',
      }, { headers: authHeader() });
      toast.success(t('toast.medicationAdded'));
      setMedicationForm({ medication_name: '', dosage: '', frequency: '', duration: '', instructions: '' });
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] add medication failed', error);
      toast.error(t('toast.medicationAddFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function updateMedicationStatus(medicationId: number | string | undefined, status: string, statusReason: string) {
    if (!id || !medicationId) return;
    setActionLoading(`medication-${medicationId}`);
    try {
      await axios.put(`/api/e-prescribing/patient/${id}/medications/${medicationId}`, {
        status,
        status_reason: statusReason,
        end_date: status === 'on_hold' ? undefined : new Date().toISOString().slice(0, 10),
      }, { headers: authHeader() });
      toast.success(t('toast.medicationUpdated'));
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] update medication failed', error);
      toast.error(t('toast.medicationUpdateFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function addAllergy(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !allergyForm.allergen.trim()) return;
    setActionLoading('allergy-add');
    try {
      await axios.post('/api/allergies', {
        patient_id: Number(id),
        ...allergyForm,
      }, { headers: authHeader() });
      toast.success(t('toast.allergyAdded'));
      setAllergyForm({ allergen: '', allergy_type: 'drug', severity: 'mild', reaction: '' });
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] add allergy failed', error);
      toast.error(t('toast.allergyAddFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function verifyAllergy(allergyId?: number | string) {
    if (!allergyId) return;
    setActionLoading(`allergy-${allergyId}`);
    try {
      await axios.put(`/api/allergies/${allergyId}/verify`, {}, { headers: authHeader() });
      toast.success(t('toast.allergyVerified'));
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] verify allergy failed', error);
      toast.error(t('toast.allergyVerifyFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function createLabOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !labOrderForm.lab_test_id) return;
    setActionLoading('lab-order');
    try {
      await axios.post(`/api/patients/${id}/chart/lab-order`, {
        tests: [{ lab_test_id: Number(labOrderForm.lab_test_id), instructions: labOrderForm.instructions || undefined }],
        notes: labOrderForm.notes || undefined,
      }, { headers: authHeader() });
      toast.success(t('toast.labOrderCreated'));
      setLabOrderForm({ lab_test_id: '', instructions: '', notes: '' });
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] create lab order failed', error);
      toast.error(t('toast.labOrderCreateFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function createRadiologyOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !radiologyOrderForm.imaging_item_name.trim()) return;
    setActionLoading('radiology-order');
    try {
      await axios.post(`/api/patients/${id}/chart/radiology-order`, radiologyOrderForm, { headers: authHeader() });
      toast.success(t('toast.radiologyOrderCreated'));
      setRadiologyOrderForm({ imaging_type_name: 'X-Ray', imaging_item_name: '', urgency: 'normal', requisition_remarks: '' });
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] create radiology order failed', error);
      toast.error(t('toast.radiologyOrderCreateFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function createFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !followUpForm.apptDate) return;
    setActionLoading('follow-up');
    try {
      await axios.post(`/api/patients/${id}/chart/follow-up`, followUpForm, { headers: authHeader() });
      toast.success(t('toast.followUpCreated'));
      setFollowUpForm({ apptDate: '', apptTime: '', notes: '' });
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] create follow-up failed', error);
      toast.error(t('toast.followUpCreateFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function closeEncounter(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setActionLoading('encounter-close');
    try {
      await axios.post(`/api/patients/${id}/chart/encounter-close`, {
        consultation_id: encounterCloseForm.consultation_id ? Number(encounterCloseForm.consultation_id) : undefined,
        summary: encounterCloseForm.summary || undefined,
        diagnosis: encounterCloseForm.diagnosis || undefined,
        prescription: encounterCloseForm.prescription || undefined,
        reconciliation_summary: encounterCloseForm.reconciliation_summary || undefined,
        medication_reconciliation_done: encounterCloseForm.medication_reconciliation_done,
        followup_date: encounterCloseForm.followup_date || undefined,
        followup_time: encounterCloseForm.followup_time || undefined,
        followup_notes: encounterCloseForm.followup_notes || undefined,
        book_followup: Boolean(encounterCloseForm.book_followup && encounterCloseForm.followup_date),
      }, { headers: authHeader() });
      toast.success(t('toast.encounterClosed'));
      setEncounterCloseForm({
        consultation_id: '',
        summary: '',
        diagnosis: '',
        prescription: '',
        reconciliation_summary: '',
        medication_reconciliation_done: true,
        followup_date: '',
        followup_time: '',
        followup_notes: '',
        book_followup: true,
      });
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] close encounter failed', error);
      toast.error(t('toast.encounterCloseFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function acknowledgeVitalAlert(alertId?: number | string) {
    if (!id || !alertId) return;
    setActionLoading(`alert-${alertId}`);
    try {
      await axios.put(`/api/patients/${id}/chart/alerts/${alertId}/acknowledge`, {}, { headers: authHeader() });
      toast.success(t('toast.alertAcknowledged'));
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] acknowledge alert failed', error);
      toast.error(t('toast.alertAcknowledgeFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function acknowledgeLabResult(itemId?: number | string) {
    if (!id || !itemId) return;
    setActionLoading(`lab-review-${itemId}`);
    try {
      await axios.put(`/api/patients/${id}/chart/results/lab/${itemId}/acknowledge`, {}, { headers: authHeader() });
      toast.success(t('toast.labResultReviewed'));
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] acknowledge lab result failed', error);
      toast.error(t('toast.labResultReviewFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  async function acknowledgeRadiologyReport(reportId?: number | string) {
    if (!id || !reportId) return;
    setActionLoading(`radiology-review-${reportId}`);
    try {
      await axios.put(`/api/patients/${id}/chart/results/radiology/${reportId}/acknowledge`, {}, { headers: authHeader() });
      toast.success(t('toast.radiologyReportReviewed'));
      await fetchChart(false);
    } catch (error) {
      console.error('[PatientChartWorkspace] acknowledge radiology report failed', error);
      toast.error(t('toast.radiologyReportReviewFailed'));
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <DashboardLayout role={role}>
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="skeleton h-10 w-56 rounded-lg" />
          <div className="skeleton h-28 w-full rounded-xl" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="skeleton h-72 rounded-xl" />
            <div className="skeleton h-72 rounded-xl lg:col-span-2" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout role={role}>
        <div className="card p-12 text-center max-w-lg mx-auto">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
          <p className="text-[var(--color-text-muted)]">{t('chartUnavailable')}</p>
        </div>
      </DashboardLayout>
    );
  }

  const { patient, snapshot, timeline, recentLabs, tasks, diagnoses, aiSummary } = data;
  const citationLookup = new Map(aiSummary.citations.map((item) => [item.id, item]));
  const selectedCitation = selectedSourceId ? citationLookup.get(selectedSourceId) ?? null : null;

  return (
    <DashboardLayout role={role}>
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
          <Link to={`${basePath}/dashboard`} className="hover:underline">{t('breadcrumbs.dashboard')}</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to={patientListPath} className="hover:underline">{t('breadcrumbs.patients')}</Link>
          <ChevronRight className="w-3 h-3" />
          {canOpenPatientDetail ? (
            <Link to={patientDetailPath} className="hover:underline">{patient.name}</Link>
          ) : (
            <span>{patient.name}</span>
          )}
          <ChevronRight className="w-3 h-3" />
          <span className="text-[var(--color-text)] font-medium">{t('breadcrumbs.doctorWorkspace')}</span>
        </div>

        <div className="card p-5 border-l-4 border-l-[var(--color-primary)]">
          <div className="flex flex-col xl:flex-row gap-4 xl:items-start">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-[var(--color-text)]">{patient.name}</h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  {patient.patient_code}
                </span>
                {patient.blood_group && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                    {patient.blood_group}
                  </span>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><span className="text-[var(--color-text-muted)] text-xs">{t('labels.age')}</span><p className="font-medium">{patientAge(patient)}</p></div>
                <div><span className="text-[var(--color-text-muted)] text-xs">{t('labels.gender')}</span><p className="font-medium capitalize">{patient.gender || t('common.notSpecified')}</p></div>
                <div><span className="text-[var(--color-text-muted)] text-xs">{t('labels.mobile')}</span><p className="font-medium">{patient.mobile || t('common.notSpecified')}</p></div>
                <div><span className="text-[var(--color-text-muted)] text-xs">{t('labels.primaryDoctor')}</span><p className="font-medium">{snapshot.primaryDoctor?.name || t('common.notSpecified')}</p></div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {canOpenPatientDetail && <Link to={patientDetailPath} className="btn-ghost">{t('buttons.detail')}</Link>}
              <Link to={`/h/${slug}/patients/${id}/timeline`} className="btn-ghost">{t('buttons.timeline')}</Link>
              <Link to={`/h/${slug}/patients/${id}/chart/print`} target="_blank" rel="noreferrer" className="btn-ghost">
                <Printer className="w-4 h-4" />
                {t('buttons.printSummary')}
              </Link>
              <Link to={`${basePath}/prescriptions/new?patient=${id}`} className="btn-primary">
                <Pill className="w-4 h-4" />
                {t('buttons.newRx')}
              </Link>
              <button onClick={() => void fetchChart(false)} className="btn-ghost" aria-label={t('aria.refreshChart')}>
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {snapshot.riskFlags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {snapshot.riskFlags.map((flag, idx) => (
                <span
                  key={`${flag.type}-${idx}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[String(flag.severity ?? '')] || 'bg-amber-100 text-amber-700'}`}
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {flag.label}
                </span>
              ))}
            </div>
          )}

          {data.careAlerts && data.careAlerts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.careAlerts.map((alert) => (
                <span
                  key={alert.code}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[String(alert.severity ?? '')] || 'bg-slate-100 text-slate-700'}`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {alert.label}
                </span>
              ))}
            </div>
          )}

          {data.familyRiskSummary && data.familyRiskSummary.insights.length > 0 && (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-rose-800 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4" />
                    {t('familyHistory.watchlist')}
                  </div>
                  <p className="mt-1 text-sm text-rose-900">{data.familyRiskSummary.headline}</p>
                  <p className="mt-1 text-xs text-rose-700/80">{data.familyRiskSummary.summary}</p>
                </div>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[String(data.familyRiskSummary.status)] || 'bg-amber-100 text-amber-700'}`}>
                  {data.familyRiskSummary.status}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 xl:grid-cols-3 gap-3">
                {data.familyRiskSummary.insights.slice(0, 3).map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-white/80 bg-white/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-rose-950">{item.label}</div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${STATUS_STYLES[String(item.severity)] || 'bg-amber-100 text-amber-700'}`}>
                        <ShieldAlert className="w-3.5 h-3.5" />
                        {item.severity}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-rose-900/80">{item.rationale}</p>
                    {item.care_context && (
                      <p className="mt-2 text-xs text-rose-800">{item.care_context}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {item.risk_score != null && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                          Score {item.risk_score}/8
                        </span>
                      )}
                      {item.screening_priority && (
                        <span className="rounded-full bg-rose-100 px-2.5 py-1 font-semibold text-rose-700">
                          {item.screening_priority.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    {item.screening_prompts?.length ? (
                      <ul className="mt-2 space-y-1 text-xs text-gray-700">
                        {item.screening_prompts.slice(0, 2).map((prompt) => (
                          <li key={prompt}>• {prompt}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-4 space-y-5">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Brain className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.sections.aiChartBrief')}
                </h2>
                {aiSummary.status !== 'ready' && (
                  <button
                    onClick={() => void fetchChart(true)}
                    disabled={aiLoading}
                    className="btn-ghost text-xs"
                  >
                    {aiLoading ? t('workspace.aiBrief.generating') : t('workspace.aiBrief.generate')}
                  </button>
                )}
              </div>

              {aiSummary.summary ? (
                <div className="space-y-3 text-sm">
                  {aiSummary.summary.oneLiner && (
                    <div className="rounded-xl bg-[var(--color-bg)] p-3 text-[var(--color-text)] font-medium">
                      {aiSummary.summary.oneLiner}
                    </div>
                  )}
                  {[
                    { label: t('workspace.aiBrief.activeIssues'), items: aiSummary.summary.activeIssues },
                    { label: t('workspace.aiBrief.familyHistory'), items: aiSummary.summary.familyHistory },
                    { label: t('workspace.aiBrief.patientContext'), items: aiSummary.summary.patientContext },
                    { label: t('workspace.aiBrief.recentChanges'), items: aiSummary.summary.recentChanges },
                    { label: t('workspace.aiBrief.medicationFocus'), items: aiSummary.summary.medicationFocus },
                    { label: t('workspace.aiBrief.abnormalFindings'), items: aiSummary.summary.abnormalFindings },
                    { label: t('workspace.aiBrief.followUpRisks'), items: aiSummary.summary.followUpRisks },
                    { label: t('workspace.aiBrief.cautions'), items: aiSummary.summary.cautions },
                    { label: t('workspace.aiBrief.provenanceFlags'), items: aiSummary.summary.provenanceFlags },
                  ].map(({ label, items }) => (
                    Array.isArray(items) && items.length > 0 ? (
                      <div key={label}>
                        <h3 className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">{label}</h3>
                        <ul className="space-y-1.5">
                          {items.map((item, index) => (
                            <li key={`${label}-${index}`} className="flex gap-2 text-[var(--color-text-secondary)]">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] shrink-0" />
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span>{item.text}</span>
                                  {item.priority && (
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[item.priority] || 'bg-slate-100 text-slate-700'}`}>
                                      {item.priority}
                                    </span>
                                  )}
                                  {item.provenance && (
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceBadge(item.provenance)}`}>
                                      {item.provenance.replace(/_/g, ' ')}
                                    </span>
                                  )}
                                </div>
                                {Array.isArray(item.citationIds) && item.citationIds.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {item.citationIds.map((citationId) => {
                                      const citation = citationLookup.get(citationId);
                                      return (
                                        <button
                                          type="button"
                                          key={citationId}
                                          onClick={() => {
                                            setSelectedSourceId(citationId);
                                            document.getElementById('chart-source-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                          }}
                                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] transition ${selectedSourceId === citationId ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)]'}`}
                                        >
                                          {citation ? `${citation.type}: ${citation.title}` : citationId}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null
                  ))}
                  {aiSummary.generatedAt && (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {aiSummary.status === 'fallback' ? t('workspace.ai.deterministicSummary') : t('workspace.ai.generated')} {fmtDateTime(aiSummary.generatedAt)}. {t('workspace.ai.verifyWithChart')}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
                  {aiSummary.status === 'unavailable'
                    ? t('workspace.ai.serviceNotConfigured')
                    : t('workspace.ai.generateSummaryDesc')}
                </div>
              )}
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.sections.activeProblems')}
              </h2>
              <div className="space-y-2">
                {(data.problemSummary?.active ?? snapshot.activeProblems).length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.emptyStates.noActiveProblems')}</p>
                ) : (data.problemSummary?.active ?? snapshot.activeProblems).map((problem) => (
                  <div key={problem.id ?? problem.description} className="rounded-xl bg-[var(--color-bg)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--color-text)]">{problem.description || t('workspace.labels.problem')}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{problem.status || t('workspace.status.active')}{problem.updated_at ? ` · ${t('labels.updated')} ${fmtDate(problem.updated_at)}` : ''}</p>
                      </div>
                      {problem.severity && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[String(problem.severity).toLowerCase()] || 'bg-slate-100 text-slate-700'}`}>
                          {problem.severity}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn-ghost text-xs" onClick={() => setSelectedSourceId(`problem-${String(problem.id)}`)}>{t('workspace.problems.source')}</button>
                      <button type="button" className="btn-ghost text-xs" disabled={actionLoading === `problem-${String(problem.id)}`} onClick={() => void resolveProblem(problem.id)}>
                        {actionLoading === `problem-${String(problem.id)}` ? t('workspace.problems.resolving') : t('workspace.problems.resolve')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {data.problemSummary?.resolved && data.problemSummary.resolved.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('workspace.sections.resolved')}</p>
                  {data.problemSummary.resolved.slice(0, 3).map((problem) => (
                    <button type="button" key={`resolved-${problem.id ?? problem.description}`} onClick={() => setSelectedSourceId(`problem-${String(problem.id)}`)} className="w-full rounded-xl bg-[var(--color-bg)] p-3 text-left">
                      <p className="font-medium text-[var(--color-text)]">{problem.description}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{problem.status || t('problems.resolved')}</p>
                    </button>
                  ))}
                </div>
              )}
              <form className="mt-4 space-y-2" onSubmit={addProblem}>
                <input className="input" placeholder={t('workspace.placeholders.addProblem')} value={problemForm.description} onChange={(e) => setProblemForm((prev) => ({ ...prev, description: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <select className="input" value={problemForm.severity} onChange={(e) => setProblemForm((prev) => ({ ...prev, severity: e.target.value }))}>
                    <option value="mild">{t('workspace.severity.mild')}</option>
                    <option value="moderate">{t('workspace.severity.moderate')}</option>
                    <option value="severe">{t('workspace.severity.severe')}</option>
                  </select>
                  <input className="input" placeholder={t('workspace.labels.comments')} value={problemForm.comments} onChange={(e) => setProblemForm((prev) => ({ ...prev, comments: e.target.value }))} />
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary" disabled={actionLoading === 'problem-add'}>
                    {actionLoading === 'problem-add' ? t('workspace.problems.adding') : t('workspace.problems.addProblem')}
                  </button>
                </div>
              </form>
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Pill className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.sections.currentMedications')}
              </h2>
              <div className="space-y-2">
                {(data.medicationHistory?.current ?? snapshot.currentMedications).length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.emptyStates.noMedications')}</p>
                ) : (data.medicationHistory?.current ?? snapshot.currentMedications).map((med) => (
                  <div key={med.id ?? med.medication_name} className="rounded-xl bg-[var(--color-bg)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-[var(--color-text)]">{med.medication_name}</p>
                      {med.provenance?.badge_text && (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge(med.provenance.category)}`}>
                          {med.provenance.badge_text}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {[med.dosage, med.frequency, med.status].filter(Boolean).join(' · ') || t('workspace.medications.noDosing')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn-ghost text-xs" onClick={() => setSelectedSourceId(`medication-${String(med.id)}`)}>{t('workspace.medications.source')}</button>
                      <button type="button" className="btn-ghost text-xs" disabled={actionLoading === `medication-${String(med.id)}`} onClick={() => void updateMedicationStatus(med.id, 'on_hold', t('workspace.medications.temporarilyHeld'))}>
                        {t('workspace.medications.hold')}
                      </button>
                      <button type="button" className="btn-ghost text-xs" disabled={actionLoading === `medication-${String(med.id)}`} onClick={() => void updateMedicationStatus(med.id, 'completed', t('workspace.medications.stoppedFromWorkspace'))}>
                        {t('workspace.medications.stop')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {data.medicationHistory?.stopped && data.medicationHistory.stopped.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('workspace.sections.stoppedMedications')}</p>
                  {data.medicationHistory.stopped.slice(0, 3).map((med) => (
                    <button type="button" key={`stopped-${med.id ?? med.medication_name}`} onClick={() => setSelectedSourceId(`medication-${String(med.id)}`)} className="w-full rounded-xl bg-[var(--color-bg)] p-3 text-left">
                      <p className="font-medium text-[var(--color-text)]">{med.medication_name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{[med.status, (med as BasicItem & { status_reason?: string }).status_reason].filter(Boolean).join(' · ')}</p>
                    </button>
                  ))}
                </div>
              )}
              <form className="mt-4 space-y-2" onSubmit={addMedication}>
                <input className="input" placeholder={t('workspace.placeholders.medicationName')} value={medicationForm.medication_name} onChange={(e) => setMedicationForm((prev) => ({ ...prev, medication_name: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" placeholder={t('workspace.labels.dose')} value={medicationForm.dosage} onChange={(e) => setMedicationForm((prev) => ({ ...prev, dosage: e.target.value }))} />
                  <input className="input" placeholder={t('workspace.labels.frequency')} value={medicationForm.frequency} onChange={(e) => setMedicationForm((prev) => ({ ...prev, frequency: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" placeholder={t('workspace.duration')} value={medicationForm.duration} onChange={(e) => setMedicationForm((prev) => ({ ...prev, duration: e.target.value }))} />
                  <input className="input" placeholder={t('workspace.labels.instructions')} value={medicationForm.instructions} onChange={(e) => setMedicationForm((prev) => ({ ...prev, instructions: e.target.value }))} />
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary" disabled={actionLoading === 'medication-add'}>
                    {actionLoading === 'medication-add' ? t('workspace.buttons.adding') : t('workspace.buttons.addMedication')}
                  </button>
                </div>
              </form>
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.sections.allergies')}
              </h2>
              {data.allergySummary && (
                <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                  {t('workspace.allergies.verified')} {data.allergySummary.verifiedCount} · {t('workspace.allergies.unverified')} {data.allergySummary.unverifiedCount}
                </p>
              )}
              <div className="space-y-2">
                {snapshot.allergies.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.emptyStates.noAllergies')}</p>
                ) : snapshot.allergies.map((item) => (
                  <div key={item.id ?? item.allergen} className="rounded-xl bg-[var(--color-bg)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-[var(--color-text)]">{item.allergen}</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[String(item.severity).toLowerCase()] || 'bg-amber-100 text-amber-700'}`}>
                        {item.severity || t('workspace.allergies.unknown')}
                      </span>
                    </div>
                    {item.reaction && <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('workspace.allergies.reactionLabel')}: {item.reaction}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn-ghost text-xs" onClick={() => setSelectedSourceId(`allergy-${String(item.id)}`)}>{t('workspace.labels.source')}</button>
                      {!item.verified_at && (
                        <button type="button" className="btn-ghost text-xs" disabled={actionLoading === `allergy-${String(item.id)}`} onClick={() => void verifyAllergy(item.id)}>
                          {actionLoading === `allergy-${String(item.id)}` ? t('workspace.allergies.verifying') : t('workspace.allergies.verify')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <form className="mt-4 space-y-2" onSubmit={addAllergy}>
                <input className="input" placeholder={t('workspace.allergies.allergen')} value={allergyForm.allergen} onChange={(e) => setAllergyForm((prev) => ({ ...prev, allergen: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <select className="input" value={allergyForm.allergy_type} onChange={(e) => setAllergyForm((prev) => ({ ...prev, allergy_type: e.target.value }))}>
                    <option value="drug">{t('workspace.allergyType.drug')}</option>
                    <option value="food">{t('workspace.allergyType.food')}</option>
                    <option value="environmental">{t('workspace.allergyType.environmental')}</option>
                    <option value="other">{t('workspace.allergyType.other')}</option>
                  </select>
                  <select className="input" value={allergyForm.severity} onChange={(e) => setAllergyForm((prev) => ({ ...prev, severity: e.target.value }))}>
                    <option value="mild">{t('workspace.severity.mild')}</option>
                    <option value="moderate">{t('workspace.severity.moderate')}</option>
                    <option value="severe">{t('workspace.severity.severe')}</option>
                    <option value="life_threatening">{t('workspace.severity.lifeThreatening')}</option>
                  </select>
                </div>
                <input className="input" placeholder={t('workspace.allergies.reaction')} value={allergyForm.reaction} onChange={(e) => setAllergyForm((prev) => ({ ...prev, reaction: e.target.value }))} />
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary" disabled={actionLoading === 'allergy-add'}>
                    {actionLoading === 'allergy-add' ? t('workspace.allergies.adding') : t('workspace.allergies.addAllergy')}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="xl:col-span-5 space-y-5">
            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.labs.title')}
              </h2>
              {recentLabs.abnormal.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.labs.noAbnormalLabs')}</p>
              ) : (
                <div className="space-y-2">
                  {recentLabs.abnormal.map((item, idx) => (
                    <div key={`${item.test_name}-${idx}`} className="rounded-xl border border-red-100 bg-red-50/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[var(--color-text)]">{String(item.test_name ?? t('workspace.labs.labResult'))}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {String(item.result ?? item.result_numeric ?? t('workspace.labs.pending'))} {item.unit ? String(item.unit) : ''}
                            {item.normal_range ? ` · ${t('workspace.labs.ref')} ${String(item.normal_range)}` : ''}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[String(item.abnormal_flag ?? '').toLowerCase()] || 'bg-red-100 text-red-700'}`}>
                          {String(item.abnormal_flag ?? t('workspace.labs.abnormal'))}
                        </span>
                      </div>
                      {item.provenance?.badge_text && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge(String(item.provenance.category ?? ''))}`}>
                            {String(item.provenance.badge_text)}
                          </span>
                          <span className="inline-flex rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                            {String(item.provenance.review_status ?? t('workspace.labs.reviewPending')).replace(/_/g, ' ')}
                          </span>
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {item.reviewed_at ? `${t('workspace.labs.reviewed')} ${fmtDateTime(String(item.reviewed_at))}` : t('workspace.labs.reviewPending')}
                        </p>
                        {!item.reviewed_at && (
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={actionLoading === `lab-review-${String(item.id ?? idx)}`}
                            onClick={() => void acknowledgeLabResult(item.id as number | string | undefined)}
                          >
                            {actionLoading === `lab-review-${String(item.id ?? idx)}` ? t('workspace.labs.reviewing') : t('workspace.labs.markReviewed')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.timeline.title')}
              </h2>
              <div className="space-y-3">
                {timeline.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.timeline.noEvents')}</p>
                ) : timeline.map((item) => (
                  <div key={item.id} className="rounded-xl border border-[var(--color-border)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--color-text)]">{item.title}</p>
                        {item.subtitle && <p className="text-sm text-[var(--color-text-secondary)] mt-1">{item.subtitle}</p>}
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                          {[item.doctor_name, fmtDateTime(item.date)].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {item.status && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[String(item.status).toLowerCase()] || 'bg-slate-100 text-slate-700'}`}>
                            {item.status}
                          </span>
                        )}
                        {item.provenance?.badge_text && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${provenanceCategoryBadge(item.provenance.category)}`}>
                            {item.provenance.badge_text}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.diagnoses.title')}
              </h2>
              {diagnoses.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.diagnoses.none')}</p>
              ) : (
                <div className="space-y-2">
                  {diagnoses.map((item, idx) => (
                    <div key={`${item.id ?? idx}`} className="rounded-xl bg-[var(--color-bg)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium text-[var(--color-text)]">{String(item.description ?? t('workspace.diagnoses.diagnosis'))}</p>
                        {(item as BasicItem).provenance?.badge_text && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge((item as BasicItem).provenance?.category)}`}>
                            {(item as BasicItem).provenance?.badge_text}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {[item.diagnosis_type, item.icd10_code, fmtDate(String(item.created_at ?? ''))].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {data.dischargeSummaries && data.dischargeSummaries.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.discharge.title')}
                </h2>
                <div className="space-y-2">
                  {data.dischargeSummaries.map((item, idx) => (
                    <div key={`discharge-${idx}`} className="rounded-xl bg-[var(--color-bg)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium text-[var(--color-text)]">{String(item.final_diagnosis ?? t('workspace.discharge.summary'))}</p>
                        {(item as BasicItem).provenance?.badge_text && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge((item as BasicItem).provenance?.category)}`}>
                            {(item as BasicItem).provenance?.badge_text}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {[item.admission_no, item.status, fmtDate(String(item.updated_at ?? ''))].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.consultations && data.consultations.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.consultations.title')}
                </h2>
                <div className="space-y-3">
                  {data.consultations.map((item, idx) => {
                    const sourceId = `consultation-${String(item.id ?? idx)}`;
                    return (
                      <button
                        type="button"
                        key={sourceId}
                        onClick={() => setSelectedSourceId(sourceId)}
                        className={`w-full rounded-xl p-3 text-left transition ${selectedSourceId === sourceId ? 'border border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'bg-[var(--color-bg)]'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-[var(--color-text)]">{String(item.chief_complaint ?? t('workspace.consultations.consultation'))}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">
                              {[item.doctor_name, item.status, fmtDateTime(String(item.scheduled_at ?? ''))].filter(Boolean).join(' · ')}
                            </p>
                            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                              {String(item.notes ?? item.prescription ?? t('workspace.consultations.noNoteRecorded'))}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {data.tasks.activeConsultation && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.encounter.title')}
                </h2>
                <div className="rounded-xl bg-[var(--color-bg)] p-3 mb-3">
                  <p className="font-medium text-[var(--color-text)]">
                    {String(data.tasks.activeConsultation.chief_complaint ?? t('workspace.encounter.activeConsultation'))}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {[data.tasks.activeConsultation.doctor_name, data.tasks.activeConsultation.status, fmtDateTime(String(data.tasks.activeConsultation.scheduled_at ?? ''))].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <form className="space-y-3" onSubmit={closeEncounter}>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => setEncounterCloseForm((prev) => ({ ...prev, prescription: buildPrescriptionDraft() }))}
                    >
                      {t('workspace.encounter.useCurrentMeds')}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => setEncounterCloseForm((prev) => ({ ...prev, reconciliation_summary: buildMedicationReconciliationSummary() }))}
                    >
                      {t('workspace.encounter.fillReconSummary')}
                    </button>
                  </div>
                  <input
                    className="input"
                    placeholder={t('workspace.encounter.workingDiagnosis')}
                    value={encounterCloseForm.diagnosis}
                    onChange={(e) => setEncounterCloseForm((prev) => ({ ...prev, diagnosis: e.target.value }))}
                  />
                  <textarea
                    className="input min-h-[80px]"
                    placeholder={t('workspace.encounter.encounterSummary')}
                    value={encounterCloseForm.summary}
                    onChange={(e) => setEncounterCloseForm((prev) => ({ ...prev, summary: e.target.value }))}
                  />
                  <textarea
                    className="input min-h-[80px]"
                    placeholder={t('workspace.encounter.prescriptionSummary')}
                    value={encounterCloseForm.prescription}
                    onChange={(e) => setEncounterCloseForm((prev) => ({ ...prev, prescription: e.target.value }))}
                  />
                  <label className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={encounterCloseForm.medication_reconciliation_done}
                      onChange={(e) => setEncounterCloseForm((prev) => ({ ...prev, medication_reconciliation_done: e.target.checked }))}
                    />
                    {t('workspace.encounter.medReconCompleted')}
                  </label>
                  <textarea
                    className="input min-h-[70px]"
                    placeholder={t('workspace.encounter.medReconSummary')}
                    value={encounterCloseForm.reconciliation_summary}
                    onChange={(e) => setEncounterCloseForm((prev) => ({ ...prev, reconciliation_summary: e.target.value }))}
                  />
                  <input
                    className="input"
                    type="date"
                    value={encounterCloseForm.followup_date}
                    onChange={(e) => setEncounterCloseForm((prev) => ({ ...prev, followup_date: e.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="input"
                      type="time"
                      value={encounterCloseForm.followup_time}
                      onChange={(e) => setEncounterCloseForm((prev) => ({ ...prev, followup_time: e.target.value }))}
                    />
                    <label className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)]">
                      <input
                        type="checkbox"
                        checked={encounterCloseForm.book_followup}
                        onChange={(e) => setEncounterCloseForm((prev) => ({ ...prev, book_followup: e.target.checked }))}
                      />
                      {t('workspace.encounter.bookFollowup')}
                    </label>
                  </div>
                  <input
                    className="input"
                    placeholder={t('workspace.encounter.followupNote')}
                    value={encounterCloseForm.followup_notes}
                    onChange={(e) => setEncounterCloseForm((prev) => ({ ...prev, followup_notes: e.target.value }))}
                  />
                  <div className="flex justify-end">
                    <button type="submit" className="btn-primary" disabled={actionLoading === 'encounter-close'}>
                      {actionLoading === 'encounter-close' ? t('workspace.encounter.closing') : t('workspace.encounter.closeEncounter')}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                {soapEditId ? t('workspace.soap.editTitle') : t('workspace.soap.newTitle')}
                {soapEditId && (
                  <button type="button" className="ml-auto text-xs text-gray-500 hover:text-gray-700" onClick={() => { setSoapEditId(null); setSoapForm({ chiefComplaint: '', subjective: '', objective: '', assessment: '', plan: '' }); }}>
                    {t('workspace.soap.cancelEdit')}
                  </button>
                )}
              </h2>
              {soapTemplates.length > 0 && !soapEditId && (
                <select
                  className="input mb-3 text-sm"
                  onChange={(e) => {
                    const t = soapTemplates.find((t) => t.id === Number(e.target.value));
                    if (t) {
                      setSoapForm({
                        chiefComplaint: t.chief_complaint ?? '',
                        subjective: t.subjective ?? '',
                        objective: t.objective ?? '',
                        assessment: t.assessment ?? '',
                        plan: t.plan ?? '',
                      });
                    }
                    e.target.value = '';
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>{t('workspace.loadTemplate')}</option>
                  {soapTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.specialty ? ` (${t.specialty})` : ''}</option>
                  ))}
                </select>
              )}
              <form className="space-y-3" onSubmit={saveSoapNote}>
                <input
                  className="input"
                  placeholder={t('workspace.soap.chiefComplaint')}
                  value={soapForm.chiefComplaint}
                  onChange={(e) => setSoapForm((prev) => ({ ...prev, chiefComplaint: e.target.value }))}
                />
                <textarea
                  className="input min-h-[80px]"
                  placeholder={t('workspace.soap.subjective')}
                  value={soapForm.subjective}
                  onChange={(e) => setSoapForm((prev) => ({ ...prev, subjective: e.target.value }))}
                />
                <textarea
                  className="input min-h-[80px]"
                  placeholder={t('workspace.soap.objective')}
                  value={soapForm.objective}
                  onChange={(e) => setSoapForm((prev) => ({ ...prev, objective: e.target.value }))}
                />
                <textarea
                  className="input min-h-[80px]"
                  placeholder={t('workspace.soap.assessment')}
                  value={soapForm.assessment}
                  onChange={(e) => setSoapForm((prev) => ({ ...prev, assessment: e.target.value }))}
                />
                <textarea
                  className="input min-h-[80px]"
                  placeholder={t('workspace.soap.plan')}
                  value={soapForm.plan}
                  onChange={(e) => setSoapForm((prev) => ({ ...prev, plan: e.target.value }))}
                />
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary" disabled={soapSaving}>
                    {soapSaving ? t('workspace.soap.saving') : soapEditId ? t('workspace.soap.updateSoap') : t('workspace.soap.saveSoap')}
                  </button>
                </div>
              </form>
            </div>

            {data.soapNotes && data.soapNotes.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.soap.soapNotes')}
                </h2>
                <div className="space-y-3">
                  {data.soapNotes.map((item, idx) => {
                    const sourceId = `soap-${String(item.SOAPId ?? idx)}`;
                    return (
                      <button
                        type="button"
                        key={sourceId}
                        onClick={() => setSelectedSourceId(sourceId)}
                        className={`w-full rounded-xl p-3 text-left transition ${selectedSourceId === sourceId ? 'border border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'bg-[var(--color-bg)]'}`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-[var(--color-text)]">{String(item.ChiefComplaint ?? t('workspace.soap.soapNote'))}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">
                              {fmtDateTime(String(item.CreatedAt ?? ''))}
                            </p>
                          </div>
                          <span
                            role="button"
                            tabIndex={0}
                            className="text-xs text-[var(--color-primary)] hover:underline cursor-pointer"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setSoapEditId(Number(item.SOAPId));
                              setSoapForm({
                                chiefComplaint: String(item.ChiefComplaint ?? ''),
                                subjective: String(item.Subjective ?? ''),
                                objective: String(item.Objective ?? ''),
                                assessment: String(item.Assessment ?? ''),
                                plan: String(item.Plan ?? ''),
                              });
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                          >{t('workspace.soap.edit')}</span>
                        </div>
                        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                          {String(item.Assessment ?? item.Subjective ?? t('workspace.soap.noSummaryRecorded'))}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {data.radiologyReports && data.radiologyReports.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.radiology.reportsTitle')}
                </h2>
                <div className="space-y-3">
                  {data.radiologyReports.map((item, idx) => {
                    const sourceId = `radiology-report-${String(item.id ?? idx)}`;
                    return (
                      <button
                        type="button"
                        key={sourceId}
                        onClick={() => setSelectedSourceId(sourceId)}
                        className={`w-full rounded-xl p-3 text-left transition ${selectedSourceId === sourceId ? 'border border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'bg-[var(--color-bg)]'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium text-[var(--color-text)]">{String(item.imaging_item_name ?? item.imaging_type_name ?? t('workspace.radiology.report'))}</p>
                          {(item as BasicItem).provenance?.badge_text && (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge((item as BasicItem).provenance?.category)}`}>
                              {(item as BasicItem).provenance?.badge_text}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {[item.performer_name, item.order_status, fmtDate(String(item.created_at ?? ''))].filter(Boolean).join(' · ')}
                        </p>
                        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                          {String(item.report_text ?? item.indication ?? t('workspace.radiology.findings'))}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {item.reviewed_at ? `${t('workspace.radiology.reviewed')} ${fmtDateTime(String(item.reviewed_at))}` : t('workspace.radiology.reviewPending')}
                          </p>
                          {!item.reviewed_at && (
                            <span
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void acknowledgeRadiologyReport(item.id as number | string | undefined);
                              }}
                              className={`btn-ghost text-xs ${actionLoading === `radiology-review-${String(item.id ?? idx)}` ? 'pointer-events-none opacity-60' : ''}`}
                            >
                              {actionLoading === `radiology-review-${String(item.id ?? idx)}` ? t('workspace.radiology.reviewing') : t('workspace.radiology.markReviewed')}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.quickOrders.title')}
              </h2>
              <div className="space-y-5">
                <form className="space-y-2" onSubmit={createLabOrder}>
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('workspace.quickOrders.lab')}</p>
                  <input className="input" placeholder={t('workspace.quickOrders.searchLabTest')} value={labSearch} onChange={(e) => setLabSearch(e.target.value)} />
                  {labSearchLoading && <p className="text-xs text-[var(--color-text-muted)]">{t('workspace.quickOrders.searchingTests')}</p>}
                  {labOptions.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                      {labOptions.slice(0, 6).map((test) => (
                        <button
                          type="button"
                          key={test.id}
                          onClick={() => {
                            setLabOrderForm((prev) => ({ ...prev, lab_test_id: String(test.id) }));
                            setLabSearch(test.name);
                            setLabOptions([]);
                          }}
                          className="flex w-full items-start justify-between rounded-lg px-2 py-2 text-left hover:bg-white"
                        >
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text)]">{test.name}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{[test.code, test.category].filter(Boolean).join(' · ')}</p>
                          </div>
                          {typeof test.price === 'number' && (
                            <span className="text-xs text-[var(--color-text-muted)]">৳{test.price}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" placeholder={t('workspace.quickOrders.labTestId')} value={labOrderForm.lab_test_id} onChange={(e) => setLabOrderForm((prev) => ({ ...prev, lab_test_id: e.target.value }))} />
                    <input className="input" placeholder={t('workspace.quickOrders.instructions')} value={labOrderForm.instructions} onChange={(e) => setLabOrderForm((prev) => ({ ...prev, instructions: e.target.value }))} />
                  </div>
                  <input className="input" placeholder={t('workspace.quickOrders.orderNotes')} value={labOrderForm.notes} onChange={(e) => setLabOrderForm((prev) => ({ ...prev, notes: e.target.value }))} />
                  <div className="flex justify-end">
                    <button type="submit" className="btn-primary" disabled={actionLoading === 'lab-order'}>
                      {actionLoading === 'lab-order' ? t('workspace.quickOrders.ordering') : t('workspace.quickOrders.orderLab')}
                    </button>
                  </div>
                </form>

                <form className="space-y-2" onSubmit={createRadiologyOrder}>
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('workspace.quickOrders.radiology')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <select className="input" value={radiologyOrderForm.imaging_type_name} onChange={(e) => setRadiologyOrderForm((prev) => ({ ...prev, imaging_type_name: e.target.value }))}>
                      <option value="X-Ray">{t('workspace.imaging.xray')}</option>
                      <option value="Ultrasound">{t('workspace.imaging.ultrasound')}</option>
                      <option value="CT">{t('workspace.imaging.ct')}</option>
                      <option value="MRI">{t('workspace.imaging.mri')}</option>
                    </select>
                    <select className="input" value={radiologyOrderForm.urgency} onChange={(e) => setRadiologyOrderForm((prev) => ({ ...prev, urgency: e.target.value }))}>
                      <option value="normal">{t('workspace.urgency.normal')}</option>
                      <option value="urgent">{t('workspace.urgency.urgent')}</option>
                      <option value="stat">{t('workspace.urgency.stat')}</option>
                    </select>
                  </div>
                  <input className="input" placeholder={t('workspace.quickOrders.imagingItem')} value={radiologyOrderForm.imaging_item_name} onChange={(e) => setRadiologyOrderForm((prev) => ({ ...prev, imaging_item_name: e.target.value }))} />
                  <input className="input" placeholder={t('workspace.quickOrders.requisitionRemarks')} value={radiologyOrderForm.requisition_remarks} onChange={(e) => setRadiologyOrderForm((prev) => ({ ...prev, requisition_remarks: e.target.value }))} />
                  <div className="flex justify-end">
                    <button type="submit" className="btn-primary" disabled={actionLoading === 'radiology-order'}>
                      {actionLoading === 'radiology-order' ? t('workspace.quickOrders.ordering') : t('workspace.quickOrders.orderImaging')}
                    </button>
                  </div>
                </form>

                <form className="space-y-2" onSubmit={createFollowUp}>
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('workspace.quickOrders.followup')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" type="date" value={followUpForm.apptDate} onChange={(e) => setFollowUpForm((prev) => ({ ...prev, apptDate: e.target.value }))} />
                    <input className="input" type="time" value={followUpForm.apptTime} onChange={(e) => setFollowUpForm((prev) => ({ ...prev, apptTime: e.target.value }))} />
                  </div>
                  <input className="input" placeholder={t('workspace.quickOrders.followupNotes')} value={followUpForm.notes} onChange={(e) => setFollowUpForm((prev) => ({ ...prev, notes: e.target.value }))} />
                  <div className="flex justify-end">
                    <button type="submit" className="btn-primary" disabled={actionLoading === 'follow-up'}>
                      {actionLoading === 'follow-up' ? t('workspace.quickOrders.scheduling') : t('workspace.quickOrders.scheduleFollowup')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <div className="xl:col-span-3 space-y-5">
            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.vitals.title')}
              </h2>
              <VitalsTrend patientId={patient.id} compact />
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.followups.title')}
              </h2>
              <div className="space-y-2">
                {tasks.pendingFollowUps.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.followups.none')}</p>
                ) : tasks.pendingFollowUps.map((item, idx) => (
                  <div key={`follow-up-${idx}`} className="rounded-xl bg-[var(--color-bg)] p-3">
                    <p className="font-medium text-[var(--color-text)]">{String(item.doctor_name ?? t('workspace.followups.followup'))}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {[fmtDate(String(item.appointment_date ?? '')), item.time_slot, item.status].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {data.tasks.vitalAlerts && data.tasks.vitalAlerts.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.alerts.title')}
                </h2>
                <div className="space-y-2">
                  {data.tasks.vitalAlerts.map((item, idx) => (
                    <div key={`vital-alert-${idx}`} className="rounded-xl bg-[var(--color-bg)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[var(--color-text)] capitalize">{String(item.vital_type ?? t('workspace.labels.alert')).replace(/_/g, ' ')}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {[String(item.recorded_value ?? ''), String(item.severity ?? ''), fmtDateTime(String(item.created_at ?? ''))].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[String(item.severity ?? '').toLowerCase()] || 'bg-amber-100 text-amber-700'}`}>
                          {String(item.status ?? t('workspace.status.active'))}
                        </span>
                      </div>
                      {String(item.status ?? t('workspace.status.active')) === t('workspace.status.active') && (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={actionLoading === `alert-${String(item.id ?? idx)}`}
                            onClick={() => void acknowledgeVitalAlert(item.id as number | string | undefined)}
                          >
                            {actionLoading === `alert-${String(item.id ?? idx)}` ? t('workspace.alerts.acknowledging') : t('workspace.alerts.acknowledge')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <User className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.pendingOrders.title')}
              </h2>
              <div className="space-y-2">
                {tasks.pendingOrders.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.pendingOrders.none')}</p>
                ) : tasks.pendingOrders.map((item, idx) => (
                  <div key={`order-${idx}`} className="rounded-xl bg-[var(--color-bg)] p-3">
                    <p className="font-medium text-[var(--color-text)]">{String(item.order_no ?? t('workspace.pendingOrders.labOrder'))}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {Number(item.pending_items ?? 0)} pending of {Number(item.total_items ?? 0)} tests
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {data.referrals && data.referrals.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.referrals.title')}
                </h2>
                <div className="space-y-2">
                  {data.referrals.map((item, idx) => (
                    <div key={`ref-${idx}`} className="rounded-xl bg-[var(--color-bg)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium text-[var(--color-text)]">{String(item.referred_to ?? t('workspace.labels.referral'))}</p>
                        {(item as BasicItem).provenance?.badge_text && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge((item as BasicItem).provenance?.category)}`}>
                            {(item as BasicItem).provenance?.badge_text}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {[item.referred_reason, fmtDate(String(item.referred_date ?? item.created_at ?? ''))].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.documents.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.documents.title')}
                </h2>
                <div className="space-y-2">
                  {data.documents.slice(0, 5).map((item, idx) => (
                    <div key={`doc-${idx}`} className="rounded-xl bg-[var(--color-bg)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium text-[var(--color-text)]">{String(item.title ?? t('workspace.documents.document'))}</p>
                        {(item as BasicItem).provenance?.badge_text && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge((item as BasicItem).provenance?.category)}`}>
                            {(item as BasicItem).provenance?.badge_text}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {[item.document_type, fmtDate(String(item.created_at ?? ''))].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.radiologyOrders && data.radiologyOrders.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.radiology.ordersTitle')}
                </h2>
                <div className="space-y-2">
                  {data.radiologyOrders.map((item, idx) => (
                    <button
                      type="button"
                      key={`rad-order-${idx}`}
                      onClick={() => setSelectedSourceId(`radiology-order-${String(item.id ?? idx)}`)}
                      className={`w-full rounded-xl p-3 text-left transition ${selectedSourceId === `radiology-order-${String(item.id ?? idx)}` ? 'border border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'bg-[var(--color-bg)]'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium text-[var(--color-text)]">{String(item.imaging_item_name ?? item.imaging_type_name ?? t('workspace.radiology.order'))}</p>
                        {(item as BasicItem).provenance?.badge_text && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge((item as BasicItem).provenance?.category)}`}>
                            {(item as BasicItem).provenance?.badge_text}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {[item.urgency, item.order_status, fmtDate(String(item.imaging_date ?? ''))].filter(Boolean).join(' · ')}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {data.tasks.chronicCareReminders && data.tasks.chronicCareReminders.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('workspace.chronicCare.title')}
                </h2>
                <div className="space-y-2">
                  {data.tasks.chronicCareReminders.map((item, idx) => (
                    <div key={`chronic-reminder-${idx}`} className="rounded-xl bg-[var(--color-bg)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[var(--color-text)]">{String(item.label ?? t('workspace.chronicCare.reminder'))}</p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{String(item.recommendation ?? '')}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[String(item.severity ?? '').toLowerCase()] || 'bg-slate-100 text-slate-700'}`}>
                          {String(item.severity ?? t('workspace.severity.info'))}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div id="chart-source-panel" className="card p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-[var(--color-primary)]" />
                {t('workspace.sourcePanel.title')}
              </h2>
              {(selectedCitation || selectedSourceId || sourceDetail) ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-[var(--color-text)]">{sourceDetail?.source.title ?? selectedCitation?.title ?? selectedSourceId}</p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-[var(--color-primary)]">
                          {sourceLabel(sourceDetail?.source.type ?? selectedCitation?.type)}
                        </span>
                        {sourceDetail?.source.provenance?.badge_text && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge(sourceDetail.source.provenance.category)}`}>
                            {sourceDetail.source.provenance.badge_text}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {[sourceDetail?.source.status ?? selectedCitation?.status, fmtDateTime(sourceDetail?.source.date ?? selectedCitation?.date)].filter(Boolean).join(' · ')}
                    </p>
                    {sourceDetail?.source.provenance && (
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {[
                          sourceDetail.source.provenance.source_label,
                          sourceDetail.source.provenance.review_status.replace(/_/g, ' '),
                          sourceDetail.source.provenance.reviewed_at ? `${t('workspace.labs.reviewed')} ${fmtDateTime(sourceDetail.source.provenance.reviewed_at)}` : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {(sourceDetail?.source.summary || selectedCitation?.subtitle) && (
                      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{sourceDetail?.source.summary ?? selectedCitation?.subtitle}</p>
                    )}
                  </div>
                  {sourceLoading ? (
                    <div className="rounded-xl bg-[var(--color-bg)] p-3 text-sm text-[var(--color-text-muted)]">{t('workspace.sourcePanel.loadingDetails')}</div>
                  ) : sourceDetail?.source.sections && sourceDetail.source.sections.length > 0 ? (
                    <div className="space-y-2">
                      {sourceDetail.source.sections.map((section) => (
                        <div key={section.label} className="rounded-xl bg-[var(--color-bg)] p-3">
                          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">{section.label}</p>
                          <p className="mt-1 text-sm text-[var(--color-text)] whitespace-pre-wrap">{section.value}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {aiSummary.citations.slice(0, 12).map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => setSelectedSourceId(item.id)}
                        className={`w-full rounded-xl px-3 py-2 text-left transition ${selectedSourceId === item.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text)]'}`}
                      >
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className={`text-xs ${selectedSourceId === item.id ? 'text-white/80' : 'text-[var(--color-text-muted)]'}`}>
                          {[sourceLabel(item.type), fmtDate(item.date)].filter(Boolean).join(' · ')}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.sourcePanel.emptyState')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
