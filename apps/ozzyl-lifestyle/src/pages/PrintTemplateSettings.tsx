import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Plus, X, Eye, Check, Settings, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

interface Template { id: number; template_type: string; template_name: string; hospital_name?: string; hospital_name_bn?: string; hospital_address?: string; hospital_phone?: string; logo_url?: string; paper_size: string; orientation: string; show_logo: number; show_hospital_name: number; is_default: number; is_active: number; }

const TYPES = ['prescription','bill','lab_report','discharge','patient_card','birth_certificate','death_certificate','appointment_slip','admission_card','referral_letter'];
const PAPER_SIZES = ['a4','a5','letter','legal','thermal_80mm','thermal_58mm'];

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const { t } = useTranslation('settings');
  return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm"><div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal ${wide ? 'w-full max-w-4xl' : 'w-full max-w-lg'} max-h-[90vh] overflow-y-auto`}><div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div><div className="p-5 space-y-4">{children}</div></div></div>);
}

export default function PrintTemplateSettings({ role }: { role?: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    template_type: 'prescription', template_name: '', hospital_name: '', hospital_name_bn: '',
    hospital_address: '', hospital_phone: '', hospital_email: '', hospital_website: '',
    logo_url: '', paper_size: 'a4', orientation: 'portrait',
    margin_top_mm: 10, margin_bottom_mm: 10, margin_left_mm: 10, margin_right_mm: 10,
    header_html: '', body_html: '', footer_html: '', css_overrides: '',
    show_logo: true, show_hospital_name: true, show_watermark: false, watermark_text: '',
    font_size_px: 12, is_default: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (typeFilter) params.type = typeFilter;
      const { data } = await axios.get('/api/print-templates', { params, headers: authHeader() });
      setTemplates(data?.data ?? []);
    } catch { setTemplates([]); } finally { setLoading(false); }
  }, [typeFilter]);
  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/print-templates', form, { headers: authHeader() });
      toast.success(t('settings.template_saved')); setShowForm(false); load();
    } catch { toast.error(t('settings.failed')); } finally { setSaving(false); }
  };

  const preview = (id: number) => {
    window.open(`/api/print-templates/${id}/preview`, '_blank');
  };

  const setDefault = async (id: number) => {
    try { await axios.put(`/api/print-templates/${id}`, { is_default: true }, { headers: authHeader() }); toast.success(t('settings.set_as_default')); load(); } catch { toast.error(t('settings.failed')); }
  };

  const deleteTemplate = async (id: number) => {
    try { await axios.delete(`/api/print-templates/${id}`, { headers: authHeader() }); toast.success(t('settings.deleted')); load(); } catch { toast.error(t('settings.failed')); }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20"><Printer className="w-5 h-5 text-white" /></div>
          <div><h1 className="page-title">Print Templates</h1><p className="section-subtitle">Customize print layouts for prescriptions, bills, reports & certificates</p></div>
        </div><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> New Template</button></div>

        <div className="flex gap-3 items-end">
          <select className="input w-44" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            {TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? [...Array(3)].map((_, i) => <div key={i} className="card p-5"><div className="skeleton h-6 w-3/4 rounded mb-3" /><div className="skeleton h-4 w-1/2 rounded" /></div>)
          : templates.length === 0 ? <div className="col-span-full card p-12 text-center"><Printer className="w-10 h-10 mx-auto text-[var(--color-text-muted)] mb-2 opacity-30" /><p className="text-[var(--color-text-muted)]">No templates. Create one to customize your print layouts.</p></div>
          : templates.map(t => (
            <div key={t.id} className={`card p-5 ${t.is_default ? 'border-2 border-[var(--color-primary)]' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold">{t.template_name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]"><span className="badge-neutral">{t.template_type.replace('_', ' ')}</span> · {t.paper_size.toUpperCase()}</p>
                </div>
                {t.is_default ? <span className="badge-success text-xs">Default</span> : null}
              </div>
              <div className="text-xs text-[var(--color-text-muted)] space-y-0.5 mb-3">
                {t.hospital_name && <p>{t.hospital_name}</p>}
                {t.hospital_address && <p>{t.hospital_address}</p>}
                {t.hospital_phone && <p>{t.hospital_phone}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => preview(t.id)} className="btn-ghost text-xs"><Eye className="w-3.5 h-3.5" /> Preview</button>
                {!t.is_default && <button onClick={() => setDefault(t.id)} className="btn-ghost text-xs"><Check className="w-3.5 h-3.5" /> Set Default</button>}
                <button onClick={() => deleteTemplate(t.id)} className="btn-ghost text-xs text-red-400"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <Modal title="Create Print Template" onClose={() => setShowForm(false)} wide>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('settings.type_')}</label><select className="input w-full" value={form.template_type} onChange={e => setForm({...form, template_type: e.target.value})}>{TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></div>
                <div><label className="label">Template Name *</label><input className="input w-full" required value={form.template_name} onChange={e => setForm({...form, template_name: e.target.value})} placeholder={t("settings.eg_a4_prescription_with_logo")} /></div>
              </div>

              <div className="border-t pt-4"><p className="text-sm font-semibold mb-3">Hospital Details</p></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('settings.hospital_name_en')}</label><input className="input w-full" value={form.hospital_name} onChange={e => setForm({...form, hospital_name: e.target.value})} /></div>
                <div><label className="label">{t('settings.hospital_name_bn')}</label><input className="input w-full" value={form.hospital_name_bn} onChange={e => setForm({...form, hospital_name_bn: e.target.value})} /></div>
              </div>
              <div><label className="label">{t('settings.address')}</label><input className="input w-full" value={form.hospital_address} onChange={e => setForm({...form, hospital_address: e.target.value})} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">{t('settings.phone')}</label><input className="input w-full" value={form.hospital_phone} onChange={e => setForm({...form, hospital_phone: e.target.value})} /></div>
                <div><label className="label">{t('settings.email')}</label><input className="input w-full" value={form.hospital_email} onChange={e => setForm({...form, hospital_email: e.target.value})} /></div>
                <div><label className="label">Logo URL</label><input className="input w-full" value={form.logo_url} onChange={e => setForm({...form, logo_url: e.target.value})} placeholder={t("settings.https")} /></div>
              </div>

              <div className="border-t pt-4"><p className="text-sm font-semibold mb-3">Layout</p></div>
              <div className="grid grid-cols-4 gap-3">
                <div><label className="label">{t('settings.paper_size')}</label><select className="input w-full" value={form.paper_size} onChange={e => setForm({...form, paper_size: e.target.value})}>{PAPER_SIZES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select></div>
                <div><label className="label">{t('settings.orientation')}</label><select className="input w-full" value={form.orientation} onChange={e => setForm({...form, orientation: e.target.value})}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></div>
                <div><label className="label">{t('settings.font_size')}</label><input className="input w-full" type="number" min={8} max={24} value={form.font_size_px} onChange={e => setForm({...form, font_size_px: Number(e.target.value)})} /></div>
                <div className="flex flex-col gap-1 pt-5">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.show_logo} onChange={e => setForm({...form, show_logo: e.target.checked})} /> Show Logo</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_default} onChange={e => setForm({...form, is_default: e.target.checked})} /> Set as Default</label>
                </div>
              </div>

              <div className="border-t pt-4"><p className="text-sm font-semibold mb-3">Custom HTML (Optional)</p></div>
              <div><label className="label">Header HTML</label><textarea className="input w-full font-mono text-xs" rows={3} value={form.header_html} onChange={e => setForm({...form, header_html: e.target.value})} placeholder={t("settings.leave_empty_for_autogenerated_header")} /></div>
              <div><label className="label">Body HTML (use {'{{variable}}'} placeholders)</label><textarea className="input w-full font-mono text-xs" rows={5} value={form.body_html} onChange={e => setForm({...form, body_html: e.target.value})} placeholder={t("settings.leave_empty_for_default_body_layout")} /></div>
              <div><label className="label">Footer HTML</label><textarea className="input w-full font-mono text-xs" rows={2} value={form.footer_html} onChange={e => setForm({...form, footer_html: e.target.value})} placeholder={t("settings.leave_empty_for_powered_by_ozzyl_health")} /></div>
              <div><label className="label">CSS Overrides</label><textarea className="input w-full font-mono text-xs" rows={3} value={form.css_overrides} onChange={e => setForm({...form, css_overrides: e.target.value})} placeholder={t("settings.header_color_navy_")} /></div>

              <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Create Template'}</button></div>
            </form>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}
