import { useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface PatientResult { id: number; name: string; patient_code?: string; uhid?: string; }
interface ToothEntry { ToothNumber: string; ToothCondition?: string; ConditionStatus?: string; ConditionSecondary?: string; SurfaceMesial?: string; SurfaceDistal?: string; SurfaceBuccal?: string; SurfaceLingual?: string; SurfaceOcclusal?: string; ClinicalNotes?: string; ToothStatus?: string; }
interface Treatment { TreatmentId: number; ToothNumber?: string; ProcedureName: string; CdtCode: string; PerformedDate: string; Fee?: number; Status?: string; IsMultiVisit?: number; VisitNumber?: number; TotalPlannedVisits?: number; }
interface TreatmentPlan { PlanId: number; PlanName?: string; PlanPhase: number; Priority: string; EstimatedTotal: number; ClinicalNotes?: string; CreatedAt: string; }
interface TreatmentPlanDetail extends TreatmentPlan { items?: { PlanItemId: number; CdtCode?: string; ToothNumber?: string; ToothSurface?: string; EstimatedFee?: number; ActualFee?: number; Status: string; Priority: number; Notes?: string }[]; }
interface PerioEntry { ChartId: number; ToothNumber: string; PocketDepthMB?: number; PocketDepthB?: number; PocketDepthDB?: number; PocketDepthDL?: number; PocketDepthL?: number; PocketDepthML?: number; BleedingMB?: number; BleedingB?: number; BleedingDB?: number; BleedingDL?: number; BleedingL?: number; BleedingML?: number; Mobility?: number; Furcation?: number; PlaqueIndex?: number; ClinicalNotes?: string; ChartedDate: string; }
interface XrayEntry { XrayId: number; XrayType: string; XraySeries?: string; TeethImaged?: string; ImageCount?: number; Reason?: string; Findings?: string; InterpretationNotes?: string; RadiationDose?: number; TakenDate: string; R2Key?: string; FileName?: string; }
interface PrescriptionEntry { PrescriptionId: number; DrugName: string; Dosage?: string; Frequency?: string; Duration?: string; Instructions?: string; PrescribedDate: string; LinkedTreatment?: string; Status?: string; }
interface PrintData { chart: any[]; treatments: any[]; perio: any[]; xrays: any[]; }


// ═══════════════════════════════════════════════════════════════════════════════
// DENTAL NOTATION SYSTEMS
// ═══════════════════════════════════════════════════════════════════════════════

const UPPER_TEETH = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
const LOWER_TEETH = [32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17];

const FDI_MAP: Record<string, string> = {
  '1':'18','2':'17','3':'16','4':'15','5':'14','6':'13','7':'12','8':'11',
  '9':'21','10':'22','11':'23','12':'24','13':'25','14':'26','15':'27','16':'28',
  '17':'48','18':'47','19':'46','20':'45','21':'44','22':'43','23':'42','24':'41',
  '25':'31','26':'32','27':'33','28':'34','29':'35','30':'36','31':'37','32':'38',
};

const PALMER_MAP: Record<string, string> = {
  '1':'8┘','2':'7┘','3':'6┘','4':'5┘','5':'4┘','6':'3┘','7':'2┘','8':'1┘',
  '9':'└1','10':'└2','11':'└3','12':'└4','13':'└5','14':'└6','15':'└7','16':'└8',
  '17':'└8','18':'└7','19':'└6','20':'└5','21':'└4','22':'└3','23':'└2','24':'└1',
  '25':'1┘','26':'2┘','27':'3┘','28':'4┘','29':'5┘','30':'6┘','31':'7┘','32':'8┘',
};

function getToothLabel(num: number, notation: string): string {
  const s = String(num);
  if (notation === 'fdi') return FDI_MAP[s] || s;
  if (notation === 'palmer') return PALMER_MAP[s] || s;
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED CONDITION LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════

const CONDITION_META: Record<string, { color: string; text: string; cat: string }> = {
  decay:       { color: '#f87171', text: 'text-white', cat: 'restorative' },
  missing:     { color: '#9ca3af', text: 'text-white', cat: 'general' },
  crown:       { color: '#fbbf24', text: 'text-gray-900', cat: 'prosthodontic' },
  filling:     { color: '#60a5fa', text: 'text-white', cat: 'restorative' },
  extraction:  { color: '#dc2626', text: 'text-white', cat: 'general' },
  bridge:      { color: '#c084fc', text: 'text-white', cat: 'prosthodontic' },
  implant:     { color: '#2dd4bf', text: 'text-white', cat: 'prosthodontic' },
  fracture:    { color: '#f97316', text: 'text-white', cat: 'general' },
  abrasion:    { color: '#f472b6', text: 'text-white', cat: 'general' },
  erosion:     { color: '#a78bfa', text: 'text-white', cat: 'general' },
  abscess:     { color: '#ef4444', text: 'text-white', cat: 'endodontic' },
  impacted:    { color: '#64748b', text: 'text-white', cat: 'general' },
  rct:         { color: '#34d399', text: 'text-gray-900', cat: 'endodontic' },
  post:        { color: '#fb923c', text: 'text-white', cat: 'endodontic' },
  veneer:      { color: '#e879f9', text: 'text-white', cat: 'prosthodontic' },
  inlay:       { color: '#818cf8', text: 'text-white', cat: 'restorative' },
  onlay:       { color: '#6366f1', text: 'text-white', cat: 'restorative' },
  sealant:     { color: '#22d3ee', text: 'text-gray-900', cat: 'preventive' },
  ortho_bracket:{ color: '#a3e635', text: 'text-gray-900', cat: 'orthodontic' },
  calculus:    { color: '#94a3b8', text: 'text-white', cat: 'perio' },
  gingivitis:  { color: '#f87171', text: 'text-white', cat: 'perio' },
  recession:   { color: '#fcd34d', text: 'text-gray-900', cat: 'perio' },
  wear:        { color: '#d1d5db', text: 'text-gray-900', cat: 'general' },
};

const STATUS_ICONS: Record<string, string> = { existing: '✓', planned: '○', inprogress: '◐', completed: '●' };
const STATUS_BORDER: Record<string, string> = { existing: 'border-solid', planned: 'border-dashed', inprogress: 'border-dotted', completed: 'border-double' };
const SURFACES = ['Mesial', 'Distal', 'Buccal', 'Lingual', 'Occlusal'];
const SURFACE_KEYS = ['SurfaceMesial', 'SurfaceDistal', 'SurfaceBuccal', 'SurfaceLingual', 'SurfaceOcclusal'];
const PERIO_SITES = ['MB','B','DB','DL','L','ML'];

const TABS = [
  { key: 'chart', label: 'chart' },
  { key: 'treatments', label: 'treatments' },
  { key: 'plans', label: 'treatmentPlans' },
  { key: 'perio', label: 'perioCharting' },
  { key: 'xrays', label: 'xrays' },
  { key: 'prescriptions', label: 'prescriptions' },
]

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Dental({ role }: { role?: string }) {
  const { t } = useTranslation('dental');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  const [chart, setChart] = useState<ToothEntry[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [perio, setPerio] = useState<PerioEntry[]>([]);
  const [xrays, setXrays] = useState<XrayEntry[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionEntry[]>([]);
  const [activeTooth, setActiveTooth] = useState<string | null>(null);
  const [notation, setNotation] = useState('universal');
  const [tab, setTab] = useState('chart');
  const [selectedPlan, setSelectedPlan] = useState<TreatmentPlanDetail | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [conditionFilter, setConditionFilter] = useState('');

  const [toothForm, setToothForm] = useState({
    ToothCondition: '', ConditionStatus: 'existing', ConditionSecondary: '',
    SurfaceMesial: '', SurfaceDistal: '', SurfaceBuccal: '', SurfaceLingual: '', SurfaceOcclusal: '',
    ClinicalNotes: '', ToothStatus: 'present'
  });
  const [treatForm, setTreatForm] = useState({
    CdtCode: '', ProcedureName: '', ToothNumber: '', PerformedDate: new Date().toISOString().slice(0,10),
    Fee: '', IsMultiVisit: false, VisitNumber: 1, TotalPlannedVisits: 1, NextVisitDate: '', NextVisitNotes: ''
  });
  const [planForm, setPlanForm] = useState({
    PlanName: '', Priority: 'routine', ClinicalNotes: '',
    Items: [] as { CdtCode: string; ToothNumber: string; ToothSurface: string; EstimatedFee: string; Priority: string; Status: string; Notes: string }[]
  });
  const [perioForm, setPerioForm] = useState({
    ToothNumber: '', PocketDepthMB: '', PocketDepthB: '', PocketDepthDB: '', PocketDepthDL: '', PocketDepthL: '', PocketDepthML: '',
    BleedingMB: false, BleedingB: false, BleedingDB: false, BleedingDL: false, BleedingL: false, BleedingML: false,
    Mobility: '0', Furcation: '0', PlaqueIndex: '0', ClinicalNotes: ''
  });
  const [xrayForm, setXrayForm] = useState({
    XrayType: 'periapical', XraySeries: '', TeethImaged: '', ImageCount: '',
    Reason: '', Findings: '', InterpretationNotes: '', RadiationDose: '', TakenDate: new Date().toISOString().slice(0,10)
  });
  const [rxForm, setRxForm] = useState({
    DrugName: '', Dosage: '', Frequency: '', Duration: '', Instructions: '', TreatmentId: ''
  });
  const [saving, setSaving] = useState({ tooth: false, treat: false, plan: false, perio: false, xray: false, rx: false });

  const searchPatients = useCallback(async () => {
    if (search.length < 2) return;
    try {
      const res = await api.get(`/api/patients?search=${encodeURIComponent(search)}&limit=10`) as any;
      setPatients(res?.patients ?? res?.Results ?? []);
    } catch { /* silent */ }
  }, [search]);

  useEffect(() => {
    const tm = setTimeout(searchPatients, 300);
    return () => clearTimeout(tm);
  }, [searchPatients]);

  const loadPatient = async (p: PatientResult) => {
    setSelectedPatient(p);
    setPatients([]);
    setSearch('');
    try {
      const [cRes, tRes, pRes, prRes, xRes, rxRes] = await Promise.all([
        api.get(`/api/dental/chart/${p.id}`).catch(() => ({ Results: [] })) as any,
        api.get(`/api/dental/treatments/${p.id}`).catch(() => ({ Results: [] })) as any,
        api.get(`/api/dental/plans/${p.id}`).catch(() => ({ Results: [] })) as any,
        api.get(`/api/dental/perio/${p.id}`).catch(() => ({ Results: [] })) as any,
        api.get(`/api/dental/xrays/${p.id}`).catch(() => ({ Results: [] })) as any,
        api.get(`/api/dental/prescriptions/${p.id}`).catch(() => ({ Results: [] })) as any,
      ]);
      setChart(cRes?.Results ?? []);
      setTreatments(tRes?.Results ?? []);
      setPlans(pRes?.Results ?? []);
      setPerio(prRes?.Results ?? []);
      setXrays(xRes?.Results ?? []);
      setPrescriptions(rxRes?.Results ?? []);
    } catch { toast.error(t('failedToLoad')); }
  };

  const getToothEntry = (num: number) => chart.find((t: any) => String(t.ToothNumber) === String(num));

  const saveTooth = async () => {
    if (!selectedPatient || !activeTooth) return;
    setSaving(s => ({ ...s, tooth: true }));
    try {
      await api.post('/api/dental/chart', {
        PatientId: selectedPatient.id,
        ToothNumber: activeTooth,
        ToothStatus: toothForm.ToothStatus,
        ToothCondition: toothForm.ToothCondition || undefined,
        ConditionStatus: toothForm.ConditionStatus,
        ConditionSecondary: toothForm.ConditionSecondary || undefined,
        SurfaceMesial: toothForm.SurfaceMesial || undefined,
        SurfaceDistal: toothForm.SurfaceDistal || undefined,
        SurfaceBuccal: toothForm.SurfaceBuccal || undefined,
        SurfaceLingual: toothForm.SurfaceLingual || undefined,
        SurfaceOcclusal: toothForm.SurfaceOcclusal || undefined,
        ClinicalNotes: toothForm.ClinicalNotes || undefined,
      });
      toast.success(t('toothUpdated', { tooth: activeTooth }));
      setActiveTooth(null);
      const res = await api.get(`/api/dental/chart/${selectedPatient.id}`) as any;
      setChart(res?.Results ?? []);
    } catch { toast.error(t('failedToSave')); }
    finally { setSaving(s => ({ ...s, tooth: false })); }
  };

  const saveTreatment = async () => {
    if (!selectedPatient || !treatForm.CdtCode || !treatForm.ProcedureName) {
      toast.error(t('cdtAndNameRequired')); return;
    }
    setSaving(s => ({ ...s, treat: true }));
    try {
      await api.post('/api/dental/treatments', {
        PatientId: selectedPatient.id,
        CdtCode: treatForm.CdtCode,
        ProcedureName: treatForm.ProcedureName,
        ToothNumber: treatForm.ToothNumber || undefined,
        PerformedDate: treatForm.PerformedDate,
        Fee: treatForm.Fee ? Number(treatForm.Fee) : undefined,
        IsMultiVisit: treatForm.IsMultiVisit,
        VisitNumber: Number(treatForm.VisitNumber) || 1,
        TotalPlannedVisits: Number(treatForm.TotalPlannedVisits) || 1,
        NextVisitDate: treatForm.NextVisitDate || undefined,
        NextVisitNotes: treatForm.NextVisitNotes || undefined,
      });
      toast.success(t('treatmentRecorded'));
      setTreatForm({ CdtCode: '', ProcedureName: '', ToothNumber: '', PerformedDate: new Date().toISOString().slice(0,10), Fee: '', IsMultiVisit: false, VisitNumber: 1, TotalPlannedVisits: 1, NextVisitDate: '', NextVisitNotes: '' });
      const res = await api.get(`/api/dental/treatments/${selectedPatient.id}`) as any;
      setTreatments(res?.Results ?? []);
    } catch { toast.error(t('failedToSaveTreatment')); }
    finally { setSaving(s => ({ ...s, treat: false })); }
  };

  const savePlan = async () => {
    if (!selectedPatient) return;
    setSaving(s => ({ ...s, plan: true }));
    try {
      await api.post('/api/dental/plans', {
        PatientId: selectedPatient.id,
        PlanName: planForm.PlanName || undefined,
        Priority: planForm.Priority,
        ClinicalNotes: planForm.ClinicalNotes || undefined,
        Items: planForm.Items.filter(i => i.CdtCode || i.ToothNumber).map(i => ({
          CdtCode: i.CdtCode || undefined, ToothNumber: i.ToothNumber || undefined,
          ToothSurface: i.ToothSurface || undefined,
          EstimatedFee: i.EstimatedFee ? Number(i.EstimatedFee) : undefined,
          Priority: Number(i.Priority) || 2, Status: i.Status || 'planned', Notes: i.Notes || undefined,
        })),
      });
      toast.success(t('planSaved'));
      setPlanForm({ PlanName: '', Priority: 'routine', ClinicalNotes: '', Items: [] as { CdtCode: string; ToothNumber: string; ToothSurface: string; EstimatedFee: string; Priority: string; Status: string; Notes: string }[] });
      const res = await api.get(`/api/dental/plans/${selectedPatient.id}`) as any;
      setPlans(res?.Results ?? []);
    } catch { toast.error(t('failedToSavePlan')); }
    finally { setSaving(s => ({ ...s, plan: false })); }
  };

  const savePerio = async () => {
    if (!selectedPatient || !perioForm.ToothNumber) return;
    setSaving(s => ({ ...s, perio: true }));
    try {
      await api.post('/api/dental/perio', {
        PatientId: selectedPatient.id, ToothNumber: perioForm.ToothNumber,
        PocketDepthMB: perioForm.PocketDepthMB ? Number(perioForm.PocketDepthMB) : undefined,
        PocketDepthB: perioForm.PocketDepthB ? Number(perioForm.PocketDepthB) : undefined,
        PocketDepthDB: perioForm.PocketDepthDB ? Number(perioForm.PocketDepthDB) : undefined,
        PocketDepthDL: perioForm.PocketDepthDL ? Number(perioForm.PocketDepthDL) : undefined,
        PocketDepthL: perioForm.PocketDepthL ? Number(perioForm.PocketDepthL) : undefined,
        PocketDepthML: perioForm.PocketDepthML ? Number(perioForm.PocketDepthML) : undefined,
        BleedingMB: perioForm.BleedingMB, BleedingB: perioForm.BleedingB, BleedingDB: perioForm.BleedingDB,
        BleedingDL: perioForm.BleedingDL, BleedingL: perioForm.BleedingL, BleedingML: perioForm.BleedingML,
        Mobility: Number(perioForm.Mobility) || 0, Furcation: Number(perioForm.Furcation) || 0,
        PlaqueIndex: Number(perioForm.PlaqueIndex) || 0, ClinicalNotes: perioForm.ClinicalNotes || undefined,
      });
      toast.success(t('perioSaved'));
      setPerioForm({ ToothNumber: '', PocketDepthMB: '', PocketDepthB: '', PocketDepthDB: '', PocketDepthDL: '', PocketDepthL: '', PocketDepthML: '', BleedingMB: false, BleedingB: false, BleedingDB: false, BleedingDL: false, BleedingL: false, BleedingML: false, Mobility: '0', Furcation: '0', PlaqueIndex: '0', ClinicalNotes: '' });
      const res = await api.get(`/api/dental/perio/${selectedPatient.id}`) as any;
      setPerio(res?.Results ?? []);
    } catch { toast.error(t('failedToSavePerio')); }
    finally { setSaving(s => ({ ...s, perio: false })); }
  };

  const saveXray = async () => {
    if (!selectedPatient) return;
    setSaving(s => ({ ...s, xray: true }));
    try {
      await api.post('/api/dental/xrays', {
        PatientId: selectedPatient.id, XrayType: xrayForm.XrayType,
        XraySeries: xrayForm.XraySeries || undefined, TeethImaged: xrayForm.TeethImaged || undefined,
        ImageCount: xrayForm.ImageCount ? Number(xrayForm.ImageCount) : undefined,
        Reason: xrayForm.Reason || undefined, Findings: xrayForm.Findings || undefined,
        InterpretationNotes: xrayForm.InterpretationNotes || undefined,
        RadiationDose: xrayForm.RadiationDose ? Number(xrayForm.RadiationDose) : undefined,
        TakenDate: xrayForm.TakenDate,
      });
      toast.success(t('xraySaved'));
      setXrayForm({ XrayType: 'periapical', XraySeries: '', TeethImaged: '', ImageCount: '', Reason: '', Findings: '', InterpretationNotes: '', RadiationDose: '', TakenDate: new Date().toISOString().slice(0,10) });
      const res = await api.get(`/api/dental/xrays/${selectedPatient.id}`) as any;
      setXrays(res?.Results ?? []);
    } catch { toast.error(t('failedToSaveXray')); }
    finally { setSaving(s => ({ ...s, xray: false })); }
  };

  const savePrescription = async () => {
    if (!selectedPatient || !rxForm.DrugName) return;
    setSaving(s => ({ ...s, rx: true }));
    try {
      await api.post('/api/dental/prescriptions', {
        PatientId: selectedPatient.id,
        TreatmentId: rxForm.TreatmentId ? Number(rxForm.TreatmentId) : undefined,
        DrugName: rxForm.DrugName,
        Dosage: rxForm.Dosage || undefined,
        Frequency: rxForm.Frequency || undefined,
        Duration: rxForm.Duration || undefined,
        Instructions: rxForm.Instructions || undefined,
      });
      toast.success(t('prescriptionSaved'));
      setRxForm({ DrugName: '', Dosage: '', Frequency: '', Duration: '', Instructions: '', TreatmentId: '' });
      const res = await api.get(`/api/dental/prescriptions/${selectedPatient.id}`) as any;
      setPrescriptions(res?.Results ?? []);
    } catch { toast.error(t('failedToSavePrescription')); }
    finally { setSaving(s => ({ ...s, rx: false })); }
  };

  const loadPlanDetail = async (planId: number) => {
    try {
      const res = await api.get(`/api/dental/plans/detail/${planId}`) as any;
      if (res?.Results) setSelectedPlan(res.Results);
    } catch { toast.error(t('failedToLoadPlan')); }
  };

  const handlePrint = async () => {
    if (!selectedPatient) return;
    try {
      const res = await api.get(`/api/dental/chart-print/${selectedPatient.id}`) as any;
      setPrintData(res?.Results);
      setShowPrintPreview(true);
    } catch { toast.error(t('failedToLoad')); }
  };

  const addPlanItem = () => setPlanForm((f: any) => ({ ...f, Items: [...f.Items, { CdtCode: '', ToothNumber: '', ToothSurface: '', EstimatedFee: '', Priority: '2', Status: 'planned', Notes: '' }] }));
  const removePlanItem = (idx: number) => setPlanForm((f: any) => ({ ...f, Items: f.Items.filter((_: any, i: number) => i !== idx) }));
  const updatePlanItem = (idx: number, field: string, value: string) => setPlanForm((f: any) => ({ ...f, Items: f.Items.map((item: any, i: number) => i === idx ? { ...item, [field]: value } : item) }));

  // ─── RENDER HELPERS ───────────────────────────────────────────────────────

  const renderToothButton = (num: number) => {
    const entry = getToothEntry(num);
    const cond = entry?.ToothCondition;
    const meta = cond ? CONDITION_META[cond] : null;
    const isMissing = entry?.ToothStatus === 'missing';
    const isSelected = activeTooth === String(num);
    const label = getToothLabel(num, notation);

    if (isMissing) {
      return (
        <button key={num}
          onClick={() => { setActiveTooth(String(num)); setToothForm({ ...toothForm, ToothCondition: entry?.ToothCondition ?? '', ConditionStatus: entry?.ConditionStatus ?? 'existing', ConditionSecondary: entry?.ConditionSecondary ?? '', ToothStatus: 'missing', ClinicalNotes: entry?.ClinicalNotes ?? '' }); }}
          className={`w-9 h-9 rounded text-xs font-bold border-2 border-gray-400 bg-gray-100 text-gray-400 transition-all hover:scale-110 ${isSelected ? 'ring-2 ring-[var(--color-primary)] scale-110' : ''}`}
          title={`Tooth ${num} — Missing`}>
          ✕
        </button>
      );
    }

    return (
      <button key={num}
        onClick={() => { setActiveTooth(String(num)); setToothForm({ ...toothForm, ToothCondition: entry?.ToothCondition ?? '', ConditionStatus: entry?.ConditionStatus ?? 'existing', ConditionSecondary: entry?.ConditionSecondary ?? '', ToothStatus: entry?.ToothStatus ?? 'present', ClinicalNotes: entry?.ClinicalNotes ?? '', SurfaceMesial: entry?.SurfaceMesial ?? '', SurfaceDistal: entry?.SurfaceDistal ?? '', SurfaceBuccal: entry?.SurfaceBuccal ?? '', SurfaceLingual: entry?.SurfaceLingual ?? '', SurfaceOcclusal: entry?.SurfaceOcclusal ?? '' }); }}
        className={`w-9 h-9 rounded text-xs font-bold border-2 transition-all hover:scale-110 ${meta ? `text-white` : 'bg-slate-200 dark:bg-slate-700 text-[var(--color-text)]'} ${STATUS_BORDER[entry?.ConditionStatus || 'existing'] || 'border-solid'} ${isSelected ? 'ring-2 ring-[var(--color-primary)] scale-110' : 'border-transparent'}`}
        style={meta ? { backgroundColor: meta.color, borderColor: isSelected ? 'var(--color-primary)' : meta.color } : {}}
        title={`Tooth ${num}${cond ? ` — ${t(cond)}` : ''}${entry?.ConditionStatus && entry?.ConditionStatus !== 'existing' ? ` [${t(entry.ConditionStatus)}]` : ''}`}>
        {label}
      </button>
    );
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="page-title">{t('title')}</h1>
          {selectedPatient && (
            <button onClick={handlePrint} className="btn btn-secondary text-sm self-start">
              🖨️ {t('printChart')}
            </button>
          )}
        </div>

        {/* Patient Search */}
        <div className="card p-4 relative">
          <label className="label">{t('patient')}</label>
          <input
            placeholder={t('searchPlaceholder')}
            value={selectedPatient ? `${selectedPatient.name} (${selectedPatient.patient_code || selectedPatient.uhid || ''})` : search}
            onChange={(e) => { setSearch(e.target.value); setSelectedPatient(null); }}
            className="input w-full"
          />
          {patients.length > 0 && (
            <div className="absolute z-10 top-full left-4 right-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
              {patients.map((p) => (
                <button key={p.id} onClick={() => loadPatient(p)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code || p.uhid}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedPatient && (
          <>
            {/* Notation Toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-[var(--color-text-muted)]">{t('notation')}:</span>
              {['universal', 'fdi', 'palmer'].map((n) => (
                <button key={n} onClick={() => setNotation(n)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${notation === n ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
                  {t(n)}
                </button>
              ))}
            </div>

            <div className="flex gap-1 border-b border-[var(--color-border)] overflow-x-auto">
              {TABS.map((tKey) => (
                <button key={tKey.key} onClick={() => setTab(tKey.key)}
                  className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors whitespace-nowrap ${tab === tKey.key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
                  {t(tKey.label)}
                </button>
              ))}
            </div>

            {/* ═══ CHART TAB ═══ */}
            {tab === 'chart' && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="section-title mb-4">{t('dentalChartTitle', { name: selectedPatient.name })}</h3>

                  {/* Condition Filter */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <button onClick={() => setConditionFilter('')} className={`px-2 py-0.5 rounded text-xs ${conditionFilter === '' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]'}`}>{t('all')}</button>
                    {Object.entries(CONDITION_META).map(([key, m]) => (
                      <button key={key} onClick={() => setConditionFilter(conditionFilter === key ? '' : key)}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${conditionFilter === key ? 'ring-1 ring-offset-1' : ''}`}
                        style={{ backgroundColor: m.color, color: m.text.includes('white') ? '#fff' : '#111' }}>
                        {t(key)}
                      </button>
                    ))}
                  </div>

                  <p className="text-xs text-[var(--color-text-muted)] text-center mb-1">{t('upper')}</p>
                  <div className="flex justify-center gap-1 mb-3 flex-wrap">
                    {UPPER_TEETH.map((n) => {
                      const entry = getToothEntry(n);
                      if (conditionFilter && entry?.ToothCondition !== conditionFilter) {
                        return <div key={n} className="w-9 h-9 rounded bg-transparent" />;
                      }
                      return renderToothButton(n);
                    })}
                  </div>
                  <div className="flex justify-center gap-1 mb-1 flex-wrap">
                    {LOWER_TEETH.map((n) => {
                      const entry = getToothEntry(n);
                      if (conditionFilter && entry?.ToothCondition !== conditionFilter) {
                        return <div key={n} className="w-9 h-9 rounded bg-transparent" />;
                      }
                      return renderToothButton(n);
                    })}
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] text-center mb-4">{t('lower')}</p>

                  {/* Legend / Quick Select */}
                  <div className="flex flex-wrap gap-2 justify-center mb-4">
                    {Object.entries(CONDITION_META).map(([c, m]) => (
                      <button
                        key={c} type="button"
                        onClick={() => activeTooth && setToothForm((f) => ({ ...f, ToothCondition: f.ToothCondition === c ? '' : c }))}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${activeTooth && toothForm.ToothCondition === c ? 'ring-2 ring-offset-1 ring-[var(--color-primary)] scale-105' : 'opacity-90 hover:opacity-100'} ${!activeTooth ? 'cursor-not-allowed opacity-40' : ''}`}
                        style={{ backgroundColor: m.color, color: m.text.includes('white') ? '#fff' : '#111' }}
                        disabled={!activeTooth}
                        title={activeTooth ? t('clickToSetCondition') : t('selectToothFirst')}>
                        {t(c)}
                      </button>
                    ))}
                  </div>

                  {/* Status Legend */}
                  <div className="flex flex-wrap gap-3 justify-center mb-4 text-xs text-[var(--color-text-muted)]">
                    {Object.entries(STATUS_ICONS).map(([status, icon]) => (
                      <span key={status} className="flex items-center gap-1">
                        <span className={`w-3 h-3 rounded border border-[var(--color-border)] ${STATUS_BORDER[status]}`} /> {icon} {t(status)}
                      </span>
                    ))}
                  </div>

                  {/* Active Tooth Form */}
                  {activeTooth && (
                    <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-bg-secondary)] space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">{t('tooth')} {activeTooth} {notation !== 'universal' && <span className="text-[var(--color-text-muted)] font-normal">({getToothLabel(Number(activeTooth), notation)})</span>}</p>
                        <button onClick={() => setActiveTooth(null)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">✕</button>
                      </div>

                      {/* Surface Charting */}
                      <div>
                        <label className="label text-xs mb-2">{t('surfaces')}</label>
                        <div className="grid grid-cols-5 gap-2">
                          {SURFACES.map((surf, idx) => {
                            const key = SURFACE_KEYS[idx];
                            return (
                              <div key={surf} className="text-center">
                                <span className="text-[10px] uppercase text-[var(--color-text-muted)] block mb-1">{t(surf.toLowerCase())}</span>
                                <select value={(toothForm as any)[key] || ''} onChange={(e) => setToothForm(f => ({ ...f, [key]: e.target.value }))}
                                  className="input w-full text-xs py-1">
                                  <option value="">—</option>
                                  {Object.keys(CONDITION_META).map((c) => (
                                    <option key={c} value={c}>{t(c)}</option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="label text-xs">{t('condition')}</label>
                          <select value={toothForm.ToothCondition} onChange={(e) => setToothForm((f) => ({ ...f, ToothCondition: e.target.value }))} className="input w-full text-sm">
                            <option value="">{t('healthy')}</option>
                            {Object.keys(CONDITION_META).map((c) => <option key={c} value={c}>{t(c)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label text-xs">{t('conditionStatus')}</label>
                          <select value={toothForm.ConditionStatus} onChange={(e) => setToothForm((f) => ({ ...f, ConditionStatus: e.target.value }))} className="input w-full text-sm">
                            {['existing', 'planned', 'inprogress', 'completed'].map((s) => (
                              <option key={s} value={s}>{t(s)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label text-xs">{t('secondaryCondition')}</label>
                          <select value={toothForm.ConditionSecondary} onChange={(e) => setToothForm((f) => ({ ...f, ConditionSecondary: e.target.value }))} className="input w-full text-sm">
                            <option value="">—</option>
                            {Object.keys(CONDITION_META).map((c) => <option key={c} value={c}>{t(c)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label text-xs">{t('status')}</label>
                          <select value={toothForm.ToothStatus} onChange={(e) => setToothForm((f) => ({ ...f, ToothStatus: e.target.value }))} className="input w-full text-sm">
                            <option value="present">{t('present')}</option>
                            <option value="missing">{t('missing')}</option>
                            <option value="unerupted">{t('unerupted')}</option>
                          </select>
                        </div>
                      </div>

                      <textarea placeholder={t('notesPlaceholder')} value={toothForm.ClinicalNotes} onChange={(e) => setToothForm((f) => ({ ...f, ClinicalNotes: e.target.value }))} rows={2} className="input w-full text-sm" />

                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setActiveTooth(null)} className="btn btn-secondary text-sm">{t('cancel')}</button>
                        <button onClick={saveTooth} disabled={saving.tooth} className="btn btn-primary text-sm">{saving.tooth ? t('saving') : t('save')}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === TREATMENTS TAB === */}
            {tab === 'treatments' && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('addTreatment')}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <input placeholder={t('cdtCodePlaceholder')} value={treatForm.CdtCode} onChange={(e) => setTreatForm((f: any) => ({ ...f, CdtCode: e.target.value }))} className="input text-sm" />
                    <input placeholder={t('procedureNamePlaceholder')} value={treatForm.ProcedureName} onChange={(e) => setTreatForm((f: any) => ({ ...f, ProcedureName: e.target.value }))} className="input text-sm" />
                    <input placeholder={t('toothNumberPlaceholder')} value={treatForm.ToothNumber} onChange={(e) => setTreatForm((f: any) => ({ ...f, ToothNumber: e.target.value }))} className="input text-sm" />
                    <input type="date" value={treatForm.PerformedDate} onChange={(e) => setTreatForm((f: any) => ({ ...f, PerformedDate: e.target.value }))} className="input text-sm" />
                    <input type="number" placeholder={t('feePlaceholder')} value={treatForm.Fee} onChange={(e) => setTreatForm((f: any) => ({ ...f, Fee: e.target.value }))} className="input text-sm" />
                  </div>
                  <div className="mt-3 p-3 bg-[var(--color-bg-secondary)] rounded-lg">
                    <label className="flex items-center gap-2 text-sm mb-2">
                      <input type="checkbox" checked={treatForm.IsMultiVisit} onChange={(e) => setTreatForm(f => ({ ...f, IsMultiVisit: e.target.checked }))} />
                      {t('multiVisitTreatment')}
                    </label>
                    {treatForm.IsMultiVisit && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input type="number" placeholder={t('visitNumber')} value={treatForm.VisitNumber} onChange={(e) => setTreatForm((f: any) => ({ ...f, VisitNumber: e.target.value }))} className="input text-xs" />
                        <input type="number" placeholder={t('totalVisits')} value={treatForm.TotalPlannedVisits} onChange={(e) => setTreatForm((f: any) => ({ ...f, TotalPlannedVisits: e.target.value }))} className="input text-xs" />
                        <input type="date" value={treatForm.NextVisitDate} onChange={(e) => setTreatForm(f => ({ ...f, NextVisitDate: e.target.value }))} className="input text-xs" />
                        <input placeholder={t('nextVisitNotes')} value={treatForm.NextVisitNotes} onChange={(e) => setTreatForm(f => ({ ...f, NextVisitNotes: e.target.value }))} className="input text-xs" />
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end mt-3">
                    <button onClick={saveTreatment} disabled={saving.treat} className="btn btn-primary text-sm">{saving.treat ? t('saving') : t('addTreatmentBtn')}</button>
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('treatmentHistory')}</h3>
                  {treatments.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('noTreatments')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table-base w-full text-sm">
                        <thead><tr><th>{t('date')}</th><th>CDT</th><th>{t('procedure')}</th><th>{t('tooth')}</th><th>{t('fee')}</th><th>{t('status')}</th><th>{t('visits')}</th></tr></thead>
                        <tbody>
                          {treatments.map((tr) => (
                            <tr key={tr.TreatmentId}>
                              <td>{String(tr.PerformedDate).slice(0,10)}</td>
                              <td className="font-mono text-xs">{tr.CdtCode}</td>
                              <td>{tr.ProcedureName}</td>
                              <td>{tr.ToothNumber ?? '—'}</td>
                              <td>{tr.Fee != null ? `৳${tr.Fee}` : '—'}</td>
                              <td><span className={`px-1.5 py-0.5 rounded text-xs ${tr.Status === 'completed' ? 'bg-green-100 text-green-700' : tr.Status === 'inprogress' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>{t(tr.Status || 'completed')}</span></td>
                              <td>{tr.IsMultiVisit ? `${tr.VisitNumber || 1}/${tr.TotalPlannedVisits || 1}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === TREATMENT PLANS TAB === */}
            {tab === 'plans' && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('createPlan')}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                    <input placeholder={t('planNamePlaceholder')} value={planForm.PlanName} onChange={(e) => setPlanForm(f => ({ ...f, PlanName: e.target.value }))} className="input text-sm" />
                    <select value={planForm.Priority} onChange={(e) => setPlanForm(f => ({ ...f, Priority: e.target.value }))} className="input text-sm">
                      <option value="routine">{t('routine')}</option>
                      <option value="urgent">{t('urgent')}</option>
                      <option value="emergency">{t('emergency')}</option>
                    </select>
                    <button onClick={addPlanItem} className="btn btn-secondary text-sm">{t('addItem')}</button>
                  </div>
                  {planForm.Items.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {planForm.Items.map((item, idx) => (
                        <div key={idx} className="grid grid-cols-7 gap-2 items-center">
                          <input placeholder="CDT" value={item.CdtCode} onChange={(e) => updatePlanItem(idx, 'CdtCode', e.target.value)} className="input text-xs" />
                          <input placeholder={t('tooth')} value={item.ToothNumber} onChange={(e) => updatePlanItem(idx, 'ToothNumber', e.target.value)} className="input text-xs" />
                          <input placeholder={t('surface')} value={item.ToothSurface} onChange={(e) => updatePlanItem(idx, 'ToothSurface', e.target.value)} className="input text-xs" />
                          <input type="number" placeholder={t('fee')} value={item.EstimatedFee} onChange={(e) => updatePlanItem(idx, 'EstimatedFee', e.target.value)} className="input text-xs" />
                          <input type="number" placeholder={t('priority')} value={item.Priority} onChange={(e) => updatePlanItem(idx, 'Priority', e.target.value)} className="input text-xs" />
                          <select value={item.Status} onChange={(e) => updatePlanItem(idx, 'Status', e.target.value)} className="input text-xs">
                            <option value="planned">{t('planned')}</option>
                            <option value="inprogress">{t('inprogress')}</option>
                            <option value="completed">{t('completed')}</option>
                            <option value="cancelled">{t('cancelled')}</option>
                          </select>
                          <button onClick={() => removePlanItem(idx)} className="text-red-500 text-xs hover:underline">{t('remove')}</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea placeholder={t('planNotesPlaceholder')} value={planForm.ClinicalNotes} onChange={(e) => setPlanForm(f => ({ ...f, ClinicalNotes: e.target.value }))} rows={2} className="input w-full text-sm mb-3" />
                  <div className="flex justify-end">
                    <button onClick={savePlan} disabled={saving.plan} className="btn btn-primary text-sm">{saving.plan ? t('saving') : t('savePlan')}</button>
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('existingPlans')}</h3>
                  {plans.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('noPlans')}</p>
                  ) : (
                    <div className="space-y-3">
                      {plans.map((plan) => (
                        <div key={plan.PlanId} className="border border-[var(--color-border)] rounded-lg p-3 cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors" onClick={() => loadPlanDetail(plan.PlanId)}>
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-sm">{plan.PlanName || `${t('plan')} #${plan.PlanId}`}</p>
                              <p className="text-xs text-[var(--color-text-muted)]">{t('phase')}: {plan.PlanPhase} · {t('priority')}: {plan.Priority}</p>
                            </div>
                            <span className="text-sm font-semibold text-[var(--color-primary)]">৳{plan.EstimatedTotal?.toLocaleString() ?? 0}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedPlan && (
                    <div className="mt-4 border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-bg-secondary)]">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-semibold text-sm">{selectedPlan.PlanName || `${t('plan')} #${selectedPlan.PlanId}`}</h4>
                        <button onClick={() => setSelectedPlan(null)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">{t('close')}</button>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] mb-2">{t('priority')}: {selectedPlan.Priority} · {t('phase')}: {selectedPlan.PlanPhase} · {t('estimatedTotal')}: ৳{selectedPlan.EstimatedTotal?.toLocaleString() ?? 0}</p>
                      {selectedPlan.items && selectedPlan.items.length > 0 && (
                        <table className="table-base text-xs w-full">
                          <thead><tr><th>CDT</th><th>{t('tooth')}</th><th>{t('surface')}</th><th>{t('fee')}</th><th>{t('status')}</th><th>{t('priority')}</th></tr></thead>
                          <tbody>
                            {selectedPlan.items.map((item) => (
                              <tr key={item.PlanItemId}>
                                <td className="font-mono">{item.CdtCode ?? '—'}</td>
                                <td>{item.ToothNumber ?? '—'}</td>
                                <td>{item.ToothSurface ?? '—'}</td>
                                <td>{item.EstimatedFee != null ? `৳${item.EstimatedFee}` : '—'}</td>
                                <td><span className={`px-1 rounded text-[10px] ${item.Status === 'completed' ? 'bg-green-100 text-green-700' : item.Status === 'inprogress' ? 'bg-yellow-100 text-yellow-700' : item.Status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{t(item.Status)}</span></td>
                                <td>{item.Priority}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {selectedPlan.ClinicalNotes && (
                        <p className="text-xs text-[var(--color-text-muted)] mt-2">{selectedPlan.ClinicalNotes}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === PERIO TAB === */}
            {tab === 'perio' && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('recordPerio')}</h3>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                    <input placeholder={t('tooth')} value={perioForm.ToothNumber} onChange={(e) => setPerioForm(f => ({ ...f, ToothNumber: e.target.value }))} className="input text-sm" />
                    {PERIO_SITES.map(site => (
                      <input key={site} type="number" placeholder={`${t('pd')} ${site}`} value={(perioForm as any)[`PocketDepth${site}`]} onChange={(e) => setPerioForm(f => ({ ...f, [`PocketDepth${site}`]: e.target.value }))} className="input text-xs" />
                    ))}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                    {PERIO_SITES.map(site => (
                      <label key={site} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={(perioForm as any)[`Bleeding${site}`]} onChange={(e) => setPerioForm(f => ({ ...f, [`Bleeding${site}`]: e.target.checked }))} />
                        {t('bop')} {site}
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <input type="number" placeholder={t('mobility')} value={perioForm.Mobility} onChange={(e) => setPerioForm(f => ({ ...f, Mobility: e.target.value }))} className="input text-sm" />
                    <input type="number" placeholder={t('furcation')} value={perioForm.Furcation} onChange={(e) => setPerioForm(f => ({ ...f, Furcation: e.target.value }))} className="input text-sm" />
                    <input type="number" placeholder={t('plaqueIndex')} value={perioForm.PlaqueIndex} onChange={(e) => setPerioForm(f => ({ ...f, PlaqueIndex: e.target.value }))} className="input text-sm" />
                  </div>
                  <textarea placeholder={t('notesPlaceholder')} value={perioForm.ClinicalNotes} onChange={(e) => setPerioForm(f => ({ ...f, ClinicalNotes: e.target.value }))} rows={2} className="input w-full text-sm mb-3" />
                  <div className="flex justify-end">
                    <button onClick={savePerio} disabled={saving.perio} className="btn btn-primary text-sm">{saving.perio ? t('saving') : t('savePerio')}</button>
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('perioHistory')}</h3>
                  {perio.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('noPerio')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table-base w-full text-xs">
                        <thead><tr><th>{t('date')}</th><th>{t('tooth')}</th><th>{t('pd')}</th><th>{t('bop')}</th><th>{t('mobility')}</th><th>{t('furcation')}</th><th>{t('plaqueIndex')}</th></tr></thead>
                        <tbody>
                          {perio.map((p) => {
                            const pdValues = PERIO_SITES.map(s => (p as any)[`PocketDepth${s}`]).filter((v) => v != null);
                            const bopCount = PERIO_SITES.filter(s => (p as any)[`Bleeding${s}`]).length;
                            return (
                              <tr key={p.ChartId}>
                                <td>{String(p.ChartedDate).slice(0,10)}</td>
                                <td>{p.ToothNumber}</td>
                                <td>{pdValues.length > 0 ? `${Math.min(...pdValues)}-${Math.max(...pdValues)}` : '—'}</td>
                                <td>{bopCount}/6</td>
                                <td>{p.Mobility ?? '—'}</td>
                                <td>{p.Furcation ?? '—'}</td>
                                <td>{p.PlaqueIndex ?? '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === X-RAY TAB === */}
            {tab === 'xrays' && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('recordXray')}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                    <select value={xrayForm.XrayType} onChange={(e) => setXrayForm(f => ({ ...f, XrayType: e.target.value }))} className="input text-sm">
                      <option value="periapical">{t('periapical')}</option>
                      <option value="bitewing">{t('bitewing')}</option>
                      <option value="panoramic">{t('panoramic')}</option>
                      <option value="cephalometric">{t('cephalometric')}</option>
                      <option value="occlusal">{t('occlusal')}</option>
                      <option value="cbct">{t('cbct')}</option>
                    </select>
                    <input placeholder={t('series')} value={xrayForm.XraySeries} onChange={(e) => setXrayForm(f => ({ ...f, XraySeries: e.target.value }))} className="input text-sm" />
                    <input placeholder={t('teethImaged')} value={xrayForm.TeethImaged} onChange={(e) => setXrayForm(f => ({ ...f, TeethImaged: e.target.value }))} className="input text-sm" />
                    <input type="number" placeholder={t('imageCount')} value={xrayForm.ImageCount} onChange={(e) => setXrayForm(f => ({ ...f, ImageCount: e.target.value }))} className="input text-sm" />
                    <input type="number" step="0.01" placeholder={t('radiationDose')} value={xrayForm.RadiationDose} onChange={(e) => setXrayForm(f => ({ ...f, RadiationDose: e.target.value }))} className="input text-sm" />
                    <input type="date" value={xrayForm.TakenDate} onChange={(e) => setXrayForm(f => ({ ...f, TakenDate: e.target.value }))} className="input text-sm" />
                  </div>
                  <input placeholder={t('reason')} value={xrayForm.Reason} onChange={(e) => setXrayForm(f => ({ ...f, Reason: e.target.value }))} className="input w-full text-sm mb-2" />
                  <textarea placeholder={t('findingsPlaceholder')} value={xrayForm.Findings} onChange={(e) => setXrayForm(f => ({ ...f, Findings: e.target.value }))} rows={2} className="input w-full text-sm mb-2" />
                  <textarea placeholder={t('interpretationPlaceholder')} value={xrayForm.InterpretationNotes} onChange={(e) => setXrayForm(f => ({ ...f, InterpretationNotes: e.target.value }))} rows={2} className="input w-full text-sm mb-3" />
                  <div className="flex justify-end">
                    <button onClick={saveXray} disabled={saving.xray} className="btn btn-primary text-sm">{saving.xray ? t('saving') : t('saveXray')}</button>
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('xrayHistory')}</h3>
                  {xrays.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('noXrays')}</p>
                  ) : (
                    <div className="space-y-3">
                      {xrays.map((x) => (
                        <div key={x.XrayId} className="border border-[var(--color-border)] rounded-lg p-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-sm capitalize">{x.XrayType}</p>
                              <p className="text-xs text-[var(--color-text-muted)]">{String(x.TakenDate).slice(0,10)} · {x.TeethImaged ?? '—'}</p>
                            </div>
                            <span className="text-xs bg-[var(--color-bg-secondary)] px-2 py-0.5 rounded">{x.ImageCount ?? '—'} {t('images')}</span>
                          </div>
                          {x.R2Key && (
                            <div className="mt-2 p-2 bg-[var(--color-bg-secondary)] rounded text-center text-xs text-[var(--color-text-muted)]">
                              📷 {t('imageViewer')}: {x.FileName || x.R2Key}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === PRESCRIPTIONS TAB === */}
            {tab === 'prescriptions' && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('addPrescription')}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <input placeholder={t('drugName')} value={rxForm.DrugName} onChange={(e) => setRxForm(f => ({ ...f, DrugName: e.target.value }))} className="input text-sm" />
                    <input placeholder={t('dosage')} value={rxForm.Dosage} onChange={(e) => setRxForm(f => ({ ...f, Dosage: e.target.value }))} className="input text-sm" />
                    <input placeholder={t('frequency')} value={rxForm.Frequency} onChange={(e) => setRxForm(f => ({ ...f, Frequency: e.target.value }))} className="input text-sm" />
                    <input placeholder={t('duration')} value={rxForm.Duration} onChange={(e) => setRxForm(f => ({ ...f, Duration: e.target.value }))} className="input text-sm" />
                    <input placeholder={t('linkedTreatmentId')} value={rxForm.TreatmentId} onChange={(e) => setRxForm(f => ({ ...f, TreatmentId: e.target.value }))} className="input text-sm" />
                  </div>
                  <textarea placeholder={t('instructionsPlaceholder')} value={rxForm.Instructions} onChange={(e) => setRxForm(f => ({ ...f, Instructions: e.target.value }))} rows={2} className="input w-full text-sm mt-3" />
                  <div className="flex justify-end mt-3">
                    <button onClick={savePrescription} disabled={saving.rx} className="btn btn-primary text-sm">{saving.rx ? t('saving') : t('addPrescriptionBtn')}</button>
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('prescriptionHistory')}</h3>
                  {prescriptions.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('noPrescriptions')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table-base w-full text-sm">
                        <thead><tr><th>{t('date')}</th><th>{t('drug')}</th><th>{t('dosage')}</th><th>{t('frequency')}</th><th>{t('duration')}</th><th>{t('linkedTreatment')}</th></tr></thead>
                        <tbody>
                          {prescriptions.map((rx) => (
                            <tr key={rx.PrescriptionId}>
                              <td>{String(rx.PrescribedDate).slice(0,10)}</td>
                              <td className="font-medium">{rx.DrugName}</td>
                              <td>{rx.Dosage ?? '—'}</td>
                              <td>{rx.Frequency ?? '—'}</td>
                              <td>{rx.Duration ?? '—'}</td>
                              <td>{rx.LinkedTreatment ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === PRINT PREVIEW MODAL === */}
            {showPrintPreview && printData && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="bg-[var(--color-card)] rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold">{t('printPreview')}</h2>
                    <button onClick={() => setShowPrintPreview(false)} className="text-2xl text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">&times;</button>
                  </div>
                  <div className="border border-[var(--color-border)] rounded-lg p-6 space-y-4">
                    <div className="text-center border-b border-[var(--color-border)] pb-3">
                      <h3 className="font-bold text-lg">{selectedPatient?.name}</h3>
                      <p className="text-sm text-[var(--color-text-muted)]">{selectedPatient?.patient_code || selectedPatient?.uhid}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm mb-2">{t('dentalChart')}</h4>
                      <div className="grid grid-cols-8 gap-1">
                        {UPPER_TEETH.map(n => {
                          const e = printData.chart?.find(c => String(c.ToothNumber) === String(n));
                          const meta = e?.ToothCondition ? (CONDITION_META as any)[e.ToothCondition] : null;
                          return (
                            <div key={n} className="w-8 h-8 rounded text-[10px] flex items-center justify-center font-bold" style={meta ? { backgroundColor: meta.color, color: meta.text.includes('white') ? '#fff' : '#111' } : { backgroundColor: '#e2e8f0' }}>
                              {getToothLabel(n, notation)}
                            </div>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-8 gap-1 mt-1">
                        {LOWER_TEETH.map(n => {
                          const e = printData.chart?.find(c => String(c.ToothNumber) === String(n));
                          const meta = e?.ToothCondition ? (CONDITION_META as any)[e.ToothCondition] : null;
                          return (
                            <div key={n} className="w-8 h-8 rounded text-[10px] flex items-center justify-center font-bold" style={meta ? { backgroundColor: meta.color, color: meta.text.includes('white') ? '#fff' : '#111' } : { backgroundColor: '#e2e8f0' }}>
                              {getToothLabel(n, notation)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {printData.treatments?.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-sm mb-2">{t('recentTreatments')}</h4>
                        <table className="table-base w-full text-xs">
                          <thead><tr><th>{t('date')}</th><th>CDT</th><th>{t('procedure')}</th></tr></thead>
                          <tbody>
                            {printData.treatments.slice(0, 5).map(t => (
                              <tr key={t.TreatmentId}><td>{String(t.PerformedDate).slice(0,10)}</td><td>{t.CdtCode}</td><td>{t.ProcedureName}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <button onClick={() => setShowPrintPreview(false)} className="btn btn-secondary text-sm">{t('close')}</button>
                    <button onClick={() => window.print()} className="btn btn-primary text-sm">{t('print')}</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
