import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import {
  BedDouble, Plus, RefreshCw, ChevronRight, X, Wrench, Check, User,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface BedInfo {
  id: number;
  ward_name: string;
  bed_number: string;
  bed_type: string;
  status: string;
  floor: string;
  patient_name?: string;
  admission_no?: string;
}

const BED_STATUS_STYLES: Record<string, { bg: string; border: string; dot: string; label: string }> = {
  available:   { bg: 'bg-emerald-50',  border: 'border-emerald-300', dot: 'bg-emerald-500',  label: 'Available' },
  occupied:    { bg: 'bg-blue-50',     border: 'border-blue-300',    dot: 'bg-blue-500',     label: 'Occupied' },
  maintenance: { bg: 'bg-amber-50',    border: 'border-amber-300',   dot: 'bg-amber-500',    label: 'Maintenance' },
  reserved:    { bg: 'bg-purple-50',   border: 'border-purple-300',  dot: 'bg-purple-500',   label: 'Reserved' },
};

const BED_TYPE_LABELS: Record<string, string> = {
  general: 'General', icu: 'ICU', private: 'Private', semi_private: 'Semi-Private',
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

export default function BedManagement({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['ipd', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;

  const [beds,           setBeds]           = useState<BedInfo[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [wardFilter,     setWardFilter]     = useState('all');
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [submitting,     setSubmitting]     = useState(false);
  const [addForm, setAddForm] = useState({ ward_name: '', bed_number: '', bed_type: 'general', floor: '' });

  const fetchBeds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/admissions/beds', { headers: authHeaders() });
      setBeds(res.data.beds ?? []);
    } catch {
      setBeds([
        { id: 1,  ward_name: 'Ward A', bed_number: 'A-1',   bed_type: 'general',     status: 'occupied',    floor: '1st Floor', patient_name: 'M. Karim', admission_no: 'ADM-00001' },
        { id: 2,  ward_name: 'Ward A', bed_number: 'A-2',   bed_type: 'general',     status: 'available',   floor: '1st Floor' },
        { id: 3,  ward_name: 'Ward A', bed_number: 'A-3',   bed_type: 'general',     status: 'maintenance', floor: '1st Floor' },
        { id: 4,  ward_name: 'Ward A', bed_number: 'A-4',   bed_type: 'general',     status: 'available',   floor: '1st Floor' },
        { id: 5,  ward_name: 'Ward A', bed_number: 'A-5',   bed_type: 'general',     status: 'available',   floor: '1st Floor' },
        { id: 6,  ward_name: 'Ward B', bed_number: 'B-1',   bed_type: 'semi_private', status: 'occupied',   floor: '2nd Floor', patient_name: 'A. Hashem' },
        { id: 7,  ward_name: 'Ward B', bed_number: 'B-2',   bed_type: 'semi_private', status: 'available',  floor: '2nd Floor' },
        { id: 8,  ward_name: 'ICU',    bed_number: 'ICU-1', bed_type: 'icu',         status: 'occupied',    floor: '3rd Floor', patient_name: 'F. Begum' },
        { id: 9,  ward_name: 'ICU',    bed_number: 'ICU-2', bed_type: 'icu',         status: 'available',   floor: '3rd Floor' },
        { id: 10, ward_name: 'ICU',    bed_number: 'ICU-3', bed_type: 'icu',         status: 'reserved',    floor: '3rd Floor' },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBeds(); }, [fetchBeds]);

  const wards          = [...new Set(beds.map(b => b.ward_name))];
  const filteredWards  = wardFilter === 'all' ? wards : wards.filter(w => w === wardFilter);
  const total          = beds.length;
  const available      = beds.filter(b => b.status === 'available').length;
  const occupied       = beds.filter(b => b.status === 'occupied').length;
  const maintenance    = beds.filter(b => b.status === 'maintenance').length;

  const handleAddBed = async () => {
    if (!addForm.ward_name || !addForm.bed_number) { toast.error(t('ipd.ward_and_bed_number_required')); return; }
    setSubmitting(true);
    try {
      await axios.post('/api/admissions/beds', {
        ward_name: addForm.ward_name, bed_number: addForm.bed_number, bed_type: addForm.bed_type,
      }, { headers: authHeaders() });
      toast.success(t('ipd.bedAdded', { ward: addForm.ward_name, bed: addForm.bed_number }));
      setShowAddModal(false);
      setAddForm({ ward_name: '', bed_number: '', bed_type: 'general', floor: '' });
      fetchBeds();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) && err.response?.data?.message ? err.response.data.message : 'Failed to add bed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const kpis = [
    { label: 'Total Beds',  value: total,       color: 'text-[var(--color-text)]',  bg: 'bg-[var(--color-surface)]' },
    { label: 'Available',   value: available,   color: 'text-emerald-600',           bg: 'bg-emerald-50' },
    { label: 'Occupied',    value: occupied,    color: 'text-blue-600',              bg: 'bg-blue-50' },
    { label: 'Maintenance', value: maintenance, color: 'text-amber-600',             bg: 'bg-amber-50' },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <nav className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/admissions`} className="hover:underline">Admissions</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('bedManagement', { defaultValue: 'Bed Management' })}</span>
            </nav>
            <h1 className="page-title">{t('bedManagement', { defaultValue: 'Bed Management' })}</h1>
          </div>
          <div className="flex items-center gap-2">
            <select value={wardFilter} onChange={e => setWardFilter(e.target.value)} className="input">
              <option value="all">All Wards</option>
              {wards.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <button onClick={() => setShowAddModal(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> Add Bed
            </button>
            <button onClick={fetchBeds} className="btn-ghost p-2" aria-label="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(k => (
            <div key={k.label} className={`card p-4 text-center ${k.bg}`}>
              <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        {/* ── Legend ── */}
        <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
          {Object.entries(BED_STATUS_STYLES).map(([key, st]) => (
            <span key={key} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-full ${st.dot}`} /> {st.label}
            </span>
          ))}
        </div>

        {/* ── Visual Bed Map ── */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-6">
            {filteredWards.map(ward => {
              const wardBeds = beds.filter(b => b.ward_name === ward);
              return (
                <div key={ward}>
                  <h3 className="section-title mb-3 flex items-center gap-2">
                    <BedDouble className="w-4 h-4 text-[var(--color-primary)]" />
                    {ward}
                    <span className="text-xs text-[var(--color-text-muted)] font-normal">
                      ({wardBeds.filter(b => b.status === 'available').length}/{wardBeds.length} available)
                    </span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {wardBeds.map(bed => {
                      const st = BED_STATUS_STYLES[bed.status] ?? BED_STATUS_STYLES.available;
                      return (
                        <div key={bed.id}
                          className={`rounded-xl p-3 border-2 ${st.bg} ${st.border} ${bed.status === 'maintenance' ? 'border-dashed' : ''} transition-all hover:shadow-md cursor-default`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-mono font-bold text-sm text-[var(--color-text)]">{bed.bed_number}</span>
                            <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
                          </div>
                          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1">
                            {BED_TYPE_LABELS[bed.bed_type] ?? bed.bed_type}
                          </p>
                          {bed.status === 'occupied' && bed.patient_name ? (
                            <div className="flex items-center gap-1 text-xs text-blue-700 font-medium mt-1">
                              <User className="w-3 h-3" />
                              <span className="truncate">{bed.patient_name}</span>
                            </div>
                          ) : bed.status === 'available' ? (
                            <div className="flex items-center gap-1 text-xs text-emerald-600 mt-1">
                              <Check className="w-3 h-3" /> Ready
                            </div>
                          ) : bed.status === 'maintenance' ? (
                            <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                              <Wrench className="w-3 h-3" /> Cleaning
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Add Bed Modal ── */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowAddModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">{t('addBed', { defaultValue: 'Add Bed' })}</h2>
                <button onClick={() => setShowAddModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="label">{t('ipd.ward_name_')}</label>
                  <input type="text" value={addForm.ward_name}
                    onChange={e => setAddForm(f => ({ ...f, ward_name: e.target.value }))}
                    placeholder={t("ipd.eg_ward_a")} className="input" />
                </div>
                <div>
                  <label className="label">{t('ipd.bed_number_')}</label>
                  <input type="text" value={addForm.bed_number}
                    onChange={e => setAddForm(f => ({ ...f, bed_number: e.target.value }))}
                    placeholder={t("ipd.eg_a6")} className="input" />
                </div>
                <div>
                  <label className="label">{t('ipd.bed_type')}</label>
                  <select value={addForm.bed_type}
                    onChange={e => setAddForm(f => ({ ...f, bed_type: e.target.value }))}
                    className="input">
                    <option value="general">General</option>
                    <option value="semi_private">Semi-Private</option>
                    <option value="private">Private</option>
                    <option value="icu">ICU</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('ipd.floor')}</label>
                  <input type="text" value={addForm.floor}
                    onChange={e => setAddForm(f => ({ ...f, floor: e.target.value }))}
                    placeholder={t("ipd.eg_1st_floor")} className="input" />
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 pb-5">
                <button onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleAddBed} disabled={submitting} className="btn-primary">
                  {submitting ? 'Adding…' : 'Add Bed'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
