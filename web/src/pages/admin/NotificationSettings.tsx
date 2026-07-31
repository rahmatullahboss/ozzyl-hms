import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { useSearchParams } from 'react-router';

interface NotificationRule {
  id: string;
  name: string;
  event: string;
  channel: string;
  recipients: string;
  enabled: boolean;
}

const CHANNELS = ['All', 'Email', 'SMS', 'In-App'] as const;
type Channel = (typeof CHANNELS)[number];

export default function NotificationSettings() {
  const { t } = useTranslation('adminPages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Channel | null;
  const isValidTab = (val: string | null): val is Channel =>
    val !== null && CHANNELS.includes(val as Channel);
  const [activeChannel, setActiveChannelRaw] = useState<Channel>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'All';
    }
    return isValidTab(tabParam) ? tabParam : 'All';
  });
  const setActiveChannel = (tab: Channel) => {
    setActiveChannelRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading } = useApiQuery<{ rules: NotificationRule[] }>(
    queryKeys.admin.notificationRules(),
    `/api/admin/notifications/rules`
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <div className="p-6">{t('notificationSettings.loading')}</div>
      </DashboardLayout>
    );
  }

  const rules = data?.rules ?? [];
  const CHANNEL_FILTER_MAP: Record<Channel, string> = {
    'All': '',
    'Email': 'email',
    'SMS': 'sms',
    'In-App': 'in_app',
  };

  const filtered = activeChannel === 'All'
    ? rules
    : rules.filter((r) => r.channel === CHANNEL_FILTER_MAP[activeChannel]);

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('notificationSettings.title')}</h1>

        <div className="flex gap-2">
          {CHANNELS.map((ch) => (
            <button
              key={ch}
              onClick={() => setActiveChannel(ch)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                activeChannel === ch
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t(ch)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {t('notificationSettings.empty')}
          </div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Event</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Channel</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Recipients</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rule) => (
                  <tr key={rule.id} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm">{rule.name}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{rule.event}</td>
                    <td className="py-3 px-4 text-sm">
                      <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">
                        {rule.channel}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{rule.recipients}</td>
                    <td className="py-3 px-4 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          rule.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {rule.enabled ? t('notificationSettings.statusLabels.enabled') : t('notificationSettings.statusLabels.disabled')}
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
