import { useRef, useState, useEffect } from 'react';
import {
  FlaskConical, Plus, X, Trash2, Tag, FileText, Truck, Hash,
  Scale, Landmark, XCircle, List, Upload, Download, CheckCircle2, AlertTriangle,
  Activity, Settings, BarChart3, ClipboardCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';
import VisualTemplateSelector from '../components/VisualTemplateSelector';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

const TABS = [
  { key: 'categories',       labelKey: 'testCategories',       icon: Tag       },
  { key: 'catalog',          labelKey: 'catalog',              icon: List      },
  { key: 'templates',        labelKey: 'reportTemplates',      icon: FileText  },
  { key: 'vendors',          labelKey: 'vendors',              icon: Truck     },
  { key: 'runnumber',        labelKey: 'runNumber',            icon: Hash      },
  { key: 'reference_ranges', labelKey: 'referenceRanges',      icon: Scale     },
  { key: 'gov_reporting',    labelKey: 'governmentReporting',  icon: Landmark  },
  { key: 'rejection_reasons',labelKey: 'rejectionReasons',     icon: XCircle   },
] as const;
type LabSettingsTabKey = (typeof TABS)[number]['key'];
const LAB_SETTINGS_TAB_KEYS = new Set<LabSettingsTabKey>(TABS.map(tab => tab.key));
function isLabSettingsTabKey(value: string | null): value is LabSettingsTabKey {
  return Boolean(value && LAB_SETTINGS_TAB_KEYS.has(value as LabSettingsTabKey));
}

const DIAGNOSTIC_QUICK_ACTIONS = [
  { kind: 'link', labelKey: 'diagnosticMonitor', defaultLabel: 'Diagnostic Monitor', description: 'Live order queue, pending samples, delayed reports and critical alerts.', icon: FlaskConical, path: '../monitor/lab' },
  { kind: 'tab', labelKey: 'testCatalog', defaultLabel: 'Test Catalog', description: 'Create and manage billable lab/radiology tests and prices.', icon: List, tab: 'catalog' },
  { kind: 'tab', labelKey: 'testCategories', defaultLabel: 'Test Categories', description: 'Organize tests by Hematology, Biochemistry, Serology and other sections.', icon: Tag, tab: 'categories' },
  { kind: 'tab', labelKey: 'reportTemplates', defaultLabel: 'Report Templates', description: 'Manage report formats and reusable result templates.', icon: FileText, tab: 'templates' },
  { kind: 'tab', labelKey: 'referenceRanges', defaultLabel: 'Reference Ranges', description: 'Maintain age, sex and unit-specific reference ranges.', icon: Scale, tab: 'reference_ranges' },
  { kind: 'link', labelKey: 'labMachines', defaultLabel: 'Lab Machines', description: 'Configure analyzers and machine-to-test mappings.', icon: Settings, path: '../lab-machines' },
  { kind: 'link', labelKey: 'machineMonitoring', defaultLabel: 'Machine Monitoring', description: 'Track analyzer connectivity, imports and message logs.', icon: Activity, path: '../lab/monitoring' },
  { kind: 'link', labelKey: 'qcDashboard', defaultLabel: 'QC Dashboard', description: 'Review quality-control trends and exceptions.', icon: ClipboardCheck, path: '../lab/qc' },
  { kind: 'link', labelKey: 'labReports', defaultLabel: 'Lab Reports', description: 'Open diagnostic report analytics and operational reports.', icon: BarChart3, path: '../reports/lab' },
] as const;

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(4)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CategoriesTab() {
  const { t } = useTranslation('laboratory');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category_name: '', category_code: '', description: '' });

  const { data: rawData, isLoading: loading } = useApiQuery<any>(
    queryKeys.labSettings.categories(),
    '/api/lab-settings/categories',
  );
  const items = rawData?.data ?? [];

  const createMutation = useApiMutation<any, any>('post', '/api/lab-settings/categories', {
    onSuccess: () => { toast.success(t('categoryCreated')); setShowForm(false); queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all }); },
    onError: (err) => { toast.error(err.message || t('failed')); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('deactivateConfirm'))) return;
    try {
      const { api } = await import('../lib/apiClient');
      await api.delete(`/api/lab-settings/categories/${id}`);
      toast.success(t('deactivated'));
      queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('newCategory')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('categoryName')}</th><th>{t('code')}</th><th>{t('description')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : items.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<Tag className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noCategories')} description={t('noCategoriesDesc')} action={<button onClick={() => setShowForm(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('newCategory')}</button>} /></td></tr>
            : items.map((c: any) => <tr key={c.id}><td className="font-medium">{c.category_name}</td><td className="font-data text-sm">{c.category_code ?? '—'}</td><td className="text-[var(--color-text-secondary)]">{c.description ?? '—'}</td><td><span className={`badge ${c.is_active ? 'badge-success' : 'badge-warning'}`}>{c.is_active ? t('active') : t('inactive')}</span></td><td><button onClick={() => handleDelete(c.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></td></tr>)}
        </tbody>
      </table></div></div>
      {showForm && <Modal title={t('newCategoryTitle')} onClose={() => setShowForm(false)}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('categoryNameLabel')}</label><input className="input" required value={form.category_name} onChange={e => setForm(f => ({ ...f, category_name: e.target.value }))} /></div>
          <div><label className="label">{t('code')}</label><input className="input" value={form.category_code} onChange={e => setForm(f => ({ ...f, category_code: e.target.value }))} /></div>
          <div><label className="label">{t('description')}</label><input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel')}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('savingEllipsis') : t('create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function TemplatesTab() {
  const { t } = useTranslation('laboratory');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showVisualSelector, setShowVisualSelector] = useState(false);
  const [form, setForm] = useState({ template_name: '', template_code: '', header_html: '', footer_html: '', is_default: false });

  const { data: rawData, isLoading: loading } = useApiQuery<any>(
    queryKeys.labSettings.templates(),
    '/api/lab-settings/templates',
  );
  const items = rawData?.data ?? [];

  const createMutation = useApiMutation<any, any>('post', '/api/lab-settings/templates', {
    onSuccess: () => { toast.success(t('templateCreated')); setShowForm(false); queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all }); },
    onError: (err) => { toast.error(err.message || t('failed')); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button onClick={() => setShowVisualSelector(true)} className="btn-secondary">
          <FileText className="w-4 h-4" />{t('visualTemplates')}
        </button>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="w-4 h-4" />{t('newTemplate')}
        </button>
      </div>

      {showVisualSelector && (
        <Modal title={t('chooseVisualTemplate')} onClose={() => setShowVisualSelector(false)}>
          <div className="p-5">
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              {t('visualTemplateDesc')}
            </p>
            <VisualTemplateSelector onSelect={(preset) => {
              if (preset) {
                setForm(f => ({
                  ...f,
                  template_name: preset.preset_name,
                  template_code: preset.preset_code,
                }));
                setShowVisualSelector(false);
                setShowForm(true);
              }
            }} />
          </div>
        </Modal>
      )}

      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('templateName')}</th><th>{t('code')}</th><th>{t('default')}</th><th>{t('status')}</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : items.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<FileText className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noTemplates')} description={t('noTemplatesDesc')} action={<button onClick={() => setShowVisualSelector(true)} className="btn-primary mt-2"><FileText className="w-4 h-4" />{t('browseVisualTemplates')}</button>} /></td></tr>
            : items.map((tmpl: any) => <tr key={tmpl.id}><td className="font-medium">{tmpl.template_name}</td><td className="font-data text-sm">{tmpl.template_code ?? '—'}</td><td>{tmpl.is_default ? <span className="badge badge-success">{t('default')}</span> : '—'}</td><td><span className={`badge ${tmpl.is_active ? 'badge-success' : 'badge-warning'}`}>{tmpl.is_active ? t('active') : t('inactive')}</span></td></tr>)}
        </tbody>
      </table></div></div>
      {showForm && <Modal title={t('newTemplateTitle')} onClose={() => setShowForm(false)}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('templateNameLabel')}</label><input className="input" required value={form.template_name} onChange={e => setForm(f => ({ ...f, template_name: e.target.value }))} /></div>
          <div><label className="label">{t('code')}</label><input className="input" value={form.template_code} onChange={e => setForm(f => ({ ...f, template_code: e.target.value }))} /></div>
          <div><label className="label">{t('headerHtml')}</label><textarea className="input font-mono text-sm" rows={3} value={form.header_html} onChange={e => setForm(f => ({ ...f, header_html: e.target.value }))} placeholder="<div>Hospital Name</div>" /></div>
          <div><label className="label">{t('footerHtml')}</label><textarea className="input font-mono text-sm" rows={2} value={form.footer_html} onChange={e => setForm(f => ({ ...f, footer_html: e.target.value }))} placeholder="<div>Signature</div>" /></div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} className="rounded" /><span className="text-sm">{t('setAsDefault')}</span></label>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel')}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('savingEllipsis') : t('create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function VendorsTab() {
  const { t } = useTranslation('laboratory');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ vendor_name: '', vendor_code: '', contact_person: '', contact_no: '', email: '', address: '' });

  const { data: rawData, isLoading: loading } = useApiQuery<any>(
    queryKeys.labSettings.vendors(),
    '/api/lab-settings/vendors',
  );
  const items = rawData?.data ?? [];

  const createMutation = useApiMutation<any, any>('post', '/api/lab-settings/vendors', {
    onSuccess: () => { toast.success(t('vendorCreated')); setShowForm(false); queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all }); },
    onError: (err) => { toast.error(err.message || t('failed')); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('deactivateVendorConfirm'))) return;
    try {
      const { api } = await import('../lib/apiClient');
      await api.delete(`/api/lab-settings/vendors/${id}`);
      toast.success(t('deactivated'));
      queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('newVendor')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('vendorName')}</th><th>{t('code')}</th><th>{t('contact')}</th><th>{t('email')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={6} />
            : items.length === 0 ? <tr><td colSpan={6}><EmptyState icon={<Truck className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noVendors')} description={t('noVendorsDesc')} action={<button onClick={() => setShowForm(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('newVendor')}</button>} /></td></tr>
            : items.map((v: any) => <tr key={v.id}><td className="font-medium">{v.vendor_name}</td><td className="font-data text-sm">{v.vendor_code ?? '—'}</td><td>{v.contact_person ? `${v.contact_person}${v.contact_no ? ` — ${v.contact_no}` : ''}` : (v.contact_no ?? '—')}</td><td>{v.email ?? '—'}</td><td><span className={`badge ${v.is_active ? 'badge-success' : 'badge-warning'}`}>{v.is_active ? t('active') : t('inactive')}</span></td><td><button onClick={() => handleDelete(v.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></td></tr>)}
        </tbody>
      </table></div></div>
      {showForm && <Modal title={t('newVendorTitle')} onClose={() => setShowForm(false)}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('vendorNameLabel')}</label><input className="input" required value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('code')}</label><input className="input" value={form.vendor_code} onChange={e => setForm(f => ({ ...f, vendor_code: e.target.value }))} /></div>
            <div><label className="label">{t('contactPerson')}</label><input className="input" value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('phone')}</label><input className="input" value={form.contact_no} onChange={e => setForm(f => ({ ...f, contact_no: e.target.value }))} /></div>
            <div><label className="label">{t('email')}</label><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          </div>
          <div><label className="label">{t('address')}</label><input className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel')}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('savingEllipsis') : t('create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function RunNumberTab() {
  const { t } = useTranslation('laboratory');
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ prefix: 'LAB', starting_number: '1', padding_digits: '5', reset_period: 'yearly' });

  const { data: config, isLoading: loading } = useApiQuery<any>(
    queryKeys.labSettings.runNumber(),
    '/api/lab-settings/run-number-settings',
  );

  useEffect(() => {
    if (config) setForm({ prefix: config.prefix ?? 'LAB', starting_number: String(config.starting_number ?? 1), padding_digits: String(config.padding_digits ?? 5), reset_period: config.reset_period ?? 'yearly' });
  }, [config]);

  const saveMutation = useApiMutation<any, any>('put', '/api/lab-settings/run-number-settings', {
    onSuccess: () => { toast.success(t('runNumberSaved')); queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all }); },
    onError: (err) => { toast.error(err.message || t('failed')); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...form, starting_number: parseInt(form.starting_number), padding_digits: parseInt(form.padding_digits) });
  };

  const preview = `${form.prefix}-${String(form.starting_number || 1).padStart(parseInt(form.padding_digits) || 5, '0')}`;
  return (
    <div className="max-w-lg">
      {loading ? <div className="card p-6"><div className="skeleton h-48 rounded-lg" /></div> : (
        <div className="card p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1"><Hash className="w-5 h-5 text-[var(--color-primary)]" /><h3 className="font-semibold">{t('runNumberConfig')}</h3></div>
          <p className="text-sm text-[var(--color-text-secondary)]">{t('runNumberDesc')}</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">{t('prefix')}</label><input className="input" value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value }))} placeholder="e.g. LAB" /></div>
              <div><label className="label">{t('startingNumber')}</label><input className="input" type="number" min="1" value={form.starting_number} onChange={e => setForm(f => ({ ...f, starting_number: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">{t('paddingDigits')}</label><input className="input" type="number" min="1" max="10" value={form.padding_digits} onChange={e => setForm(f => ({ ...f, padding_digits: e.target.value }))} /></div>
              <div><label className="label">{t('resetPeriod')}</label><select className="input" value={form.reset_period} onChange={e => setForm(f => ({ ...f, reset_period: e.target.value }))}><option value="daily">{t('daily')}</option><option value="monthly">{t('monthly')}</option><option value="yearly">{t('yearly')}</option><option value="never">{t('never')}</option></select></div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--color-border-light)] flex items-center gap-2">
              <span className="text-sm text-[var(--color-text-secondary)]">{t('preview')}:</span>
              <span className="font-data font-semibold text-[var(--color-primary)]">{preview}</span>
            </div>
            <div className="flex justify-end"><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('savingEllipsis') : t('saveSettings')}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function ReferenceRangesTab() {
  const { t } = useTranslation('laboratory');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ test_name: '', gender: 'all', age_from: '', age_to: '', min_value: '', max_value: '', unit: '' });

  const { data: rawData, isLoading: loading } = useApiQuery<any>(
    queryKeys.labSettings.referenceRanges(),
    '/api/lab-components/reference-ranges',
  );
  const items = rawData?.data ?? [];

  const createMutation = useApiMutation<any, any>('post', '/api/lab-components/reference-ranges', {
    onSuccess: () => { toast.success(t('rangeCreated')); setShowForm(false); queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all }); },
    onError: (err) => { toast.error(err.message || t('failed')); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      ...form,
      age_from: form.age_from ? parseInt(form.age_from) : null,
      age_to: form.age_to ? parseInt(form.age_to) : null,
      min_value: form.min_value ? parseFloat(form.min_value) : null,
      max_value: form.max_value ? parseFloat(form.max_value) : null,
    });
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      const { api } = await import('../lib/apiClient');
      await api.delete(`/api/lab-components/reference-ranges/${id}`);
      toast.success(t('deleted'));
      queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  };

  const genderLabel = (g: string) => {
    if (g === 'male') return t('male');
    if (g === 'female') return t('female');
    if (g === 'child') return t('child');
    return t('all');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('newRange')}</button></div>
      <div className="card overflow-hidden">
        {loading ? <div className="p-4"><SkeletonRows cols={6} /></div>
          : items.length === 0 ? <div className="p-8"><EmptyState icon={<Scale className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noRanges')} description={t('noRangesDesc')} action={<button onClick={() => setShowForm(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('newRange')}</button>} /></div>
          : <div className="divide-y divide-[var(--color-border)]">
            {Object.entries(
              items.reduce((groups: Record<string, any[]>, r: any) => {
                const key = r.test_name || 'Unknown';
                if (!groups[key]) groups[key] = [];
                groups[key].push(r);
                return groups;
              }, {})
            ).map(([testName, ranges]: [string, any]) => (
              <div key={testName} className="p-4">
                <div className="flex items-center justify-between bg-[var(--color-bg-secondary)] px-4 py-2 rounded-t-lg border border-[var(--color-border)]">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-[var(--color-text-primary)]">{testName}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{ranges.length} range{ranges.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div className="border-x border-b border-[var(--color-border)] rounded-b-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {ranges.map((r: any, idx: number) => (
                        <tr key={r.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-[var(--color-bg-secondary)]'}`}>
                          <td className="px-4 py-2"><span className="badge badge-info text-[10px]">{genderLabel(r.gender)}</span></td>
                          <td className="px-4 py-2 text-[var(--color-text-secondary)]">{r.age_from ?? '—'} – {r.age_to ?? '—'} {t('years')}</td>
                          <td className="px-4 py-2 font-data">{r.min_value ?? '—'} – {r.max_value ?? '—'}</td>
                          <td className="px-4 py-2 text-[var(--color-text-muted)]">{r.unit ?? '—'}</td>
                          <td className="px-4 py-2 text-right"><button onClick={() => handleDelete(r.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          }
        </div>
      {showForm && <Modal title={t('newRangeTitle')} onClose={() => setShowForm(false)}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('testName')} *</label><input className="input" required value={form.test_name} onChange={e => setForm(f => ({ ...f, test_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('gender')}</label><select className="input" value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
              <option value="all">{t('all')}</option>
              <option value="male">{t('male')}</option>
              <option value="female">{t('female')}</option>
              <option value="child">{t('child')}</option>
            </select></div>
            <div><label className="label">{t('unit')}</label><input className="input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('ageFrom')}</label><input className="input" type="number" min="0" value={form.age_from} onChange={e => setForm(f => ({ ...f, age_from: e.target.value }))} /></div>
            <div><label className="label">{t('ageTo')}</label><input className="input" type="number" min="0" value={form.age_to} onChange={e => setForm(f => ({ ...f, age_to: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('minValue')}</label><input className="input" type="number" step="any" value={form.min_value} onChange={e => setForm(f => ({ ...f, min_value: e.target.value }))} /></div>
            <div><label className="label">{t('maxValue')}</label><input className="input" type="number" step="any" value={form.max_value} onChange={e => setForm(f => ({ ...f, max_value: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel')}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('savingEllipsis') : t('create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function GovReportingTab() {
  const { t } = useTranslation('laboratory');
  const [reportType, setReportType] = useState('monthly');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const handleGenerate = () => {
    toast.success(t('reportGenerated', { type: reportType, month }));
  };

  return (
    <div className="max-w-lg space-y-5">
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2 mb-1"><Landmark className="w-5 h-5 text-[var(--color-primary)]" /><h3 className="font-semibold">{t('govReportConfig')}</h3></div>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('govReportDesc')}</p>
        <div className="space-y-4">
          <div>
            <label className="label">{t('reportType')}</label>
            <select className="input" value={reportType} onChange={e => setReportType(e.target.value)}>
              <option value="monthly">{t('monthlyReport')}</option>
              <option value="quarterly">{t('quarterlyReport')}</option>
              <option value="dengue">{t('dengueReport')}</option>
              <option value="tb">{t('tbReport')}</option>
            </select>
          </div>
          <div>
            <label className="label">{t('period')}</label>
            <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={handleGenerate} className="btn-primary">{t('generateReport')}</button>
          </div>
        </div>
      </div>

      <div className="card p-6 space-y-3">
        <h4 className="font-medium text-sm">{t('recentGovReports')}</h4>
        <div className="space-y-2">
          {[
            { type: 'monthly', period: '2024-01', status: 'submitted' },
            { type: 'dengue', period: '2024-W03', status: 'pending' },
          ].map((r, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-border-light)]">
              <div>
                <p className="text-sm font-medium">{t(`reportTypes.${r.type}`)}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{r.period}</p>
              </div>
              <span className={`badge ${r.status === 'submitted' ? 'badge-success' : 'badge-warning'} text-[10px]`}>{t(r.status)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RejectionReasonsTab() {
  const { t } = useTranslation('laboratory');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ reason: '', code: '', category: 'pre_analytical', is_active: true });

  const { data: rawData, isLoading: loading } = useApiQuery<any>(
    queryKeys.labSettings.rejectionReasons(),
    '/api/lab-components/rejection-reasons',
  );
  const items = rawData?.data ?? [];

  const createMutation = useApiMutation<any, any>('post', '/api/lab-components/rejection-reasons', {
    onSuccess: () => { toast.success(t('reasonCreated')); setShowForm(false); queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all }); },
    onError: (err) => { toast.error(err.message || t('failed')); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      const { api } = await import('../lib/apiClient');
      await api.delete(`/api/lab-components/rejection-reasons/${id}`);
      toast.success(t('deleted'));
      queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  };

  const categoryLabel = (c: string) => {
    if (c === 'pre_analytical') return t('preAnalytical');
    if (c === 'analytical') return t('analytical');
    if (c === 'post_analytical') return t('postAnalytical');
    return c;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('newReason')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('reason')}</th><th>{t('code')}</th><th>{t('category')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : items.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<XCircle className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noRejectionReasons')} description={t('noRejectionReasonsDesc')} action={<button onClick={() => setShowForm(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('newReason')}</button>} /></td></tr>
            : items.map((r: any) => <tr key={r.id}>
                <td className="font-medium">{r.reason}</td>
                <td className="font-data text-sm">{r.code ?? '—'}</td>
                <td><span className="badge badge-info text-[10px]">{categoryLabel(r.category)}</span></td>
                <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-warning'}`}>{r.is_active ? t('active') : t('inactive')}</span></td>
                <td><button onClick={() => handleDelete(r.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></td>
              </tr>)}
        </tbody>
      </table></div></div>
      {showForm && <Modal title={t('newReasonTitle')} onClose={() => setShowForm(false)}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('reason')} *</label><input className="input" required value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('code')}</label><input className="input" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
            <div><label className="label">{t('category')}</label><select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              <option value="pre_analytical">{t('preAnalytical')}</option>
              <option value="analytical">{t('analytical')}</option>
              <option value="post_analytical">{t('postAnalytical')}</option>
            </select></div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" /><span className="text-sm">{t('active')}</span></label>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel')}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('savingEllipsis') : t('create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function CatalogTab() {
  const { t } = useTranslation('laboratory');
  const queryClient = useQueryClient();

  // State
  const [showForm, setShowForm] = useState(false);
  const [editingTest, setEditingTest] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<'upsert' | 'replace_all'>('upsert');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: '',
    code: '',
    category: '',
    price: '',
    unit: '',
    normal_range: '',
    method: '',
    is_commissionable: '1',
  });

  // Fetch tests from /api/lab
  const { data: rawTests, isLoading: loading } = useApiQuery<any>(
    queryKeys.lab.catalog(),
    '/api/lab?status=all',
  );

  // Fetch categories for dropdown
  const { data: rawCategories } = useApiQuery<any>(
    queryKeys.labSettings.categories(),
    '/api/lab-settings/categories',
  );

  const tests = rawTests?.tests ?? [];
  const categories = rawCategories?.data ?? [];

  const categoryOptions = (() => {
    const byName = new Map<string, { id: string | number; category_name: string }>();
    categories.forEach((cat: any) => {
      if (cat?.category_name) byName.set(cat.category_name, { id: cat.id ?? cat.category_name, category_name: cat.category_name });
    });
    tests.forEach((test: any) => {
      if (test?.category && !byName.has(test.category)) {
        byName.set(test.category, { id: test.category, category_name: test.category });
      }
    });
    return Array.from(byName.values()).sort((a, b) => a.category_name.localeCompare(b.category_name));
  })();

  // Filter tests based on search and filters
  const filteredTests = tests.filter((test: any) => {
    // Status filter
    if (statusFilter === 'active' && !test.is_active) return false;
    if (statusFilter === 'inactive' && test.is_active) return false;

    // Category filter
    if (categoryFilter && test.category !== categoryFilter) return false;

    // Search filter
    if (search) {
      const s = search.toLowerCase();
      return (
        test.name?.toLowerCase().includes(s) ||
        test.code?.toLowerCase().includes(s) ||
        test.category?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  // Create mutation
  const createMutation = useApiMutation<any, any>('post', '/api/lab', {
    onSuccess: () => {
      toast.success(t('testCreated'));
      setShowForm(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.lab.all });
    },
    onError: (err) => toast.error(err.message || t('failed')),
  });

  // Update mutation
  const updateMutation = useApiMutation<any, any>('put', (payload) => `/api/lab/${payload.id}`, {
    onSuccess: () => {
      toast.success(t('testUpdated'));
      setShowForm(false);
      setEditingTest(null);
      resetForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.lab.all });
    },
    onError: (err) => toast.error(err.message || t('failed')),
  });

  // Delete mutation (soft delete)
  const deleteMutation = useApiMutation<any, number>('delete', (id) => `/api/lab/${id}`, {
    onSuccess: () => {
      toast.success(t('testDeactivated'));
      queryClient.invalidateQueries({ queryKey: queryKeys.lab.all });
    },
    onError: (err) => toast.error(err.message || t('failed')),
  });

  const resetForm = () => {
    setForm({ name: '', code: '', category: '', price: '', unit: '', normal_range: '', method: '', is_commissionable: '1' });
  };

  const handleOpenAdd = () => {
    setEditingTest(null);
    resetForm();
    setShowForm(true);
  };

  const handleOpenEdit = (test: any) => {
    setEditingTest(test);
    setForm({
      name: test.name || '',
      code: test.code || '',
      category: test.category || '',
      price: test.price?.toString() || '',
      unit: test.unit || '',
      normal_range: test.normal_range || '',
      method: test.method || '',
      is_commissionable: test.is_commissionable === 0 ? '0' : '1',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...form,
      price: Math.round(Number(form.price) || 0),
      is_commissionable: Number(form.is_commissionable),
    };

    if (editingTest) {
      updateMutation.mutate({ ...payload, id: editingTest.id });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('deactivateConfirm'))) return;
    deleteMutation.mutate(id);
  };

  const handleDownloadTemplate = () => {
    const csv = [
      'kind,code,name,category,price,unit,normal_range,method,active',
      'lab,CBC,Complete Blood Count,Hematology,500,,,"Automated",1',
      'radiology,XR-CHEST,Chest X-Ray,X-Ray,800,,,,1',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'diagnostic-catalog-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (importMode === 'replace_all' && !window.confirm('Replace current lab and radiology catalog with this CSV? Existing catalog rows will be deactivated.')) {
      return;
    }
    setImporting(true);
    try {
      const { api } = await import('../lib/apiClient');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', importMode);
      const result = await api.post('/api/lab/catalog/bulk-import', formData) as any;
      toast.success(`Imported ${result.success ?? 0}; failed ${result.failed ?? 0}${result.replaced ? `; replaced ${result.replaced}` : ''}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.lab.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.radiology.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
    } catch (err: any) {
      toast.error(err.message || t('failed'));
    } finally {
      setImporting(false);
    }
  };

  const handleToggleActive = async (test: any) => {
    try {
      const { api } = await import('../lib/apiClient');
      const newStatus = test.is_active ? 0 : 1;
      await api.put(`/api/lab/${test.id}`, { is_active: newStatus });
      toast.success(test.is_active ? t('testDeactivated') : t('testActivated'));
      queryClient.invalidateQueries({ queryKey: queryKeys.lab.all });
    } catch (err: any) {
      toast.error(err.message || t('failed'));
    }
  };

  // Get unique categories for filter dropdown
  const uniqueCategories = [...new Set(tests.map((t: any) => t.category).filter(Boolean) as string[])];

  return (
    <div className="space-y-4">
      {/* Header with filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {/* Search */}
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-48"
          />
          {/* Status filter */}
          <select
            className="input w-32"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">{t('all')}</option>
            <option value="active">{t('active')}</option>
            <option value="inactive">{t('inactive')}</option>
          </select>
          {/* Category filter */}
          <select
            className="input w-40"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">{t('allCategories')}</option>
            {uniqueCategories.map((cat: string) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="input w-40"
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as 'upsert' | 'replace_all')}
            title="CSV import mode"
          >
            <option value="upsert">Update existing</option>
            <option value="replace_all">Replace catalog</option>
          </select>
          <button onClick={handleDownloadTemplate} className="btn-secondary" title="CSV template">
            <Download className="w-4 h-4" />CSV
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="btn-secondary">
            <Upload className="w-4 h-4" />{importing ? 'Importing' : 'Import CSV'}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
          <button onClick={handleOpenAdd} className="btn-primary">
            <Plus className="w-4 h-4" />{t('addTest')}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('testName')}</th>
                <th>{t('code')}</th>
                <th>{t('category')}</th>
                <th>{t('price')}</th>
                <th>{t('unit')}</th>
                <th>Billing</th>
                <th>{t('commissionEligible')}</th>
                <th>{t('status')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={9} />
              ) : filteredTests.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon={<List className="w-8 h-8" />}
                      title={t('noTests')}
                      description={t('noTestsDesc')}
                      action={
                        <button onClick={handleOpenAdd} className="btn-primary mt-2">
                          <Plus className="w-4 h-4" />{t('addTest')}
                        </button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                filteredTests.map((test: any) => (
                  <tr key={test.id}>
                    <td className="font-medium">{test.name}</td>
                    <td className="font-data text-sm">{test.code}</td>
                    <td>{test.category || '—'}</td>
                    <td className="font-data">{test.price ? `৳${test.price}` : '—'}</td>
                    <td className="text-[var(--color-text-secondary)]">{test.unit || '—'}</td>
                    <td>
                      {test.billing_service_item_id ? (
                        <span className="badge badge-success inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Synced</span>
                      ) : (
                        <span className="badge badge-warning inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Missing</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${test.is_commissionable === 0 ? 'badge-warning' : 'badge-success'}`}>
                        {test.is_commissionable === 0 ? t('noCommissionBadge') : t('commissionEligibleBadge')}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${test.is_active ? 'badge-success' : 'badge-warning'}`}>
                        {test.is_active ? t('active') : t('inactive')}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => handleOpenEdit(test)} className="btn-ghost p-1.5">
                          <FileText className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(test)}
                          className={`btn-ghost p-1.5 ${test.is_active ? 'text-orange-500' : 'text-green-500'}`}
                          title={test.is_active ? t('deactivateTestConfirm') : t('activate')}
                        >
                          {test.is_active ? <XCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <Modal
          title={editingTest ? t('editTest') : t('newTest')}
          onClose={() => { setShowForm(false); setEditingTest(null); resetForm(); }}
        >
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="label">{t('testNameLabel')} *</label>
              <input
                className="input"
                required
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={t('testNamePlaceholder')}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">{t('codeLabel')} *</label>
                <input
                  className="input"
                  required
                  value={form.code}
                  onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))}
                  placeholder={t('codePlaceholder')}
                />
              </div>
              <div>
                <label className="label">{t('priceLabel')} *</label>
                <input
                  className="input"
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder={t('pricePlaceholder')}
                />
              </div>
            </div>
            <div>
              <label className="label">{t('categoryLabel')} *</label>
              <select
                className="input"
                required
                value={form.category}
                onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
              >
                <option value="">{t('selectCategory')}</option>
                {categoryOptions.map((cat: any) => (
                  <option key={cat.id} value={cat.category_name}>{cat.category_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('commissionEligible')}</label>
              <select
                className="input"
                value={form.is_commissionable}
                onChange={(e) => setForm(f => ({ ...f, is_commissionable: e.target.value }))}
              >
                <option value="1">{t('commissionEligibleYes')}</option>
                <option value="0">{t('commissionEligibleNo')}</option>
              </select>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('commissionEligibleHint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">{t('unitLabel')}</label>
                <input
                  className="input"
                  value={form.unit}
                  onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder={t('unitPlaceholder')}
                />
              </div>
              <div>
                <label className="label">{t('methodLabel')}</label>
                <input
                  className="input"
                  value={form.method}
                  onChange={(e) => setForm(f => ({ ...f, method: e.target.value }))}
                  placeholder={t('methodPlaceholder')}
                />
              </div>
            </div>
            <div>
              <label className="label">{t('normalRangeLabel')}</label>
              <input
                className="input"
                value={form.normal_range}
                onChange={(e) => setForm(f => ({ ...f, normal_range: e.target.value }))}
                placeholder={t('normalRangePlaceholder')}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingTest(null); resetForm(); }}
                className="btn-secondary"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="btn-primary"
              >
                {createMutation.isPending || updateMutation.isPending ? t('savingEllipsis') : t('save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const TAB_MAP: Record<string, React.ComponentType> = {
  categories: CategoriesTab,
  catalog: CatalogTab,
  templates: TemplatesTab,
  vendors: VendorsTab,
  runnumber: RunNumberTab,
  reference_ranges: ReferenceRangesTab,
  gov_reporting: GovReportingTab,
  rejection_reasons: RejectionReasonsTab,
};

export default function LabSettingsPage({ role = 'hospital_admin' }: { role?: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<LabSettingsTabKey>(() => isLabSettingsTabKey(initialTab) ? initialTab : 'categories');
  const [helpOpen, setHelpOpen] = useState(false);
  const TabComponent = TAB_MAP[activeTab] ?? CategoriesTab;
  const { t } = useTranslation(['laboratory', 'common']);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (isLabSettingsTabKey(tab) && tab !== activeTab) setActiveTab(tab);
  }, [activeTab, searchParams]);
  return (
    <DashboardLayout role={role}>
      <HelpPanel pageKey="lab_settings" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <FlaskConical className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('diagnosticManagement', { defaultValue: 'Diagnostic Management' })}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
          <HelpButton onClick={() => setHelpOpen(true)} />
          <WhatsAppButton />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {DIAGNOSTIC_QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            const content = (
              <>
                <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--color-text-primary)]">{t(action.labelKey, { defaultValue: action.defaultLabel })}</div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">{action.description}</p>
                </div>
              </>
            );
            if (action.kind === 'tab') {
              return (
                <button
                  key={action.defaultLabel}
                  type="button"
                  onClick={() => { setActiveTab(action.tab); setSearchParams({ tab: action.tab }); }}
                  className="card p-4 text-left flex items-start gap-3 hover:border-[var(--color-primary)] hover:shadow-md transition-all"
                >
                  {content}
                </button>
              );
            }
            return (
              <Link key={action.defaultLabel} to={action.path} className="card p-4 flex items-start gap-3 hover:border-[var(--color-primary)] hover:shadow-md transition-all">
                {content}
              </Link>
            );
          })}
        </div>

        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => { const Icon = tab.icon; return (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSearchParams({ tab: tab.key }); }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            ><Icon className="w-4 h-4" />{t(tab.labelKey)}</button>
          ); })}
        </div>
        <TabComponent />
      </div>
    </DashboardLayout>
  );
}
