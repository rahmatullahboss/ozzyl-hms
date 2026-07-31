import { useState } from 'react';
import { X, Shield, FileText, Activity, ClipboardCheck, Stethoscope, Receipt, Heart, History, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface BookingDetailDrawerProps {
  bookingId: number;
  patientName?: string;
  onClose: () => void;
}

type TabKey = 'clearance' | 'consents' | 'vitals' | 'safety' | 'anesthesia' | 'billing' | 'recovery' | 'audit';

const TABS: { key: TabKey; label: string; icon: typeof Shield }[] = [
  { key: 'clearance',  label: 'Clearance',  icon: Shield },
  { key: 'consents',   label: 'Consents',   icon: FileText },
  { key: 'vitals',     label: 'Vitals',     icon: Activity },
  { key: 'safety',     label: 'Safety',     icon: ClipboardCheck },
  { key: 'anesthesia', label: 'Anesthesia', icon: Stethoscope },
  { key: 'billing',    label: 'Billing',    icon: Receipt },
  { key: 'recovery',   label: 'Recovery',   icon: Heart },
  { key: 'audit',      label: 'Audit',      icon: History },
];

function ClearanceTab({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const { data } = useApiQuery<{ checks: Array<{ id: number; check_type: string; status: string; is_required: number }> }>(
    queryKeys.ot.clearance(bookingId), `/api/ot/bookings/${bookingId}/clearance`);
  const checks = data?.checks ?? [];

  const updateMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    (vars) => `/api/ot/clearance/${vars.id}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.clearance(bookingId) });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const handleStatusChange = (id: number, status: string) => {
    updateMutation.mutate({ id, status });
  };

  if (checks.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No clearance checks recorded.</p>;
  return (
    <div className="space-y-2">
      {checks.map(c => (
        <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--color-border-light)]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{c.check_type.replace(/_/g, ' ')}</span>
            {c.is_required ? <span className="text-xs text-red-500">*</span> : null}
          </div>
          <div className="flex items-center gap-1">
            {c.status === 'pending' ? (
              <>
                <button onClick={() => handleStatusChange(c.id, 'done')} className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200">Done</button>
                <button onClick={() => handleStatusChange(c.id, 'waived')} className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200">Waive</button>
                <button onClick={() => handleStatusChange(c.id, 'rejected')} className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200">Reject</button>
              </>
            ) : (
              <span className={`badge ${c.status === 'done' ? 'badge-success' : c.status === 'rejected' ? 'badge-error' : 'badge-warning'}`}>
                {c.status}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConsentsTab({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    consent_type: 'general_surgery', guardian_name: '', guardian_relation: '', guardian_phone: '', witness_name: '',
  });

  const { data } = useApiQuery<{ consents: Array<{ id: number; consent_type: string; status: string; guardian_name?: string }> }>(
    queryKeys.ot.consents(bookingId), `/api/ot/bookings/${bookingId}/consents`);
  const consents = data?.consents ?? [];

  const CONSENT_TYPES = [
    'general_surgery', 'anesthesia', 'high_risk', 'blood_transfusion',
    'c_section', 'minor_guardian', 'laparoscopic', 'icu', 'other',
  ];

  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    `/api/ot/bookings/${bookingId}/consents`,
    {
      onSuccess: () => {
        toast.success('Consent recorded');
        setShowForm(false);
        setForm({ consent_type: 'general_surgery', guardian_name: '', guardian_relation: '', guardian_phone: '', witness_name: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.consents(bookingId) });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const updateMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    (vars) => `/api/ot/consents/${vars.id}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.consents(bookingId) });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { consent_type: form.consent_type };
    if (form.guardian_name) body.guardian_name = form.guardian_name;
    if (form.guardian_relation) body.guardian_relation = form.guardian_relation;
    if (form.guardian_phone) body.guardian_phone = form.guardian_phone;
    if (form.witness_name) body.witness_name = form.witness_name;
    createMutation.mutate(body);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--color-text-muted)]">CONSENTS</h4>
        <button onClick={() => setShowForm(!showForm)} className="btn-ghost text-xs text-[var(--color-primary)]">
          <Plus className="w-3 h-3" /> Add Consent
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="p-3 rounded-lg bg-[var(--color-border-light)] space-y-3">
          <div>
            <label className="label text-xs">Type *</label>
            <select className="input text-xs" value={form.consent_type} onChange={e => setForm(f => ({ ...f, consent_type: e.target.value }))}>
              {CONSENT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">Guardian Name</label>
              <input className="input text-xs" placeholder="Name" value={form.guardian_name} onChange={e => setForm(f => ({ ...f, guardian_name: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Relation</label>
              <input className="input text-xs" placeholder="Father / Mother" value={form.guardian_relation} onChange={e => setForm(f => ({ ...f, guardian_relation: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Phone</label>
              <input className="input text-xs" placeholder="017..." value={form.guardian_phone} onChange={e => setForm(f => ({ ...f, guardian_phone: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Witness</label>
              <input className="input text-xs" placeholder="Name" value={form.witness_name} onChange={e => setForm(f => ({ ...f, witness_name: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-xs">Cancel</button>
            <button type="submit" disabled={createMutation.isPending} className="btn-primary text-xs">
              {createMutation.isPending ? 'Saving…' : 'Save Consent'}
            </button>
          </div>
        </form>
      )}

      {consents.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No consents recorded.</p>
      ) : (
        <div className="space-y-2">
          {consents.map(c => (
            <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--color-border-light)]">
              <div>
                <span className="text-sm font-medium">{c.consent_type.replace(/_/g, ' ')}</span>
                {c.guardian_name && <span className="text-xs text-[var(--color-text-muted)] ml-2">({c.guardian_name})</span>}
              </div>
              <div className="flex items-center gap-1">
                {c.status === 'pending' ? (
                  <>
                    <button onClick={() => updateMutation.mutate({ id: c.id, status: 'signed' })} className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200">Sign</button>
                    <button onClick={() => updateMutation.mutate({ id: c.id, status: 'verified' })} className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">Verify</button>
                    <button onClick={() => updateMutation.mutate({ id: c.id, status: 'rejected' })} className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200">Reject</button>
                  </>
                ) : (
                  <span className={`badge ${c.status === 'verified' || c.status === 'signed' ? 'badge-success' : c.status === 'rejected' ? 'badge-error' : 'badge-warning'}`}>
                    {c.status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VitalsTab({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    pulse: '', blood_pressure_systolic: '', blood_pressure_diastolic: '',
    spo2: '', temperature: '', respiratory_rate: '', pain_scale: '', notes: '',
  });

  const { data } = useApiQuery<{ vitals: Array<{ taken_at: string; pulse?: number; blood_pressure_systolic?: number; blood_pressure_diastolic?: number; spo2?: number; temperature?: number; respiratory_rate?: number; pain_scale?: number }> }>(
    queryKeys.ot.vitals(bookingId), `/api/ot/bookings/${bookingId}/vitals`);
  const vitals = data?.vitals ?? [];

  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    `/api/ot/bookings/${bookingId}/vitals`,
    {
      offline: true,
      onSuccess: () => {
        toast.success('Vitals recorded');
        setShowForm(false);
        setForm({ pulse: '', blood_pressure_systolic: '', blood_pressure_diastolic: '', spo2: '', temperature: '', respiratory_rate: '', pain_scale: '', notes: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.vitals(bookingId) });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

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
    if (Object.keys(body).length === 0) { toast.error('At least one vital sign required'); return; }
    createMutation.mutate(body);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--color-text-muted)]">VITALS TIMELINE</h4>
        <button onClick={() => setShowForm(!showForm)} className="btn-ghost text-xs text-[var(--color-primary)]">
          <Plus className="w-3 h-3" /> Record
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="p-3 rounded-lg bg-[var(--color-border-light)] space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">BP Systolic</label>
              <input className="input text-xs" type="number" placeholder="120" value={form.blood_pressure_systolic} onChange={e => setForm(f => ({ ...f, blood_pressure_systolic: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">BP Diastolic</label>
              <input className="input text-xs" type="number" placeholder="80" value={form.blood_pressure_diastolic} onChange={e => setForm(f => ({ ...f, blood_pressure_diastolic: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Pulse (bpm)</label>
              <input className="input text-xs" type="number" placeholder="72" value={form.pulse} onChange={e => setForm(f => ({ ...f, pulse: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">SpO2 (%)</label>
              <input className="input text-xs" type="number" step="0.1" placeholder="98" value={form.spo2} onChange={e => setForm(f => ({ ...f, spo2: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Temp (°F)</label>
              <input className="input text-xs" type="number" step="0.1" placeholder="98.6" value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">RR (breaths/min)</label>
              <input className="input text-xs" type="number" placeholder="16" value={form.respiratory_rate} onChange={e => setForm(f => ({ ...f, respiratory_rate: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Pain (0-10)</label>
              <input className="input text-xs" type="number" min="0" max="10" placeholder="0" value={form.pain_scale} onChange={e => setForm(f => ({ ...f, pain_scale: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label text-xs">Notes</label>
            <input className="input text-xs" placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-xs">Cancel</button>
            <button type="submit" disabled={createMutation.isPending} className="btn-primary text-xs">
              {createMutation.isPending ? 'Saving…' : 'Save Vitals'}
            </button>
          </div>
        </form>
      )}

      {vitals.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No vitals recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base text-xs">
            <thead><tr><th>Time</th><th>BP</th><th>Pulse</th><th>SpO2</th><th>Temp</th><th>RR</th><th>Pain</th></tr></thead>
            <tbody>
              {vitals.slice(0, 20).map((v, i) => (
                <tr key={i}>
                  <td>{v.taken_at?.slice(11, 16) ?? '—'}</td>
                  <td>{v.blood_pressure_systolic && v.blood_pressure_diastolic ? `${v.blood_pressure_systolic}/${v.blood_pressure_diastolic}` : '—'}</td>
                  <td>{v.pulse ?? '—'}</td>
                  <td>{v.spo2 ?? '—'}%</td>
                  <td>{v.temperature ?? '—'}°F</td>
                  <td>{v.respiratory_rate ?? '—'}</td>
                  <td>{v.pain_scale ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SafetyTab({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const { data } = useApiQuery<{ items: Array<{ id: number; section: string; item_name: string; item_value: number; item_details?: string }> }>(
    queryKeys.ot.safetyChecklist(bookingId), `/api/ot/bookings/${bookingId}/safety-checklist`);
  const items = data?.items ?? [];

  const toggleMutation = useApiMutation<unknown, { id: number; item_value: number }>(
    'put',
    (vars) => `/api/ot/safety-checklist/${vars.id}`,
    {
      offline: true,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.safetyChecklist(bookingId) });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const handleToggle = (id: number, currentValue: number) => {
    toggleMutation.mutate({ id, item_value: currentValue ? 0 : 1 });
  };

  if (items.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No safety checklist items.</p>;
  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    (grouped[item.section] ??= []).push(item);
  }
  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([section, sectionItems]) => (
        <div key={section}>
          <h4 className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-1">{section.replace(/_/g, ' ')}</h4>
          {sectionItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleToggle(item.id, item.item_value)}
              className="flex items-center gap-2 py-1 w-full text-left hover:bg-[var(--color-border-light)] rounded px-1 transition-colors"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${item.item_value ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300'}`}>
                {item.item_value ? '✓' : ''}
              </span>
              <span className="text-sm">{item.item_name}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function AnesthesiaTab({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    anesthesia_type: 'general', airway_method: '', drugs: '', complications: '', notes: '',
  });

  const { data } = useApiQuery<{ logs: Array<{ id: number; anesthesia_type: string; anesthetist_id?: number; start_time?: string; end_time?: string; airway_method?: string; drugs?: string; complications?: string; notes?: string }> }>(
    queryKeys.ot.anesthesia(bookingId), `/api/ot/bookings/${bookingId}/anesthesia`);
  const logs = data?.logs ?? [];

  const ANESTHESIA_TYPES = ['general', 'regional', 'local', 'sedation', 'spinal', 'epidural', 'nerve_block', 'combined', 'other'];

  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    `/api/ot/bookings/${bookingId}/anesthesia`,
    {
      onSuccess: () => {
        toast.success('Anesthesia log recorded');
        setShowForm(false);
        setForm({ anesthesia_type: 'general', airway_method: '', drugs: '', complications: '', notes: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.anesthesia(bookingId) });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { anesthesia_type: form.anesthesia_type };
    if (form.airway_method) body.airway_method = form.airway_method;
    if (form.drugs) body.drugs = form.drugs;
    if (form.complications) body.complications = form.complications;
    if (form.notes) body.notes = form.notes;
    createMutation.mutate(body);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--color-text-muted)]">ANESTHESIA LOGS</h4>
        <button onClick={() => setShowForm(!showForm)} className="btn-ghost text-xs text-[var(--color-primary)]">
          <Plus className="w-3 h-3" /> Add Log
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="p-3 rounded-lg bg-[var(--color-border-light)] space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">Type *</label>
              <select className="input text-xs" value={form.anesthesia_type} onChange={e => setForm(f => ({ ...f, anesthesia_type: e.target.value }))}>
                {ANESTHESIA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Airway Method</label>
              <input className="input text-xs" placeholder="ETT / LMA / Mask" value={form.airway_method} onChange={e => setForm(f => ({ ...f, airway_method: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label text-xs">Drugs</label>
            <input className="input text-xs" placeholder="Propofol, Sevoflurane, Fentanyl" value={form.drugs} onChange={e => setForm(f => ({ ...f, drugs: e.target.value }))} />
          </div>
          <div>
            <label className="label text-xs">Complications</label>
            <input className="input text-xs" placeholder="None" value={form.complications} onChange={e => setForm(f => ({ ...f, complications: e.target.value }))} />
          </div>
          <div>
            <label className="label text-xs">Notes</label>
            <input className="input text-xs" placeholder="Additional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-xs">Cancel</button>
            <button type="submit" disabled={createMutation.isPending} className="btn-primary text-xs">
              {createMutation.isPending ? 'Saving…' : 'Save Log'}
            </button>
          </div>
        </form>
      )}

      {logs.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No anesthesia logs.</p>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="p-3 rounded-lg bg-[var(--color-border-light)] space-y-1 text-sm">
              <p><strong>Type:</strong> {log.anesthesia_type}</p>
              {log.airway_method && <p><strong>Airway:</strong> {log.airway_method}</p>}
              {log.drugs && <p><strong>Drugs:</strong> {log.drugs}</p>}
              {log.complications && <p className="text-red-600"><strong>Complications:</strong> {log.complications}</p>}
              {log.notes && <p><strong>Notes:</strong> {log.notes}</p>}
              {log.start_time && <p><strong>Start:</strong> {log.start_time}</p>}
              {log.end_time && <p><strong>End:</strong> {log.end_time}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BillingTab({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    charge_head: 'surgery', description: '', quantity: '1', unit_price: '', doctor_id: '',
  });

  const { data } = useApiQuery<{ bill: { id: number; status: string; gross_amount: number; discount_amount: number; net_amount: number } | null; items: Array<{ id: number; charge_head: string; description: string; quantity: number; unit_price: number; total: number; doctor_id?: number }> }>(
    queryKeys.ot.bill(bookingId), `/api/ot/bookings/${bookingId}/bill`);

  const CHARGE_HEADS = [
    'ot_room', 'surgery', 'surgeon_fee', 'assistant_surgeon_fee', 'anesthesia',
    'anesthetist_fee', 'ot_nurse_service', 'equipment', 'consumables',
    'medicines', 'implant', 'cssd', 'recovery', 'emergency_surcharge', 'misc',
  ];

  const createItemMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    `/api/ot/bills/${data?.bill?.id}/items`,
    {
      onSuccess: () => {
        toast.success('Line item added');
        setShowForm(false);
        setForm({ charge_head: 'surgery', description: '', quantity: '1', unit_price: '', doctor_id: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.bill(bookingId) });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description || !form.unit_price) { toast.error('Description and price required'); return; }
    const body: Record<string, unknown> = {
      charge_head: form.charge_head,
      description: form.description,
      quantity: parseInt(form.quantity) || 1,
      unit_price: parseFloat(form.unit_price),
    };
    if (form.doctor_id) body.doctor_id = parseInt(form.doctor_id);
    createItemMutation.mutate(body);
  };

  if (!data?.bill) return <p className="text-sm text-[var(--color-text-muted)]">No bill generated.</p>;
  const { bill, items } = data;

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-lg bg-[var(--color-border-light)] text-sm space-y-1">
        <p><strong>Status:</strong> <span className="badge badge-info">{bill.status}</span></p>
        <p><strong>Gross:</strong> ৳{bill.gross_amount.toLocaleString()}</p>
        <p><strong>Discount:</strong> ৳{bill.discount_amount.toLocaleString()}</p>
        <p className="font-semibold"><strong>Net:</strong> ৳{bill.net_amount.toLocaleString()}</p>
      </div>

      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--color-text-muted)]">LINE ITEMS</h4>
        {bill.status === 'draft' && (
          <button onClick={() => setShowForm(!showForm)} className="btn-ghost text-xs text-[var(--color-primary)]">
            <Plus className="w-3 h-3" /> Add Item
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="p-3 rounded-lg bg-[var(--color-border-light)] space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">Charge Head *</label>
              <select className="input text-xs" value={form.charge_head} onChange={e => setForm(f => ({ ...f, charge_head: e.target.value }))}>
                {CHARGE_HEADS.map(h => <option key={h} value={h}>{h.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Doctor ID</label>
              <input className="input text-xs" type="number" placeholder="Optional" value={form.doctor_id} onChange={e => setForm(f => ({ ...f, doctor_id: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Qty</label>
              <input className="input text-xs" type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">Unit Price *</label>
              <input className="input text-xs" type="number" step="0.01" placeholder="0" value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label text-xs">Description *</label>
            <input className="input text-xs" placeholder="e.g. Appendectomy" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-xs">Cancel</button>
            <button type="submit" disabled={createItemMutation.isPending} className="btn-primary text-xs">
              {createItemMutation.isPending ? 'Adding…' : 'Add Item'}
            </button>
          </div>
        </form>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table-base text-xs">
            <thead><tr><th>Head</th><th>Description</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="capitalize">{item.charge_head.replace(/_/g, ' ')}</td>
                  <td>{item.description}</td>
                  <td>{item.quantity}</td>
                  <td>৳{item.unit_price.toLocaleString()}</td>
                  <td className="text-right font-medium">৳{item.total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecoveryTab({ bookingId }: { bookingId: number }) {
  const { data } = useApiQuery<{ handover: { shifted_to: string; consciousness_level?: string; bp?: string; pulse?: number; spo2?: number; pain_score?: number; post_op_instruction?: string } | null }>(
    queryKeys.ot.recovery(bookingId), `/api/ot/bookings/${bookingId}/recovery`);
  const h = data?.handover;
  if (!h) return <p className="text-sm text-[var(--color-text-muted)]">No recovery handover recorded.</p>;
  return (
    <div className="p-3 rounded-lg bg-[var(--color-border-light)] text-sm space-y-1">
      <p><strong>Shifted to:</strong> {h.shifted_to}</p>
      {h.consciousness_level && <p><strong>Consciousness:</strong> {h.consciousness_level}</p>}
      {h.bp && <p><strong>BP:</strong> {h.bp}</p>}
      {h.pulse && <p><strong>Pulse:</strong> {h.pulse}</p>}
      {h.spo2 && <p><strong>SpO2:</strong> {h.spo2}%</p>}
      {h.pain_score !== undefined && <p><strong>Pain:</strong> {h.pain_score}/10</p>}
      {h.post_op_instruction && <p><strong>Instructions:</strong> {h.post_op_instruction}</p>}
    </div>
  );
}

function AuditTab({ bookingId }: { bookingId: number }) {
  const { data } = useApiQuery<{ logs: Array<{ action: string; user_role?: string; entity_type?: string; reason?: string; created_at: string }> }>(
    queryKeys.ot.audit(bookingId), `/api/ot/bookings/${bookingId}/audit`);
  const logs = data?.logs ?? [];
  if (logs.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No audit entries.</p>;
  return (
    <div className="space-y-2">
      {logs.map((log, i) => (
        <div key={i} className="flex items-start gap-3 py-2">
          <div className="w-2 h-2 mt-1.5 rounded-full bg-[var(--color-primary)]" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{log.action} <span className="text-xs text-[var(--color-text-muted)]">by {log.user_role ?? 'unknown'}</span></p>
            {log.reason && <p className="text-xs text-[var(--color-text-muted)]">{log.reason}</p>}
            <p className="text-xs text-[var(--color-text-muted)]">{log.created_at}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const TAB_COMPONENTS: Record<TabKey, React.ComponentType<{ bookingId: number }>> = {
  clearance: ClearanceTab,
  consents: ConsentsTab,
  vitals: VitalsTab,
  safety: SafetyTab,
  anesthesia: AnesthesiaTab,
  billing: BillingTab,
  recovery: RecoveryTab,
  audit: AuditTab,
};

export default function BookingDetailDrawer({ bookingId, patientName, onClose }: BookingDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('clearance');
  const TabComponent = TAB_COMPONENTS[activeTab];

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-800 h-full shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-[var(--color-border)] p-4 flex items-center justify-between z-10">
          <div>
            <h3 className="font-semibold text-lg">OT Case #{bookingId}</h3>
            {patientName && <p className="text-sm text-[var(--color-text-muted)]">{patientName}</p>}
          </div>
          <button onClick={onClose} aria-label="Close drawer" className="btn-ghost p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="sticky top-[73px] bg-white dark:bg-slate-800 border-b border-[var(--color-border)] z-10 overflow-x-auto">
          <div className="flex min-w-max">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.key
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          <TabComponent bookingId={bookingId} />
        </div>
      </div>
    </div>
  );
}
