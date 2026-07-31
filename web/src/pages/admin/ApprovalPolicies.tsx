import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';

interface ApprovalPolicy {
  id: string;
  name: string;
  action: string;
  condition: string;
  approver: string;
  attachmentRequired: boolean;
  pinRequired: boolean;
  escalationMinutes: number;
  enabled: boolean;
}

const ACTION_TABS = ['All', 'Discount', 'Refund', 'Write-Off', 'Override'] as const;
type ActionTab = (typeof ACTION_TABS)[number];

export default function ApprovalPolicies() {
  const { t } = useTranslation('adminPages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as ActionTab | null;
  const isValidTab = (val: string | null): val is ActionTab =>
    val !== null && ACTION_TABS.includes(val as ActionTab);
  const [activeTab, setActiveTabRaw] = useState<ActionTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'All';
    }
    return isValidTab(tabParam) ? tabParam : 'All';
  });
  const setActiveTab = (tab: ActionTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading } = useApiQuery<{ policies: ApprovalPolicy[] }>(
    queryKeys.admin.approvalPolicies(),
    `/api/admin/approval-policies`
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <div className="p-6">{t('approvalPolicies.loading')}</div>
      </DashboardLayout>
    );
  }

  const policies = data?.policies ?? [];
  const ACTION_FILTER_MAP: Record<ActionTab, string> = {
    'All': '',
    'Discount': 'discount',
    'Refund': 'refund',
    'Write-Off': 'write_off',
    'Override': 'override',
  };

  const filtered = activeTab === 'All'
    ? policies
    : policies.filter((p) => p.action === ACTION_FILTER_MAP[activeTab]);

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('approvalPolicies.title')}</h1>

        <div className="flex gap-2">
          {ACTION_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                activeTab === tab
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
            {t('approvalPolicies.empty')}
          </div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Action</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Condition</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Approver</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Attachment</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">PIN</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Escalation</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((policy) => (
                  <tr key={policy.id} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm font-medium">{policy.name}</td>
                    <td className="py-3 px-4 text-sm">
                      <span className="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-700">
                        {policy.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{policy.condition}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{policy.approver}</td>
                    <td className="py-3 px-4 text-sm">
                      {policy.attachmentRequired ? (
                        <span className="text-green-600 text-xs font-medium">Required</span>
                      ) : (
                        <span className="text-gray-400 text-xs">Optional</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {policy.pinRequired ? (
                        <span className="text-green-600 text-xs font-medium">Required</span>
                      ) : (
                        <span className="text-gray-400 text-xs">Optional</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{policy.escalationMinutes}m</td>
                    <td className="py-3 px-4 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          policy.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {policy.enabled ? t('approvalPolicies.statusLabels.enabled') : t('approvalPolicies.statusLabels.disabled')}
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
