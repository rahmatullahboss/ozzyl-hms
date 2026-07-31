import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, Save, Shield, Bell, FileText, DollarSign, Wifi, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface OTSettingsData {
  default_cleaning_minutes: number;
  default_sterilization_minutes: number;
  vitals_reminder_minutes: number;
  emergency_override_allowed: number;
  hard_block_on_consent: number;
  hard_block_on_anesthesia_fitness: number;
  hard_block_on_payment: number;
  hard_block_on_blood: number;
  bill_post_requires_review: number;
  commission_calculation_enabled: number;
  auto_deduct_stock_on_post: number;
  offline_draft_enabled: number;
}

const DEFAULTS: OTSettingsData = {
  default_cleaning_minutes: 30,
  default_sterilization_minutes: 45,
  vitals_reminder_minutes: 5,
  emergency_override_allowed: 1,
  hard_block_on_consent: 1,
  hard_block_on_anesthesia_fitness: 1,
  hard_block_on_payment: 0,
  hard_block_on_blood: 0,
  bill_post_requires_review: 1,
  commission_calculation_enabled: 1,
  auto_deduct_stock_on_post: 1,
  offline_draft_enabled: 0,
};

function Section({ icon, title, desc, children }: {
  icon: React.ReactNode; title: string; desc?: string; children: React.ReactNode;
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-md bg-[var(--color-primary-light)] flex items-center justify-center">
          <span className="text-[var(--color-primary)]">{icon}</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
          {desc && <p className="text-xs text-[var(--color-text-muted)]">{desc}</p>}
        </div>
      </div>
      <div className="space-y-4 pl-10">{children}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-[var(--color-primary)]' : 'bg-slate-300 dark:bg-slate-600'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, hint }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; hint?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}
      </div>
      <input
        type="number"
        className="input w-20 text-right"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
      />
    </div>
  );
}

export default function OTSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantClinical']);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OTSettingsData>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useApiQuery<{ settings: OTSettingsData }>(
    queryKeys.ot.settings(),
    '/api/ot/settings',
  );

  useEffect(() => {
    if (data?.settings) {
      setForm({ ...DEFAULTS, ...data.settings });
      setDirty(false);
    }
  }, [data]);

  const saveMutation = useApiMutation<unknown, Partial<OTSettingsData>>(
    'put',
    '/api/ot/settings',
    {
      onSuccess: () => {
        toast.success(t('otSettings.toast.saved'));
        setDirty(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.settings() });
      },
      onError: (err) => toast.error(err.message || t('otSettings.toast.failed')),
    },
  );

  const handleSave = () => {
    saveMutation.mutate(form);
  };

  const update = <K extends keyof OTSettingsData>(key: K, value: OTSettingsData[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  };

  if (isLoading) {
    return (
      <DashboardLayout role={role}>
        <div className="space-y-5 max-w-screen-lg mx-auto">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-64 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-lg mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('otSettings.title')}</h1>
              <p className="section-subtitle">{t('otSettings.subtitle')}</p>
            </div>
          </div>
          <button onClick={handleSave} disabled={!dirty || saveMutation.isPending} className="btn-primary">
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? t('otSettings.saving') : t('otSettings.saveChanges')}
          </button>
        </div>

        {/* Room Defaults */}
        <Section icon={<Package className="w-4 h-4" />} title={t('otSettings.section.roomDefaults.title')} desc={t('otSettings.section.roomDefaults.desc')}>
          <NumberField label={t('otSettings.section.roomDefaults.cleaning')} value={form.default_cleaning_minutes} onChange={v => update('default_cleaning_minutes', v)} min={0} max={480} hint={t('otSettings.minutes')} />
          <NumberField label={t('otSettings.section.roomDefaults.sterilization')} value={form.default_sterilization_minutes} onChange={v => update('default_sterilization_minutes', v)} min={0} max={480} hint={t('otSettings.minutes')} />
        </Section>

        {/* Monitoring */}
        <Section icon={<Bell className="w-4 h-4" />} title={t('otSettings.section.monitoring.title')} desc={t('otSettings.section.monitoring.desc')}>
          <NumberField label={t('otSettings.section.monitoring.vitalsReminder')} value={form.vitals_reminder_minutes} onChange={v => update('vitals_reminder_minutes', v)} min={1} max={60} hint={t('otSettings.section.monitoring.vitalsReminderHint')} />
          <Toggle label={t('otSettings.section.monitoring.emergencyOverride')} checked={!!form.emergency_override_allowed} onChange={v => update('emergency_override_allowed', v ? 1 : 0)} hint={t('otSettings.section.monitoring.emergencyOverrideHint')} />
        </Section>

        {/* Hard Blocks */}
        <Section icon={<Shield className="w-4 h-4" />} title={t('otSettings.section.hardBlocks.title')} desc={t('otSettings.section.hardBlocks.desc')}>
          <Toggle label={t('otSettings.section.hardBlocks.blockConsent')} checked={!!form.hard_block_on_consent} onChange={v => update('hard_block_on_consent', v ? 1 : 0)} hint={t('otSettings.section.hardBlocks.blockConsentHint')} />
          <Toggle label={t('otSettings.section.hardBlocks.blockAnesthesia')} checked={!!form.hard_block_on_anesthesia_fitness} onChange={v => update('hard_block_on_anesthesia_fitness', v ? 1 : 0)} hint={t('otSettings.section.hardBlocks.blockAnesthesiaHint')} />
          <Toggle label={t('otSettings.section.hardBlocks.blockPayment')} checked={!!form.hard_block_on_payment} onChange={v => update('hard_block_on_payment', v ? 1 : 0)} hint={t('otSettings.section.hardBlocks.blockPaymentHint')} />
          <Toggle label={t('otSettings.section.hardBlocks.blockBlood')} checked={!!form.hard_block_on_blood} onChange={v => update('hard_block_on_blood', v ? 1 : 0)} hint={t('otSettings.section.hardBlocks.blockBloodHint')} />
        </Section>

        {/* Billing */}
        <Section icon={<DollarSign className="w-4 h-4" />} title={t('otSettings.section.billing.title')} desc={t('otSettings.section.billing.desc')}>
          <Toggle label={t('otSettings.section.billing.billPostReview')} checked={!!form.bill_post_requires_review} onChange={v => update('bill_post_requires_review', v ? 1 : 0)} hint={t('otSettings.section.billing.billPostReviewHint')} />
          <Toggle label={t('otSettings.section.billing.commissionCalc')} checked={!!form.commission_calculation_enabled} onChange={v => update('commission_calculation_enabled', v ? 1 : 0)} hint={t('otSettings.section.billing.commissionCalcHint')} />
          <Toggle label={t('otSettings.section.billing.autoDeductStock')} checked={!!form.auto_deduct_stock_on_post} onChange={v => update('auto_deduct_stock_on_post', v ? 1 : 0)} hint={t('otSettings.section.billing.autoDeductStockHint')} />
        </Section>

        {/* Offline */}
        <Section icon={<Wifi className="w-4 h-4" />} title={t('otSettings.section.offline.title')} desc={t('otSettings.section.offline.desc')}>
          <Toggle label={t('otSettings.section.offline.offlineDraft')} checked={!!form.offline_draft_enabled} onChange={v => update('offline_draft_enabled', v ? 1 : 0)} hint={t('otSettings.section.offline.offlineDraftHint')} />
        </Section>

      </div>
    </DashboardLayout>
  );
}
