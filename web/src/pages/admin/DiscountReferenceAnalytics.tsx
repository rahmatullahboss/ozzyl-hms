import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { Stethoscope, UserCog } from 'lucide-react';
import { formatCurrency } from '../../lib/format';
import { useSearchParams } from 'react-router';

interface ReferenceRow {
  name: string;
  type: string;
  totalDiscounts: number;
  discountAmount: number;
  patientCount: number;
  avgDiscount: number;
  highDiscountCount: number;
}

interface StaffRow {
  name: string;
  role: string;
  totalDiscounts: number;
  discountAmount: number;
  avgDiscount: number;
  highDiscountCount: number;
}

interface ReferenceData {
  references: ReferenceRow[];
  staff: StaffRow[];
  summary?: { totalReferences: number; totalStaff: number; totalDiscountAmount: number; highDiscountCount: number };
}

const ANALYTICS_TABS = ['referenceWise', 'staffWise'] as const;
type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

const TYPE_BADGE: Record<string, string> = {
  doctor: 'bg-blue-100 text-blue-700',
  staff: 'bg-green-100 text-green-700',
  external: 'bg-purple-100 text-purple-700',
};

export default function DiscountReferenceAnalytics() {
  const { t } = useTranslation('adminDiscount');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as AnalyticsTab | null;
  const isValidTab = (val: string | null): val is AnalyticsTab =>
    val !== null && ANALYTICS_TABS.includes(val as AnalyticsTab);
  const [activeTab, setActiveTabRaw] = useState<AnalyticsTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'referenceWise';
    }
    return isValidTab(tabParam) ? tabParam : 'referenceWise';
  });
  const setActiveTab = (tab: AnalyticsTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading } = useApiQuery<ReferenceData>(
    queryKeys.admin.discountReferenceAnalytics(),
    `/api/admin/discount-references`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('discountReferenceAnalytics.loading')}</div></DashboardLayout>;
  }

  const references = data?.references ?? [];
  const staff = data?.staff ?? [];
  const summary = data?.summary;

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('discountReferenceAnalytics.title')}</h1>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('discountReferenceAnalytics.summary.totalReferences')}</div>
              <div className="text-2xl font-bold">{summary.totalReferences}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('discountReferenceAnalytics.summary.totalStaff')}</div>
              <div className="text-2xl font-bold text-blue-600">{summary.totalStaff}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('discountReferenceAnalytics.summary.totalDiscountAmount')}</div>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalDiscountAmount)}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('discountReferenceAnalytics.summary.highDiscounts')}</div>
              <div className="text-2xl font-bold text-orange-600">{summary.highDiscountCount}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {ANALYTICS_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {tab === 'referenceWise' ? <Stethoscope className="w-4 h-4" /> : <UserCog className="w-4 h-4" />}
              {tab === 'referenceWise' ? 'Reference-wise' : 'Staff-wise'}
            </button>
          ))}
        </div>

        {activeTab === 'referenceWise' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            {references.length === 0 ? (
              <div className="text-center py-12 text-gray-500">{t('discountReferenceAnalytics.empty.reference')}</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.referenceName')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.type')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.totalDiscounts')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.discountAmount')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.patients')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.avgDiscount')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.highDiscount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {references.map((r, i) => (
                    <tr key={i} className="border-t hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium">{r.name}</td>
                      <td className="py-3 px-4 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${TYPE_BADGE[r.type] ?? 'bg-gray-100 text-gray-600'}`}>
                          {t(`discountReferenceAnalytics.typeLabels.${r.type}`, { defaultValue: r.type })}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-right">{r.totalDiscounts}</td>
                      <td className="py-3 px-4 text-sm text-right font-medium text-red-600">{formatCurrency(r.discountAmount)}</td>
                      <td className="py-3 px-4 text-sm text-right">{r.patientCount}</td>
                      <td className="py-3 px-4 text-sm text-right">{formatCurrency(r.avgDiscount)}</td>
                      <td className="py-3 px-4 text-sm text-right">
                        {r.highDiscountCount > 0 ? (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">{r.highDiscountCount}</span>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'staffWise' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            {staff.length === 0 ? (
              <div className="text-center py-12 text-gray-500">{t('discountReferenceAnalytics.empty.staff')}</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.staffName')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.role')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.totalDiscounts')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.discountAmount')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.avgDiscount')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('discountReferenceAnalytics.table.highDiscount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s, i) => (
                    <tr key={i} className="border-t hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium">{s.name}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{s.role}</td>
                      <td className="py-3 px-4 text-sm text-right">{s.totalDiscounts}</td>
                      <td className="py-3 px-4 text-sm text-right font-medium text-red-600">{formatCurrency(s.discountAmount)}</td>
                      <td className="py-3 px-4 text-sm text-right">{formatCurrency(s.avgDiscount)}</td>
                      <td className="py-3 px-4 text-sm text-right">
                        {s.highDiscountCount > 0 ? (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">{s.highDiscountCount}</span>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
