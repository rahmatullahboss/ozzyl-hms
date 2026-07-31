import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, TrendingDown, TrendingUp, RefreshCw, Filter } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import AdminDataTable from '../../components/admin/AdminDataTable';
import type { DataTableColumn } from '../../components/admin/AdminDataTable';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDate } from '../../lib/format';
import { useSearchParams } from 'react-router';

interface StockMovement {
  id: number;
  date: string;
  itemName: string;
  category: string;
  type: 'purchase' | 'issue' | 'adjustment' | 'transfer' | 'return' | 'write_off';
  quantity: number;
  unit: string;
  batchNumber: string;
  fromLocation: string | null;
  toLocation: string | null;
  reference: string;
  performedBy: string;
  notes: string | null;
}

interface MovementSummary {
  totalIn: number;
  totalOut: number;
  netMovement: number;
  transactionCount: number;
}

interface MovementResponse {
  movements: StockMovement[];
  summary: MovementSummary;
}

const TYPE_BG: Record<string, string> = {
  purchase: 'bg-green-100 text-green-700',
  issue: 'bg-blue-100 text-blue-700',
  adjustment: 'bg-amber-100 text-amber-700',
  transfer: 'bg-purple-100 text-purple-700',
  return: 'bg-cyan-100 text-cyan-700',
  write_off: 'bg-red-100 text-red-700',
};

const TYPE_LABEL_KEY: Record<string, string> = {
  purchase: 'stockMovementPage.badges.purchase',
  issue: 'stockMovementPage.badges.issue',
  adjustment: 'stockMovementPage.badges.adjustment',
  transfer: 'stockMovementPage.badges.transfer',
  return: 'stockMovementPage.badges.return',
  write_off: 'stockMovementPage.badges.writeOff',
};

const TYPE_FILTERS = ['all', 'purchase', 'issue', 'adjustment', 'transfer', 'return', 'writeOff'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

const TYPE_MAP: Record<TypeFilter, string | null> = {
  all: null,
  purchase: 'purchase',
  issue: 'issue',
  adjustment: 'adjustment',
  transfer: 'transfer',
  return: 'return',
  writeOff: 'write_off',
};

export default function StockMovementPage() {
  const { t } = useTranslation('adminPages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TypeFilter | null;
  const isValidTab = (val: string | null): val is TypeFilter =>
    val !== null && TYPE_FILTERS.includes(val as TypeFilter);
  const [typeFilter, setTypeFilterRaw] = useState<TypeFilter>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'all';
    }
    return isValidTab(tabParam) ? tabParam : 'all';
  });
  const setTypeFilter = (tab: TypeFilter) => {
    setTypeFilterRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading, refetch } = useApiQuery<MovementResponse>(
    queryKeys.inventoryLedger.transactions({ type: typeFilter === 'all' ? undefined : TYPE_MAP[typeFilter] ?? undefined }),
    `/api/inventory/ledger/transactions${typeFilter !== 'all' && TYPE_MAP[typeFilter] ? `?type=${TYPE_MAP[typeFilter]}` : ''}`,
  );

  const summary = data?.summary;
  const movements = data?.movements ?? [];

  const columns: DataTableColumn<StockMovement>[] = [
    { key: 'date', label: t('stockMovementPage.table.date'), sortable: true, render: (row) => formatDate(row.date) },
    { key: 'itemName', label: t('stockMovementPage.table.item'), sortable: true },
    { key: 'category', label: t('stockMovementPage.table.category'), sortable: true },
    {
      key: 'type',
      label: t('stockMovementPage.table.type'),
      render: (row) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${TYPE_BG[row.type] ?? TYPE_BG.adjustment}`}>
          {t(TYPE_LABEL_KEY[row.type] ?? 'stockMovementPage.badges.adjustment')}
        </span>
      ),
    },
    {
      key: 'quantity',
      label: t('stockMovementPage.table.qty'),
      sortable: true,
      render: (row) => (
        <span className={row.quantity > 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
          {row.quantity > 0 ? '+' : ''}{row.quantity} {row.unit}
        </span>
      ),
    },
    { key: 'batchNumber', label: t('stockMovementPage.table.batch') },
    {
      key: 'fromLocation',
      label: t('stockMovementPage.table.from'),
      render: (row) => row.fromLocation ?? '---',
    },
    {
      key: 'toLocation',
      label: t('stockMovementPage.table.to'),
      render: (row) => row.toLocation ?? '---',
    },
    { key: 'reference', label: t('stockMovementPage.table.reference') },
    { key: 'performedBy', label: t('stockMovementPage.table.by') },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('stockMovementPage.title')}</h1>
            <p className="text-sm text-gray-500">{t('stockMovementPage.subtitle')}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="btn-ghost p-2"
            title={t('stockMovementPage.refresh')}
            aria-label={t('stockMovementPage.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-xs text-gray-500">{t('stockMovementPage.summary.totalIn')}</span>
            </div>
            <p className="text-xl font-bold text-green-600">{summary?.totalIn ?? 0}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <span className="text-xs text-gray-500">{t('stockMovementPage.summary.totalOut')}</span>
            </div>
            <p className="text-xl font-bold text-red-600">{summary?.totalOut ?? 0}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowRightLeft className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-gray-500">{t('stockMovementPage.summary.netMovement')}</span>
            </div>
            <p className="text-xl font-bold">{summary?.netMovement ?? 0}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-xs text-gray-500">{t('stockMovementPage.summary.transactions')}</span>
            </div>
            <p className="text-xl font-bold">{summary?.transactionCount ?? 0}</p>
          </div>
        </div>

        {/* Type Filter */}
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TYPE_FILTERS.map(type => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                typeFilter === type
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
              }`}
            >
              {t(`stockMovementPage.filters.${type}`)}
            </button>
          ))}
        </div>

        {/* Data Table */}
        <AdminDataTable
          columns={columns as unknown as DataTableColumn<Record<string, unknown>>[]}
          data={movements as unknown as Record<string, unknown>[]}
          rowKey={r => (r as unknown as StockMovement).id}
          searchKeys={['itemName', 'category', 'reference', 'performedBy']}
          searchPlaceholder={t('stockMovementPage.searchPlaceholder')}
          loading={isLoading}
          emptyMessage={t('stockMovementPage.emptyMessage')}
        />
      </div>
    </DashboardLayout>
  );
}
