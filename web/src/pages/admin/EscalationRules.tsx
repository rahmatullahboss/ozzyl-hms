import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { Bell, Clock, ArrowUpRight, Plus } from 'lucide-react';

interface EscalationRule {
  id: string;
  name: string;
  category: string;
  triggerCondition: string;
  steps: Array<{ delayMinutes: number; notifyRole: string; notifyUser?: string }>;
  status: string;
}

interface EscalationData {
  rules: EscalationRule[];
  summary?: { totalRules: number; activeRules: number; categories: number };
}

const CATEGORY_BADGE: Record<string, string> = {
  cash_dispute: 'bg-red-100 text-red-700',
  pending_approval: 'bg-yellow-100 text-yellow-700',
  high_discount: 'bg-orange-100 text-orange-700',
  refund_request: 'bg-purple-100 text-purple-700',
  stock_low: 'bg-blue-100 text-blue-700',
  ipd_due: 'bg-pink-100 text-pink-700',
};

export default function EscalationRules() {
  const { t } = useTranslation('adminPages');

  const { data, isLoading } = useApiQuery<EscalationData>(
    queryKeys.admin.escalationRules(),
    `/api/admin/escalation-rules`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('escalationRules.loading')}</div></DashboardLayout>;
  }

  const rules = data?.rules ?? [];
  const summary = data?.summary;

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('escalationRules.title')}</h1>
            <p className="text-sm text-gray-500">{t('escalationRules.subtitle')}</p>
          </div>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
            <Plus className="w-4 h-4" /> {t('escalationRules.actions.addRule')}
          </button>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('escalationRules.summary.totalRules')}</div>
              <div className="text-2xl font-bold">{summary.totalRules}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('escalationRules.summary.activeRules')}</div>
              <div className="text-2xl font-bold text-green-600">{summary.activeRules}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('escalationRules.summary.categories')}</div>
              <div className="text-2xl font-bold text-blue-600">{summary.categories}</div>
            </div>
          </div>
        )}

        {rules.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{t('escalationRules.empty')}</div>
        ) : (
          <div className="space-y-4">
            {rules.map((rule) => (
              <div key={rule.id} className="bg-white rounded-lg border p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Bell className="w-5 h-5 text-gray-400" />
                    <div>
                      <h3 className="font-semibold">{rule.name}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_BADGE[rule.category] ?? 'bg-gray-100 text-gray-600'}`}>
                        {rule.category.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${rule.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {rule.status}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-3">{rule.triggerCondition}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500 font-medium">Escalation Steps:</span>
                  {rule.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-1">
                      {i > 0 && <ArrowUpRight className="w-3 h-3 text-gray-400" />}
                      <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {step.delayMinutes}min → {step.notifyRole}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
