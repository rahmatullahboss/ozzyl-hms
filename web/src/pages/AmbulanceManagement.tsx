import { useState } from 'react';
import { Ambulance, Plus, X, RefreshCw, MapPin, Clock, CheckCircle, Truck, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';

interface Vehicle { id: number; vehicle_number: string; vehicle_type: string; make_model?: string; driver_name?: string; driver_phone?: string; current_status: string; insurance_expiry?: string; fitness_expiry?: string; }
interface Trip { id: number; trip_number: string; vehicle_number?: string; vehicle_type?: string; patient_name?: string; trip_type: string; urgency: string; pickup_location: string; drop_location?: string; status: string; dispatched_at?: string; driver_name?: string; distance_km?: number; fare_amount?: number; }
interface Stats { vehicles: { total: number; available: number; on_trip: number; maintenance: number }; today_trips: number; active_trips: number; }

const V_STATUS: Record<string, string> = { available: 'badge-success', on_trip: 'bg-blue-100 text-blue-700', maintenance: 'badge-warning', out_of_service: 'bg-red-100 text-red-700' };
const T_STATUS: Record<string, string> = { dispatched: 'bg-gray-100 text-gray-600', en_route: 'bg-blue-100 text-blue-700', arrived: 'bg-cyan-100 text-cyan-700', patient_loaded: 'bg-amber-100 text-amber-700', in_transit: 'bg-purple-100 text-purple-700', completed: 'badge-success', cancelled: 'badge-neutral' };
const URGENCY_BADGE: Record<string, string> = { routine: 'badge-neutral', urgent: 'badge-warning', emergency: 'bg-red-100 text-red-700' };
const TRIP_TYPES = ['emergency_pickup','hospital_transfer','discharge_drop','dead_body','referral','other'];
const STATUS_FLOW: Record<string, string> = { dispatched: 'en_route', en_route: 'arrived', arrived: 'patient_loaded', patient_loaded: 'in_transit', in_transit: 'completed' };
const TABS = ['active', 'trips', 'vehicles'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm"><div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto"><div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div><div className="p-5 space-y-4">{children}</div></div></div>);
}

function ActiveTab() {
  const { t } = useTranslation(['ambulance', 'common']);
  const queryClient = useQueryClient();

  const { data: tripsData, isLoading: loading } = useApiQuery<{ data?: Trip[] }>(
    queryKeys.ambulance.active(),
    '/api/ambulance/active',
    { refetchInterval: 30000 },
  );
  const trips = tripsData?.data ?? [];

  const { data: statsData } = useApiQuery<Stats>(
    queryKeys.ambulance.stats(),
    '/api/ambulance/stats',
    { refetchInterval: 30000 },
  );
  const stats = statsData ?? null;

  const advanceMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    (vars) => `/api/ambulance/trips/${vars.id}/status`,
    {
      onSuccess: (_data, vars) => {
        toast.success(t('statusAdvanced', { status: vars.status.replace('_', ' ') }));
        queryClient.invalidateQueries({ queryKey: queryKeys.ambulance.all });
      },
      onError: () => { toast.error(t('failed', { ns: 'common' })); },
    },
  );

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.ambulance.active() });
    queryClient.invalidateQueries({ queryKey: queryKeys.ambulance.stats() });
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { l: t('totalVehicles'), v: stats.vehicles.total ?? 0 },
            { l: t('available'), v: stats.vehicles.available ?? 0, c: 'text-green-600' },
            { l: t('onTrip'), v: stats.vehicles.on_trip ?? 0, c: 'text-blue-600' },
            { l: t('todayTrips'), v: stats.today_trips },
            { l: t('activeNow'), v: stats.active_trips, c: 'text-amber-600' },
          ].map(k => <div key={k.l} className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{k.l}</p><p className={`text-2xl font-bold mt-1 ${k.c ?? ''}`}>{k.v}</p></div>)}
        </div>
      )}
      <div className="flex justify-end"><button onClick={refetch} className="btn-ghost"><RefreshCw className="w-4 h-4" /> {t('refresh', { ns: 'common' })}</button></div>
      {loading ? <div className="card p-8 text-center text-[var(--color-text-muted)]">{t('loading', { ns: 'common' })}</div>
      : trips.length === 0 ? <div className="card p-12 text-center"><Ambulance className="w-10 h-10 mx-auto text-[var(--color-text-muted)] mb-2 opacity-30" /><p className="text-[var(--color-text-muted)]">{t('noActiveTrips')}</p></div>
      : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{trips.map((trip) => {
        const next = STATUS_FLOW[trip.status];
        return (
          <div key={trip.id} className={`card p-4 border-l-4 ${trip.urgency === 'emergency' ? 'border-l-red-500' : trip.urgency === 'urgent' ? 'border-l-amber-400' : 'border-l-blue-400'}`}>
            <div className="flex items-start justify-between mb-2">
              <div><span className="font-mono font-bold text-[var(--color-primary)]">{trip.trip_number}</span><span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_BADGE[trip.urgency] ?? ''}`}>{trip.urgency}</span></div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${T_STATUS[trip.status] ?? ''}`}>{trip.status.replace('_', ' ')}</span>
            </div>
            <p className="text-sm font-medium">{trip.patient_name ?? t('noPatient')}</p>
            <p className="text-xs text-[var(--color-text-muted)]"><MapPin className="w-3 h-3 inline" /> {trip.pickup_location}{trip.drop_location ? ` → ${trip.drop_location}` : ''}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1"><Truck className="w-3 h-3 inline" /> {trip.vehicle_number ?? '—'} · {trip.driver_name ?? '—'}</p>
            {next && <button onClick={() => advanceMutation.mutate({ id: trip.id, status: next })} className="btn-primary text-xs mt-3 w-full">→ {next.replace('_', ' ')}</button>}
          </div>
        );
      })}</div>}
    </div>
  );
}

function TripsTab() {
  const { t } = useTranslation(['ambulance', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ vehicle_id: '', patient_name: '', trip_type: 'emergency_pickup', urgency: 'routine', pickup_location: '', drop_location: '', driver_name: '', remarks: '' });

  const { data: tripsData, isLoading: loading } = useApiQuery<{ data?: Trip[] }>(
    queryKeys.ambulance.trips(),
    '/api/ambulance/trips',
  );
  const items = tripsData?.data ?? [];

  const { data: vehiclesData } = useApiQuery<{ data?: Vehicle[] }>(
    queryKeys.ambulance.vehicles(),
    '/api/ambulance/vehicles',
  );
  const vehicles = vehiclesData?.data ?? [];

  const createMutation = useApiMutation<unknown, Omit<typeof form, 'vehicle_id'> & { vehicle_id: number }>(
    'post',
    '/api/ambulance/trips',
    {
      onSuccess: () => {
        toast.success(t('tripDispatched'));
        setShowForm(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.ambulance.all });
      },
      onError: () => { toast.error(t('failed', { ns: 'common' })); },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.vehicle_id) { toast.error(t('selectVehicle', { ns: 'ambulance' })); return; }
    createMutation.mutate({ ...form, vehicle_id: Number(form.vehicle_id) });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('dispatchTrip')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('tripNumber', { defaultValue: 'Trip #' })}</th><th>{t('vehicle')}</th><th>{t('patientName')}</th><th>{t('tripType')}</th><th>{t('urgency')}</th><th>{t('fromTo', { defaultValue: 'From → To' })}</th><th>{t('status')}</th><th>{t('dispatched', { defaultValue: 'Dispatched' })}</th></tr></thead><tbody>
        {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">{t('noTrips')}</td></tr>
        : items.map(t => (
          <tr key={t.id}>
            <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{t.trip_number}</td>
            <td className="text-sm">{t.vehicle_number ?? '—'}</td>
            <td className="text-sm font-medium">{t.patient_name ?? '—'}</td>
            <td className="text-xs"><span className="badge-neutral">{t.trip_type.replace('_', ' ')}</span></td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_BADGE[t.urgency] ?? ''}`}>{t.urgency}</span></td>
            <td className="text-xs text-[var(--color-text-muted)] max-w-40 truncate">{t.pickup_location}{t.drop_location ? ` → ${t.drop_location}` : ''}</td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${T_STATUS[t.status] ?? ''}`}>{t.status.replace('_', ' ')}</span></td>
            <td className="text-xs">{t.dispatched_at?.slice(0, 16).replace('T', ' ')}</td>
          </tr>
        ))}
      </tbody></table></div></div>
      {showForm && (
        <Modal title={t('dispatchAmbulance')} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('vehicle')} *</label><select className="input w-full" value={form.vehicle_id} onChange={e => setForm({...form, vehicle_id: e.target.value})}><option value="">{t('selectVehicle')}</option>{vehicles.filter(v => v.current_status === 'available').map(v => <option key={v.id} value={v.id}>{v.vehicle_number} ({v.vehicle_type})</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('tripType')} *</label><select className="input w-full" value={form.trip_type} onChange={e => setForm({...form, trip_type: e.target.value})}>{TRIP_TYPES.map(tt => <option key={tt} value={tt}>{t(tt, { defaultValue: tt.replace('_', ' ') })}</option>)}</select></div>
              <div><label className="label">{t('urgency')}</label><select className="input w-full" value={form.urgency} onChange={e => setForm({...form, urgency: e.target.value})}><option value="routine">{t('routine')}</option><option value="urgent">{t('urgent')}</option><option value="emergency">{t('emergency')}</option></select></div>
            </div>
            <div><label className="label">{t('patientName')}</label><input className="input w-full" value={form.patient_name} onChange={e => setForm({...form, patient_name: e.target.value})} /></div>
            <div><label className="label">{t('pickupLocation')} *</label><input className="input w-full" required value={form.pickup_location} onChange={e => setForm({...form, pickup_location: e.target.value})} placeholder={t('pickupPlaceholder')} /></div>
            <div><label className="label">{t('dropLocation')}</label><input className="input w-full" value={form.drop_location} onChange={e => setForm({...form, drop_location: e.target.value})} /></div>
            <div><label className="label">{t('driver')}</label><input className="input w-full" value={form.driver_name} onChange={e => setForm({...form, driver_name: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('dispatching') : t('dispatch')}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function VehiclesTab() {
  const { t } = useTranslation(['ambulance', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ vehicle_number: '', vehicle_type: 'basic', make_model: '', driver_name: '', driver_phone: '' });

  const { data: vehiclesData, isLoading: loading } = useApiQuery<{ data?: Vehicle[] }>(
    queryKeys.ambulance.vehicles(),
    '/api/ambulance/vehicles',
  );
  const items = vehiclesData?.data ?? [];

  const createMutation = useApiMutation<unknown, typeof form>(
    'post',
    '/api/ambulance/vehicles',
    {
      onSuccess: () => {
        toast.success(t('vehicleAdded'));
        setShowForm(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.ambulance.all });
      },
      onError: () => { toast.error(t('failed', { ns: 'common' })); },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('addVehicle')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('vehicleNumber')}</th><th>{t('type')}</th><th>{t('makeModel', { defaultValue: 'Make/Model' })}</th><th>{t('driver')}</th><th>{t('driverPhone')}</th><th>{t('status')}</th></tr></thead><tbody>
        {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('noVehicles')}</td></tr>
        : items.map(v => (
          <tr key={v.id}>
            <td className="font-mono font-bold">{v.vehicle_number}</td>
            <td className="text-xs"><span className="badge-neutral">{v.vehicle_type}</span></td>
            <td className="text-sm">{v.make_model ?? '—'}</td>
            <td className="text-sm">{v.driver_name ?? '—'}</td>
            <td className="text-sm">{v.driver_phone ?? '—'}</td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${V_STATUS[v.current_status] ?? ''}`}>{v.current_status.replace('_', ' ')}</span></td>
          </tr>
        ))}
      </tbody></table></div></div>
      {showForm && (
        <Modal title={t('addVehicleTitle')} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('vehicleNumber')} *</label><input className="input w-full" required value={form.vehicle_number} onChange={e => setForm({...form, vehicle_number: e.target.value})} /></div>
              <div><label className="label">{t('type')}</label><select className="input w-full" value={form.vehicle_type} onChange={e => setForm({...form, vehicle_type: e.target.value})}><option value="basic">{t('basic')}</option><option value="advanced">{t('advanced')}</option><option value="icu">{t('icu')}</option><option value="neonatal">{t('neonatal')}</option><option value="patient_transport">{t('patientTransport')}</option></select></div>
            </div>
            <div><label className="label">{t('makeModel', { defaultValue: 'Make/Model' })}</label><input className="input w-full" value={form.make_model} onChange={e => setForm({...form, make_model: e.target.value})} placeholder={t('makeModelPlaceholder')} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('driver')}</label><input className="input w-full" value={form.driver_name} onChange={e => setForm({...form, driver_name: e.target.value})} /></div>
              <div><label className="label">{t('driverPhone')}</label><input className="input w-full" value={form.driver_phone} onChange={e => setForm({...form, driver_phone: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('saving') : t('add')}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function AmbulanceManagement({ role }: { role?: string }) {
  const { t } = useTranslation(['ambulance', 'common']);
  const [tab, setTab] = useState<Tab>('active');
  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/20"><Ambulance className="w-5 h-5 text-white" /></div>
          <div><h1 className="page-title">{t('title')}</h1><p className="section-subtitle">{t('subtitle')}</p></div>
        </div></div>
        <div className="card p-1.5 flex gap-1">{TABS.map(tb => (<button key={tb} onClick={() => setTab(tb)} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === tb ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{t(tb === 'active' ? 'activeTrips' : tb === 'trips' ? 'allTrips' : 'vehicles')}</button>))}</div>
        {tab === 'active' && <ActiveTab />}{tab === 'trips' && <TripsTab />}{tab === 'vehicles' && <VehiclesTab />}
      </div>
    </DashboardLayout>
  );
}
