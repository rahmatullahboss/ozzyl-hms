import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router';
import {
  Stethoscope, Plus, Trash2, Printer, Save, CheckCircle2,
  FlaskConical, FileText, ArrowLeft, AlertCircle, X,
  Share2, Truck, Copy, Package
} from 'lucide-react';

import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { formatDoctorName } from '../lib/doctor-display';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PrescriptionItem {
  id?: number;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
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



// ─── Constants ────────────────────────────────────────────────────────────────
const LAB_TESTS = ['CBC', 'Blood Sugar', 'Urine R/E', 'LFT', 'RFT', 'ECG', 'Chest X-Ray', 'Lipid Profile', 'HbA1c', 'Thyroid (TSH)'];

const QUICK_MEDICINES = [
  { medicine_name: 'Paracetamol 500mg', dosage: '500mg', frequency: '1+1+1', duration: '5 Days', instructions: 'After Food' },
  { medicine_name: 'Amoxicillin 500mg', dosage: '500mg', frequency: '1+0+1', duration: '7 Days', instructions: 'After Food' },
  { medicine_name: 'Metformin 500mg',   dosage: '500mg', frequency: '0+1+1', duration: '30 Days', instructions: 'After Food' },
  { medicine_name: 'Omeprazole 20mg',   dosage: '20mg',  frequency: '1+0+0', duration: '14 Days', instructions: 'Before Breakfast' },
  { medicine_name: 'Cetirizine 10mg',   dosage: '10mg',  frequency: '0+0+1', duration: '5 Days', instructions: 'At Night' },
];

const FREQUENCY_OPTIONS = ['1+0+0', '0+1+0', '0+0+1', '1+1+0', '1+0+1', '0+1+1', '1+1+1', 'SOS', 'Once Daily', 'Twice Daily'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calcAge(dob?: string): string {
  if (!dob) return '—';
  const birth = new Date(dob);
  const ageDiff = Date.now() - birth.getTime();
  return `${Math.floor(ageDiff / (365.25 * 24 * 3600 * 1000))}y`;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DigitalPrescription() {
  const { t } = useTranslation(['patients', 'common']);

  const { slug, rxId: rxIdRouteParam } = useParams<{ slug: string; rxId?: string }>();
  const [searchParams] = useSearchParams();
  const basePath = `/h/${slug}`;

  // IDs from query params / route params
  const patientIdParam = Number(searchParams.get('patient') ?? 0);
  const apptIdParam    = Number(searchParams.get('appt') ?? 0);
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
  const [medResults, setMedResults]  = useState<{ name: string }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // UI state
  const [saving,        setSaving]        = useState(false);
  const [rxId,          setRxId]          = useState<number | null>(rxIdParam || null);
  const [rxNo,          setRxNo]          = useState('');
  const [shareUrl,      setShareUrl]      = useState<string | null>(null);
  const [sharing,       setSharing]       = useState(false);
  const [showDelivery,  setShowDelivery]  = useState(false);
  const [deliveryAddr,  setDeliveryAddr]  = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState<string | null>(null);

  // ── Load initial data ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!patientIdParam) return;
    axios.get(`/api/patients/${patientIdParam}`, { headers: authHeaders() })
      .then(r => setPatient(r.data.patient ?? r.data))
      .catch(() => toast.error(t('rxToast.loadPatientFailed', { ns: 'patients', defaultValue: 'Failed to load patient' })));
  }, [patientIdParam]);

  useEffect(() => {
    if (!apptIdParam) return;
    axios.get(`/api/appointments/${apptIdParam}`, { headers: authHeaders() })
      .then(r => {
        const appt = r.data;
        appointmentIdRef.current = appt.id;
        if (appt.chief_complaint) setChiefComplaint(appt.chief_complaint);
        if (appt.doctor_id) {
          axios.get(`/api/doctors/${appt.doctor_id}`, { headers: authHeaders() })
            .then(d => setDoctor(d.data.doctor ?? d.data))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [apptIdParam]);

  // Load existing prescription (edit mode)
  useEffect(() => {
    if (!rxIdParam) return;
    axios.get(`/api/prescriptions/${rxIdParam}`, { headers: authHeaders() })
      .then(r => {
        const rx = r.data;
        setRxNo(rx.rx_no);
        setBp(rx.bp ?? '');
        setTemperature(rx.temperature ?? '');
        setWeight(rx.weight ?? '');
        setSpo2(rx.spo2 ?? '');
        setChiefComplaint(rx.chief_complaint ?? '');
        setDiagnosis(rx.diagnosis ?? '');
        setExaminationNotes(rx.examination_notes ?? '');
        setAdvice(rx.advice ?? '');
        // Safe JSON parse — guard against corrupted or empty string
        try { setLabTests(JSON.parse(rx.lab_tests || '[]')); } catch { setLabTests([]); }
        setFollowUpDate(rx.follow_up_date ?? '');
        setItems(rx.items ?? []);
      })
      .catch(() => toast.error(t('rxToast.loadPrescriptionFailed', { ns: 'patients', defaultValue: 'Failed to load prescription' })));
  }, [rxIdParam]);

  // ── Medicine search (debounced) ────────────────────────────────────────────
  useEffect(() => {
    if (medSearch.length < 2) { setMedResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      axios.get(`/api/e-prescribing/formulary/search?q=${encodeURIComponent(medSearch)}`, { headers: authHeaders() })
        .then(r => setMedResults(r.data.medicines ?? []))
        .catch(() => setMedResults([]));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [medSearch]);

  // ── Item helpers ───────────────────────────────────────────────────────────
  const addItem = useCallback((med?: Partial<PrescriptionItem>) => {
    setItems(prev => [...prev, {
      medicine_name: med?.medicine_name ?? '',
      dosage:        med?.dosage ?? '',
      frequency:     med?.frequency ?? '1+1+1',
      duration:      med?.duration ?? '',
      instructions:  med?.instructions ?? '',
    }]);
  }, []);

  const updateItem = useCallback((idx: number, field: keyof PrescriptionItem, val: string) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  }, []);

  const removeItem = useCallback((idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const toggleLabTest = useCallback((test: string) => {
    setLabTests(prev => prev.includes(test) ? prev.filter(t => t !== test) : [...prev, test]);
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const buildPayload = (status: 'draft' | 'final') => ({
    patientId:        patientIdParam || patient?.id,
    doctorId:         doctor?.id,
    appointmentId:    appointmentIdRef.current || undefined,
    bp, temperature, weight, spo2,
    chiefComplaint, diagnosis, examinationNotes, advice,
    labTests, followUpDate,
    status,
    items: items.map((it, idx) => ({ ...it, sort_order: idx })),
  });

  const save = async (status: 'draft' | 'final') => {
    if (!patientIdParam && !patient?.id) { toast.error(t('rxToast.patientRequired', { ns: 'patients', defaultValue: 'Patient required' })); return; }
    setSaving(true);
    try {
      if (rxId) {
        await axios.put(`/api/prescriptions/${rxId}`, buildPayload(status), { headers: authHeaders() });
        toast.success(status === 'final' ? t('rxToast.prescriptionFinalised', { ns: 'patients', defaultValue: 'Prescription finalised!' }) : t('rxToast.draftSaved', { ns: 'patients', defaultValue: 'Draft saved' }));
      } else {
        const r = await axios.post('/api/prescriptions', buildPayload(status), { headers: authHeaders() });
        setRxId(r.data.id);
        setRxNo(r.data.rxNo);
        toast.success(status === 'final' ? t('rxToast.prescriptionCreated', { ns: 'patients', defaultValue: 'Prescription created!' }) : t('rxToast.draftSaved', { ns: 'patients', defaultValue: 'Draft saved' }));
      }
    } catch {
      toast.error(t('rxToast.savePrescriptionFailed', { ns: 'patients', defaultValue: 'Failed to save prescription' }));
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async () => {
    if (!rxId) { toast.error(t('rxToast.saveFirst', { ns: 'patients', defaultValue: 'Save the prescription first' })); return; }
    setSharing(true);
    try {
      const r = await axios.post(`/api/prescriptions/${rxId}/share`, {}, { headers: authHeaders() });
      const url = `${window.location.origin}/api/rx/${r.data.token}`;
      setShareUrl(url);
      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success(t('rxToast.shareLinkCopied', { ns: 'patients', defaultValue: 'Share link copied to clipboard!' }));
    } catch {
      toast.error(t('rxToast.shareLinkFailed', { ns: 'patients', defaultValue: 'Failed to generate share link' }));
    } finally {
      setSharing(false);
    }
  };

  const handleOrderDelivery = async () => {
    if (!rxId) { toast.error(t('rxToast.saveFirst', { ns: 'patients', defaultValue: 'Save the prescription first' })); return; }
    if (!deliveryAddr || !deliveryPhone) { toast.error(t('rxToast.deliveryInfoRequired', { ns: 'patients', defaultValue: 'Address and phone required' })); return; }
    try {
      await axios.post(`/api/prescriptions/${rxId}/order-delivery`,
        { address: deliveryAddr, phone: deliveryPhone },
        { headers: authHeaders() });
      setDeliveryStatus('ordered');
      toast.success(t('rxToast.deliveryOrdered', { ns: 'patients', defaultValue: 'Delivery ordered!' }));
    } catch {
      toast.error(t('rxToast.deliveryFailed', { ns: 'patients', defaultValue: 'Failed to place delivery order' }));
    }
  };

  const handlePrint = () => {
    if (!rxId) { toast.error(t('rxToast.saveBeforePrint', { ns: 'patients', defaultValue: 'Save first before printing' })); return; }
    window.open(`${basePath}/prescriptions/${rxId}/print`, '_blank');
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[var(--color-border)] px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
        <Link to={`${basePath}/appointments`} className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors">
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
              { label: t('rx.temperature', { ns: 'patients', defaultValue: 'Temp (°F)' }),  value: temperature,  set: setTemperature, placeholder: '98.6' },
              { label: t('rx.weight', { ns: 'patients', defaultValue: 'Weight' }),     value: weight,       set: setWeight,      placeholder: '70 kg' },
              { label: t('rx.spo2', { ns: 'patients', defaultValue: 'SpO₂ (%)' }),   value: spo2,         set: setSpo2,        placeholder: '98' },
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

        {/* ── Main 2-col layout ────────────────────────────────────────── */}
        <div className="grid lg:grid-cols-5 gap-6">

          {/* LEFT — Rx / Medicines (3/5) */}
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
                      <button key={i} onClick={() => { addItem({ medicine_name: m.name }); setMedSearch(''); setMedResults([]); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-primary)]/5 transition-colors">
                        {m.name}
                      </button>
                    ))}
                    <button onClick={() => setMedResults([])} className="w-full text-center text-xs text-[var(--color-text-muted)] py-1 border-t border-[var(--color-border)]">
                      <X className="w-3 h-3 inline mr-1" />{t('common.close', { defaultValue: 'Close' })}
                    </button>
                  </div>
                )}
              </div>

              {/* Quick select */}
              <div className="flex flex-wrap gap-2 mb-4">
                {QUICK_MEDICINES.map(m => (
                  <button key={m.medicine_name}
                    onClick={() => addItem(m)}
                    className="text-xs border border-[var(--color-primary)] text-[var(--color-primary)] rounded-full px-3 py-1 hover:bg-[var(--color-primary)] hover:text-white transition-colors">
                    {m.medicine_name}
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
                              {FREQUENCY_OPTIONS.map(f => <option key={f}>{f}</option>)}
                            </select>
                          </td>
                          <td className="py-1.5 pr-3">
                            <input value={it.duration} onChange={e => updateItem(idx, 'duration', e.target.value)}
                              className="input w-full text-xs py-1" placeholder={t('rx.durationPlaceholder', { ns: 'patients', defaultValue: '5 Days' })} />
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

          {/* RIGHT — Clinical Notes (2/5) */}
          <div className="lg:col-span-2 space-y-4">

            {/* Diagnosis */}
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-primary)]" />Diagnosis / ICD-10
              </h3>
              <input
                value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
                placeholder={t('rx.diagnosisPlaceholder', { ns: 'patients', defaultValue: 'e.g. J00 — Common Cold, E11 — Type 2 Diabetes' })}
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
              <div className="grid grid-cols-2 gap-2">
                {LAB_TESTS.map(t => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={labTests.includes(t)} onChange={() => toggleLabTest(t)}
                      className="rounded accent-[var(--color-primary)]" />
                    <span className="text-sm text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors">{t}</span>
                  </label>
                ))}
              </div>
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

            {/* Delivery Card */}
            <div className="card p-4">
              <button onClick={() => setShowDelivery(v => !v)}
                className="flex items-center gap-2 w-full text-left">
                <Truck className="w-4 h-4 text-[var(--color-primary)]" />
                <h3 className="font-semibold text-sm text-[var(--color-text)]">Medicine Delivery</h3>
                {deliveryStatus && (
                  <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full capitalize font-medium">
                    {deliveryStatus}
                  </span>
                )}
              </button>
              {showDelivery && (
                <div className="mt-3 space-y-2">
                  <input
                    value={deliveryAddr}
                    onChange={e => setDeliveryAddr(e.target.value)}
                    placeholder={t('rx.deliveryAddress', { ns: 'patients', defaultValue: 'Delivery address' })}
                    className="input w-full text-sm"
                  />
                  <input
                    value={deliveryPhone}
                    onChange={e => setDeliveryPhone(e.target.value)}
                    placeholder={t('rx.phoneNumber', { ns: 'patients', defaultValue: 'Phone number' })}
                    className="input w-full text-sm"
                  />
                  <button
                    onClick={handleOrderDelivery}
                    disabled={!!deliveryStatus}
                    className="btn-primary w-full flex items-center gap-2 justify-center">
                    <Package className="w-4 h-4" />
                    {deliveryStatus ? `${t('rx.status', { ns: 'patients', defaultValue: 'Status' })}: ${deliveryStatus}` : t('rx.orderDelivery', { ns: 'patients', defaultValue: 'Order Delivery' })}
                  </button>
                </div>
              )}
            </div>

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
          {sharing ? t('rx.gettingLink', { ns: 'patients', defaultValue: 'Getting link…' }) : t('rx.share', { ns: 'patients', defaultValue: 'Share' })}
        </button>
        <button
          onClick={() => save('draft')}
          disabled={saving}
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
          disabled={saving}
          className="btn-primary flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {saving ? t('common.saving', { ns: 'patients', defaultValue: 'Saving…' }) : t('rx.finaliseRx', { ns: 'patients', defaultValue: 'Finalise Rx' })}
        </button>
      </div>
    </div>
  );
}
