import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Beaker,
  Boxes,
  CheckCircle2,
  ClipboardList,
  FileText,
  FlaskConical,
  ListChecks,
  Package,
  PackageCheck,
  PackageOpen,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Stethoscope,
  ToolCase,
  TrendingDown,
  Truck,
  Wand2,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import KPICard from '../../components/dashboard/KPICard';
import EmptyState from '../../components/dashboard/EmptyState';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import {
  alertClass,
  formatAlertType,
  formatComputedAt,
  formatRecommendationAction,
  formatSuggestedOrderQty,
  intelligenceStatusCopy,
  money,
  recommendationToneClass,
  smartStockVerdict,
  stockHealthLabel,
  urgentStockCount,
} from './inventoryDashboardSmartHelpers';
export {
  alertClass,
  formatAlertType,
  formatComputedAt,
  formatSuggestedOrderQty,
  intelligenceStatusCopy,
  money,
  recommendationToneClass,
  smartStockVerdict,
  stockHealthLabel,
  urgentStockCount,
} from './inventoryDashboardSmartHelpers';

interface InventoryDashboardSummary {
  totalStockValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiringSoonItems: number;
  expiredItems: number;
  pendingPurchaseRequests: number;
  pendingDepartmentRequests: number;
  todayReceivedQuantity: number;
  todayIssuedQuantity: number;
  damagedStockQuantity: number;
  assetMaintenanceDue: number;
}

interface InventoryAlert {
  type: string;
  severity: string;
  count?: number;
  ItemName?: string;
  ItemCode?: string;
  StoreName?: string;
  BatchNo?: string;
  ExpiryDate?: string;
  AvailableQuantity?: number;
}

interface RecentMovement {
  TransactionId: number;
  TransactionType: string;
  TransactionDate: string;
  ItemName?: string;
  StoreName?: string;
  InQuantity?: number;
  OutQuantity?: number;
  BalanceQuantity?: number;
  ReferenceNo?: string;
}

interface ReorderSuggestion {
  ItemId: number;
  ItemName: string;
  ItemCode: string;
  ReOrderLevel: number;
  current_stock: number;
  suggested_quantity: number;
  preferred_vendor_name?: string;
}

interface DashboardResponse {
  summary: InventoryDashboardSummary;
  alerts: InventoryAlert[];
  recentMovements: RecentMovement[];
}

const EMPTY_SUMMARY: InventoryDashboardSummary = {
  totalStockValue: 0,
  lowStockItems: 0,
  outOfStockItems: 0,
  expiringSoonItems: 0,
  expiredItems: 0,
  pendingPurchaseRequests: 0,
  pendingDepartmentRequests: 0,
  todayReceivedQuantity: 0,
  todayIssuedQuantity: 0,
  damagedStockQuantity: 0,
  assetMaintenanceDue: 0,
};

const MINI_GUIDE_STEPS = [
  { title: 'Receive stock', detail: 'GRN + batch + expiry first', icon: Truck },
  { title: 'Map deduction rule', detail: 'Test/OT → item quantity', icon: Wand2 },
  { title: 'Auto deduct', detail: 'Billing, result or OT close', icon: Beaker },
  { title: 'Review exception', detail: 'Missing, low stock or conflict', icon: ShieldAlert },
];

const DEFAULT_RULE_EXAMPLES = [
  { service: 'CBC', deduction: 'CBC reagent + EDTA tube', mode: 'Billing' },
  { service: 'LFT', deduction: 'Kit reagent per test', mode: 'Result' },
  { service: 'X-Ray', deduction: 'Film + envelope', mode: 'Billing' },
  { service: 'OT case', deduction: 'OT kit + suture + gauze', mode: 'OT close' },
];

interface InventoryIntelligenceSummary {
  stockout: number;
  low: number;
  watch: number;
  ok: number;
  suggestedOrderQtyTotal: number | null;
}

interface InventoryRecommendation {
  id: number | string;
  recommendation_type?: string;
  severity?: string | null;
  inventory_item_id?: number;
  title: string;
  message?: string;
  suggested_action?: string;
  suggested_quantity?: number | null;
  status?: string;
  created_at?: string;
}

interface InventoryIntelligenceDashboardResponse {
  status?: 'not_configured' | 'stale' | 'ready';
  snapshotCount?: number;
  lastComputedAt?: string | null;
  summary: InventoryIntelligenceSummary;
  recommendations: InventoryRecommendation[];
  message?: string;
}

const EMPTY_INTELLIGENCE_SUMMARY: InventoryIntelligenceSummary = {
  stockout: 0,
  low: 0,
  watch: 0,
  ok: 0,
  suggestedOrderQtyTotal: 0,
};

export default function InventoryDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [recomputeFeedback, setRecomputeFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const { data, isLoading, refetch, isFetching } = useApiQuery<DashboardResponse>(
    queryKeys.inventory.dashboard(),
    '/api/inventory/dashboard',
  );
  const { data: reorderData, isLoading: reorderLoading, refetch: refetchReorder } = useApiQuery<{ suggestions: ReorderSuggestion[] }>(
    ['inventory', 'reorder', 'suggestions'],
    '/api/inventory/reorder/suggestions',
  );
  const { data: intelligenceData, isLoading: intelligenceLoading, refetch: refetchIntelligence } = useApiQuery<InventoryIntelligenceDashboardResponse>(
    ['inventory', 'intelligence', 'dashboard'],
    '/api/inventory/intelligence/dashboard',
  );
  const recomputeMutation = useApiMutation(
    'post',
    '/api/inventory/intelligence/recompute',
    {
      offline: false,
      onSuccess: () => {
        refetch();
        refetchIntelligence();
        refetchReorder();
        setRecomputeFeedback({
          tone: 'success',
          message: 'Stock brain recomputed. Review suggestions before creating purchase orders.',
        });
      },
      onError: () => {
        setRecomputeFeedback({
          tone: 'error',
          message: 'Could not recompute stock brain. Check migration/setup and try again.',
        });
      },
    },
  );

  const summary = data?.summary ?? EMPTY_SUMMARY;
  const alerts = data?.alerts ?? [];
  const movements = data?.recentMovements ?? [];
  const reorderSuggestions = reorderData?.suggestions ?? [];
  const intelligenceSummary = intelligenceData?.summary ?? EMPTY_INTELLIGENCE_SUMMARY;
  const intelligenceRecommendations = intelligenceData?.recommendations ?? [];
  const urgentIssues = urgentStockCount(summary);
  const stockHealth = stockHealthLabel(summary);
  const smartVerdict = smartStockVerdict(summary, intelligenceSummary, intelligenceData?.status);
  const intelligenceRiskCount = intelligenceSummary.stockout + intelligenceSummary.low + intelligenceSummary.watch;
  const hasOperationalRisk = urgentIssues > 0 || summary.lowStockItems > 0 || summary.expiringSoonItems > 0 || intelligenceSummary.stockout > 0 || intelligenceSummary.low > 0;
  const shouldPromptRecompute = intelligenceData?.status === 'not_configured' || intelligenceData?.status === 'stale';

  const handleScan = (value: string) => {
    const code = value.trim();
    if (!code) return;
    navigate(`${base}/inventory/traceability?scan=${encodeURIComponent(code)}`);
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6 max-w-screen-2xl mx-auto">
        <section className="relative overflow-hidden rounded-3xl border border-cyan-100 bg-gradient-to-br from-slate-950 via-cyan-950 to-emerald-900 p-5 text-white shadow-sm">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-cyan-100">
                <Sparkles className="h-3.5 w-3.5" />
                Deterministic stock brain · no AI magic
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                Smart Stock Assistant
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-cyan-50/80 md:text-base">
                Rules + usage history calculate stockout risk, reorder quantity and lab/OT readiness before staff make a mistake.
              </p>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-wide text-cyan-100/80">Ready services</p>
                  <p className="mt-1 text-2xl font-semibold">{intelligenceLoading ? '…' : intelligenceSummary.ok}</p>
                  <p className="mt-1 text-xs text-cyan-50/70">Tests, OT and stock rules clear</p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-wide text-cyan-100/80">Risk items</p>
                  <p className="mt-1 text-2xl font-semibold">{intelligenceLoading ? '…' : intelligenceRiskCount}</p>
                  <p className="mt-1 text-xs text-cyan-50/70">Stockout, low and watch</p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-wide text-cyan-100/80">Stock health</p>
                  <p className="mt-1 text-lg font-semibold">{stockHealth}</p>
                  <p className="mt-1 text-xs text-cyan-50/70">Low/no/expired stock priority</p>
                </div>
              </div>
            </div>

            <div className="w-full max-w-md rounded-3xl border border-white/15 bg-white/95 p-4 text-slate-900 shadow-xl shadow-slate-950/20">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Today's system verdict</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{smartVerdict}</p>
                  <p className="mt-1 text-xs text-slate-500">Calculated from usable stock, reorder point and hospital alerts.</p>
                  <p className="mt-1 text-xs font-medium text-cyan-700">{intelligenceStatusCopy(intelligenceData?.status)}</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {shouldPromptRecompute && (
                    <button
                      onClick={() => {
                        setRecomputeFeedback(null);
                        recomputeMutation.mutate(undefined);
                      }}
                      className="btn-primary text-xs"
                      disabled={recomputeMutation.isPending}
                    >
                      <Wand2 className={`h-4 w-4 ${recomputeMutation.isPending ? 'animate-pulse' : ''}`} />
                      {recomputeMutation.isPending ? 'Computing…' : 'Run recompute'}
                    </button>
                  )}
                  <button onClick={() => refetch()} className="btn-secondary text-xs" disabled={isFetching}>
                    <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-red-50 p-3 text-center text-red-700"><p className="text-xl font-bold">{intelligenceSummary.stockout}</p><p className="text-[11px] font-medium">Blocked</p></div>
                <div className="rounded-2xl bg-amber-50 p-3 text-center text-amber-700"><p className="text-xl font-bold">{intelligenceSummary.low}</p><p className="text-[11px] font-medium">Low</p></div>
                <div className="rounded-2xl bg-sky-50 p-3 text-center text-sky-700"><p className="text-xl font-bold">{intelligenceSummary.watch}</p><p className="text-[11px] font-medium">Watch</p></div>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500">Suggested draft quantity</p>
                <p className="mt-1 text-lg font-bold text-slate-950">{formatSuggestedOrderQty(intelligenceSummary.suggestedOrderQtyTotal)}</p>
                <p className="mt-1 text-[11px] font-medium text-slate-500">Last computed: {formatComputedAt(intelligenceData?.lastComputedAt)}</p>
              </div>
              {recomputeFeedback && (
                <div className={`mt-3 rounded-2xl border px-3 py-2 text-xs font-semibold ${recomputeFeedback.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`} role="status">
                  {recomputeFeedback.message}
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Link to={`${base}/inventory/gr/new`} className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                  <Truck className="mb-2 h-5 w-5" /> Receive stock
                </Link>
                <Link to={`${base}/inventory/issues`} className="rounded-2xl border border-sky-100 bg-sky-50 p-3 text-sm font-medium text-sky-800 hover:bg-sky-100">
                  <PackageOpen className="mb-2 h-5 w-5" /> Issue stock
                </Link>
                <Link to={`${base}/inventory/adjustment-requests`} className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm font-medium text-amber-800 hover:bg-amber-100">
                  <ListChecks className="mb-2 h-5 w-5" /> Approvals
                </Link>
                <Link to={`${base}/lab/monitoring`} className="rounded-2xl border border-fuchsia-100 bg-fuchsia-50 p-3 text-sm font-medium text-fuchsia-800 hover:bg-fuchsia-100">
                  <FlaskConical className="mb-2 h-5 w-5" /> Reagent rules
                </Link>
              </div>
              <div className="relative mt-4">
                <QrCode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  aria-label="Scan inventory QR or barcode"
                  className="input w-full pl-9"
                  placeholder="Scan QR / barcode and press Enter"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      handleScan((event.target as HTMLInputElement).value);
                      (event.target as HTMLInputElement).value = '';
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="card xl:col-span-7 overflow-hidden">
            <div className="border-b border-[var(--color-border)] bg-gradient-to-r from-slate-50 via-cyan-50 to-emerald-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-cyan-600" />
                    <h3 className="font-semibold">Smart stock action queue</h3>
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">What to buy, what to fix, and what may block tests or operations.</p>
                </div>
                <Link to={`${base}/inventory/po/new`} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary)] hover:underline">
                  Create draft PO <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="p-4">
              {intelligenceLoading ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
                </div>
              ) : intelligenceRecommendations.length === 0 ? (
                <EmptyState icon={<PackageCheck className="h-8 w-8 text-[var(--color-text-muted)]" />} title="No smart stock action yet" description={intelligenceData?.message || 'Run inventory intelligence snapshots after applying the migration to see usage-based suggestions here.'} />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {intelligenceRecommendations.slice(0, 6).map((recommendation) => (
                    <div key={recommendation.id} className={`rounded-2xl border p-4 ${recommendationToneClass(recommendation.severity)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">{recommendation.title}</p>
                          <p className="mt-1 text-xs opacity-80">{recommendation.message || 'Review the affected item before the next shift.'}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold">{formatRecommendationAction(recommendation.suggested_action)}</span>
                            <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold">{formatSuggestedOrderQty(recommendation.suggested_quantity)}</span>
                          </div>
                        </div>
                        <ShieldAlert className="h-5 w-5 shrink-0 opacity-70" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card xl:col-span-5 overflow-hidden">
            <div className="border-b border-[var(--color-border)] bg-gradient-to-r from-cyan-50 to-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Stethoscope className="h-5 w-5 text-cyan-600" />
                    <h3 className="font-semibold">Lab & OT readiness model</h3>
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">Default rule examples staff can understand before calibration.</p>
                </div>
                <Link to={`${base}/lab/monitoring`} className="text-sm font-medium text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
                  Configure <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {DEFAULT_RULE_EXAMPLES.map((rule, index) => {
                const status = index === 0 ? 'Verified' : index === 3 ? 'Manual confirm' : 'Needs review';
                const statusClass = index === 0 ? 'badge-success' : index === 3 ? 'badge-warning' : 'badge-info';
                return (
                  <div key={`${rule.service}-${rule.mode}-readiness`} className="grid grid-cols-12 items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3 text-sm">
                    <div className="col-span-3 font-semibold text-slate-900">{rule.service}</div>
                    <div className="col-span-5 text-slate-600">{rule.deduction}</div>
                    <div className="col-span-2 text-xs font-medium text-slate-500">{rule.mode}</div>
                    <div className="col-span-2 text-right"><span className={`badge ${statusClass}`}>{status}</span></div>
                  </div>
                );
              })}
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">Safety note</p>
                <p className="mt-1 text-xs">mL/kit defaults are starter rules only; analyzer kit IFU and hospital SOP must verify final quantity.</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <KPICard title="Stock value" value={money(summary.totalStockValue)} loading={isLoading} icon={<Boxes className="h-5 w-5" />} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title="Low stock" value={summary.lowStockItems} loading={isLoading} icon={<TrendingDown className="h-5 w-5" />} iconBg="bg-amber-50 text-amber-600" />
          <KPICard title="Out of stock" value={summary.outOfStockItems} loading={isLoading} icon={<ShieldAlert className="h-5 w-5" />} iconBg="bg-red-50 text-red-600" />
          <KPICard title="Expiring soon" value={summary.expiringSoonItems} loading={isLoading} icon={<AlertTriangle className="h-5 w-5" />} iconBg="bg-orange-50 text-orange-600" />
          <KPICard title="Pending requests" value={summary.pendingDepartmentRequests} loading={isLoading} icon={<ClipboardList className="h-5 w-5" />} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title="Asset service due" value={summary.assetMaintenanceDue} loading={isLoading} icon={<ToolCase className="h-5 w-5" />} iconBg="bg-violet-50 text-violet-600" />
        </div>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className={`card xl:col-span-4 overflow-hidden ${hasOperationalRisk ? 'ring-1 ring-amber-100' : ''}`}>
            <div className="border-b border-[var(--color-border)] bg-gradient-to-r from-amber-50 to-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    <h3 className="font-semibold">Action alerts</h3>
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">What needs attention before billing, issuing or purchase.</p>
                </div>
                <Link to={`${base}/inventory/stock`} className="text-sm font-medium text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
                  Stock <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {isLoading ? (
                [...Array(4)].map((_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)
              ) : alerts.length === 0 ? (
                <EmptyState icon={<PackageCheck className="h-8 w-8 text-[var(--color-text-muted)]" />} title="No active inventory alerts" description="Stock is safe enough for daily operation." />
              ) : alerts.slice(0, 8).map((alert, index) => (
                <div key={`${alert.type}-${index}`} className={`border rounded-2xl p-3 ${alertClass(alert.severity)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{formatAlertType(alert.type)}</p>
                      <p className="text-xs mt-0.5 opacity-80">
                        {alert.ItemName || alert.StoreName || (alert.count !== undefined ? `${alert.count} pending` : 'Needs review')}
                        {alert.BatchNo ? ` · Batch ${alert.BatchNo}` : ''}
                        {alert.ExpiryDate ? ` · Exp ${alert.ExpiryDate}` : ''}
                      </p>
                      <p className="mt-2 text-xs font-medium opacity-90">
                        Recommended: {alert.severity === 'danger' ? 'block risky use and restock now' : 'review before next shift'}
                      </p>
                    </div>
                    {alert.AvailableQuantity !== undefined && (
                      <span className="rounded-xl bg-white/70 px-2.5 py-1 font-data text-sm font-semibold">{alert.AvailableQuantity}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card xl:col-span-4 overflow-hidden">
            <div className="border-b border-[var(--color-border)] bg-gradient-to-r from-cyan-50 to-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Beaker className="h-5 w-5 text-cyan-600" />
                    <h3 className="font-semibold">Reagent readiness</h3>
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">Default rules make lab billing and OT consumption safer.</p>
                </div>
                <Link to={`${base}/lab/monitoring`} className="text-sm font-medium text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
                  Configure <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="p-4">
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-white p-2 text-cyan-700 shadow-sm"><CheckCircle2 className="h-5 w-5" /></div>
                  <div>
                    <p className="font-semibold text-cyan-950">Billing-time semi-auto mode recommended</p>
                    <p className="mt-1 text-sm text-cyan-800/80">Mapped tests deduct reagent once; missing mappings become exceptions instead of silent stock mismatch.</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {DEFAULT_RULE_EXAMPLES.map((rule) => (
                  <div key={`${rule.service}-${rule.mode}`} className="grid grid-cols-12 items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-sm">
                    <div className="col-span-3 font-semibold text-slate-900">{rule.service}</div>
                    <div className="col-span-6 text-slate-600">{rule.deduction}</div>
                    <div className="col-span-3 text-right"><span className="badge badge-info">{rule.mode}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card xl:col-span-4 overflow-hidden">
            <div className="border-b border-[var(--color-border)] bg-gradient-to-r from-emerald-50 to-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ScanLine className="h-5 w-5 text-emerald-600" />
                    <h3 className="font-semibold">Simple daily workflow</h3>
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">A clear 4-step model for new hospital users.</p>
                </div>
                <Link to={`${base}/inventory/master-data`} className="text-sm font-medium text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
                  Master data <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {MINI_GUIDE_STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{index + 1}. {step.title}</p>
                      <p className="text-xs text-slate-500">{step.detail}</p>
                    </div>
                    {index < MINI_GUIDE_STEPS.length - 1 && <ArrowRight className="hidden h-4 w-4 text-slate-300 sm:block" />}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="card xl:col-span-7 overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Recent stock movement</h3>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">Trace every in/out movement with live balance.</p>
              </div>
              <Link to={`${base}/inventory/ledger`} className="text-sm font-medium text-[var(--color-primary)] hover:underline flex items-center gap-1">
                Ledger <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Item</th>
                    <th>Store</th>
                    <th>Type</th>
                    <th className="text-right">In</th>
                    <th className="text-right">Out</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? [...Array(5)].map((_, i) => (
                    <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                  )) : movements.length === 0 ? (
                    <tr><td colSpan={7} className="py-12"><EmptyState icon={<Activity className="h-8 w-8 text-[var(--color-text-muted)]" />} title="No stock movement yet" description="Receive or issue stock to start the ledger." /></td></tr>
                  ) : movements.map((movement) => (
                    <tr key={movement.TransactionId}>
                      <td className="font-data text-sm">{movement.TransactionDate?.slice(0, 10) || '—'}</td>
                      <td>
                        <div className="font-medium">{movement.ItemName || '—'}</div>
                        {movement.ReferenceNo && <div className="text-xs text-[var(--color-text-muted)]">Ref: {movement.ReferenceNo}</div>}
                      </td>
                      <td>{movement.StoreName || '—'}</td>
                      <td><span className="badge badge-info">{movement.TransactionType}</span></td>
                      <td className="text-right font-data text-emerald-700">{movement.InQuantity || 0}</td>
                      <td className="text-right font-data text-red-700">{movement.OutQuantity || 0}</td>
                      <td className="text-right font-data">{movement.BalanceQuantity ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card xl:col-span-5 overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Reorder suggestions</h3>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">Suggested quantity, current stock and vendor in one card.</p>
              </div>
              <Link to={`${base}/inventory/po/new`} className="text-sm font-medium text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
                Create PO <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="p-4 space-y-3">
              {reorderLoading ? (
                [...Array(4)].map((_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)
              ) : reorderSuggestions.length === 0 ? (
                <EmptyState icon={<ShoppingCart className="h-8 w-8 text-[var(--color-text-muted)]" />} title="No reorder suggestions" description="All items are above reorder level." />
              ) : reorderSuggestions.slice(0, 6).map((suggestion) => (
                <div key={suggestion.ItemId} className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{suggestion.ItemName}</p>
                      <p className="text-xs mt-0.5 opacity-80">
                        {suggestion.ItemCode} · Current: {suggestion.current_stock} · Reorder level: {suggestion.ReOrderLevel}
                      </p>
                      {suggestion.preferred_vendor_name && (
                        <p className="text-xs mt-1 opacity-75">Preferred vendor: {suggestion.preferred_vendor_name}</p>
                      )}
                    </div>
                    <div className="rounded-2xl bg-white/80 px-3 py-2 text-right shadow-sm">
                      <p className="text-xs opacity-70">Suggested</p>
                      <p className="font-data text-lg font-bold">+{suggestion.suggested_quantity}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Link to={`${base}/inventory/requisitions/new`} className="card p-4 hover:border-blue-200 hover:bg-blue-50/40">
            <ClipboardList className="h-5 w-5 text-blue-600" />
            <p className="mt-3 font-semibold">Request stock</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Department demand entry</p>
          </Link>
          <Link to={`${base}/inventory/transfers`} className="card p-4 hover:border-cyan-200 hover:bg-cyan-50/40">
            <ArrowUpRight className="h-5 w-5 text-cyan-600" />
            <p className="mt-3 font-semibold">Transfer</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Move between stores</p>
          </Link>
          <Link to={`${base}/inventory/returns`} className="card p-4 hover:border-emerald-200 hover:bg-emerald-50/40">
            <Package className="h-5 w-5 text-emerald-600" />
            <p className="mt-3 font-semibold">Return</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Return from ward/lab</p>
          </Link>
          <Link to={`${base}/inventory/counts`} className="card p-4 hover:border-violet-200 hover:bg-violet-50/40">
            <Boxes className="h-5 w-5 text-violet-600" />
            <p className="mt-3 font-semibold">Count</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Physical stock audit</p>
          </Link>
          <Link to={`${base}/inventory/reports`} className="card p-4 hover:border-slate-300 hover:bg-slate-50">
            <FileText className="h-5 w-5 text-slate-600" />
            <p className="mt-3 font-semibold">Reports</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Stock, expiry, cost</p>
          </Link>
        </section>
      </div>
    </DashboardLayout>
  );
}
