import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  Package, Plus, Search, RefreshCw, CheckCircle, XCircle, Truck, ClipboardList,
  AlertTriangle, Archive, ArrowRightLeft, Filter,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';

interface Requisition {
  id: number; requisition_no: string; ward_id: number; ward_name?: string;
  requested_by: string; status: string; priority: string; total_items: number; total_value: number;
  created_at: string; approved_by?: string; approved_at?: string;
}

interface RequisitionItem {
  id: number; item_name: string; item_code?: string; quantity_requested: number;
  quantity_approved: number; quantity_dispatched: number; unit: string; status: string;
}

interface Dispatch {
  id: number; dispatch_no: string; requisition_id: number; ward_id: number;
  dispatched_by: string; dispatched_at: string; status: string; received_by?: string; received_at?: string;
}

interface DispatchItem {
  id: number; item_name: string; quantity_dispatched: number; quantity_received: number; unit: string;
}

interface WardStock {
  id: number; item_name: string; item_code?: string; current_quantity: number;
  min_stock_level: number; unit: string; last_receipt_date?: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  partially_dispatched: 'bg-amber-100 text-amber-700',
  fully_dispatched: 'bg-purple-100 text-purple-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const PRIORITY_COLORS: Record<string, string> = {
  routine: 'badge-secondary',
  urgent: 'badge-warning',
  emergency: 'badge-danger',
};

const TABS = [
  { key: 'requisitions', label: 'tabs.requisitions', icon: ClipboardList },
  { key: 'dispatches', label: 'tabs.dispatches', icon: Truck },
  { key: 'stock', label: 'tabs.stock', icon: Archive },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function WardSupplyDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['ward_supply', 'common']);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('requisitions');
  const [wardId, setWardId] = useState('1');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showReqModal, setShowReqModal] = useState(false);
  const [reqMode, setReqMode] = useState<'inventory' | 'pharmacy'>('inventory');
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedReq, setSelectedReq] = useState<Requisition | null>(null);
  const [selectedDispatch, setSelectedDispatch] = useState<Dispatch | null>(null);

  // Form states
  const [reqForm, setReqForm] = useState({
    wardId: '1', wardName: '', requestedBy: '', priority: 'routine' as 'routine'|'urgent'|'emergency', remarks: '',
    items: [] as { itemId: string; itemName: string; quantityRequested: string; unit: string; remarks: string }[],
  });
  const [dispatchForm, setDispatchForm] = useState({
    requisitionId: 0, wardId: 0,
    items: [] as { requisitionItemId: number; itemName: string; quantityDispatched: string; unit: string; batchNo: string; remarks: string }[],
  });
  const [receiptForm, setReceiptForm] = useState({
    dispatchId: 0, receivedBy: '', receiptRemarks: '',
    items: [] as { dispatchItemId: number; itemName: string; quantityReceived: string; remarks: string }[],
  });

  useEffect(() => { setPage(1); }, [activeTab, statusFilter]);

  // Stats
  const { data: stats } = useApiQuery<{ pendingRequisitions: number; todayDispatches: number; lowStockItems: number; totalRequisitionsThisMonth: number }>(
    queryKeys.reports.all,
    '/api/ward-supply/stats'
  );

  // Requisitions
  const reqParams = new URLSearchParams({ page: String(page), limit: '20' });
  if (statusFilter) reqParams.set('status', statusFilter);
  if (wardId) reqParams.set('wardId', wardId);

  const { data: reqData, isLoading: loadingReq } = useApiQuery<{ requisitions: Requisition[]; pagination: { total: number } }>(
    ['wardSupply', 'requisitions', statusFilter, wardId, page],
    `/api/ward-supply/requisitions?${reqParams.toString()}`
  );

  // Dispatches
  const { data: dispatchData, isLoading: loadingDispatch } = useApiQuery<{ dispatches: Dispatch[] }>(
    ['wardSupply', 'dispatches', wardId],
    `/api/ward-supply/dispatches?wardId=${wardId}`
  );

  // Stock
  const { data: stockData, isLoading: loadingStock } = useApiQuery<{ stock: WardStock[] }>(
    ['wardSupply', 'stock', wardId],
    `/api/ward-supply/stock/${wardId}?lowStock=0`
  );
  const { data: lowStockData } = useApiQuery<{ stock: WardStock[] }>(
    ['wardSupply', 'lowStock', wardId],
    `/api/ward-supply/stock/${wardId}?lowStock=1`
  );

  const createReqMutation = useApiMutation('post', '/api/ward-supply/requisitions', {
    onSuccess: () => {
      toast.success(t('toasts.reqCreated'));
      setShowReqModal(false);
      setReqForm({ wardId: '1', wardName: '', requestedBy: '', priority: 'routine', remarks: '', items: [] });
      queryClient.invalidateQueries({ queryKey: ['wardSupply', 'requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['wardSupply', 'stats'] });
    },
    onError: (err: any) => toast.error(err.message || t('toasts.failed')),
  });

  const createPharmacyReqMutation = useApiMutation('post', '/api/ward-supply/pharmacy-requisitions', {
    onSuccess: () => {
      toast.success(t('toasts.pharmacyReqCreated', { defaultValue: 'Medicine requisition created' }));
      setShowReqModal(false);
      setReqForm({ wardId: '1', wardName: '', requestedBy: '', priority: 'routine', remarks: '', items: [] });
      queryClient.invalidateQueries({ queryKey: ['wardSupply'] });
    },
    onError: (err: any) => toast.error(err.message || t('toasts.failed')),
  });

  const approveMutation = useApiMutation('patch', (vars: any) => `/api/ward-supply/requisitions/${vars.id}/status`, {
    onSuccess: () => {
      toast.success(t('toasts.statusUpdated'));
      queryClient.invalidateQueries({ queryKey: ['wardSupply', 'requisitions'] });
    },
    onError: (err: any) => toast.error(err.message || t('toasts.failed')),
  });

  const createDispatchMutation = useApiMutation('post', '/api/ward-supply/dispatches', {
    onSuccess: () => {
      toast.success(t('toasts.dispatchCreated'));
      setShowDispatchModal(false);
      queryClient.invalidateQueries({ queryKey: ['wardSupply'] });
    },
    onError: (err: any) => toast.error(err.message || t('toasts.failed')),
  });

  const receiptMutation = useApiMutation('patch', (vars: any) => `/api/ward-supply/dispatches/${vars.id}/receipt`, {
    onSuccess: () => {
      toast.success(t('toasts.receiptRecorded'));
      setShowReceiptModal(false);
      queryClient.invalidateQueries({ queryKey: ['wardSupply'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const addReqItem = () => {
    setReqForm(f => ({ ...f, items: [...f.items, { itemId: '', itemName: '', quantityRequested: '', unit: 'pcs', remarks: '' }] }));
  };

  const removeReqItem = (idx: number) => {
    setReqForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  };

  const updateReqItem = (idx: number, field: string, value: string) => {
    setReqForm(f => ({ ...f, items: f.items.map((item, i) => i === idx ? { ...item, [field]: value } : item) }));
  };

  const submitRequisition = () => {
    const missingInventory = reqMode === 'inventory' && reqForm.items.some(i => !i.itemName || !i.quantityRequested);
    const missingPharmacy = reqMode === 'pharmacy' && reqForm.items.some(i => !i.itemId || !i.quantityRequested);
    if (!reqForm.requestedBy || reqForm.items.length === 0 || missingInventory || missingPharmacy) {
      toast.error(t('toasts.fillRequired')); return;
    }
    if (reqMode === 'pharmacy') {
      createPharmacyReqMutation.mutate({
        wardId: Number(reqForm.wardId),
        wardName: reqForm.wardName || undefined,
        requestedBy: reqForm.requestedBy,
        remarks: reqForm.remarks || undefined,
        items: reqForm.items.map(i => ({
          itemId: Number(i.itemId),
          requestedQty: Number(i.quantityRequested),
          remarks: i.remarks || undefined,
        })),
      });
      return;
    }
    createReqMutation.mutate({
      wardId: Number(reqForm.wardId),
      wardName: reqForm.wardName || undefined,
      requestedBy: reqForm.requestedBy,
      priority: reqForm.priority,
      remarks: reqForm.remarks || undefined,
      items: reqForm.items.map(i => ({
        itemName: i.itemName,
        quantityRequested: Number(i.quantityRequested),
        unit: i.unit,
        remarks: i.remarks || undefined,
      })),
    });
  };

  const openDispatchModal = async (req: Requisition) => {
    setSelectedReq(req);
    const res = await api.get<{ requisition: { items: RequisitionItem[] } }>(`/api/ward-supply/requisitions/${req.id}`);
    const items = res?.requisition?.items?.filter((i: RequisitionItem) => i.status !== 'fully_dispatched') ?? [];
    setDispatchForm({
      requisitionId: req.id,
      wardId: req.ward_id,
      items: items.map((i: RequisitionItem) => ({
        requisitionItemId: i.id,
        itemName: i.item_name,
        quantityDispatched: String(Math.min(i.quantity_requested - i.quantity_dispatched, i.quantity_approved || i.quantity_requested)),
        unit: i.unit,
        batchNo: '',
        remarks: '',
      })),
    });
    setShowDispatchModal(true);
  };

  const submitDispatch = () => {
    const validItems = dispatchForm.items.filter(i => Number(i.quantityDispatched) > 0);
    if (validItems.length === 0) { toast.error(t('toasts.noItems')); return; }
    createDispatchMutation.mutate({
      requisitionId: dispatchForm.requisitionId,
      wardId: dispatchForm.wardId,
      items: validItems.map(i => ({
        requisitionItemId: i.requisitionItemId,
        itemName: i.itemName,
        quantityDispatched: Number(i.quantityDispatched),
        unit: i.unit,
        batchNo: i.batchNo || undefined,
        remarks: i.remarks || undefined,
      })),
    });
  };

  const openReceiptModal = async (dispatch: Dispatch) => {
    setSelectedDispatch(dispatch);
    const res = await api.get<{ dispatch: { items: DispatchItem[] } }>(`/api/ward-supply/dispatches/${dispatch.id}`);
    const items = res?.dispatch?.items ?? [];
    setReceiptForm({
      dispatchId: dispatch.id,
      receivedBy: '',
      receiptRemarks: '',
      items: items.map((i: DispatchItem) => ({
        dispatchItemId: i.id,
        itemName: i.item_name,
        quantityReceived: String(i.quantity_dispatched),
        remarks: '',
      })),
    });
    setShowReceiptModal(true);
  };

  const submitReceipt = () => {
    if (!receiptForm.receivedBy) { toast.error(t('toasts.enterReceiver')); return; }
    receiptMutation.mutate({
      id: receiptForm.dispatchId,
      body: {
        dispatchId: receiptForm.dispatchId,
        receivedBy: receiptForm.receivedBy,
        receiptRemarks: receiptForm.receiptRemarks || undefined,
        items: receiptForm.items.map(i => ({
          dispatchItemId: i.dispatchItemId,
          quantityReceived: Number(i.quantityReceived),
          remarks: i.remarks || undefined,
        })),
      },
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <p className="section-subtitle mt-1">{t('subtitle')}</p>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('pendingRequisitions')} value={String(stats?.pendingRequisitions ?? 0)} icon={<ClipboardList className="w-5 h-5" />} iconBg="bg-blue-50 text-blue-600" loading={!stats} />
          <KPICard title={t('todayDispatches')} value={String(stats?.todayDispatches ?? 0)} icon={<Truck className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" loading={!stats} />
          <KPICard title={t('lowStockAlerts')} value={String(stats?.lowStockItems ?? 0)} icon={<AlertTriangle className="w-5 h-5" />} iconBg="bg-red-50 text-red-600" loading={!stats} />
          <KPICard title={t('thisMonth')} value={String(stats?.totalRequisitionsThisMonth ?? 0)} icon={<Package className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" loading={!stats} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--color-border)]">
          {TABS.map(t_item => (
            <button key={t_item.key} onClick={() => setActiveTab(t_item.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === t_item.key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              <t_item.icon className="w-4 h-4" /> {t(t_item.label)}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="card p-3 flex gap-3 flex-wrap items-center">
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">{t('filters.ward')}</span>
          <input className="input w-24 text-sm" value={wardId} onChange={e => setWardId(e.target.value)} placeholder={t('filters.wardId')} />
          {activeTab === 'requisitions' && (
            <>
              <span className="text-sm font-medium text-[var(--color-text-secondary)]">{t('filters.status')}</span>
              <select className="input w-40 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">{t('filters.all')}</option>
                <option value="draft">{t('status.draft')}</option>
                <option value="submitted">{t('status.submitted')}</option>
                <option value="approved">{t('status.approved')}</option>
                <option value="partially_dispatched">{t('status.partially_dispatched')}</option>
                <option value="fully_dispatched">{t('status.fully_dispatched')}</option>
                <option value="rejected">{t('status.rejected')}</option>
                <option value="cancelled">{t('status.cancelled')}</option>
              </select>
            </>
          )}
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ['wardSupply'] })} className="btn-ghost ml-auto text-sm">
            <RefreshCw className="w-4 h-4" />
          </button>
          {activeTab === 'requisitions' && (
            <>
              <button onClick={() => { setReqMode('inventory'); setShowReqModal(true); }} className="btn-primary text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" /> {t('buttons.newRequisition')}
              </button>
              <button onClick={() => { setReqMode('pharmacy'); setShowReqModal(true); }} className="btn-secondary text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" /> {t('buttons.requestMedicines', { defaultValue: 'Request Medicines' })}
              </button>
            </>
          )}
        </div>

        {/* === REQUISITIONS TAB === */}
        {activeTab === 'requisitions' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base text-sm">
                <thead>
                  <tr><th>{t('table.reqNo')}</th><th>{t('table.ward')}</th><th>{t('table.requestedBy')}</th><th>{t('table.items')}</th><th>{t('table.value')}</th><th>{t('table.priority')}</th><th>{t('table.status')}</th><th>{t('table.date')}</th><th>{t('table.actions')}</th></tr>
                </thead>
                <tbody>
                  {loadingReq ? (
                    [...Array(5)].map((_, i) => <tr key={i}>{[...Array(9)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  ) : reqData?.requisitions?.length === 0 ? (
                    <tr><td colSpan={9}><EmptyState icon={<ClipboardList className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('empty.noRequisitions')} description={t('empty.noRequisitionsDesc')} /></td></tr>
                  ) : (
                    reqData?.requisitions?.map(req => (
                      <tr key={req.id}>
                        <td className="font-mono text-xs">{req.requisition_no}</td>
                        <td>{req.ward_name || t('filters.ward') + ' ' + req.ward_id}</td>
                        <td>{req.requested_by}</td>
                        <td>{req.total_items}</td>
                        <td>৳{(req.total_value ?? 0).toLocaleString()}</td>
                        <td><span className={`badge ${PRIORITY_COLORS[req.priority] ?? 'badge-secondary'}`}>{t(`priority.${req.priority}`)}</span></td>
                        <td><span className={`badge text-xs ${STATUS_COLORS[req.status] ?? 'bg-gray-100'}`}>{t(`status.${req.status}`)}</span></td>
                        <td className="text-xs">{String(req.created_at).slice(0,10)}</td>
                        <td>
                          <div className="flex gap-1">
                            {req.status === 'submitted' && (
                              <>
                                <button onClick={() => approveMutation.mutate({ id: req.id, body: { status: 'approved' } })} className="btn-ghost text-xs text-emerald-600" title="Approve"><CheckCircle className="w-4 h-4" /></button>
                                <button onClick={() => approveMutation.mutate({ id: req.id, body: { status: 'rejected' } })} className="btn-ghost text-xs text-red-600" title="Reject"><XCircle className="w-4 h-4" /></button>
                              </>
                            )}
                            {req.status === 'approved' && (
                              <button onClick={() => openDispatchModal(req)} className="btn-ghost text-xs text-amber-600" title="Dispatch"><Truck className="w-4 h-4" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* === DISPATCHES TAB === */}
        {activeTab === 'dispatches' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base text-sm">
                <thead>
                  <tr><th>{t('table.dispatchNo')}</th><th>{t('table.reqNo')}</th><th>{t('table.ward')}</th><th>{t('table.dispatchedBy')}</th><th>{t('table.date')}</th><th>{t('table.status')}</th><th>{t('table.actions')}</th></tr>
                </thead>
                <tbody>
                  {loadingDispatch ? (
                    [...Array(5)].map((_, i) => <tr key={i}>{[...Array(7)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  ) : dispatchData?.dispatches?.length === 0 ? (
                    <tr><td colSpan={7}><EmptyState icon={<Truck className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('empty.noDispatches')} description={t('empty.noDispatchesDesc')} /></td></tr>
                  ) : (
                    dispatchData?.dispatches?.map(d => (
                      <tr key={d.id}>
                        <td className="font-mono text-xs">{d.dispatch_no}</td>
                        <td>{d.requisition_id}</td>
                        <td>{t('filters.ward')} {d.ward_id}</td>
                        <td>{d.dispatched_by}</td>
                        <td className="text-xs">{String(d.dispatched_at).slice(0,10)}</td>
                        <td><span className={`badge text-xs ${d.status === 'fully_received' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{t(`status.${d.status}`)}</span></td>
                        <td>
                          {d.status !== 'fully_received' && (
                            <button onClick={() => openReceiptModal(d)} className="btn-ghost text-xs text-emerald-600" title="Mark Received"><CheckCircle className="w-4 h-4" /></button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* === STOCK TAB === */}
        {activeTab === 'stock' && (
          <div className="space-y-4">
            {lowStockData && lowStockData.stock.length > 0 && (
              <div className="card p-4 border-l-4 border-red-500">
                <h3 className="text-sm font-semibold text-red-600 flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4" /> {t('lowStockAlerts')}</h3>
                <div className="flex flex-wrap gap-2">
                  {lowStockData.stock.map(s => (
                    <span key={s.id} className="badge badge-danger text-xs">{s.item_name}: {s.current_quantity} / {s.min_stock_level} {s.unit}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base text-sm">
                  <thead><tr><th>{t('table.item')}</th><th>{t('table.code')}</th><th>{t('table.currentStock')}</th><th>{t('table.minLevel')}</th><th>{t('table.unit')}</th><th>{t('table.lastReceipt')}</th></tr></thead>
                  <tbody>
                    {loadingStock ? (
                      [...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    ) : stockData?.stock?.length === 0 ? (
                      <tr><td colSpan={6}><EmptyState icon={<Archive className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('empty.noStock')} description={t('empty.noStockDesc')} /></td></tr>
                    ) : (
                      stockData?.stock?.map(s => (
                        <tr key={s.id} className={s.current_quantity <= s.min_stock_level ? 'bg-red-50' : ''}>
                          <td className="font-medium">{s.item_name}</td>
                          <td className="font-mono text-xs">{s.item_code ?? '—'}</td>
                          <td className={`font-data font-bold ${s.current_quantity <= s.min_stock_level ? 'text-red-600' : ''}`}>{s.current_quantity}</td>
                          <td>{s.min_stock_level}</td>
                          <td>{s.unit}</td>
                          <td className="text-xs">{s.last_receipt_date ? String(s.last_receipt_date).slice(0,10) : '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* === REQUISITION MODAL === */}
        {showReqModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">
                  {reqMode === 'pharmacy'
                    ? t('modal.newPharmacyRequisition', { defaultValue: 'New Medicine Requisition' })
                    : t('modal.newRequisition')}
                </h3>
                <button onClick={() => setShowReqModal(false)} className="btn-ghost"><XCircle className="w-5 h-5" /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input placeholder={t('modal.wardId')} value={reqForm.wardId} onChange={e => setReqForm(f => ({ ...f, wardId: e.target.value }))} className="input text-sm" />
                <input placeholder={t('modal.wardName')} value={reqForm.wardName} onChange={e => setReqForm(f => ({ ...f, wardName: e.target.value }))} className="input text-sm" />
                <input placeholder={t('modal.requestedBy')} value={reqForm.requestedBy} onChange={e => setReqForm(f => ({ ...f, requestedBy: e.target.value }))} className="input text-sm" />
                <select value={reqForm.priority} onChange={e => setReqForm(f => ({ ...f, priority: e.target.value as any }))} className="input text-sm">
                  <option value="routine">{t('priority.routine')}</option>
                  <option value="urgent">{t('priority.urgent')}</option>
                  <option value="emergency">{t('priority.emergency')}</option>
                </select>
              </div>
              <textarea placeholder={t('modal.remarks')} value={reqForm.remarks} onChange={e => setReqForm(f => ({ ...f, remarks: e.target.value }))} rows={2} className="input w-full text-sm" />
              <div className="space-y-2">
                {reqForm.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-5 gap-2 items-center">
                    {reqMode === 'pharmacy' ? (
                      <input type="number" placeholder={t('modal.itemId', { defaultValue: 'Medicine Item ID' })} value={item.itemId} onChange={e => updateReqItem(idx, 'itemId', e.target.value)} className="input text-xs col-span-2" />
                    ) : (
                      <input placeholder={t('modal.itemName')} value={item.itemName} onChange={e => updateReqItem(idx, 'itemName', e.target.value)} className="input text-xs col-span-2" />
                    )}
                    <input type="number" placeholder={t('modal.qty')} value={item.quantityRequested} onChange={e => updateReqItem(idx, 'quantityRequested', e.target.value)} className="input text-xs" />
                    <input placeholder={t('table.unit')} value={item.unit} onChange={e => updateReqItem(idx, 'unit', e.target.value)} className="input text-xs" />
                    <button onClick={() => removeReqItem(idx)} className="text-red-500 text-xs hover:underline">{t('buttons.remove')}</button>
                  </div>
                ))}
                <button onClick={addReqItem} className="btn btn-secondary text-sm w-full">{t('buttons.addItem')}</button>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowReqModal(false)} className="btn btn-secondary text-sm">{t('common:cancel')}</button>
                <button onClick={submitRequisition} disabled={createReqMutation.isPending || createPharmacyReqMutation.isPending} className="btn btn-primary text-sm">
                  {(createReqMutation.isPending || createPharmacyReqMutation.isPending) ? t('common:saving') : t('common:submit')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* === DISPATCH MODAL === */}
        {showDispatchModal && selectedReq && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">{t('modal.createDispatch', { no: selectedReq.requisition_no })}</h3>
                <button onClick={() => setShowDispatchModal(false)} className="btn-ghost"><XCircle className="w-5 h-5" /></button>
              </div>
              <div className="space-y-2">
                {dispatchForm.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-4 gap-2 items-center border border-[var(--color-border)] rounded-lg p-2">
                    <div className="col-span-1"><p className="text-sm font-medium">{item.itemName}</p><p className="text-xs text-[var(--color-text-muted)]">{item.unit}</p></div>
                    <input type="number" placeholder={t('modal.qty')} value={item.quantityDispatched} onChange={e => setDispatchForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, quantityDispatched: e.target.value } : it) }))} className="input text-xs" />
                    <input placeholder={t('modal.batch')} value={item.batchNo} onChange={e => setDispatchForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, batchNo: e.target.value } : it) }))} className="input text-xs" />
                    <input placeholder={t('modal.remarks')} value={item.remarks} onChange={e => setDispatchForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, remarks: e.target.value } : it) }))} className="input text-xs" />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDispatchModal(false)} className="btn btn-secondary text-sm">{t('common:cancel')}</button>
                <button onClick={submitDispatch} disabled={createDispatchMutation.isPending} className="btn btn-primary text-sm">{createDispatchMutation.isPending ? t('common:saving') : t('buttons.dispatch')}</button>
              </div>
            </div>
          </div>
        )}

        {/* === RECEIPT MODAL === */}
        {showReceiptModal && selectedDispatch && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">{t('modal.recordReceipt', { no: selectedDispatch.dispatch_no })}</h3>
                <button onClick={() => setShowReceiptModal(false)} className="btn-ghost"><XCircle className="w-5 h-5" /></button>
              </div>
              <input placeholder={t('modal.receivedBy')} value={receiptForm.receivedBy} onChange={e => setReceiptForm(f => ({ ...f, receivedBy: e.target.value }))} className="input w-full text-sm" />
              <textarea placeholder={t('modal.receiptRemarks')} value={receiptForm.receiptRemarks} onChange={e => setReceiptForm(f => ({ ...f, receiptRemarks: e.target.value }))} rows={2} className="input w-full text-sm" />
              <div className="space-y-2">
                {receiptForm.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-3 gap-2 items-center border border-[var(--color-border)] rounded-lg p-2">
                    <div><p className="text-sm font-medium">{item.itemName}</p></div>
                    <input type="number" placeholder={t('modal.qtyReceived')} value={item.quantityReceived} onChange={e => setReceiptForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, quantityReceived: e.target.value } : it) }))} className="input text-xs" />
                    <input placeholder={t('modal.remarks')} value={item.remarks} onChange={e => setReceiptForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, remarks: e.target.value } : it) }))} className="input text-xs" />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowReceiptModal(false)} className="btn btn-secondary text-sm">{t('common:cancel')}</button>
                <button onClick={submitReceipt} disabled={receiptMutation.isPending} className="btn btn-primary text-sm">{receiptMutation.isPending ? t('common:saving') : t('buttons.confirmReceipt')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
