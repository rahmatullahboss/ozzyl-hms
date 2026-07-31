import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';

interface DiscountRule {
  id: string;
  name: string;
  scope: string;
  type: string;
  value: number;
  maxAmount: number;
  conditions: string;
  enabled: boolean;
}

interface DiscountRulesData {
  rules: DiscountRule[];
  summary?: {
    totalRules: number;
    activeRules: number;
    avgDiscount: number;
  };
}

const SCOPE_TABS = ['Global', 'Per-Department', 'Per-Doctor', 'Per-Branch'] as const;
type ScopeTab = (typeof SCOPE_TABS)[number];

const SCOPE_MAP: Record<ScopeTab, string> = {
  'Global': 'global',
  'Per-Department': 'department',
  'Per-Doctor': 'doctor',
  'Per-Branch': 'branch',
};

export default function DiscountRules() {
  const { t } = useTranslation('adminPages');
  const [activeScope, setActiveScope] = useState<ScopeTab>('Global');

  const { data, isLoading } = useApiQuery<DiscountRulesData>(
    queryKeys.admin.discountRules(),
    `/api/admin/discount-rules`
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <div className="p-6">{t('discountRules.loading')}</div>
      </DashboardLayout>
    );
  }

  const rules = data?.rules ?? [];
  const summary = data?.summary;
  const filtered = activeScope === 'Global'
    ? rules
    : rules.filter((r) => r.scope === SCOPE_MAP[activeScope]);

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('discountRules.title')}</h1>

        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('discountRules.summary.totalRules')}</div>
              <div className="text-2xl font-bold text-blue-600">{summary.totalRules}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('discountRules.summary.activeRules')}</div>
              <div className="text-2xl font-bold text-green-600">{summary.activeRules}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('discountRules.summary.avgDiscountPct')}</div>
              <div className="text-2xl font-bold text-orange-600">{summary.avgDiscount}%</div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {SCOPE_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveScope(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                activeScope === tab
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t(tab)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {t('discountRules.empty')}
          </div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Scope</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Type</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Value</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Max Amount</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Conditions</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rule) => (
                  <tr key={rule.id} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm font-medium">{rule.name}</td>
                    <td className="py-3 px-4 text-sm">
                      <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">
                        {rule.scope}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{rule.type}</td>
                    <td className="py-3 px-4 text-sm font-medium">
                      {rule.type === 'percentage' ? `${rule.value}%` : `৳${rule.value}`}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">৳{rule.maxAmount}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{rule.conditions}</td>
                    <td className="py-3 px-4 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          rule.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {rule.enabled ? t('discountRules.statusLabels.enabled') : t('discountRules.statusLabels.disabled')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
