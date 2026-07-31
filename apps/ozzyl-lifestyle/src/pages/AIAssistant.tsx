import { useState, type JSX } from 'react';
import { Bot, Send, ThumbsUp, ThumbsDown, Stethoscope, Pill, FileText, Activity, Brain, BarChart3, X } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

type Feature = 'prescription' | 'diagnosis' | 'billing' | 'summarize' | 'lab' | 'insights';

interface FeatureConfig { key: Feature; label: string; icon: JSX.Element; desc: string; endpoint: string; }

const FEATURES: FeatureConfig[] = [
  { key: 'prescription', label: 'Prescription AI', icon: <Pill className="w-5 h-5" />, desc: 'Review drug interactions & dosage', endpoint: '/api/ai/prescription-assist' },
  { key: 'diagnosis', label: 'Diagnosis Suggest', icon: <Stethoscope className="w-5 h-5" />, desc: 'AI differential diagnosis', endpoint: '/api/ai/diagnosis-suggest' },
  { key: 'billing', label: 'Billing from Notes', icon: <FileText className="w-5 h-5" />, desc: 'Generate bill from consultation', endpoint: '/api/ai/billing-from-notes' },
  { key: 'summarize', label: 'Clinical Summary', icon: <Brain className="w-5 h-5" />, desc: 'Summarize clinical notes', endpoint: '/api/ai/summarize-note' },
  { key: 'lab', label: 'Lab Interpret', icon: <Activity className="w-5 h-5" />, desc: 'Interpret lab results', endpoint: '/api/ai/interpret-lab' },
  { key: 'insights', label: 'Dashboard Insights', icon: <BarChart3 className="w-5 h-5" />, desc: 'Predictive analytics', endpoint: '/api/ai/dashboard-insights' },
];

export default function AIAssistant({ role = 'hospital_admin' }: { role?: string }) {
  const [active, setActive] = useState<Feature>('prescription');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [interactionId, setInteractionId] = useState<number | null>(null);
  const { t } = useTranslation(['common']);

  // Form states per feature
  const [rxForm, setRxForm] = useState({ medications: '', allergies: '', age: '', weight: '' });
  const [dxForm, setDxForm] = useState({ symptoms: '', age: '', gender: '', vitals: '', history: '' });
  const [billForm, setBillForm] = useState({ notes: '' });
  const [sumForm, setSumForm] = useState({ note: '', format: 'soap' });
  const [labForm, setLabForm] = useState({ results: '', age: '', gender: '' });
  const [insForm, setInsForm] = useState({ from: '', to: '' });

  const sendFeedback = async (action: 'accepted' | 'rejected') => {
    if (!interactionId) return;
    try {
      const token = localStorage.getItem('hms_token');
      await axios.post('/api/ai/feedback', { interactionId, action }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('common.aiFeedbackSaved'));
    } catch { toast.error(t('common.feedback_failed')); }
  };

  const submit = async () => {
    const feat = FEATURES.find(f => f.key === active)!;
    setLoading(true); setResult(null);
    let payload: Record<string, unknown> = {};

    if (active === 'prescription') {
      const meds = rxForm.medications.split('\n').filter(Boolean).map(line => {
        const [name, ...rest] = line.split(',').map(s => s.trim());
        return { name, dosage: rest[0] || undefined, frequency: rest[1] || undefined, duration: rest[2] || undefined };
      });
      payload = { medications: meds, knownAllergies: rxForm.allergies ? rxForm.allergies.split(',').map(s => s.trim()) : [], patientAge: rxForm.age ? parseInt(rxForm.age) : undefined, patientWeight: rxForm.weight ? parseInt(rxForm.weight) : undefined };
    } else if (active === 'diagnosis') {
      payload = { symptoms: dxForm.symptoms, patientAge: dxForm.age ? parseInt(dxForm.age) : undefined, patientGender: dxForm.gender || undefined, medicalHistory: dxForm.history || undefined, vitals: dxForm.vitals ? Object.fromEntries(dxForm.vitals.split(',').map(v => v.split(':').map(s => s.trim()))) : undefined };
    } else if (active === 'billing') {
      payload = { consultationNotes: billForm.notes };
    } else if (active === 'summarize') {
      payload = { note: sumForm.note, format: sumForm.format };
    } else if (active === 'lab') {
      const results = labForm.results.split('\n').filter(Boolean).map(line => {
        const [testName, value, unit, normalRange] = line.split(',').map(s => s.trim());
        return { testName, value, unit: unit || undefined, normalRange: normalRange || undefined };
      });
      payload = { results, patientAge: labForm.age ? parseInt(labForm.age) : undefined, patientGender: labForm.gender || undefined };
    } else if (active === 'insights') {
      payload = { dateRange: { from: insForm.from, to: insForm.to } };
    }

    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.post(feat.endpoint, payload, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
      setInteractionId(data.interactionId ?? null);
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message ?? 'AI service error' : 'AI service error';
      toast.error(msg);
    } finally { setLoading(false); }
  };

  const activeConfig = FEATURES.find(f => f.key === active)!;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div><h1 className="page-title"><Bot className="w-6 h-6 inline-block mr-2 text-[var(--color-primary)]" />AI Assistant</h1><p className="section-subtitle mt-1">Medical AI tools: Rx review, diagnosis, billing, lab interpretation</p></div></div>

        {/* Feature selector */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {FEATURES.map(f => (
            <button key={f.key} onClick={() => { setActive(f.key); setResult(null); }}
              className={`card p-3 flex flex-col items-center gap-2 text-center cursor-pointer transition-all hover:shadow-md ${active === f.key ? 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary-light)]' : ''}`}>
              <div className={`p-2 rounded-xl ${active === f.key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'}`}>{f.icon}</div>
              <span className="text-xs font-medium">{f.label}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Input */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold">{activeConfig.label} <span className="text-sm text-[var(--color-text-muted)] font-normal">— {activeConfig.desc}</span></h3>

            {active === 'prescription' && (<>
              <div><label className="label">Medications (one per line: name, dosage, frequency, duration)</label><textarea className="input" rows={4} placeholder={t("common.metformin_500mg_101_daily_30_days")} value={rxForm.medications} onChange={e => setRxForm({ ...rxForm, medications: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-3"><div><label className="label">Allergies</label><input className="input" placeholder={t("common.penicillin")} value={rxForm.allergies} onChange={e => setRxForm({ ...rxForm, allergies: e.target.value })} /></div>
              <div><label className="label">{t('common.age')}</label><input className="input" type="number" value={rxForm.age} onChange={e => setRxForm({ ...rxForm, age: e.target.value })} /></div>
              <div><label className="label">{t('common.weight_kg')}</label><input className="input" type="number" value={rxForm.weight} onChange={e => setRxForm({ ...rxForm, weight: e.target.value })} /></div></div>
            </>)}
            {active === 'diagnosis' && (<>
              <div><label className="label">Symptoms *</label><textarea className="input" rows={3} placeholder={t("common.chest_pain_radiating_to_left_arm_shortness_of_breath")} value={dxForm.symptoms} onChange={e => setDxForm({ ...dxForm, symptoms: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-3"><div><label className="label">{t('common.age')}</label><input className="input" type="number" value={dxForm.age} onChange={e => setDxForm({ ...dxForm, age: e.target.value })} /></div>
              <div><label className="label">{t('common.gender')}</label><select className="input" value={dxForm.gender} onChange={e => setDxForm({ ...dxForm, gender: e.target.value })}><option value="">Select</option><option>Male</option><option>Female</option></select></div>
              <div><label className="label">Vitals</label><input className="input" placeholder={t("common.bp14090hr88")} value={dxForm.vitals} onChange={e => setDxForm({ ...dxForm, vitals: e.target.value })} /></div></div>
              <div><label className="label">{t('common.medical_history')}</label><input className="input" value={dxForm.history} onChange={e => setDxForm({ ...dxForm, history: e.target.value })} /></div>
            </>)}
            {active === 'billing' && (<div><label className="label">Consultation Notes *</label><textarea className="input" rows={6} placeholder={t("common.patient_presented_with_fever_for_3_days_cbc_ordered_prescrib")} value={billForm.notes} onChange={e => setBillForm({ notes: e.target.value })} /></div>)}
            {active === 'summarize' && (<>
              <div><label className="label">Clinical Note *</label><textarea className="input" rows={6} placeholder={t("common.paste_the_clinical_note")} value={sumForm.note} onChange={e => setSumForm({ ...sumForm, note: e.target.value })} /></div>
              <div><label className="label">{t('common.format')}</label><select className="input" value={sumForm.format} onChange={e => setSumForm({ ...sumForm, format: e.target.value })}><option value="soap">SOAP</option><option value="brief">Brief</option><option value="discharge">Discharge</option></select></div>
            </>)}
            {active === 'lab' && (<>
              <div><label className="label">Lab Results (one per line: testName, value, unit, normalRange)</label><textarea className="input" rows={4} placeholder={t("common.hemoglobin_125_gdl_1216")} value={labForm.results} onChange={e => setLabForm({ ...labForm, results: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3"><div><label className="label">{t('common.age')}</label><input className="input" type="number" value={labForm.age} onChange={e => setLabForm({ ...labForm, age: e.target.value })} /></div>
              <div><label className="label">{t('common.gender')}</label><select className="input" value={labForm.gender} onChange={e => setLabForm({ ...labForm, gender: e.target.value })}><option value="">Select</option><option>Male</option><option>Female</option></select></div></div>
            </>)}
            {active === 'insights' && (<div className="grid grid-cols-2 gap-3"><div><label className="label">{t('common.from_')}</label><input className="input" type="date" value={insForm.from} onChange={e => setInsForm({ ...insForm, from: e.target.value })} /></div>
              <div><label className="label">{t('common.to_')}</label><input className="input" type="date" value={insForm.to} onChange={e => setInsForm({ ...insForm, to: e.target.value })} /></div></div>)}

            <button onClick={submit} disabled={loading} className="btn-primary w-full"><Send className="w-4 h-4" /> {loading ? 'Analyzing…' : 'Ask AI'}</button>
          </div>

          {/* Output */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between"><h3 className="font-semibold">AI Response</h3>
              {interactionId && (<div className="flex gap-2"><button onClick={() => sendFeedback('accepted')} className="btn-ghost p-1.5 text-emerald-600" title="Helpful"><ThumbsUp className="w-4 h-4" /></button>
                <button onClick={() => sendFeedback('rejected')} className="btn-ghost p-1.5 text-red-500" title="Not helpful"><ThumbsDown className="w-4 h-4" /></button></div>)}
            </div>
            {loading ? (<div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]"><div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full mb-3" /><p>AI is analyzing…</p></div>)
            : result ? (<pre className="bg-[var(--color-surface)] p-4 rounded-lg text-sm overflow-auto max-h-96 whitespace-pre-wrap font-data">{JSON.stringify(result, null, 2)}</pre>)
            : (<div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]"><Bot className="w-12 h-12 mb-3 opacity-30" /><p>Enter data and click "Ask AI" to get results</p></div>)}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
