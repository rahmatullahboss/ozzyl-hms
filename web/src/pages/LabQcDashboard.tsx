import React, { useState } from 'react';
import {
  FlaskConical, Activity, Plus, Trash2, AlertTriangle, Calendar, Clock,
  CheckCircle, XCircle, SlidersHorizontal, LineChart, RefreshCw,
  Gauge, BarChart3,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { apiFetch } from '../lib/apiClient';

interface QCControl {
  id: number;
  control_name: string;
  control_code: string;
  control_lot?: string;
  manufacturer?: string;
  expiry_date?: string;
}

interface QCRange {
  id: number;
  control_id: number;
  control_name: string;
  control_code: string;
  lab_test_id: number;
  test_name: string;
  test_code: string;
  mean_value: number;
  sd_value: number;
  range_low: number;
  range_high: number;
  qc_level: number;
}

interface QCResult {
  id: number;
  control_id: number;
  lab_test_id: number;
  result_value: number;
  run_date: string;
  run_number?: number;
  is_out_of_range: number;
  westgard_violations?: string;
  action_taken?: string;
  created_at: string;
}

interface Calibration {
  id: number;
  machine_id: number;
  machine_name: string;
  calibration_type: string;
  scheduled_date: string;
  next_due_date?: string;
  performed_date?: string;
  result_status: string;
  notes?: string;
}

type Tab = 'controls' | 'ranges' | 'results' | 'calibrations';

export default function LabQcDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['laboratory', 'common']);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('controls');

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'controls', label: t('qc.controls', 'QC Controls'), icon: <FlaskConical className="w-4 h-4" /> },
    { key: 'ranges', label: t('qc.ranges', 'QC Ranges'), icon: <SlidersHorizontal className="w-4 h-4" /> },
    { key: 'results', label: t('qc.results', 'QC Results'), icon: <LineChart className="w-4 h-4" /> },
    { key: 'calibrations', label: t('qc.calibrations', 'Calibrations'), icon: <Gauge className="w-4 h-4" /> },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('qc.title', 'Lab QC & Calibrations')}</h1>
              <p className="section-subtitle">{t('qc.subtitle', 'Quality control, Westgard rules, and machine calibrations')}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto border-b border-gray-100 dark:border-gray-800 p-2 hide-scrollbar">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-teal-50 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'controls' && <QCControlsTab />}
        {activeTab === 'ranges' && <QCRangesTab />}
        {activeTab === 'results' && <QCResultsTab />}
        {activeTab === 'calibrations' && <CalibrationsTab />}
      </div>
    </DashboardLayout>
  );
}

/* ─────────────────── QC Controls Tab ─────────────────── */

function QCControlsTab() {
  const { t } = useTranslation(['laboratory', 'common']);
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ control_name: '', control_code: '', control_lot: '', manufacturer: '', expiry_date: '' });

  const { data, isLoading } = useApiQuery<{ data: QCControl[] }>(
    queryKeys.labQc.controls(),
    '/api/lab-monitoring/qc/controls',
  );

  const deleteMutation = useApiMutation('delete', (id: number) => `/api/lab-monitoring/qc/controls/${id}`, {
    onSuccess: () => {
      toast.success('Control removed');
      queryClient.invalidateQueries({ queryKey: queryKeys.labQc.controls() });
    },
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/lab-monitoring/qc/controls', { method: 'POST', body: form });
      toast.success('QC control added');
      setShowAdd(false);
      setForm({ control_name: '', control_code: '', control_lot: '', manufacturer: '', expiry_date: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.labQc.controls() });
    } catch (err: any) {
      toast.error(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const controls = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{t('qc.controls', 'QC Controls')}</h2>
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('qc.addControl', 'Add Control')}</button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card p-4 border border-teal-100 dark:border-teal-900/30 bg-teal-50/50 dark:bg-teal-900/10 space-y-3">
          <h3 className="font-medium text-teal-900 dark:text-teal-300">{t('qc.newControl', 'New QC Control')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="label text-xs">{t('qc.controlName', 'Control Name')} *</label><input required value={form.control_name} onChange={e => setForm({ ...form, control_name: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">{t('qc.controlCode', 'Control Code')} *</label><input required value={form.control_code} onChange={e => setForm({ ...form, control_code: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">{t('qc.controlLot', 'Lot #')}</label><input value={form.control_lot} onChange={e => setForm({ ...form, control_lot: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">{t('qc.manufacturer', 'Manufacturer')}</label><input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">{t('qc.expiryDate', 'Expiry Date')}</label><input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} className="input text-sm" /></div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost text-sm">{t('common:cancel')}</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? t('common:saving') : t('common:save')}</button>
          </div>
        </form>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead><tr><th>Name</th><th>Code</th><th>Lot</th><th>Manufacturer</th><th>Expiry</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={6} className="text-center py-4 text-gray-500">{t('common:loading')}</td></tr> :
            controls.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-gray-500"><EmptyState icon={<FlaskConical className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('qc.noControls', 'No QC controls')} description="" /></td></tr> :
            controls.map(c => (
              <tr key={c.id}>
                <td className="font-medium">{c.control_name}</td><td>{c.control_code}</td><td>{c.control_lot || '-'}</td><td>{c.manufacturer || '-'}</td>
                <td>{c.expiry_date || '-'}</td>
                <td className="text-right">
                  <button onClick={() => deleteMutation.mutate(c.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────── QC Ranges Tab ─────────────────── */

function QCRangesTab() {
  const { t } = useTranslation(['laboratory', 'common']);
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ control_id: '', lab_test_id: '', mean_value: '', sd_value: '', qc_level: '1' });

  const { data, isLoading } = useApiQuery<{ data: QCRange[] }>(
    queryKeys.labQc.ranges(),
    '/api/lab-monitoring/qc/ranges',
  );

  const deleteMutation = useApiMutation('delete', (id: number) => `/api/lab-monitoring/qc/ranges/${id}`, {
    onSuccess: () => { toast.success('Range removed'); queryClient.invalidateQueries({ queryKey: queryKeys.labQc.ranges() }); },
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/lab-monitoring/qc/ranges', {
        method: 'POST',
        body: {
          control_id: Number(form.control_id),
          lab_test_id: Number(form.lab_test_id),
          mean_value: Number(form.mean_value),
          sd_value: Number(form.sd_value),
          qc_level: Number(form.qc_level),
        },
      });
      toast.success('QC range added');
      setShowAdd(false);
      setForm({ control_id: '', lab_test_id: '', mean_value: '', sd_value: '', qc_level: '1' });
      queryClient.invalidateQueries({ queryKey: queryKeys.labQc.ranges() });
    } catch (err: any) { toast.error(err?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const ranges = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{t('qc.ranges', 'QC Ranges')}</h2>
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('qc.addRange', 'Add Range')}</button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card p-4 border border-teal-100 dark:border-teal-900/30 bg-teal-50/50 dark:bg-teal-900/10 space-y-3">
          <h3 className="font-medium text-teal-900 dark:text-teal-300">{t('qc.newRange', 'New QC Range')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="label text-xs">Control ID *</label><input required type="number" value={form.control_id} onChange={e => setForm({ ...form, control_id: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">Test ID *</label><input required type="number" value={form.lab_test_id} onChange={e => setForm({ ...form, lab_test_id: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">Mean *</label><input required type="number" step="0.01" value={form.mean_value} onChange={e => setForm({ ...form, mean_value: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">SD *</label><input required type="number" step="0.01" min="0.01" value={form.sd_value} onChange={e => setForm({ ...form, sd_value: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">QC Level</label><select value={form.qc_level} onChange={e => setForm({ ...form, qc_level: e.target.value })} className="input text-sm"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost text-sm">{t('common:cancel')}</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? t('common:saving') : t('common:save')}</button>
          </div>
        </form>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead><tr><th>Control</th><th>Test</th><th>Mean</th><th>SD</th><th>Range</th><th>Level</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={7} className="text-center py-4 text-gray-500">{t('common:loading')}</td></tr> :
            ranges.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-500"><EmptyState icon={<SlidersHorizontal className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('qc.noRanges', 'No QC ranges')} description="" /></td></tr> :
            ranges.map(r => (
              <tr key={r.id}>
                <td className="font-medium">{r.control_name}</td><td>{r.test_name || `Test #${r.lab_test_id}`}</td>
                <td>{r.mean_value}</td><td>{r.sd_value}</td>
                <td className="text-xs font-mono">{r.range_low?.toFixed(2)} – {r.range_high?.toFixed(2)}</td>
                <td><span className="badge bg-gray-100 text-gray-700">{r.qc_level}</span></td>
                <td className="text-right">
                  <button onClick={() => deleteMutation.mutate(r.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────── QC Results Tab ─────────────────── */

function QCResultsTab() {
  const { t } = useTranslation(['laboratory', 'common']);
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ control_id: '', lab_test_id: '', result_value: '', run_date: new Date().toISOString().split('T')[0], action_taken: '' });
  const [result, setResult] = useState<{ westgard_violations?: string[]; is_out_of_range?: boolean } | null>(null);

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      const res = await apiFetch<{ westgard_violations: string[]; is_out_of_range: boolean; message: string }>('/api/lab-monitoring/qc/results', {
        method: 'POST',
        body: { control_id: Number(form.control_id), lab_test_id: Number(form.lab_test_id), result_value: Number(form.result_value), run_date: form.run_date || undefined, action_taken: form.action_taken || undefined },
      });
      setResult(res);
      toast.success('QC result recorded');
      setForm({ control_id: '', lab_test_id: '', result_value: '', run_date: new Date().toISOString().split('T')[0], action_taken: '' });
    } catch (err: any) { toast.error(err?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{t('qc.results', 'QC Results')}</h2>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary"><Plus className="w-4 h-4" /> {t('qc.recordResult', 'Record Result')}</button>
      </div>

      {showAdd && (
        <form onSubmit={handleRecord} className="card p-4 border border-teal-100 dark:border-teal-900/30 bg-teal-50/50 dark:bg-teal-900/10 space-y-3">
          <h3 className="font-medium text-teal-900 dark:text-teal-300">{t('qc.newResult', 'New QC Result')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="label text-xs">Control ID *</label><input required type="number" value={form.control_id} onChange={e => setForm({ ...form, control_id: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">Test ID *</label><input required type="number" value={form.lab_test_id} onChange={e => setForm({ ...form, lab_test_id: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">Result Value *</label><input required type="number" step="0.01" value={form.result_value} onChange={e => setForm({ ...form, result_value: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">Run Date</label><input type="date" value={form.run_date} onChange={e => setForm({ ...form, run_date: e.target.value })} className="input text-sm" /></div>
            <div className="md:col-span-2"><label className="label text-xs">{t('qc.actionTaken', 'Action Taken')}</label><input value={form.action_taken} onChange={e => setForm({ ...form, action_taken: e.target.value })} className="input text-sm" /></div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost text-sm">{t('common:cancel')}</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? t('common:saving') : t('qc.record', 'Record')}</button>
          </div>
        </form>
      )}

      {result && (
        <div className={`card p-4 border-2 ${result.is_out_of_range ? 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-900/10' : 'border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-900/10'}`}>
          <div className="flex items-center gap-2 mb-2">
            {result.is_out_of_range ? <XCircle className="w-5 h-5 text-red-600" /> : <CheckCircle className="w-5 h-5 text-green-600" />}
            <span className="font-semibold">{result.is_out_of_range ? t('qc.outOfRange', 'Out of Range!') : t('qc.inRange', 'Within Range')}</span>
          </div>
          {result.westgard_violations && result.westgard_violations.length > 0 && (
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">{t('qc.westgardViolations', 'Westgard Violations')}:</p>
              <ul className="list-disc list-inside text-sm text-red-600 dark:text-red-400">
                {result.westgard_violations.map((v, i) => <li key={i}>{v}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="text-sm text-gray-500">{t('qc.resultsNote', 'QC results are validated against Westgard multi-rules. Record each daily run here.')}</p>
    </div>
  );
}

/* ─────────────────── Calibrations Tab ─────────────────── */

function CalibrationsTab() {
  const { t } = useTranslation(['laboratory', 'common']);
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ machine_id: '', calibration_type: 'full', due_date: '', next_due_date: '', result_summary: '' });

  const { data: calibrations, isLoading } = useApiQuery<{ data: Calibration[] }>(
    queryKeys.labQc.calibrations(),
    '/api/lab-monitoring/calibrations',
  );

  const { data: upcoming } = useApiQuery<{ data: Calibration[]; count: number }>(
    queryKeys.labQc.upcomingCalibrations(),
    '/api/lab-monitoring/calibrations/upcoming?days=30',
  );

  const { data: overdue } = useApiQuery<{ data: Calibration[]; count: number }>(
    queryKeys.labQc.overdueCalibrations(),
    '/api/lab-monitoring/calibrations/overdue',
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/lab-monitoring/calibrations', { method: 'POST', body: { machine_id: Number(form.machine_id), calibration_type: form.calibration_type, due_date: form.due_date, next_due_date: form.next_due_date || undefined, status: 'scheduled' } });
      toast.success('Calibration scheduled');
      setShowAdd(false);
      setForm({ machine_id: '', calibration_type: 'full', due_date: '', next_due_date: '', result_summary: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.labQc.calibrations() });
    } catch (err: any) { toast.error(err?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const updateStatus = async (calId: number, status: string) => {
    try {
      await apiFetch(`/api/lab-monitoring/calibrations/${calId}`, { method: 'PUT', body: { result_status: status, performed_date: new Date().toISOString().split('T')[0] } });
      toast.success(`Calibration ${status}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.labQc.calibrations() });
    } catch (err: any) { toast.error(err?.message || 'Failed'); }
  };

  const calList = calibrations?.data ?? [];
  const upcomingList = upcoming?.data ?? [];
  const overdueList = overdue?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Alerts for overdue/upcoming */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
          <div><p className="text-2xl font-bold">{overdueList.length}</p><p className="text-xs text-gray-500">{t('qc.overdue', 'Overdue')}</p></div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center"><Clock className="w-5 h-5 text-amber-600" /></div>
          <div><p className="text-2xl font-bold">{upcomingList.length}</p><p className="text-xs text-gray-500">{t('qc.upcoming', 'Upcoming (30d)')}</p></div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center"><Activity className="w-5 h-5 text-green-600" /></div>
          <div><p className="text-2xl font-bold">{calList.filter(c => c.result_status === 'pass').length}</p><p className="text-xs text-gray-500">{t('qc.passed', 'Passed')}</p></div>
        </div>
      </div>

      {/* Overdue */}
      {overdueList.length > 0 && (
        <div className="card p-3 border-2 border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-900/10">
          <h3 className="font-semibold text-red-800 dark:text-red-300 text-sm mb-2">{t('qc.overdueCalibrations', 'Overdue Calibrations')}</h3>
          <div className="space-y-1">
            {overdueList.map(c => (
              <div key={c.id} className="flex justify-between text-sm">
                <span>{c.machine_name} - {c.calibration_type}</span>
                <span className="text-red-600">{c.scheduled_date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{t('qc.calibrationsList', 'Calibrations')}</h2>
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('qc.scheduleCalibration', 'Schedule')}</button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card p-4 border border-teal-100 dark:border-teal-900/30 bg-teal-50/50 dark:bg-teal-900/10 space-y-3">
          <h3 className="font-medium text-teal-900 dark:text-teal-300">{t('qc.newCalibration', 'Schedule Calibration')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="label text-xs">Machine ID *</label><input required type="number" value={form.machine_id} onChange={e => setForm({ ...form, machine_id: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">{t('qc.calibrationType', 'Type')}</label><select value={form.calibration_type} onChange={e => setForm({ ...form, calibration_type: e.target.value })} className="input text-sm"><option value="full">Full</option><option value="partial">Partial</option><option value="verification">Verification</option><option value="preventive_maintenance">Preventive</option></select></div>
            <div><label className="label text-xs">{t('qc.dueDate', 'Due Date')} *</label><input required type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="input text-sm" /></div>
            <div><label className="label text-xs">{t('qc.nextDueDate', 'Next Due')}</label><input type="date" value={form.next_due_date} onChange={e => setForm({ ...form, next_due_date: e.target.value })} className="input text-sm" /></div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost text-sm">{t('common:cancel')}</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? t('common:saving') : t('common:save')}</button>
          </div>
        </form>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead><tr><th>{t('qc.machine', 'Machine')}</th><th>{t('qc.calibrationType', 'Type')}</th><th>{t('qc.dueDate', 'Due')}</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={5} className="text-center py-4 text-gray-500">{t('common:loading')}</td></tr> :
            calList.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-gray-500"><EmptyState icon={<Gauge className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('qc.noCalibrations', 'No calibrations')} description="" /></td></tr> :
            calList.map(c => (
              <tr key={c.id}>
                <td className="font-medium">{c.machine_name || `Machine #${c.machine_id}`}</td>
                <td>{c.calibration_type}</td>
                <td>{c.scheduled_date}</td>
                <td><span className={`badge text-xs ${c.result_status === 'pass' ? 'bg-green-100 text-green-700' : c.result_status === 'fail' ? 'bg-red-100 text-red-700' : c.result_status === 'cancelled' ? 'bg-gray-100 text-gray-700' : 'bg-amber-100 text-amber-700'}`}>{c.result_status || 'pending'}</span></td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => updateStatus(c.id, 'pass')} className="text-green-600 hover:bg-green-50 p-1 rounded" title="Pass"><CheckCircle className="w-4 h-4" /></button>
                    <button onClick={() => updateStatus(c.id, 'fail')} className="text-red-500 hover:bg-red-50 p-1 rounded" title="Fail"><XCircle className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
