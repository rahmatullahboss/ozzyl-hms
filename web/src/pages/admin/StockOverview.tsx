import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Package, AlertTriangle, TrendingDown, Calendar, RefreshCw } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import AdminDataTable from '../../components/admin/AdminDataTable';
import type { DataTableColumn } from '../../components/admin/AdminDataTable';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatCurrency } from '../../lib/format';
import { formatDisplayDate } from '../../lib/date-utils';

interface StockItem {
  id: number;
  itemName: string;
  category: string;
  currentStock: number;
  reorderLevel: number;
  unit: string;
  lotNumber: string;
  batchNumber: string;
  expiryDate: string | null;
  purchasePrice: number;
  sellingPrice: number;
  status: 'ok' | 'low' | 'out' | 'expired' | 'near_expiry';
}

interface StockSummary {
  totalItems: number;
  totalValue: number;
  lowStock: number;
  outOfStock: number;
  nearExpiry: number;
  expired: number;
}

interface BackendStockRow {
  StockId?: number;
  ItemId?: number;
  ItemName?: string | null;
  CategoryName?: string | null;
  Category?: string | null;
  AvailableQuantity?: number | null;
  ReOrderLevel?: number | null;
  UnitName?: string | null;
  Unit?: string | null;
  LotNumber?: string | null;
  BatchNo?: string | null;
  ExpiryDate?: string | null;
  CostPrice?: number | null;
  PurchasePrice?: number | null;
  SellingPrice?: number | null;
  StockValue?: number | null;
  Status?: string | null;
}

interface StockResponse {
  items?: StockItem[];
  data?: BackendStockRow[];
  summary?: StockSummary;
  pagination?: { total?: number };
}

const STATUS_KEY: Record<string, string> = {
  ok: 'stockOverview.statusBadges.ok',
  low: 'stockOverview.statusBadges.low',
  out: 'stockOverview.statusBadges.out',
  expired: 'stockOverview.statusBadges.expired',
  near_expiry: 'stockOverview.statusBadges.nearExpiry',
};

function normalizeStatus(status?: string | null): StockItem['status'] {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'low_stock' || normalized === 'low') return 'low';
  if (normalized === 'out_of_stock' || normalized === 'out') return 'out';
  if (normalized === 'near_expiry') return 'near_expiry';
  if (normalized === 'expired') return 'expired';
  return 'ok';
}

function normalizeBackendStock(row: BackendStockRow): StockItem {
  const currentStock = Number(row.AvailableQuantity ?? 0);
  const purchasePrice = Number(row.PurchasePrice ?? row.CostPrice ?? 0);
  return {
    id: Number(row.StockId ?? row.ItemId ?? 0),
    itemName: String(row.ItemName ?? 'Unknown item'),
    category: String(row.CategoryName ?? row.Category ?? 'Uncategorized'),
    currentStock,
    reorderLevel: Number(row.ReOrderLevel ?? 0),
    unit: String(row.UnitName ?? row.Unit ?? ''),
    lotNumber: String(row.LotNumber ?? '—'),
    batchNumber: String(row.BatchNo ?? '—'),
    expiryDate: row.ExpiryDate ?? null,
    purchasePrice,
    sellingPrice: Number(row.SellingPrice ?? 0),
    status: normalizeStatus(row.Status),
  };
}

function normalizeStockItems(response?: StockResponse | null): StockItem[] {
  if (Array.isArray(response?.items)) return response.items;
  return (response?.data ?? []).map(normalizeBackendStock);
}

const TABS = ['all', 'low', 'out', 'nearExpiry', 'expired'] as const;
type Tab = (typeof TABS)[number];

const TAB_FILTERS: Record<Tab, string | null> = {
  all: null,
  low: 'low',
  out: 'out',
  nearExpiry: 'near_expiry',
  expired: 'expired',
};

export default function StockOverview() {
  const { t } = useTranslation('adminStock');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const isValidTab = (val: string | null): val is Tab =>
    val !== null && TABS.includes(val as Tab);
  const [activeTab, setActiveTabRaw] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'all';
    }
    return isValidTab(tabParam) ? tabParam : 'all';
  });
  const setActiveTab = (tab: Tab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading, refetch } = useApiQuery<StockResponse>(
    queryKeys.inventory.stock(),
    '/api/inventory/stock/overview?limit=1000',
    { refetchInterval: 60000 },
  );

  const allItems = normalizeStockItems(data);
  const summary = data?.summary ?? {
    totalItems: allItems.length,
    totalValue: allItems.reduce((sum, item) => sum + (item.currentStock * item.purchasePrice), 0),
    lowStock: allItems.filter((item) => item.status === 'low').length,
    outOfStock: allItems.filter((item) => item.status === 'out').length,
    nearExpiry: allItems.filter((item) => item.status === 'near_expiry').length,
    expired: allItems.filter((item) => item.status === 'expired').length,
  };


  const filteredItems = TAB_FILTERS[activeTab]
    ? allItems.filter(i => i.status === TAB_FILTERS[activeTab])
    : allItems;

  const columns: DataTableColumn<StockItem>[] = [
    { key: 'itemName', label: t('stockOverview.table.item'), sortable: true },
    { key: 'category', label: t('stockOverview.table.category'), sortable: true },
    {
      key: 'currentStock',
      label: t('stockOverview.table.stock'),
      sortable: true,
      render: (row) => (
        <span className={row.currentStock <= row.reorderLevel ? 'text-red-600 font-semibold' : ''}>
          {row.currentStock} {row.unit}
        </span>
      ),
    },
    { key: 'reorderLevel', label: t('stockOverview.table.reorderLevel'), sortable: true, render: (row) => `${row.reorderLevel} ${row.unit}` },
    { key: 'lotNumber', label: 'Lot' },
    { key: 'batchNumber', label: t('stockOverview.table.batch') },
    {
      key: 'expiryDate',
      label: t('stockOverview.table.expiry'),
      sortable: true,
      render: (row) => row.expiryDate
        ? formatDisplayDate(row.expiryDate)
        : '---',
    },
    { key: 'purchasePrice', label: t('stockOverview.table.purchase'), sortable: true, render: (row) => `৳${row.purchasePrice.toLocaleString()}` },
    { key: 'sellingPrice', label: t('stockOverview.table.selling'), sortable: true, render: (row) => `৳${row.sellingPrice.toLocaleString()}` },
    {
      key: 'status',
      label: t('stockOverview.table.status'),
      render: (row) => {
        const bg =
          row.status === 'ok' ? 'bg-green-100 text-green-700' :
          row.status === 'low' ? 'bg-amber-100 text-amber-700' :
          row.status === 'out' ? 'bg-red-100 text-red-700' :
          row.status === 'expired' ? 'bg-red-100 text-red-700' :
          'bg-yellow-100 text-yellow-700';
        return <span className={`px-2 py-1 rounded-full text-xs font-medium ${bg}`}>{t(STATUS_KEY[row.status] ?? 'stockOverview.statusBadges.ok')}</span>;
      },
    },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('stockOverview.title')}</h1>
            <p className="text-sm text-gray-500">{t('stockOverview.subtitle')}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="btn-ghost p-2"
            title={t('stockOverview.refresh')}
            aria-label={t('stockOverview.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-gray-500">{t('stockOverview.summary.totalItems')}</span>
            </div>
            <p className="text-xl font-bold">{summary?.totalItems ?? 0}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-emerald-500" />
              <span className="text-xs text-gray-500">{t('stockOverview.summary.stockValue')}</span>
            </div>
            <p className="text-xl font-bold">{formatCurrency((summary?.totalValue ?? 0))}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-gray-500">{t('stockOverview.summary.lowStock')}</span>
            </div>
            <p className="text-xl font-bold text-amber-600">{summary?.lowStock ?? 0}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-red-500" />
              <span className="text-xs text-gray-500">{t('stockOverview.summary.outOfStock')}</span>
            </div>
            <p className="text-xl font-bold text-red-600">{summary?.outOfStock ?? 0}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-yellow-500" />
              <span className="text-xs text-gray-500">{t('stockOverview.summary.nearExpiry')}</span>
            </div>
            <p className="text-xl font-bold text-yellow-600">{summary?.nearExpiry ?? 0}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs text-gray-500">{t('stockOverview.summary.expired')}</span>
            </div>
            <p className="text-xl font-bold text-red-600">{summary?.expired ?? 0}</p>
          </div>
        </div>

        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
              }`}
            >
              {t(`stockOverview.tabs.${tab}`)}
            </button>
          ))}
        </div>

        <AdminDataTable
          columns={columns as unknown as DataTableColumn<Record<string, unknown>>[]}
          data={filteredItems as unknown as Record<string, unknown>[]}
          rowKey={r => (r as unknown as StockItem).id}
          searchKeys={['itemName', 'category', 'lotNumber', 'batchNumber']}
          searchPlaceholder={t('stockOverview.searchPlaceholder')}
          loading={isLoading}
          emptyMessage={t('stockOverview.emptyMessage')}
        />
      </div>
    </DashboardLayout>
  );
}
