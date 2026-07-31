import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Plus, X, Trash2, Pencil, Wifi, WifiOff, ArrowUpDown, Upload, RefreshCw, ChevronDown, ChevronRight, AlertCircle, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import AnalyzerInboxTab from './laboratory/AnalyzerInboxTab';
import AnalyzerRetractionQueueTab, { canViewAnalyzerRetractionQueue } from './laboratory/AnalyzerRetractionQueueTab';

/* ─── Types ─── */
interface Machine {
  id: number;
  machine_name: string;
  machine_code: string;
  machine_type: string;
  manufacturer?: string;
  model_number?: string;
  serial_number?: string;
  protocol: string;
  connection_type: string;
  host_address?: string;
  port?: number;
  baud_rate?: number;
  is_bidirectional: boolean;
  is_active: boolean;
  last_communication_at?: string;
}

interface TestMapping {
  id: number;
  machine_test_code: string;
  test_name: string;
  test_id: number;
  machine_unit?: string;
  conversion_factor?: number;
  qualitative_map_json?: string | null;
}

interface MessageLog {
  id: number;
  received_at: string;
  message_type: string;
  processing_status: string;
  error_message?: string;
  raw_message?: string;
  parsed_data?: any;
}

interface AnalyzerRun {
  run_id: number;
  machine_id: number;
  message_type?: string;
  processing_status?: string;
  received_at?: string;
  updated_at?: string | null;
  error_message?: string | null;
  reprocessed_from_log_id?: number | null;
  total_results: number;
  matched: number;
  unmatched: number;
  processed: number;
  blocked: number;
  duplicate: number;
  corrected: number;
  qc: number;
  errors: number;
}

interface CatalogTest {
  id: number;
  test_name: string;
  test_code: string;
}

interface UnmatchedResult {
  id: number;
  machine_id?: number | null;
  machine_name?: string | null;
  machine_code?: string | null;
  identifier_type?: string | null;
  identifier_value?: string | null;
  machine_test_code?: string | null;
  reason?: string | null;
  status: 'open' | 'resolved' | 'ignored' | string;
  result_payload_json?: string | null;
  created_at?: string | null;
}

interface UnmatchedCandidate {
  lab_order_item_id: number;
  lab_order_id?: number;
  order_no?: string | null;
  patient_name?: string | null;
  patient_code?: string | null;
  patient_mobile?: string | null;
  test_name?: string | null;
  test_code?: string | null;
  item_barcode?: string | null;
  item_status?: string | null;
}

interface AnalyzerProfile {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  protocol: string;
  machineType: string;
  bidirectional: boolean;
  defaultPort?: number;
  defaultAckMode?: string;
  requiresUnitMapping?: boolean;
  requiresQualitativeMapping?: boolean;
}

interface LabMachineCapabilities {
  machineTypes?: string[];
  protocols?: string[];
  connectionTypes?: string[];
  capabilities?: Array<{ machineType: string; examples?: string[]; inbound?: string[]; outbound?: string[]; notes?: string }>;
}

const MACHINE_TYPES = ['hematology', 'biochemistry', 'immunoassay', 'coagulation', 'urinalysis', 'microbiology', 'blood_gas', 'electrolyte', 'other'];
const PROTOCOLS = ['astm', 'hl7', 'serial', 'tcp', 'http'];
const CONNECTION_TYPES = ['tcp', 'serial', 'http'];
const LOG_STATUSES = ['all', 'pending', 'processed', 'error', 'ignored'];
const RUN_STATUSES = ['all', 'completed', 'partial', 'processed', 'qc_review', 'error'];

const EMPTY_FORM = {
  machine_name: '', machine_code: '', machine_type: 'hematology', manufacturer: '', model_number: '', serial_number: '',
  protocol: 'astm', connection_type: 'tcp', host_address: '', port: '', baud_rate: '', is_bidirectional: false,
};

/* ─── Helpers ─── */
function timeAgo(dateStr: string | undefined, t: any): string {
  if (!dateStr) return t('common:never');
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('common:justNow');
  if (mins < 60) return `${mins}${t('common:m')} ${t('common:ago')}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}${t('common:h')} ${t('common:ago')}`;
  return `${Math.floor(hrs / 24)}${t('common:d')} ${t('common:ago')}`;
}

function statusDot(machine: Machine): string {
  if (!machine.is_active) return 'bg-red-500';
  if (!machine.last_communication_at) return 'bg-yellow-400';
  const mins = (Date.now() - new Date(machine.last_communication_at).getTime()) / 60000;
  return mins < 10 ? 'bg-green-500' : 'bg-yellow-400';
}

export function unmatchedResultLabel(row: Pick<UnmatchedResult, 'identifier_type' | 'identifier_value' | 'machine_test_code' | 'id'>): string {
  const identifier = row.identifier_value ? (row.identifier_type ?? 'identifier') + ': ' + row.identifier_value : 'Result #' + row.id;
  return row.machine_test_code ? identifier + ' · ' + row.machine_test_code : identifier;
}

export function canResolveUnmatchedResult(row: Pick<UnmatchedResult, 'status'>): boolean {
  return row.status === 'open';
}

export function initialUnmatchedCandidateSearch(row: Pick<UnmatchedResult, 'identifier_value' | 'machine_test_code'> | undefined): string {
  return row?.identifier_value?.trim() || row?.machine_test_code?.trim() || '';
}

export function unmatchedCandidateLabel(candidate: Pick<UnmatchedCandidate, 'lab_order_item_id' | 'order_no' | 'patient_name' | 'patient_code' | 'test_name' | 'test_code' | 'item_barcode'>): string {
  const patient = candidate.patient_name || candidate.patient_code || 'Unknown patient';
  const test = candidate.test_name || candidate.test_code || 'Lab test';
  const order = candidate.order_no ? ' · ' + candidate.order_no : '';
  const barcode = candidate.item_barcode ? ' · ' + candidate.item_barcode : '';
  return '#' + candidate.lab_order_item_id + ' · ' + patient + ' · ' + test + order + barcode;
}

export function unmatchedCandidateSearchUrl(search: string): string {
  return '/api/lab-machines/unmatched-results/candidates?q=' + encodeURIComponent(search.trim()) + '&limit=8';
}

export function analyzerProfileLabel(profile: Pick<AnalyzerProfile, 'name' | 'protocol' | 'machineType'>): string {
  return profile.name + ' · ' + profile.protocol.toUpperCase() + ' · ' + profile.machineType.replace('_', ' ');
}

export function applyAnalyzerProfileToMachineForm<T extends Record<string, any>>(form: T, profile: AnalyzerProfile): T {
  return {
    ...form,
    manufacturer: profile.manufacturer,
    model_number: profile.model,
    machine_type: profile.machineType,
    protocol: profile.protocol,
    port: profile.defaultPort ? String(profile.defaultPort) : form.port,
    is_bidirectional: profile.bidirectional,
  };
}

export function mergeCapabilityOptions(fallback: string[], remote?: string[] | null): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...(remote ?? []), ...fallback]) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

export function machineCapabilityNotes(capabilities: LabMachineCapabilities | undefined, machineType: string): string {
  const item = capabilities?.capabilities?.find(cap => cap.machineType === machineType);
  if (!item) return '';
  const examples = item.examples?.length ? ' Examples: ' + item.examples.join(', ') + '.' : '';
  return (item.notes || '') + examples;
}

export function parseQualitativeMapInput(input: string): Record<string, string> | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter(([key, value]) => key.trim() && String(value ?? '').trim());
    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries.map(([key, value]) => [key.trim(), String(value).trim()]));
  }
  const map: Record<string, string> = {};
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separatorIndex = line.includes('=') ? line.indexOf('=') : line.indexOf(':');
    if (separatorIndex <= 0) throw new Error('Use one alias per line, for example POS=Positive');
    const source = line.slice(0, separatorIndex).trim();
    const target = line.slice(separatorIndex + 1).trim();
    if (!source || !target) throw new Error('Qualitative aliases need both source and target values');
    map[source] = target;
  }
  return Object.keys(map).length ? map : undefined;
}

export function qualitativeMapSummary(qualitativeMapJson?: string | null): string {
  if (!qualitativeMapJson) return '—';
  try {
    const map = JSON.parse(qualitativeMapJson) as Record<string, string>;
    const entries = Object.entries(map).filter(([source, target]) => source && target);
    if (entries.length === 0) return '—';
    const preview = entries.slice(0, 3).map(([source, target]) => `${source}→${target}`).join(', ');
    return entries.length > 3 ? `${preview} +${entries.length - 3}` : preview;
  } catch {
    return 'Invalid map';
  }
}

export function analyzerRunStatusBadge(status?: string): string {
  const map: Record<string, string> = {
    completed: 'badge-success',
    processed: 'badge-success',
    partial: 'badge-warning',
    qc_review: 'badge-warning',
    error: 'badge-danger',
  };
  return map[String(status ?? '')] ?? 'badge-secondary';
}

export function analyzerRunSummaryText(run: Pick<AnalyzerRun, 'total_results' | 'matched' | 'unmatched' | 'blocked' | 'qc' | 'duplicate' | 'corrected'>): string {
  const parts = [
    `${run.total_results ?? 0} results`,
    `${run.matched ?? 0} matched`,
    `${run.unmatched ?? 0} unmatched`,
  ];
  if ((run.blocked ?? 0) > 0) parts.push(`${run.blocked} blocked`);
  if ((run.qc ?? 0) > 0) parts.push(`${run.qc} QC`);
  if ((run.duplicate ?? 0) > 0) parts.push(`${run.duplicate} duplicate`);
  if ((run.corrected ?? 0) > 0) parts.push(`${run.corrected} corrected`);
  return parts.join(' · ');
}

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(4)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─── Machine Form Modal ─── */
function MachineFormModal({ machine, onClose, onSaved }: { machine?: Machine | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['laboratory', 'common']);
  const [form, setForm] = useState(machine ? {
    machine_name: machine.machine_name, machine_code: machine.machine_code, machine_type: machine.machine_type,
    manufacturer: machine.manufacturer ?? '', model_number: machine.model_number ?? '', serial_number: machine.serial_number ?? '',
    protocol: machine.protocol, connection_type: machine.connection_type, host_address: machine.host_address ?? '',
    port: machine.port ? String(machine.port) : '', baud_rate: machine.baud_rate ? String(machine.baud_rate) : '',
    is_bidirectional: machine.is_bidirectional,
  } : { ...EMPTY_FORM });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const { data: profileRaw } = useApiQuery<{ data?: AnalyzerProfile[] }>(
    ['labMachines', 'analyzerProfiles'],
    '/api/lab-machines/analyzer-profiles',
  );
  const { data: capabilitiesRaw } = useApiQuery<LabMachineCapabilities>(
    ['labMachines', 'capabilities'],
    '/api/lab-machines/capabilities',
  );
  const analyzerProfiles = profileRaw?.data ?? [];
  const machineTypeOptions = mergeCapabilityOptions(MACHINE_TYPES, capabilitiesRaw?.machineTypes);
  const protocolOptions = mergeCapabilityOptions(PROTOCOLS, capabilitiesRaw?.protocols);
  const connectionTypeOptions = mergeCapabilityOptions(CONNECTION_TYPES, capabilitiesRaw?.connectionTypes);
  const selectedCapabilityNotes = machineCapabilityNotes(capabilitiesRaw, form.machine_type);
  const applyProfile = (profileId: string) => {
    const profile = analyzerProfiles.find(item => item.id === profileId);
    if (!profile) return;
    setForm(f => applyAnalyzerProfileToMachineForm(f, profile));
  };

  const createMutation = useApiMutation<any, any>('post', '/api/lab-machines', {
    onSuccess: () => { toast.success(t('machineSettings.createdToast')); onSaved(); onClose(); },
    onError: (err) => { toast.error(err.message || 'Failed'); },
  });

  const updateMutation = useApiMutation<any, any>('put', `/api/lab-machines/${machine?.id}`, {
    onSuccess: () => { toast.success(t('machineSettings.updatedToast')); onSaved(); onClose(); },
    onError: (err) => { toast.error(err.message || 'Failed'); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, port: form.port ? parseInt(form.port) : null, baud_rate: form.baud_rate ? parseInt(form.baud_rate) : null, is_bidirectional: Boolean(form.is_bidirectional) };
    if (machine) {
      updateMutation.mutate(body);
    } else {
      createMutation.mutate(body);
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal title={machine ? t('machineSettings.editMachine') : t('machineSettings.addMachine')} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label className="label">Analyzer profile</label>
          <select className="input" defaultValue="" onChange={e => applyProfile(e.target.value)}>
            <option value="">Select profile to auto-fill machine defaults</option>
            {analyzerProfiles.map(profile => <option key={profile.id} value={profile.id}>{analyzerProfileLabel(profile)}</option>)}
          </select>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Profile fills manufacturer, model, type, protocol, port and bidirectional mode. You can still edit every field manually.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label">{t('machineSettings.nameLabel')}</label><input className="input" required value={form.machine_name} onChange={e => set('machine_name', e.target.value)} /></div>
          <div><label className="label">{t('machineSettings.codeLabel')}</label><input className="input" required value={form.machine_code} onChange={e => set('machine_code', e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><label className="label">{t('machineSettings.typeLabel')}</label><select className="input" value={form.machine_type} onChange={e => set('machine_type', e.target.value)}>{machineTypeOptions.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></div>
          <div><label className="label">{t('machineSettings.protocolLabel')}</label><select className="input" value={form.protocol} onChange={e => set('protocol', e.target.value)}>{protocolOptions.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select></div>
          <div><label className="label">{t('machineSettings.connectionLabel')}</label><select className="input" value={form.connection_type} onChange={e => set('connection_type', e.target.value)}>{connectionTypeOptions.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}</select></div>
        </div>
        {selectedCapabilityNotes && <p className="text-xs text-[var(--color-text-secondary)] -mt-2">{selectedCapabilityNotes}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><label className="label">{t('machineSettings.manufacturerLabel')}</label><input className="input" value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} /></div>
          <div><label className="label">{t('machineSettings.modelLabel')}</label><input className="input" value={form.model_number} onChange={e => set('model_number', e.target.value)} /></div>
          <div><label className="label">{t('machineSettings.serialLabel')}</label><input className="input" value={form.serial_number} onChange={e => set('serial_number', e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><label className="label">{t('machineSettings.hostLabel')}</label><input className="input" value={form.host_address} onChange={e => set('host_address', e.target.value)} placeholder="192.168.1.100" /></div>
          <div><label className="label">{t('machineSettings.portLabel')}</label><input className="input" type="number" value={form.port} onChange={e => set('port', e.target.value)} placeholder="9100" /></div>
          <div><label className="label">{t('machineSettings.baudLabel')}</label><input className="input" type="number" value={form.baud_rate} onChange={e => set('baud_rate', e.target.value)} placeholder="9600" /></div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.is_bidirectional} onChange={e => set('is_bidirectional', e.target.checked)} className="rounded" />
          <span className="text-sm">{t('machineSettings.bidirectionalLabel')}</span>
        </label>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common:cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common:saving') : (machine ? t('common:update') : t('common:create'))}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Test Mapping Tab ─── */
function TestMappingTab({ machineId }: { machineId: number }) {
  const { t } = useTranslation(['laboratory', 'common']);
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ test_id: '', machine_test_code: '', machine_unit: '', conversion_factor: '1', qualitative_map_text: '' });

  const { data: mapRaw, isLoading: mapLoading, isError: mapError, refetch: refetchMap } = useApiQuery<any>(
    queryKeys.labMachines.testMap(machineId),
    `/api/lab-machines/${machineId}/test-map`,
  );
  const { data: catRaw } = useApiQuery<any>(
    queryKeys.laboratory.all,
    '/api/lab',
  );

  const mappings: TestMapping[] = mapRaw?.data ?? mapRaw ?? [];
  const catalog: CatalogTest[] = catRaw?.data ?? catRaw ?? [];
  const loading = mapLoading;

  const addMutation = useApiMutation<any, any>('post', `/api/lab-machines/${machineId}/test-map`, {
    onSuccess: () => {
      toast.success(t('machineSettings.mappingAddedToast'));
      setShowAdd(false);
      setAddForm({ test_id: '', machine_test_code: '', machine_unit: '', conversion_factor: '1', qualitative_map_text: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.labMachines.testMap(machineId) });
    },
    onError: (err) => { toast.error(err.message || t('failed')); },
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    let qualitativeMap: Record<string, string> | undefined;
    try {
      qualitativeMap = parseQualitativeMapInput(addForm.qualitative_map_text);
    } catch (error: any) {
      toast.error(error.message || 'Invalid qualitative map');
      return;
    }
    addMutation.mutate({
      test_id: parseInt(addForm.test_id),
      machine_test_code: addForm.machine_test_code,
      machine_unit: addForm.machine_unit || null,
      conversion_factor: addForm.conversion_factor ? parseFloat(addForm.conversion_factor) : 1,
      qualitative_map: qualitativeMap,
    });
  };

  const handleDelete = async (mapId: number) => {
    if (!confirm(t('machineSettings.confirmRemoveMapping'))) return;
    try {
      await api.delete(`/api/lab-machines/${machineId}/test-map/${mapId}`);
      toast.success(t('machineSettings.mappingRemovedToast'));
      queryClient.invalidateQueries({ queryKey: queryKeys.labMachines.testMap(machineId) });
    } catch {
      toast.error(t('failed'));
    }
  };

  if (mapError) return (
    <div className="text-center py-8">
      <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
      <p className="text-[var(--color-text-secondary)] mb-3">{t('machineSettings.noMappings')}</p>
      <button onClick={() => refetchMap()} className="btn-primary"><RefreshCw className="w-4 h-4" />{t('common:retry')}</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('machineSettings.addMapping')}</button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>{t('machineSettings.codeLabel')}</th><th>{t('testName')}</th><th>{t('machineSettings.machineUnitLabel')}</th><th>{t('machineSettings.conversionFactorLabel')}</th><th>Qualitative map</th><th></th></tr></thead>
            <tbody>
              {loading ? <SkeletonRows cols={6} />
                : mappings.length === 0 ? (
                  <tr><td colSpan={6}>
                    <EmptyState
                      icon={<ArrowUpDown className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('machineSettings.noMappings')}
                      description={t('machineSettings.noMappingsDesc')}
                      action={<button onClick={() => setShowAdd(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('machineSettings.addMapping')}</button>}
                    />
                  </td></tr>
                ) : mappings.map(m => (
                  <tr key={m.id}>
                    <td className="font-data text-sm">{m.machine_test_code}</td>
                    <td className="font-medium">{m.test_name}</td>
                    <td>{m.machine_unit ?? '—'}</td>
                    <td className="font-data">{m.conversion_factor ?? 1}</td>
                    <td className="font-data text-xs max-w-[220px] truncate" title={qualitativeMapSummary(m.qualitative_map_json)}>{qualitativeMapSummary(m.qualitative_map_json)}</td>
                    <td><button onClick={() => handleDelete(m.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {showAdd && (
        <Modal title={t('machineSettings.addMapping')} onClose={() => setShowAdd(false)}>
          <form onSubmit={handleAdd} className="p-5 space-y-4">
            <div>
              <label className="label">{t('machineSettings.labTestLabel')}</label>
              <select className="input" required value={addForm.test_id} onChange={e => setAddForm(f => ({ ...f, test_id: e.target.value }))}>
                <option value="">{t('common:selectTest')}</option>
                {catalog.map(t => <option key={t.id} value={t.id}>{t.test_name} ({t.test_code})</option>)}
              </select>
            </div>
            <div><label className="label">{t('machineSettings.machineTestCodeLabel')}</label><input className="input" required value={addForm.machine_test_code} onChange={e => setAddForm(f => ({ ...f, machine_test_code: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">{t('machineSettings.machineUnitLabel')}</label><input className="input" value={addForm.machine_unit} onChange={e => setAddForm(f => ({ ...f, machine_unit: e.target.value }))} placeholder="e.g. g/dL" /></div>
              <div><label className="label">{t('machineSettings.conversionFactorLabel')}</label><input className="input" type="number" step="any" value={addForm.conversion_factor} onChange={e => setAddForm(f => ({ ...f, conversion_factor: e.target.value }))} /></div>
            </div>
            <div>
              <label className="label">Qualitative aliases</label>
              <textarea className="input min-h-[96px] font-data text-sm" value={addForm.qualitative_map_text} onChange={e => setAddForm(f => ({ ...f, qualitative_map_text: e.target.value }))} placeholder={'POS=Positive\nDetected=Positive\nNEG=Negative'} />
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">Optional. One alias per line. The analyzer value on the left will be stored as the standard value on the right.</p>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">{t('common:cancel')}</button>
              <button type="submit" disabled={addMutation.isPending} className="btn-primary">{addMutation.isPending ? t('common:saving') : t('machineSettings.addMapping')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ─── Message Log Tab ─── */
function MessageLogTab({ machineId }: { machineId: number }) {
  const { t } = useTranslation(['laboratory', 'common']);
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedLog, setExpandedLog] = useState<MessageLog | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const { data: logsRaw, isLoading: loading, isError: error, refetch } = useApiQuery<any>(
    queryKeys.labMachines.logs(machineId, filter !== 'all' ? filter : undefined),
    `/api/lab-machines/${machineId}/logs${filter !== 'all' ? `?processing_status=${filter}` : ''}`,
  );
  const logs: MessageLog[] = logsRaw?.data ?? logsRaw ?? [];

  const toggleExpand = async (logId: number) => {
    if (expandedId === logId) { setExpandedId(null); setExpandedLog(null); return; }
    setExpandedId(logId);
    setLoadingDetail(true);
    try {
      const data = await api.get<any>(`/api/lab-machines/${machineId}/logs/${logId}`);
      setExpandedLog(data.data ?? data);
    } catch {
      setExpandedLog(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = { processed: 'badge-success', error: 'badge-danger', pending: 'badge-warning', ignored: 'badge-secondary' };
    return map[s] ?? 'badge-secondary';
  };

  if (error) return (
    <div className="text-center py-8">
      <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
      <p className="text-[var(--color-text-secondary)] mb-3">{t('machineSettings.messageLogs')}</p>
      <button onClick={() => refetch()} className="btn-primary"><RefreshCw className="w-4 h-4" />Retry</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="label mb-0 text-sm">{t('common:filter')}:</label>
        <select className="input w-auto" value={filter} onChange={e => setFilter(e.target.value)}>
          {LOG_STATUSES.map(s => <option key={s} value={s}>{t(`common:${s}`)}</option>)}
        </select>
        <button onClick={() => refetch()} className="btn-ghost p-2"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th></th><th>{t('machineSettings.receivedAt')}</th><th>{t('machineSettings.type')}</th><th>{t('machineSettings.status')}</th><th>{t('common:error')}</th></tr></thead>
            <tbody>
              {loading ? <SkeletonRows cols={5} />
                : logs.length === 0 ? (
                  <tr><td colSpan={5}>
                    <EmptyState
                      icon={<Monitor className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('machineSettings.messageLogs')}
                      description={t('machineSettings.noMachinesDesc')}
                    />
                  </td></tr>
                ) : logs.map(log => (
                  <>
                    <tr key={log.id} className="cursor-pointer hover:bg-[var(--color-border-light)]" onClick={() => toggleExpand(log.id)}>
                      <td className="w-8">{expandedId === log.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                      <td className="font-data text-sm whitespace-nowrap">{new Date(log.received_at).toLocaleString()}</td>
                      <td>{log.message_type}</td>
                      <td><span className={`badge ${statusBadge(log.processing_status)}`}>{t(`common:${log.processing_status}`)}</span></td>
                      <td className="text-sm text-red-500 max-w-xs truncate">{log.error_message ?? '—'}</td>
                    </tr>
                    {expandedId === log.id && (
                      <tr key={`${log.id}-detail`}>
                        <td colSpan={5} className="bg-[var(--color-border-light)] p-4">
                          {loadingDetail ? <div className="skeleton h-20 rounded" /> : expandedLog ? (
                            <div className="space-y-3">
                              <div>
                                 <p className="text-xs font-semibold uppercase text-[var(--color-text-secondary)] mb-1">{t('machineSettings.rawMessage')}</p>
                                <pre className="bg-white dark:bg-slate-900 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48">{expandedLog.raw_message ?? 'N/A'}</pre>
                              </div>
                              {expandedLog.parsed_data && (
                                <div>
                                  <p className="text-xs font-semibold uppercase text-[var(--color-text-secondary)] mb-1">{t('machineSettings.parsedData')}</p>
                                  <pre className="bg-white dark:bg-slate-900 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48">{JSON.stringify(expandedLog.parsed_data, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          ) : <p className="text-sm text-[var(--color-text-secondary)]">Could not load details</p>}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Analyzer Runs Tab ─── */
function AnalyzerRunsTab({ machineId }: { machineId: number }) {
  const [filter, setFilter] = useState('all');
  const { data: runsRaw, isLoading: loading, isError: error, refetch } = useApiQuery<any>(
    ['labMachines', 'runs', machineId, filter],
    `/api/lab-machines/${machineId}/runs${filter !== 'all' ? `?processing_status=${filter}` : ''}`,
  );
  const runs: AnalyzerRun[] = runsRaw?.data ?? [];
  const summary = runsRaw?.summary ?? {};

  if (error) return (
    <div className="text-center py-8">
      <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
      <p className="text-[var(--color-text-secondary)] mb-3">Could not load analyzer runs</p>
      <button onClick={() => refetch()} className="btn-primary"><RefreshCw className="w-4 h-4" />Retry</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Analyzer runs</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Grouped from existing raw analyzer logs; useful for reviewing processing, QC, and reprocess outcomes.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-auto" value={filter} onChange={e => setFilter(e.target.value)}>
            {RUN_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button onClick={() => refetch()} className="btn-ghost p-2"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-3"><p className="text-xs text-[var(--color-text-secondary)]">Runs</p><p className="font-semibold font-data">{summary.runs ?? runs.length}</p></div>
        <div className="card p-3"><p className="text-xs text-[var(--color-text-secondary)]">Results</p><p className="font-semibold font-data">{summary.total_results ?? 0}</p></div>
        <div className="card p-3"><p className="text-xs text-[var(--color-text-secondary)]">Blocked</p><p className="font-semibold font-data">{summary.blocked ?? 0}</p></div>
        <div className="card p-3"><p className="text-xs text-[var(--color-text-secondary)]">QC</p><p className="font-semibold font-data">{summary.qc ?? 0}</p></div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Run</th><th>Received</th><th>Status</th><th>Summary</th><th>Reprocess</th></tr></thead>
            <tbody>
              {loading ? <SkeletonRows cols={5} />
                : runs.length === 0 ? (
                  <tr><td colSpan={5}>
                    <EmptyState
                      icon={<Monitor className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title="No analyzer runs"
                      description="Analyzer runs will appear after machine messages are received."
                    />
                  </td></tr>
                ) : runs.map(run => (
                  <tr key={run.run_id}>
                    <td className="font-data text-sm">#{run.run_id}<div className="text-xs text-[var(--color-text-secondary)]">{run.message_type ?? '—'}</div></td>
                    <td className="font-data text-xs whitespace-nowrap">{run.received_at ? new Date(run.received_at).toLocaleString() : '—'}</td>
                    <td><span className={`badge ${analyzerRunStatusBadge(run.processing_status)}`}>{String(run.processing_status ?? 'unknown').replace('_', ' ')}</span>{run.error_message ? <div className="text-xs text-red-500 max-w-[180px] truncate">{run.error_message}</div> : null}</td>
                    <td className="text-sm">{analyzerRunSummaryText(run)}</td>
                    <td className="font-data text-xs">{run.reprocessed_from_log_id ? `from #${run.reprocessed_from_log_id}` : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Unmatched LIS Queue Tab ─── */
function UnmatchedResultsTab({ machineId }: { machineId: number }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('open');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [labOrderItemId, setLabOrderItemId] = useState('');
  const [notes, setNotes] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidates, setCandidates] = useState<UnmatchedCandidate[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);

  const queryKey = ['labMachines', 'unmatchedResults', machineId, status] as const;
  const { data: raw, isLoading, isError, refetch } = useApiQuery<any>(
    queryKey,
    '/api/lab-machines/unmatched-results?status=' + status + '&machineId=' + machineId + '&limit=50',
  );
  const rows: UnmatchedResult[] = raw?.data ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'analyzer-health'] });
  };

  const handleResolve = async (row: UnmatchedResult | undefined) => {
    if (!row) return;
    const id = parseInt(labOrderItemId, 10);
    if (!id) { toast.error('Enter lab order item ID'); return; }
    try {
      await api.post('/api/lab-machines/unmatched-results/' + row.id + '/resolve', {
        status: 'resolved',
        labOrderItemId: id,
        notes: notes || undefined,
      });
      toast.success('Unmatched result resolved');
      setSelectedId(null);
      setLabOrderItemId('');
      setNotes('');
      refresh();
    } catch (err: any) { toast.error(err.message || 'Failed'); }
  };

  const handleIgnore = async (row: UnmatchedResult | undefined) => {
    if (!row) return;
    if (!confirm('Ignore this unmatched result?')) return;
    try {
      await api.post('/api/lab-machines/unmatched-results/' + row.id + '/resolve', { status: 'ignored', notes: notes || undefined });
      toast.success('Unmatched result ignored');
      setSelectedId(null);
      refresh();
    } catch (err: any) { toast.error(err.message || 'Failed'); }
  };

  const selected = rows.find(row => row.id === selectedId);

  useEffect(() => {
    setLabOrderItemId('');
    setNotes('');
    setCandidates([]);
    setCandidateSearch(initialUnmatchedCandidateSearch(selected));
  }, [selected?.id, selected?.identifier_value, selected?.machine_test_code]);

  const searchCandidates = async () => {
    const search = candidateSearch.trim();
    if (search.length < 2) { toast.error('Enter at least 2 characters to search'); return; }
    setCandidateLoading(true);
    try {
      const res = await api.get<{ data?: UnmatchedCandidate[] }>(unmatchedCandidateSearchUrl(search));
      setCandidates(res.data ?? []);
      if ((res.data ?? []).length === 0) toast.error('No matching lab order items found');
    } catch (err: any) {
      toast.error(err.message || 'Failed to search candidates');
    } finally {
      setCandidateLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={status} onChange={e => setStatus(e.target.value)}>
          {['open', 'resolved', 'ignored'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => refetch()} className="btn-ghost p-2"><RefreshCw className="w-4 h-4" /></button>
        <p className="text-xs text-[var(--color-text-secondary)]">Open analyzer results that could not be matched automatically.</p>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Result</th><th>Machine</th><th>Reason</th><th>Received</th><th></th></tr></thead>
            <tbody>
              {isLoading ? <SkeletonRows cols={5} />
                : isError ? <tr><td colSpan={5} className="text-center py-8"><button onClick={() => refetch()} className="btn-primary"><RefreshCw className="w-4 h-4" />Retry</button></td></tr>
                : rows.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<AlertCircle className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No unmatched LIS results" description="Analyzer queue is clear for this machine." /></td></tr>
                : rows.map(row => (
                  <tr key={row.id}>
                    <td>
                      <div className="font-medium">{unmatchedResultLabel(row)}</div>
                      <div className="text-xs text-[var(--color-text-secondary)]">#{row.id}</div>
                    </td>
                    <td>{row.machine_name || row.machine_code || row.machine_id || '—'}</td>
                    <td className="text-sm text-[var(--color-text-secondary)]">{row.reason || 'unmatched'}</td>
                    <td className="font-data text-sm whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                    <td>
                      {canResolveUnmatchedResult(row) ? (
                        <button onClick={() => setSelectedId(selectedId === row.id ? null : row.id)} className="btn-secondary text-xs">Resolve</button>
                      ) : <span className="badge badge-secondary">{row.status}</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {selected && (
        <div className="card p-4 space-y-3">
          <div className="font-semibold text-sm">Resolve unmatched result #{selected.id}</div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
            <input
              className="input"
              placeholder="Search barcode, order, patient or test"
              value={candidateSearch}
              onChange={e => setCandidateSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchCandidates(); }}
            />
            <button className="btn-secondary" onClick={searchCandidates} disabled={candidateLoading}>
              {candidateLoading ? 'Searching...' : 'Search candidates'}
            </button>
          </div>
          {candidates.length > 0 && (
            <div className="rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)] overflow-hidden">
              {candidates.map(candidate => (
                <button
                  key={candidate.lab_order_item_id}
                  type="button"
                  onClick={() => setLabOrderItemId(String(candidate.lab_order_item_id))}
                  className={(String(candidate.lab_order_item_id) === labOrderItemId ? 'bg-primary/10 ' : '') + 'w-full text-left p-3 hover:bg-[var(--color-border-light)] transition-colors'}
                >
                  <div className="font-medium text-sm">{unmatchedCandidateLabel(candidate)}</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">Status: {candidate.item_status || '—'} · Item ID: {candidate.lab_order_item_id}</div>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-3">
            <input className="input" placeholder="Selected/manual lab order item ID" value={labOrderItemId} onChange={e => setLabOrderItemId(e.target.value)} />
            <input className="input" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
            <button className="btn-primary" onClick={() => handleResolve(selected)}>Resolve</button>
            <button className="btn-secondary" onClick={() => handleIgnore(selected)}>Ignore</button>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">Search by analyzer barcode/order/patient, select a candidate, or enter the lab order item ID manually. Resolving will attach the result and consume mapped reagents once.</p>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function LabMachineSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['laboratory', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editMachine, setEditMachine] = useState<Machine | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [detailTab, setDetailTab] = useState<'mappings' | 'runs' | 'inbox' | 'retractions' | 'logs' | 'unmatched'>('mappings');
  const [pinging, setPinging] = useState<number | null>(null);

  const { data: machinesRaw, isLoading: loading, isError: error, refetch } = useApiQuery<any>(
    queryKeys.labMachines.list(),
    '/api/lab-machines',
  );
  const machines: Machine[] = machinesRaw?.data ?? machinesRaw ?? [];

  const invalidateMachines = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.labMachines.all });
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('machineSettings.confirmDeactivate'))) return;
    try {
      await api.delete(`/api/lab-machines/${id}`);
      toast.success(t('machineSettings.deactivatedToast'));
      if (selectedMachine?.id === id) setSelectedMachine(null);
      invalidateMachines();
    } catch (err: any) {
      toast.error(err.message || t('failed'));
    }
  };

  const handlePing = async (machine: Machine) => {
    setPinging(machine.id);
    try {
      const data = await api.post<any>(`/api/lab-machines/${machine.id}/ping`, {});
      toast.success(data.message ?? t('machineSettings.pingSuccess'));
    } catch (err: any) {
      toast.error(err.message || t('failed'));
    } finally {
      setPinging(null);
    }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Monitor className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('machineSettings.title')}</h1>
              <p className="section-subtitle">{t('machineSettings.subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Machine List */}
        <div className="flex flex-col lg:flex-row gap-5">
          <div className={`${selectedMachine ? 'lg:w-1/2' : 'w-full'} space-y-4 transition-all`}>
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-lg">{t('machineSettings.machines')}</h2>
              <button onClick={() => { setEditMachine(null); setShowForm(true); }} className="btn-primary"><Plus className="w-4 h-4" />{t('machineSettings.addMachine')}</button>
            </div>

            {error ? (
              <div className="card p-8 text-center">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <p className="text-[var(--color-text-secondary)] mb-3">{t('failed')}</p>
                <button onClick={() => refetch()} className="btn-primary"><RefreshCw className="w-4 h-4" />{t('common:retry')}</button>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th></th>
                        <th>{t('common:name')}</th>
                        <th className="hidden md:table-cell">{t('laboratory:code')}</th>
                        <th className="hidden sm:table-cell">{t('machineSettings.type')}</th>
                        <th className="hidden lg:table-cell">{t('machineSettings.protocolLabel')}</th>
                        <th>{t('machineSettings.lastComm')}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? <SkeletonRows cols={7} />
                        : machines.length === 0 ? (
                          <tr><td colSpan={7}>
                            <EmptyState
                              icon={<Monitor className="w-8 h-8 text-[var(--color-text-muted)]" />}
                              title={t('machineSettings.noMachines')}
                              description={t('machineSettings.noMachinesDesc')}
                              action={<button onClick={() => { setEditMachine(null); setShowForm(true); }} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('machineSettings.addMachine')}</button>}
                            />
                          </td></tr>
                        ) : machines.map(m => (
                          <tr
                            key={m.id}
                            className={`cursor-pointer transition-colors ${selectedMachine?.id === m.id ? 'bg-[var(--color-primary)]/5' : 'hover:bg-[var(--color-border-light)]'}`}
                            onClick={() => { setSelectedMachine(m); setDetailTab('mappings'); }}
                          >
                            <td className="w-8"><span className={`inline-block w-2.5 h-2.5 rounded-full ${statusDot(m)}`} /></td>
                            <td className="font-medium">{m.machine_name}</td>
                            <td className="font-data text-sm hidden md:table-cell">{m.machine_code}</td>
                            <td className="hidden sm:table-cell capitalize">{m.machine_type.replace('_', ' ')}</td>
                            <td className="hidden lg:table-cell uppercase text-xs font-data">{m.protocol}</td>
                            <td className="text-sm text-[var(--color-text-secondary)] whitespace-nowrap">{timeAgo(m.last_communication_at, t)}</td>
                            <td>
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <button onClick={() => handlePing(m)} disabled={pinging === m.id} className="btn-ghost p-1.5" title="Ping">
                                  {pinging === m.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                                </button>
                                <button onClick={() => { setEditMachine(m); setShowForm(true); }} className="btn-ghost p-1.5" title={t('common:edit')}><Pencil className="w-4 h-4" /></button>
                                <button onClick={() => handleDelete(m.id)} className="btn-ghost p-1.5 text-red-500" title={t('common:deactivate')}><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          {selectedMachine && (
            <div className="lg:w-1/2 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-lg">{selectedMachine.machine_name}</h2>
                  <p className="text-sm text-[var(--color-text-secondary)]">{selectedMachine.machine_code} — {selectedMachine.manufacturer ?? selectedMachine.machine_type}</p>
                </div>
                <button onClick={() => setSelectedMachine(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>

              <div className="card p-1.5 flex gap-1 overflow-x-auto">
                <button
                  onClick={() => setDetailTab('mappings')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${detailTab === 'mappings' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
                ><ArrowUpDown className="w-4 h-4" />{t('machineSettings.testMappings')}</button>
                <button
                  onClick={() => setDetailTab('runs')}
                  className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${detailTab === 'runs' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
                ><Monitor className="w-4 h-4" />Runs</button>
                <button
                  onClick={() => setDetailTab('inbox')}
                  className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${detailTab === 'inbox' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
                ><AlertCircle className="w-4 h-4" />Review Inbox</button>
                {canViewAnalyzerRetractionQueue(role) && (
                  <button
                    onClick={() => setDetailTab('retractions')}
                    className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${detailTab === 'retractions' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
                  ><RotateCcw className="w-4 h-4" />Retractions</button>
                )}
                <button
                  onClick={() => setDetailTab('logs')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${detailTab === 'logs' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
                ><Monitor className="w-4 h-4" />{t('machineSettings.messageLogs')}</button>
                <button
                  onClick={() => setDetailTab('unmatched')}
                  className={detailTab === 'unmatched' ? 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-[var(--color-primary)] text-white shadow-sm' : 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}
                ><AlertCircle className="w-4 h-4" />Unmatched LIS</button>
              </div>

              {detailTab === 'mappings'
                ? <TestMappingTab machineId={selectedMachine.id} />
                : detailTab === 'runs'
                  ? <AnalyzerRunsTab machineId={selectedMachine.id} />
                  : detailTab === 'inbox'
                    ? <AnalyzerInboxTab machineId={selectedMachine.id} role={role} />
                    : detailTab === 'retractions'
                      ? <AnalyzerRetractionQueueTab machineId={selectedMachine.id} role={role} />
                      : detailTab === 'logs'
                        ? <MessageLogTab machineId={selectedMachine.id} />
                        : <UnmatchedResultsTab machineId={selectedMachine.id} />}
            </div>
          )}
        </div>

        {/* Form Modal */}
        {showForm && (
          <MachineFormModal
            machine={editMachine}
            onClose={() => setShowForm(false)}
            onSaved={invalidateMachines}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
