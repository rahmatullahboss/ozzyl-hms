import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft, Shield, FileText, Activity, ClipboardCheck,
  Stethoscope, Receipt, Heart, History, AlertTriangle, Droplets, Pill, Plus
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface PatientOverview {
  verification_notice: string;
  patient: { patient_id: number; name: string; age?: number; gender?: string; blood_group?: string; patient_code?: string };
  risk: { score: number; level: string; signals: Array<{ label: string; source: string; severity: string }> };
  allergies: Array<{ allergen: string; severity: string; reaction?: string }>;
  current_medications: Array<{ name: string; dosage?: string }>;
  clearance: { items: Array<{ check_type: string; status: string }>; readiness_percent: number };
  vitals: { bp?: string; pulse?: number; spo2?: number; temperature?: number; weight?: number; blood_sugar?: number } | null;
}

function RiskBadge({ label, severity }: { label: string; severity: string }) {
  const colors: Record<string, string> = {
    life_threatening: 'bg-red-100 text-red-800 border-red-300',
    severe: 'bg-orange-100 text-orange-800 border-orange-300',
    moderate: 'bg-amber-100 text-amber-800 border-amber-300',
    low: 'bg-blue-100 text-blue-800 border-blue-300',
    high: 'bg-red-100 text-red-800 border-red-300',
  };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colors[severity] ?? colors.low}`}>{label}</span>;
}

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Shield; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${active ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

export default function IntraOpCanvas({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantClinical']);
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bid = parseInt(bookingId ?? '0');
  const [activeTab, setActiveTab] = useState('vitals');

  const { data: overview, isLoading } = useApiQuery<PatientOverview>(
    queryKeys.ot.overview(bid), `/api/ot/overview/${bid}`, { enabled: !!bid });

  if (!bid) {
    return (
      <DashboardLayout role={role}>
        <div className="flex items-center justify-center h-64">
          <p className="text-[var(--color-text-muted)]">{t('intraOpCanvas.noBooking')}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (isLoading) {
    return (
      <DashboardLayout role={role}>
        <div className="flex gap-4 h-[calc(100vh-4rem)]">
          <div className="w-80 skeleton rounded-xl" />
          <div className="flex-1 skeleton rounded-xl" />
        </div>
      </DashboardLayout>
    );
  }

  const TABS = [
    { key: 'clearance', label: t('intraOpCanvas.tab.clearance'), icon: Shield },
    { key: 'consents', label: t('intraOpCanvas.tab.consents'), icon: FileText },
    { key: 'vitals', label: t('intraOpCanvas.tab.vitals'), icon: Activity },
    { key: 'safety', label: t('intraOpCanvas.tab.safety'), icon: ClipboardCheck },
    { key: 'anesthesia', label: t('intraOpCanvas.tab.anesthesia'), icon: Stethoscope },
    { key: 'billing', label: t('intraOpCanvas.tab.billing'), icon: Receipt },
    { key: 'recovery', label: t('intraOpCanvas.tab.recovery'), icon: Heart },
    { key: 'audit', label: t('intraOpCanvas.tab.audit'), icon: History },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="flex gap-4 h-[calc(100vh-4rem)] max-w-screen-2xl mx-auto">

        {/* Left Panel — Patient Summary */}
        <div className="w-80 flex-shrink-0 overflow-y-auto space-y-3 pb-4">
          <button onClick={() => navigate('/ot')} className="btn-ghost text-sm flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> {t('intraOpCanvas.backToOT')}
          </button>

          <div className="card p-4 space-y-2">
            <h2 className="text-lg font-bold">{overview?.patient?.name ?? `${t('intraOpCanvas.patient')} #${bid}`}</h2>
            <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
              {overview?.patient?.patient_code && <p>{t('intraOpCanvas.id')}: <span className="font-data">{overview.patient.patient_code}</span></p>}
              {overview?.patient?.age && <p>{t('intraOpCanvas.age')}: <span className="font-data">{overview.patient.age}</span></p>}
              {overview?.patient?.gender && <p>{t('intraOpCanvas.gender')}: {overview.patient.gender}</p>}
              {overview?.patient?.blood_group && <p className="flex items-center gap-1"><Droplets className="w-3 h-3" /><span className="font-data">{overview.patient.blood_group}</span></p>}
            </div>
          </div>

          {overview?.risk?.signals && overview.risk.signals.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">{t('intraOpCanvas.riskSignals')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {overview.risk.signals.map((s, i) => <RiskBadge key={i} label={s.label} severity={s.severity} />)}
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">{t('intraOpCanvas.score')}: <span className="font-bold">{overview.risk.score}</span> ({overview.risk.level})</p>
            </div>
          )}

          {overview?.allergies && overview.allergies.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-red-600 uppercase flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {t('intraOpCanvas.allergies')}</h3>
              {overview.allergies.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{a.allergen}</span>
                  <span className={`badge ${a.severity === 'severe' || a.severity === 'life_threatening' ? 'badge-error' : 'badge-warning'}`}>{a.severity}</span>
                </div>
              ))}
            </div>
          )}

          {overview?.current_medications && overview.current_medications.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase flex items-center gap-1"><Pill className="w-3.5 h-3.5" /> {t('intraOpCanvas.medications')}</h3>
              {overview.current_medications.map((m, i) => <p key={i} className="text-sm">{m.name} {m.dosage && <span className="text-[var(--color-text-muted)]">({m.dosage})</span>}</p>)}
            </div>
          )}

          {overview?.vitals && (
            <div className="card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> {t('intraOpCanvas.lastVitals')}</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {overview.vitals.bp && <p>{t('intraOpCanvas.bp')}: <span className="font-data font-medium">{overview.vitals.bp}</span></p>}
                {overview.vitals.pulse && <p>{t('intraOpCanvas.pulse')}: <span className="font-data font-medium">{overview.vitals.pulse} {t('intraOpCanvas.bpm')}</span></p>}
                {overview.vitals.spo2 && <p>{t('intraOpCanvas.spo2')}: <span className="font-data font-medium">{overview.vitals.spo2}%</span></p>}
                {overview.vitals.temperature && <p>{t('intraOpCanvas.temp')}: <span className="font-data font-medium">{overview.vitals.temperature}°F</span></p>}
              </div>
            </div>
          )}

          {overview?.clearance?.items && overview.clearance.items.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase flex items-center gap-1">
                <Shield className="w-3.5 h-3.5" /> {t('intraOpCanvas.clearance')} <span className="ml-auto text-[var(--color-primary)] font-bold">{overview.clearance.readiness_percent}%</span>
              </h3>
              {overview.clearance.items.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{c.check_type.replace(/_/g, ' ')}</span>
                  <span className={`badge ${c.status === 'done' ? 'badge-success' : c.status === 'rejected' ? 'badge-error' : 'badge-warning'}`}>{c.status}</span>
                </div>
              ))}
            </div>
          )}

          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
            {overview?.verification_notice ?? t('intraOpCanvas.verifyNotice')}
          </div>
        </div>

        {/* Right Panel — Tabs */}
        <div className="flex-1 min-w-0 card overflow-hidden flex flex-col">
          <div className="border-b border-[var(--color-border)] overflow-x-auto flex-shrink-0">
            <div className="flex min-w-max">
              {TABS.map(tab => <TabButton key={tab.key} active={activeTab === tab.key} icon={tab.icon} label={tab.label} onClick={() => setActiveTab(tab.key)} />)}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'vitals' && <VitalsPanel bookingId={bid} />}
            {activeTab === 'clearance' && <ClearancePanel bookingId={bid} />}
            {activeTab === 'consents' && <ConsentsPanel bookingId={bid} />}
            {activeTab === 'safety' && <SafetyPanel bookingId={bid} />}
            {activeTab === 'anesthesia' && <AnesthesiaPanel bookingId={bid} />}
            {activeTab === 'billing' && <BillingPanel bookingId={bid} />}
            {activeTab === 'recovery' && <RecoveryPanel bookingId={bid} />}
            {activeTab === 'audit' && <AuditPanel bookingId={bid} />}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

// ─── Tab Panels ───────────────────────────────────────────────────────────────

function VitalsPanel({ bookingId }: { bookingId: number }) {
  const { t } = useTranslation(['tenantClinical']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ pulse: '', blood_pressure_systolic: '', blood_pressure_diastolic: '', spo2: '', temperature: '', respiratory_rate: '', pain_scale: '', notes: '' });
  const { data } = useApiQuery<{ vitals: Array<{ taken_at: string; pulse?: number; blood_pressure_systolic?: number; blood_pressure_diastolic?: number; spo2?: number; temperature?: number; respiratory_rate?: number; pain_scale?: number }> }>(queryKeys.ot.vitals(bookingId), `/api/ot/bookings/${bookingId}/vitals`);
  const vitals = data?.vitals ?? [];
  const createMutation = useApiMutation<unknown, Record<string, unknown>>('post', `/api/ot/bookings/${bookingId}/vitals`, {
    onSuccess: () => { toast.success(t('intraOpCanvas.vitalsRecorded')); setShowForm(false); setForm({ pulse: '', blood_pressure_systolic: '', blood_pressure_diastolic: '', spo2: '', temperature: '', respiratory_rate: '', pain_scale: '', notes: '' }); queryClient.invalidateQueries({ queryKey: queryKeys.ot.vitals(bookingId) }); },
    onError: (err) => toast.error(err.message || t('intraOpCanvas.failed')),
  });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (form.pulse) body.pulse = parseInt(form.pulse);
    if (form.blood_pressure_systolic) body.blood_pressure_systolic = parseInt(form.blood_pressure_systolic);
    if (form.blood_pressure_diastolic) body.blood_pressure_diastolic = parseInt(form.blood_pressure_diastolic);
    if (form.spo2) body.spo2 = parseFloat(form.spo2);
    if (form.temperature) body.temperature = parseFloat(form.temperature);
    if (form.respiratory_rate) body.respiratory_rate = parseInt(form.respiratory_rate);
    if (form.pain_scale) body.pain_scale = parseInt(form.pain_scale);
    if (form.notes) body.notes = form.notes;
    if (Object.keys(body).length === 0) { toast.error(t('intraOpCanvas.atLeastOneVital')); return; }
    createMutation.mutate(body);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h4 className="text-xs font-semibold text-[var(--color-text-muted)]">{t('intraOpCanvas.vitalsTimeline')}</h4><button onClick={() => setShowForm(!showForm)} className="btn-ghost text-xs text-[var(--color-primary)]"><Plus className="w-3 h-3" /> {t('intraOpCanvas.record')}</button></div>
      {showForm && (
        <form onSubmit={handleSubmit} className="p-3 rounded-lg bg-[var(--color-border-light)] space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <div><label className="label text-xs">{t('intraOpCanvas.bpSys')}</label><input className="input text-xs" type="number" placeholder="120" value={form.blood_pressure_systolic} onChange={e => setForm(f => ({ ...f, blood_pressure_systolic: e.target.value }))} /></div>
            <div><label className="label text-xs">{t('intraOpCanvas.bpDia')}</label><input className="input text-xs" type="number" placeholder="80" value={form.blood_pressure_diastolic} onChange={e => setForm(f => ({ ...f, blood_pressure_diastolic: e.target.value }))} /></div>
            <div><label className="label text-xs">{t('intraOpCanvas.pulse')}</label><input className="input text-xs" type="number" placeholder="72" value={form.pulse} onChange={e => setForm(f => ({ ...f, pulse: e.target.value }))} /></div>
            <div><label className="label text-xs">{t('intraOpCanvas.spo2')}</label><input className="input text-xs" type="number" step="0.1" placeholder="98" value={form.spo2} onChange={e => setForm(f => ({ ...f, spo2: e.target.value }))} /></div>
            <div><label className="label text-xs">{t('intraOpCanvas.temp')}</label><input className="input text-xs" type="number" step="0.1" placeholder="98.6" value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: e.target.value }))} /></div>
            <div><label className="label text-xs">{t('intraOpCanvas.rr')}</label><input className="input text-xs" type="number" placeholder="16" value={form.respiratory_rate} onChange={e => setForm(f => ({ ...f, respiratory_rate: e.target.value }))} /></div>
            <div><label className="label text-xs">{t('intraOpCanvas.pain')}</label><input className="input text-xs" type="number" min="0" max="10" placeholder="0" value={form.pain_scale} onChange={e => setForm(f => ({ ...f, pain_scale: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-xs">{t('intraOpCanvas.cancel')}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary text-xs">{createMutation.isPending ? t('intraOpCanvas.saving') : t('intraOpCanvas.save')}</button></div>
        </form>
      )}
      {vitals.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">{t('intraOpCanvas.noVitals')}</p> : (
        <div className="overflow-x-auto"><table className="table-base text-xs"><thead><tr><th>{t('intraOpCanvas.time')}</th><th>{t('intraOpCanvas.bp')}</th><th>{t('intraOpCanvas.pulse')}</th><th>{t('intraOpCanvas.spo2')}</th><th>{t('intraOpCanvas.temp')}</th><th>{t('intraOpCanvas.rr')}</th><th>{t('intraOpCanvas.pain')}</th></tr></thead><tbody>{vitals.slice(0, 30).map((v, i) => <tr key={i}><td>{v.taken_at?.slice(11, 16) ?? '—'}</td><td>{v.blood_pressure_systolic && v.blood_pressure_diastolic ? `${v.blood_pressure_systolic}/${v.blood_pressure_diastolic}` : '—'}</td><td>{v.pulse ?? '—'}</td><td>{v.spo2 ?? '—'}%</td><td>{v.temperature ?? '—'}°F</td><td>{v.respiratory_rate ?? '—'}</td><td>{v.pain_scale ?? '—'}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

function ClearancePanel({ bookingId }: { bookingId: number }) {
  const { t } = useTranslation(['tenantClinical']);
  const queryClient = useQueryClient();
  const { data } = useApiQuery<{ checks: Array<{ id: number; check_type: string; status: string; is_required: number }> }>(queryKeys.ot.clearance(bookingId), `/api/ot/bookings/${bookingId}/clearance`);
  const checks = data?.checks ?? [];
  const updateMutation = useApiMutation<unknown, { id: number; status: string }>('put', (vars) => `/api/ot/clearance/${vars.id}`, { onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.ot.clearance(bookingId) }), onError: (err) => toast.error(err.message || t('intraOpCanvas.failed')) });
  if (checks.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">{t('intraOpCanvas.noClearanceChecks')}</p>;
  return <div className="space-y-2">{checks.map(c => <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--color-border-light)]"><div className="flex items-center gap-2"><span className="text-sm font-medium">{c.check_type.replace(/_/g, ' ')}</span>{c.is_required ? <span className="text-xs text-red-500">*</span> : null}</div><div className="flex items-center gap-1">{c.status === 'pending' ? <><button onClick={() => updateMutation.mutate({ id: c.id, status: 'done' })} className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200">{t('intraOpCanvas.done')}</button><button onClick={() => updateMutation.mutate({ id: c.id, status: 'waived' })} className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200">{t('intraOpCanvas.waive')}</button></> : <span className={`badge ${c.status === 'done' ? 'badge-success' : 'badge-warning'}`}>{c.status}</span>}</div></div>)}</div>;
}

function ConsentsPanel({ bookingId }: { bookingId: number }) {
  const { t } = useTranslation(['tenantClinical']);
  const queryClient = useQueryClient();
  const { data } = useApiQuery<{ consents: Array<{ id: number; consent_type: string; status: string; guardian_name?: string }> }>(queryKeys.ot.consents(bookingId), `/api/ot/bookings/${bookingId}/consents`);
  const consents = data?.consents ?? [];
  const updateMutation = useApiMutation<unknown, { id: number; status: string }>('put', (vars) => `/api/ot/consents/${vars.id}`, { onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.ot.consents(bookingId) }), onError: (err) => toast.error(err.message || t('intraOpCanvas.failed')) });
  if (consents.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">{t('intraOpCanvas.noConsents')}</p>;
  return <div className="space-y-2">{consents.map(c => <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--color-border-light)]"><div><span className="text-sm font-medium">{c.consent_type.replace(/_/g, ' ')}</span>{c.guardian_name && <span className="text-xs text-[var(--color-text-muted)] ml-2">({c.guardian_name})</span>}</div><div className="flex items-center gap-1">{c.status === 'pending' ? <><button onClick={() => updateMutation.mutate({ id: c.id, status: 'signed' })} className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">{t('intraOpCanvas.sign')}</button><button onClick={() => updateMutation.mutate({ id: c.id, status: 'verified' })} className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{t('intraOpCanvas.verify')}</button></> : <span className={`badge ${c.status === 'verified' || c.status === 'signed' ? 'badge-success' : 'badge-warning'}`}>{c.status}</span>}</div></div>)}</div>;
}

function SafetyPanel({ bookingId }: { bookingId: number }) {
  const { t } = useTranslation(['tenantClinical']);
  const queryClient = useQueryClient();
  const { data } = useApiQuery<{ items: Array<{ id: number; section: string; item_name: string; item_value: number }> }>(queryKeys.ot.safetyChecklist(bookingId), `/api/ot/bookings/${bookingId}/safety-checklist`);
  const items = data?.items ?? [];
  const toggleMutation = useApiMutation<unknown, { id: number; item_value: number }>('put', (vars) => `/api/ot/safety-checklist/${vars.id}`, { onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.ot.safetyChecklist(bookingId) }), onError: (err) => toast.error(err.message || t('intraOpCanvas.failed')) });
  if (items.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">{t('intraOpCanvas.noSafetyChecklist')}</p>;
  const grouped: Record<string, typeof items> = {};
  for (const item of items) { (grouped[item.section] ??= []).push(item); }
  return <div className="space-y-3">{Object.entries(grouped).map(([section, sectionItems]) => <div key={section}><h4 className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-1">{section.replace(/_/g, ' ')}</h4>{sectionItems.map(item => <button key={item.id} type="button" onClick={() => toggleMutation.mutate({ id: item.id, item_value: item.item_value ? 0 : 1 })} className="flex items-center gap-2 py-1 w-full text-left hover:bg-[var(--color-border-light)] rounded px-1"><span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${item.item_value ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300'}`}>{item.item_value ? '✓' : ''}</span><span className="text-sm">{item.item_name}</span></button>)}</div>)}</div>;
}

function AnesthesiaPanel({ bookingId }: { bookingId: number }) {
  const { t } = useTranslation(['tenantClinical']);
  const { data } = useApiQuery<{ logs: Array<{ id: number; anesthesia_type: string; airway_method?: string; drugs?: string; complications?: string; notes?: string }> }>(queryKeys.ot.anesthesia(bookingId), `/api/ot/bookings/${bookingId}/anesthesia`);
  const logs = data?.logs ?? [];
  if (logs.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">{t('intraOpCanvas.noAnesthesiaLogs')}</p>;
  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className="p-3 rounded-lg bg-[var(--color-border-light)] space-y-1 text-sm">
          <p><strong>{t('intraOpCanvas.type')}:</strong> {log.anesthesia_type}</p>
          {log.airway_method && <p><strong>{t('intraOpCanvas.airway')}:</strong> {log.airway_method}</p>}
          {log.drugs && <p><strong>{t('intraOpCanvas.drugs')}:</strong> {log.drugs}</p>}
          {log.complications && <p className="text-red-600"><strong>{t('intraOpCanvas.complications')}:</strong> {log.complications}</p>}
          {log.notes && <p><strong>{t('intraOpCanvas.notes')}:</strong> {log.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function BillingPanel({ bookingId }: { bookingId: number }) {
  const { t } = useTranslation(['tenantClinical']);
  const { data } = useApiQuery<{ bill: { id: number; status: string; gross_amount: number; discount_amount: number; net_amount: number } | null; items: Array<{ id: number; charge_head: string; description: string; quantity: number; unit_price: number; total: number }> }>(queryKeys.ot.bill(bookingId), `/api/ot/bookings/${bookingId}/bill`);
  if (!data?.bill) return <p className="text-sm text-[var(--color-text-muted)]">{t('intraOpCanvas.noBill')}</p>;
  const { bill, items } = data;
  return (
    <div className="space-y-3">
      <div className="p-3 rounded-lg bg-[var(--color-border-light)] text-sm space-y-1">
        <p><strong>{t('intraOpCanvas.status')}:</strong> <span className="badge badge-info">{bill.status}</span></p>
        <p><strong>{t('intraOpCanvas.gross')}:</strong> ৳{bill.gross_amount.toLocaleString()}</p>
        <p><strong>{t('intraOpCanvas.discount')}:</strong> ৳{bill.discount_amount.toLocaleString()}</p>
        <p className="font-semibold"><strong>{t('intraOpCanvas.net')}:</strong> ৳{bill.net_amount.toLocaleString()}</p>
      </div>
      {items.length > 0 && <div className="overflow-x-auto"><table className="table-base text-xs"><thead><tr><th>{t('intraOpCanvas.head')}</th><th>{t('intraOpCanvas.description')}</th><th>{t('intraOpCanvas.qty')}</th><th>{t('intraOpCanvas.price')}</th><th>{t('intraOpCanvas.total')}</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td className="capitalize">{item.charge_head.replace(/_/g, ' ')}</td><td>{item.description}</td><td>{item.quantity}</td><td>৳{item.unit_price.toLocaleString()}</td><td className="text-right font-medium">৳{item.total.toLocaleString()}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function RecoveryPanel({ bookingId }: { bookingId: number }) {
  const { t } = useTranslation(['tenantClinical']);
  const { data } = useApiQuery<{ handover: { shifted_to: string; consciousness_level?: string; bp?: string; pulse?: number; spo2?: number; pain_score?: number; post_op_instruction?: string } | null }>(queryKeys.ot.recovery(bookingId), `/api/ot/bookings/${bookingId}/recovery`);
  const h = data?.handover;
  if (!h) return <p className="text-sm text-[var(--color-text-muted)]">{t('intraOpCanvas.noRecoveryHandover')}</p>;
  return (
    <div className="p-3 rounded-lg bg-[var(--color-border-light)] text-sm space-y-1">
      <p><strong>{t('intraOpCanvas.shiftedTo')}:</strong> {h.shifted_to}</p>
      {h.consciousness_level && <p><strong>{t('intraOpCanvas.consciousness')}:</strong> {h.consciousness_level}</p>}
      {h.bp && <p><strong>{t('intraOpCanvas.bp')}:</strong> {h.bp}</p>}
      {h.pulse && <p><strong>{t('intraOpCanvas.pulse')}:</strong> {h.pulse}</p>}
      {h.spo2 && <p><strong>{t('intraOpCanvas.spo2')}:</strong> {h.spo2}%</p>}
      {h.pain_score !== undefined && <p><strong>{t('intraOpCanvas.pain')}:</strong> {h.pain_score}/10</p>}
      {h.post_op_instruction && <p><strong>{t('intraOpCanvas.instructions')}:</strong> {h.post_op_instruction}</p>}
    </div>
  );
}

function AuditPanel({ bookingId }: { bookingId: number }) {
  const { t } = useTranslation(['tenantClinical']);
  const { data } = useApiQuery<{ logs: Array<{ action: string; user_role?: string; reason?: string; created_at: string }> }>(queryKeys.ot.audit(bookingId), `/api/ot/bookings/${bookingId}/audit`);
  const logs = data?.logs ?? [];
  if (logs.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">{t('intraOpCanvas.noAuditEntries')}</p>;
  return <div className="space-y-2">{logs.map((log, i) => <div key={i} className="flex items-start gap-3 py-2"><div className="w-2 h-2 mt-1.5 rounded-full bg-[var(--color-primary)]" /><div className="flex-1 min-w-0"><p className="text-sm font-medium">{log.action} <span className="text-xs text-[var(--color-text-muted)]">{t('intraOpCanvas.by')} {log.user_role ?? t('intraOpCanvas.unknown')}</span></p>{log.reason && <p className="text-xs text-[var(--color-text-muted)]">{log.reason}</p>}<p className="text-xs text-[var(--color-text-muted)]">{log.created_at}</p></div></div>)}</div>;
}
