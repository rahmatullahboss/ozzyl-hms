import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTimeShort } from '../../lib/format';
import { useSearchParams } from 'react-router';

interface ExportRecord {
  id: string;
  timestamp: string;
  userName: string;
  reportName: string;
  format: string;
  filtersUsed: string;
  rowsExported: number;
  device: string;
  ipAddress: string;
}

interface ExportHistoryData {
  summary: {
    totalExports: number;
    todayExports: number;
    uniqueUsers: number;
    csvExports: number;
    pdfExports: number;
  };
  exports: ExportRecord[];
}

const FORMAT_TABS = ['all', 'csv', 'pdf'] as const;
type FormatTab = (typeof FORMAT_TABS)[number];

const FORMAT_BG: Record<string, string> = {
  CSV: 'bg-green-100 text-green-800',
  PDF: 'bg-red-100 text-red-800',
  Excel: 'bg-blue-100 text-blue-800',
};

const TABLE_HEADERS: Array<{ key: string }> = [
  { key: 'time' },
  { key: 'user' },
  { key: 'report' },
  { key: 'format' },
  { key: 'filters' },
  { key: 'rows' },
  { key: 'device' },
  { key: 'ip' },
];

export default function ExportHistory() {
  const { t } = useTranslation('adminPages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as FormatTab | null;
  const isValidTab = (val: string | null): val is FormatTab =>
    val !== null && FORMAT_TABS.includes(val as FormatTab);
  const [activeFormat, setActiveFormatRaw] = useState<FormatTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'all';
    }
    return isValidTab(tabParam) ? tabParam : 'all';
  });
  const setActiveFormat = (tab: FormatTab) => {
    setActiveFormatRaw(tab);
    setSearchParams({ tab });
  };
  const { data, isLoading } = useApiQuery<ExportHistoryData>(
    queryKeys.admin.exportHistory(),
    '/api/admin/export-history'
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <h1 className="text-2xl font-bold mb-6">{t('exportHistory.title')}</h1>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-24 rounded-lg" />
          ))}
        </div>
        <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
      </DashboardLayout>
    );
  }

  const summary = data?.summary || { totalExports: 0, todayExports: 0, uniqueUsers: 0, csvExports: 0, pdfExports: 0 };
  const exportRecords = data?.exports || [];
  const formatFilter = activeFormat === 'all' ? null : activeFormat.toUpperCase();
  const filteredExports = formatFilter ? exportRecords.filter((item) => item.format === formatFilter) : exportRecords;

  const summaryCards = [
    { label: t('exportHistory.totalExports'), value: summary.totalExports, color: 'text-gray-900' },
    { label: t('exportHistory.today'), value: summary.todayExports, color: 'text-blue-600' },
    { label: t('exportHistory.uniqueUsers'), value: summary.uniqueUsers, color: 'text-purple-600' },
    { label: t('exportHistory.csv'), value: summary.csvExports, color: 'text-green-600' },
    { label: t('exportHistory.pdf'), value: summary.pdfExports, color: 'text-red-600' },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('exportHistory.title')}</h1>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {summaryCards.map((card, i) => (
          <div key={i} className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mb-4">
        {FORMAT_TABS.map((tab) => (
          <button key={tab} onClick={() => setActiveFormat(tab)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeFormat === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {tab === 'all' ? t('exportHistory.all') : t(`exportHistory.${tab}`)}
          </button>
        ))}
      </div>
      {filteredExports.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">{t('exportHistory.noData')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {TABLE_HEADERS.map(h => (
                  <th key={h.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t(`exportHistory.${h.key}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredExports.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDateTimeShort(item.timestamp)}</td>
                  <td className="px-4 py-3 text-sm font-medium">{item.userName}</td>
                  <td className="px-4 py-3 text-sm">{item.reportName}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${FORMAT_BG[item.format] || 'bg-gray-100 text-gray-800'}`}>{item.format}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{item.filtersUsed}</td>
                  <td className="px-4 py-3 text-sm">{item.rowsExported.toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{item.device}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">{item.ipAddress}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}
