import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Droplets, Plus, X, Search, RefreshCw, AlertTriangle,
  Heart, Syringe, FlaskConical, Users, CheckCircle, Clock,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

/* ─── Types ───────────────────────────────────────────────── */
interface Donor { id: number; donor_name: string; blood_group: string; donor_type: string; gender?: string; age?: number; phone?: string; last_donation_date?: string; total_donations: number; is_eligible: number; }
interface Donation { id: number; bag_number: string; blood_group: string; component: string; volume_ml: number; collection_date: string; expiry_date: string; status: string; screening_status: string; donor_name?: string; }
interface CrossMatch { id: number; patient_name?: string; patient_code?: string; patient_blood_group: string; requested_component: string; units_requested: number; urgency: string; status: string; compatibility_result?: string; bag_number?: string; }
interface Transfusion { id: number; patient_name?: string; bag_number: string; blood_group: string; component: string; status: string; issued_at: string; reaction_type?: string; }
interface StockRow { blood_group: string; component: string; available: number; reserved: number; expired: number; pending_screening: number; }
interface Stats { total_donors: number; available_units: number; pending_cross_match: number; today_transfusions: number; expiring_soon: number; }

/* ─── Constants ───────────────────────────────────────────── */
const BG_COLOR: Record<string, string> = { 'A+': 'bg-red-100 text-red-700', 'A-': 'bg-red-50 text-red-600', 'B+': 'bg-blue-100 text-blue-700', 'B-': 'bg-blue-50 text-blue-600', 'AB+': 'bg-purple-100 text-purple-700', 'AB-': 'bg-purple-50 text-purple-600', 'O+': 'bg-green-100 text-green-700', 'O-': 'bg-green-50 text-green-600' };
const STATUS_BADGE: Record<string, string> = { in_stock: 'badge-success', reserved: 'bg-blue-100 text-blue-700', cross_matched: 'bg-purple-100 text-purple-700', issued: 'bg-amber-100 text-amber-700', expired: 'bg-gray-200 text-gray-600', discarded: 'bg-red-100 text-red-600', quarantine: 'bg-orange-100 text-orange-700' };
const SCREEN_BADGE: Record<string, string> = { pending: 'bg-gray-100 text-gray-600', passed: 'badge-success', failed: 'bg-red-100 text-red-700' };
const URGENCY_BADGE: Record<string, string> = { routine: 'badge-neutral', urgent: 'badge-warning', emergency: 'bg-red-100 text-red-700' };
const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const COMPONENTS = ['whole_blood','packed_rbc','ffp','platelets','cryoprecipitate','plasma'];
const TABS = ['stock', 'donors', 'donations', 'cross-match', 'transfusions'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation('inventory');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

/* ─── Stock Tab ───────────────────────────────────────────── */
function StockTab() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stkRes, stRes] = await Promise.all([
        axios.get('/api/blood-bank/stock', { headers: authHeader() }),
        axios.get('/api/blood-bank/stats', { headers: authHeader() }),
      ]);
      setRows(stkRes.data?.stock ?? []);
      setStats(stRes.data ?? null);
    } catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total Donors', val: stats.total_donors, icon: <Users className="w-4 h-4 text-blue-500" /> },
            { label: 'Available Units', val: stats.available_units, icon: <Droplets className="w-4 h-4 text-green-500" /> },
            { label: 'Pending X-Match', val: stats.pending_cross_match, icon: <FlaskConical className="w-4 h-4 text-purple-500" /> },
            { label: "Today's Transfusions", val: stats.today_transfusions, icon: <Syringe className="w-4 h-4 text-red-500" /> },
            { label: 'Expiring Soon', val: stats.expiring_soon, icon: <AlertTriangle className="w-4 h-4 text-amber-500" /> },
          ].map(k => (
            <div key={k.label} className="card p-3">
              <div className="flex items-center gap-2 mb-1">{k.icon}<span className="text-xs text-[var(--color-text-muted)]">{k.label}</span></div>
              <p className="text-2xl font-bold">{k.val}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]"><h3 className="font-semibold">Blood Stock by Group & Component</h3></div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Blood Group</th><th>Component</th><th className="text-center">Available</th><th className="text-center">Reserved</th><th className="text-center">Expired</th><th className="text-center">Pending Screen</th></tr></thead>
            <tbody>
              {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">No blood stock</td></tr>
              : rows.map((r, i) => (
                <tr key={i}>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[r.blood_group] ?? 'badge-neutral'}`}>{r.blood_group}</span></td>
                  <td className="text-sm">{r.component.replace('_', ' ')}</td>
                  <td className="text-center font-bold text-green-600">{r.available}</td>
                  <td className="text-center text-blue-600">{r.reserved}</td>
                  <td className="text-center text-red-500">{r.expired}</td>
                  <td className="text-center text-gray-500">{r.pending_screening}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Donors Tab ──────────────────────────────────────────── */
function DonorsTab() {
  const [items, setItems] = useState<Donor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [bgFilter, setBgFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ donor_name: '', blood_group: 'O+', donor_type: 'voluntary', gender: 'Male', phone: '', age: '', weight_kg: '', hemoglobin: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (bgFilter) params.blood_group = bgFilter;
      const { data } = await axios.get('/api/blood-bank/donors', { params, headers: authHeader() });
      setItems(data?.data ?? []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [search, bgFilter]);
  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/blood-bank/donors', { ...form, age: form.age ? Number(form.age) : undefined, weight_kg: form.weight_kg ? Number(form.weight_kg) : undefined, hemoglobin: form.hemoglobin ? Number(form.hemoglobin) : undefined }, { headers: authHeader() });
      toast.success(t('inventory.donor_registered')); setShowForm(false); load();
    } catch { toast.error(t('inventory.failed')); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <input className="input flex-1 min-w-48" placeholder={t("common.search_donors")} value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input w-28" value={bgFilter} onChange={e => setBgFilter(e.target.value)}>
          <option value="">All Groups</option>
          {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Add Donor</button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Name</th><th>Group</th><th>Type</th><th>Gender/Age</th><th>Phone</th><th>Last Donation</th><th>Total</th><th>Eligible</th></tr></thead>
            <tbody>
              {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">No donors</td></tr>
              : items.map(d => (
                <tr key={d.id}>
                  <td className="font-medium">{d.donor_name}</td>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[d.blood_group] ?? ''}`}>{d.blood_group}</span></td>
                  <td className="text-xs badge-neutral">{d.donor_type}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{d.gender ?? '—'}{d.age ? `, ${d.age}y` : ''}</td>
                  <td className="text-sm">{d.phone ?? '—'}</td>
                  <td className="text-sm">{d.last_donation_date?.slice(0, 10) ?? 'Never'}</td>
                  <td className="font-data text-center">{d.total_donations}</td>
                  <td>{d.is_eligible ? <CheckCircle className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-red-400" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <Modal title="Register Blood Donor" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('common.name_')}</label><input className="input w-full" required value={form.donor_name} onChange={e => setForm({...form, donor_name: e.target.value})} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">{t('common.blood_group_')}</label><select className="input w-full" value={form.blood_group} onChange={e => setForm({...form, blood_group: e.target.value})}>{BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}</select></div>
              <div><label className="label">{t('common.gender')}</label><select className="input w-full" value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}><option>Male</option><option>Female</option><option>Other</option></select></div>
              <div><label className="label">{t('common.age')}</label><input className="input w-full" type="number" value={form.age} onChange={e => setForm({...form, age: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('common.phone')}</label><input className="input w-full" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
              <div><label className="label">{t('common.weight_kg')}</label><input className="input w-full" type="number" value={form.weight_kg} onChange={e => setForm({...form, weight_kg: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Register'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Donations Tab ───────────────────────────────────────── */
function DonationsTab() {
  const [items, setItems] = useState<Donation[]>([]);
  const [loading, setLoading] = useState(true);
  const [bgFilter, setBgFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (bgFilter) params.blood_group = bgFilter;
      if (statusFilter) params.status = statusFilter;
      const { data } = await axios.get('/api/blood-bank/donations', { params, headers: authHeader() });
      setItems(data?.data ?? []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [bgFilter, statusFilter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <select className="input w-28" value={bgFilter} onChange={e => setBgFilter(e.target.value)}>
          <option value="">All Groups</option>{BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}
        </select>
        <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="in_stock">In Stock</option><option value="issued">Issued</option>
          <option value="expired">Expired</option><option value="quarantine">Quarantine</option>
        </select>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Bag #</th><th>Donor</th><th>Group</th><th>Component</th><th>Vol</th><th>Collected</th><th>Expiry</th><th>Screening</th><th>Status</th></tr></thead>
            <tbody>
              {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-[var(--color-text-muted)]">No donations</td></tr>
              : items.map(d => (
                <tr key={d.id}>
                  <td className="font-mono text-xs font-medium">{d.bag_number}</td>
                  <td className="text-sm">{d.donor_name ?? '—'}</td>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[d.blood_group] ?? ''}`}>{d.blood_group}</span></td>
                  <td className="text-xs">{d.component.replace('_', ' ')}</td>
                  <td className="font-data text-sm">{d.volume_ml}ml</td>
                  <td className="text-xs">{d.collection_date?.slice(0, 10)}</td>
                  <td className="text-xs">{d.expiry_date?.slice(0, 10)}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SCREEN_BADGE[d.screening_status] ?? ''}`}>{d.screening_status}</span></td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[d.status] ?? 'badge-neutral'}`}>{d.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Cross-Match Tab ─────────────────────────────────────── */
function CrossMatchTab() {
  const [items, setItems] = useState<CrossMatch[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get('/api/blood-bank/cross-match', { headers: authHeader() }); setItems(data?.data ?? []); }
    catch { setItems([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Patient</th><th>Blood Group</th><th>Component</th><th>Units</th><th>Urgency</th><th>Compatibility</th><th>Bag #</th><th>Status</th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">No cross-match requests</td></tr>
              : items.map(cm => (
                <tr key={cm.id}>
                  <td><span className="font-medium">{cm.patient_name ?? '—'}</span><br /><span className="text-xs text-[var(--color-text-muted)]">{cm.patient_code}</span></td>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[cm.patient_blood_group] ?? ''}`}>{cm.patient_blood_group}</span></td>
                  <td className="text-xs">{cm.requested_component.replace('_', ' ')}</td>
                  <td className="font-data text-center">{cm.units_requested}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_BADGE[cm.urgency] ?? ''}`}>{cm.urgency}</span></td>
                  <td>{cm.compatibility_result ? <span className={cm.compatibility_result === 'compatible' ? 'text-green-600 font-medium text-xs' : 'text-red-600 font-medium text-xs'}>{cm.compatibility_result}</span> : <span className="text-xs text-[var(--color-text-muted)]">Pending</span>}</td>
                  <td className="font-mono text-xs">{cm.bag_number ?? '—'}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[cm.status] ?? 'badge-neutral'}`}>{cm.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Transfusions Tab ────────────────────────────────────── */
function TransfusionsTab() {
  const [items, setItems] = useState<Transfusion[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get('/api/blood-bank/transfusions', { headers: authHeader() }); setItems(data?.data ?? []); }
    catch { setItems([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const REACTION_BADGE: Record<string, string> = { none: 'badge-success', mild: 'badge-warning', moderate: 'bg-orange-100 text-orange-700', severe: 'bg-red-100 text-red-700', fatal: 'bg-red-200 text-red-800' };

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Patient</th><th>Bag #</th><th>Group</th><th>Component</th><th>Issued At</th><th>Status</th><th>Reaction</th></tr></thead>
            <tbody>
              {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
              : items.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">No transfusions recorded</td></tr>
              : items.map(t => (
                <tr key={t.id}>
                  <td className="font-medium">{t.patient_name ?? '—'}</td>
                  <td className="font-mono text-xs">{t.bag_number}</td>
                  <td><span className={`px-2 py-0.5 rounded text-xs font-bold ${BG_COLOR[t.blood_group] ?? ''}`}>{t.blood_group}</span></td>
                  <td className="text-xs">{t.component.replace('_', ' ')}</td>
                  <td className="text-xs">{t.issued_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[t.status] ?? 'badge-neutral'}`}>{t.status.replace('_', ' ')}</span></td>
                  <td>{t.reaction_type ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REACTION_BADGE[t.reaction_type] ?? ''}`}>{t.reaction_type}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Tab Map ─────────────────────────────────────────────── */
const TAB_INFO: Record<Tab, { label: string; icon: typeof Droplets }> = {
  stock: { label: 'Blood Stock', icon: Droplets },
  donors: { label: 'Donors', icon: Users },
  donations: { label: 'Donations', icon: Heart },
  'cross-match': { label: 'Cross-Match', icon: FlaskConical },
  transfusions: { label: 'Transfusions', icon: Syringe },
};
const TAB_COMPONENT: Record<Tab, React.ComponentType> = {
  stock: StockTab, donors: DonorsTab, donations: DonationsTab,
  'cross-match': CrossMatchTab, transfusions: TransfusionsTab,
};

/* ─── Main Page ───────────────────────────────────────────── */
export default function BloodBankManagement({ role }: { role?: string }) {
  const [tab, setTab] = useState<Tab>('stock');
  const Content = TAB_COMPONENT[tab];

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Droplets className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Blood Bank</h1>
              <p className="section-subtitle">Donor registry, stock, cross-match & transfusion tracking</p>
            </div>
          </div>
        </div>

        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(t => {
            const info = TAB_INFO[t];
            const Icon = info.icon;
            return (
              <button key={t} onClick={() => setTab(t)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}>
                <Icon className="w-4 h-4" />{info.label}
              </button>
            );
          })}
        </div>

        <Content />
      </div>
    </DashboardLayout>
  );
}
