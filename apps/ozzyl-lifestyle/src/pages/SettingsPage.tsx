import { useState, useEffect, useRef } from 'react';
import { ChevronRight, Save, Building2, CreditCard, Users, Bell, Upload, Trash2, ImageIcon } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { compressImage } from '../lib/compressImage';
import { applyDynamicManifest, applyPwaIcons } from '../lib/pwaPrompt';

interface HospitalSettings {
  share_price: string;
  total_shares: string;
  profit_percentage: string;
  profit_partner_count: string;
  owner_partner_count: string;
  shares_per_profit_partner: string;
  fire_service_charge: string;
  ambulance_charge: string;
}

interface HospitalInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  registration_number: string;
}

type Tab = 'hospital' | 'billing' | 'shares' | 'notifications';

const TABS: { id: Tab; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'hospital',      labelKey: 'hospitalInfo',    icon: <Building2 className="w-4 h-4" /> },
  { id: 'billing',       labelKey: 'billingCharges',  icon: <CreditCard className="w-4 h-4" /> },
  { id: 'shares',        labelKey: 'shareSystem',     icon: <Users className="w-4 h-4" /> },
  { id: 'notifications', labelKey: 'notifications',    icon: <Bell className="w-4 h-4" /> },
];

const NOTIFICATION_OPTIONS = [
  { key: 'low_stock',     labelKey: 'notifLowStock',     descKey: 'notifLowStockDesc' },
  { key: 'daily_summary', labelKey: 'notifDailySummary',  descKey: 'notifDailySummaryDesc' },
  { key: 'new_patient',   labelKey: 'notifNewPatient',    descKey: 'notifNewPatientDesc' },
  { key: 'failed_login',  labelKey: 'notifFailedLogin',   descKey: 'notifFailedLoginDesc' },
] as const;

function Field({ label, type = 'text', value, onChange, placeholder, hint, disabled }: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; hint?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type={type} className="input" value={value} disabled={disabled}
        onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

export default function SettingsPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['settings', 'common']);
  const [settings, setSettings] = useState<HospitalSettings>({
    share_price: '100000', total_shares: '300', profit_percentage: '30',
    profit_partner_count: '100', owner_partner_count: '200',
    shares_per_profit_partner: '3', fire_service_charge: '50', ambulance_charge: '500',
  });
  const [hospitalInfo, setHospitalInfo] = useState<HospitalInfo>({
    name: localStorage.getItem('tenant') ?? '',
    address: '', phone: '', email: '', registration_number: '',
  });
  const [notifications, setNotifications] = useState<Record<string, boolean>>({
    low_stock: true, daily_summary: false, new_patient: true, failed_login: false,
  });
  const [loading,   setLoading]  = useState(true);
  const [saving,    setSaving]   = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('hospital');
  const [logoUrl,   setLogoUrl]  = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/settings', { headers: { Authorization: `Bearer ${token}` } });
      if (data.settings) {
        setSettings(s => ({ ...s, ...data.settings }));
        if (data.settings.hospital_logo_url) {
          setLogoUrl(data.settings.hospital_logo_url + '?t=' + Date.now());
        }
      }
      if (data.hospital_info) setHospitalInfo(h => ({ ...h, ...data.hospital_info }));
      if (data.notifications) setNotifications(n => ({ ...n, ...data.notifications }));
    } catch (err) {
      console.error('[Settings] Failed to fetch:', err);
      // use defaults silently
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      await axios.put('/api/settings', { ...settings, hospital_info: hospitalInfo, notifications }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success(t('settingsSaved'));
    } catch (err) {
      console.error('[Settings] Failed to save:', err);
      toast.error(t('settingsSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const s = settings;
  const sc = (k: keyof HospitalSettings) => (v: string) => setSettings(prev => ({ ...prev, [k]: v }));
  const hi = (k: keyof HospitalInfo) => (v: string) => setHospitalInfo(prev => ({ ...prev, [k]: v }));

  const toggleNotification = (key: string) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Logo upload / remove ──
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Compress on client side
      const compressed = await compressImage(file, 400, 0.8);
      const formData = new FormData();
      formData.append('logo', compressed, file.name);

      const token = localStorage.getItem('hms_token');
      await axios.post('/api/settings/logo', formData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const nextLogoUrl = '/api/settings/logo?t=' + Date.now();
      setLogoUrl(nextLogoUrl);
      applyPwaIcons(nextLogoUrl);
      applyDynamicManifest(nextLogoUrl);
      toast.success(t('logoUploadSuccess'));
    } catch (err) {
      console.error('[Settings] Logo upload error:', err);
      toast.error(t('logoUploadFailed'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLogoRemove = async () => {
    try {
      const token = localStorage.getItem('hms_token');
      await axios.delete('/api/settings/logo', { headers: { Authorization: `Bearer ${token}` } });
      setLogoUrl(null);
      applyPwaIcons(null);
      applyDynamicManifest(null);
      toast.success(t('logoRemoveSuccess'));
    } catch (err) {
      console.error('[Settings] Logo remove error:', err);
      toast.error(t('logoRemoveFailed'));
    }
  };

  const tabContent: Record<Tab, React.ReactNode> = {
    hospital: (
      <div className="space-y-4">
        {/* ── Hospital Logo ── */}
        <div className="flex items-center gap-5 p-4 rounded-xl bg-[var(--color-border-light)]">
          <div className="w-[88px] h-[88px] rounded-xl border-2 border-dashed border-[var(--color-border)] flex items-center justify-center overflow-hidden bg-white shrink-0">
            {logoUrl ? (
              <img src={logoUrl} alt="Hospital Logo" className="w-full h-full object-contain" />
            ) : (
              <ImageIcon className="w-8 h-8 text-[var(--color-text-muted)]" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('hospitalLogo')}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{t('hospitalLogoHint')}</p>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleLogoUpload}
                className="hidden"
                id="logo-upload"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="btn-secondary text-xs !py-1.5 !px-3 flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? t('uploading') : logoUrl ? t('changeLogo') : t('uploadLogo')}
              </button>
              {logoUrl && (
                <button
                  onClick={handleLogoRemove}
                  className="btn-secondary text-xs !py-1.5 !px-3 flex items-center gap-1.5 text-red-500 hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {t('remove')}
                </button>
              )}
            </div>
          </div>
        </div>

        <Field label={t('hospitalName')} value={hospitalInfo.name} onChange={hi('name')} placeholder={t('hospitalNamePlaceholder')}
          hint={t('hospitalNameHint')} />
        <Field label={t('hospitalAddress')} value={hospitalInfo.address} onChange={hi('address')} placeholder={t('hospitalAddressPlaceholder')} />
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('phone')} type="tel" value={hospitalInfo.phone} onChange={hi('phone')} placeholder={t('phonePlaceholder')} />
          <Field label={t('emailLabel')} type="email" value={hospitalInfo.email} onChange={hi('email')} placeholder={t('emailPlaceholder')} />
        </div>
        <Field label={t('registrationNumber')} value={hospitalInfo.registration_number} onChange={hi('registration_number')} placeholder={t('registrationNumberPlaceholder')} />
      </div>
    ),
    billing: (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('fireServiceCharge')} type="number" value={s.fire_service_charge} onChange={sc('fire_service_charge')} hint={t('fireServiceHint')} />
          <Field label={t('ambulanceCharge')}    type="number" value={s.ambulance_charge}    onChange={sc('ambulance_charge')} />
        </div>
        <div className="mt-4 p-4 bg-[var(--color-border-light)] rounded-xl">
          <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('exampleBill')}</p>
          <div className="space-y-1 text-sm text-[var(--color-text-muted)]">
            <div className="flex justify-between"><span>{t('doctorVisit')}</span><span>৳500</span></div>
            <div className="flex justify-between"><span>{t('tests')}</span><span>৳800</span></div>
            <div className="flex justify-between"><span>{t('fireService')}</span><span>৳{s.fire_service_charge}</span></div>
            <div className="flex justify-between font-semibold text-[var(--color-text-primary)] border-t border-[var(--color-border)] pt-1 mt-1">
              <span>{t('total')}</span><span>৳{1300 + Number(s.fire_service_charge)}</span>
            </div>
          </div>
        </div>
      </div>
    ),
    shares: (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('sharePrice')}          type="number" value={s.share_price}              onChange={sc('share_price')} />
          <Field label={t('totalShares')}             type="number" value={s.total_shares}             onChange={sc('total_shares')} />
          <Field label={t('profitPercentage')}    type="number" value={s.profit_percentage}        onChange={sc('profit_percentage')} />
          <Field label={t('profitPartnerCount')}     type="number" value={s.profit_partner_count}     onChange={sc('profit_partner_count')} />
          <Field label={t('ownerPartnerCount')}      type="number" value={s.owner_partner_count}      onChange={sc('owner_partner_count')} />
          <Field label={t('sharesPerProfitPartner')}  type="number" value={s.shares_per_profit_partner} onChange={sc('shares_per_profit_partner')} />
        </div>
        <div className="mt-2 p-4 bg-[var(--color-border-light)] rounded-xl text-sm text-[var(--color-text-secondary)] space-y-1">
          <div className="flex items-center gap-1.5"><ChevronRight className="w-4 h-4 text-[var(--color-primary)]" />1 share = ৳{Number(s.share_price).toLocaleString()}</div>
          <div className="flex items-center gap-1.5"><ChevronRight className="w-4 h-4 text-[var(--color-primary)]" />Total capital = ৳{(Number(s.share_price) * Number(s.total_shares)).toLocaleString()}</div>
          <div className="flex items-center gap-1.5"><ChevronRight className="w-4 h-4 text-[var(--color-primary)]" />{s.profit_percentage}% profit split among {s.profit_partner_count} partners</div>
          <div className="flex items-center gap-1.5"><ChevronRight className="w-4 h-4 text-[var(--color-primary)]" />Each partner holds {s.shares_per_profit_partner} shares</div>
        </div>
      </div>
    ),
    notifications: (
      <div className="space-y-4">
        {NOTIFICATION_OPTIONS.map(opt => {
          const isOn = notifications[opt.key] ?? false;
          return (
            <div key={opt.key} className="flex items-start justify-between gap-4 py-3 border-b border-[var(--color-border-light)] last:border-0">
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">{t(opt.labelKey)}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t(opt.descKey)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isOn}
                aria-label={t(opt.labelKey)}
                onClick={() => toggleNotification(opt.key)}
                className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${
                  isOn ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
                }`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  isOn ? 'right-1' : 'left-1'
                }`} />
              </button>
            </div>
          );
        })}
      </div>
    ),
  };

  return (
    <DashboardLayout role={role}>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="section-subtitle mt-1">{t('subtitle', { defaultValue: 'Configure hospital-wide preferences' })}</p>
        </div>

        <div className="flex flex-col md:flex-row gap-5">
          {/* ── Sidebar Tabs — horizontal on mobile ── */}
          <div className="md:w-48 shrink-0">
            <div className="card p-2 flex md:flex-col gap-0.5 overflow-x-auto">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap
                    ${activeTab === tab.id
                      ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]'
                    }`}
                >
                  {tab.icon} {t(tab.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* ── Content Panel ── */}
          <div className="flex-1">
            <div className="card p-5 space-y-5">
              <h2 className="section-title border-b border-[var(--color-border)] pb-3">
                {t(TABS.find(t => t.id === activeTab)?.labelKey ?? '')}
              </h2>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10 w-full rounded-lg" />)}
                </div>
              ) : (
                tabContent[activeTab]
              )}
              <div className="pt-2 border-t border-[var(--color-border)]">
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  <Save className="w-4 h-4" /> {saving ? t('loading', { ns: 'common' }) : t('saveChanges')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
