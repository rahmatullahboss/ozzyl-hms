import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Settings, ChevronLeft, RefreshCw,
  Zap, Clock, Shield, Server,
} from 'lucide-react';
import adminApi from '../lib/adminApi';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';


export default function SuperAdminSettings() {
  const { t } = useTranslation(['super-admin', 'common']);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Array<{ id: string; name: string; priceMonthly: number; maxUsers: number | string }>>([]);
  const [addons, setAddons] = useState<Array<{ id: string; name: string; priceMonthly: number }>>([]);
  const [trialDays, setTrialDays] = useState(14);
  const navigate = useNavigate();

  useEffect(() => { fetchPlans(); }, []);

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/plans');
      setPlans(data.plans || []);
      setAddons(data.addons || []);
      setTrialDays(data.trialDays || 14);
    } catch {
      // API not available
      toast.error(t('superAdmin.loadPricingFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/super-admin/dashboard')} className="btn-ghost p-2">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <Settings className="w-6 h-6 text-[var(--color-primary)]" />
              {t('settingsTitle')}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('settingsSubtitle')}
            </p>
          </div>
        </div>
        <button onClick={fetchPlans} className="btn-ghost" title={t('refresh', { ns: 'common' })}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* System Info */}
      <div className="card p-6 mb-6">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-4 flex items-center gap-2">
          <Server className="w-4 h-4" /> {t('systemInfo')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4">
            <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('environment')}</p>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Production</p>
          </div>
          <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4">
            <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('platform')}</p>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Cloudflare Workers</p>
          </div>
          <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4">
            <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('database')}</p>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Cloudflare D1</p>
          </div>
          <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4">
            <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('version')}</p>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">v1.0.0</p>
          </div>
        </div>
      </div>

      {/* Trial Configuration */}
      <div className="card p-6 mb-6">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4" /> {t('trialConfig')}
        </h3>
        <div className="flex items-center gap-4">
          <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">{t('trialPeriod')}</p>
              <p className="text-xl font-bold text-[var(--color-text-primary)]">{trialDays} {t('days')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Plans */}
      <div className="card p-6 mb-6">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4" /> {t('pricingPlans')}
        </h3>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div key={plan.id} className="bg-[var(--color-bg-secondary)] rounded-xl p-5 border border-[var(--color-border)]">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-[var(--color-text-primary)]">{plan.name}</h4>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    plan.id === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                    plan.id === 'professional' ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-700'
                  }`}>
                    {plan.id}
                  </span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">{t('monthlyPrice')}</span>
                    <span className="font-semibold">৳{plan.priceMonthly.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">{t('maxUsers')}</span>
                    <span className="font-semibold">{plan.maxUsers === 'unlimited' ? '∞' : plan.maxUsers}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add-ons */}
      {addons.length > 0 && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4" /> {t('addons')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {addons.map((addon) => (
              <div key={addon.id} className="bg-[var(--color-bg-secondary)] rounded-lg p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{addon.name}</span>
                <span className="text-sm font-semibold text-[var(--color-text-secondary)]">৳{addon.priceMonthly}/mo</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
