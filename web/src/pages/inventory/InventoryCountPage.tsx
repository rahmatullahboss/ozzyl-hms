import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Calculator, CheckCircle, ClipboardList, Plus, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../hooks/useAuth';

interface Store { StoreId: number; StoreName: string; }
interface StockRow { StockId: number; ItemId: number; ItemName: string; BatchNo?: string; StoreId: number; AvailableQuantity: number; }
interface CountSession { CountSessionId: number; CountNo: string; StoreName?: string; Status: string; CountDate?: string; }
interface CountRow { ItemId: number; StockId: number; BatchNo: string; CountedQuantity: number; Remarks: string; }

export default function InventoryCountPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canApproveInventory = user?.role === 'hospital_admin' || permissions.includes('*') || permissions.includes('inventory:approve');
  const [sessionForm, setSessionForm] = useState({ StoreId: '', CountDate: new Date().toISOString().slice(0, 10), AssignedTo: '', Remarks: '' });
  const [activeSessionId, setActiveSessionId] = useState('');
  const [rows, setRows] = useState<CountRow[]>([{ ItemId: 0, StockId: 0, BatchNo: '', CountedQuantity: 0, Remarks: '' }]);

  const { data: storesData } = useApiQuery<{ data: Store[] }>(queryKeys.inventory.stores(), '/api/inventory/stores?page=1&limit=100');
  const { data: sessionsData } = useApiQuery<{ data: CountSession[] }>(['inventory', 'count-sessions'], '/api/inventory/count-sessions?page=1&limit=20');
  const { data: stockData } = useApiQuery<{ data: StockRow[] }>(['inventory', 'count-stock', sessionForm.StoreId], `/api/inventory/stock/overview?limit=400${sessionForm.StoreId ? `&StoreId=${sessionForm.StoreId}` : ''}`);
  const stores = storesData?.data ?? [];
  const sessions = sessionsData?.data ?? [];
  const stockRows = stockData?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['inventory', 'count-sessions'] });
  const createSession = useApiMutation<any, any>('post', '/api/inventory/count-sessions', {
    onSuccess: (data) => { toast.success(t('inventory.count.success.sessionCreated')); setActiveSessionId(String(data.CountSessionId)); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const saveItems = useApiMutation<any, any>('post', () => `/api/inventory/count-sessions/${activeSessionId}/items`, {
    onSuccess: () => { toast.success(t('inventory.count.success.itemsSaved')); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const submitSession = useApiMutation<any, { id: number }>('post', vars => `/api/inventory/count-sessions/${vars.id}/submit`, { onSuccess: () => { toast.success(t('inventory.count.success.submitted')); invalidate(); }, onError: err => toast.error(err.message) });
  const approveSession = useApiMutation<any, { id: number }>('post', vars => `/api/inventory/count-sessions/${vars.id}/approve`, { onSuccess: () => { toast.success(t('inventory.count.success.approved')); invalidate(); queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() }); }, onError: err => toast.error(err.message) });

  const selectStock = (idx: number, stockId: number) => {
    const stock = stockRows.find(row => row.StockId === stockId);
    setRows(prev => prev.map((row, i) => i === idx ? {
      ...row,
      StockId: stockId,
      ItemId: Number(stock?.ItemId || 0),
      BatchNo: stock?.BatchNo || '',
      CountedQuantity: Number(stock?.AvailableQuantity || 0),
    } : row));
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><Calculator className="w-6 h-6 inline mr-2" />{t('inventory.count.title')}</h1>
            <p className="section-subtitle">{t('inventory.count.subtitle')}</p>
          </div>
          <Link to={`${base}/inventory/stock`} className="btn-secondary text-sm">{t('inventory.count.stockOverview')}</Link>
        </div>

        <div className="card p-5 grid grid-cols-1 md:grid-cols-5 gap-4">
          <div><label className="label">{t('inventory.count.store')}</label><select className="input" required value={sessionForm.StoreId} onChange={e => setSessionForm({ ...sessionForm, StoreId: e.target.value })}><option value="">{t('inventory.count.selectStore')}</option>{stores.map(store => <option key={store.StoreId} value={store.StoreId}>{store.StoreName}</option>)}</select></div>
          <div><label className="label">{t('inventory.count.date')}</label><input className="input" type="date" value={sessionForm.CountDate} onChange={e => setSessionForm({ ...sessionForm, CountDate: e.target.value })} /></div>
          <div><label className="label">{t('inventory.count.assignedTo')}</label><input className="input" value={sessionForm.AssignedTo} onChange={e => setSessionForm({ ...sessionForm, AssignedTo: e.target.value })} /></div>
          <div><label className="label">{t('inventory.count.remarks')}</label><input className="input" value={sessionForm.Remarks} onChange={e => setSessionForm({ ...sessionForm, Remarks: e.target.value })} /></div>
          <div className="flex items-end"><button className="btn-primary w-full" onClick={() => {
            if (!sessionForm.StoreId) { toast.error(t('inventory.count.errors.selectStore')); return; }
            createSession.mutate({ StoreId: Number(sessionForm.StoreId), CountDate: sessionForm.CountDate, AssignedTo: sessionForm.AssignedTo ? Number(sessionForm.AssignedTo) : undefined, Remarks: sessionForm.Remarks || undefined });
          }}><ClipboardList className="w-4 h-4" /> {t('inventory.count.createSession')}</button></div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)] flex flex-wrap items-center gap-3 justify-between">
            <h3 className="font-semibold">{t('inventory.count.physicalEntry')}</h3>
            <select className="input w-64" value={activeSessionId} onChange={e => setActiveSessionId(e.target.value)}><option value="">{t('inventory.count.selectActiveSession')}</option>{sessions.map(session => <option key={session.CountSessionId} value={session.CountSessionId}>{session.CountNo} · {session.Status}</option>)}</select>
          </div>
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('inventory.count.items.stock')}</th><th>{t('inventory.count.items.batch')}</th><th>{t('inventory.count.items.system')}</th><th>{t('inventory.count.items.counted')}</th><th>{t('inventory.count.items.difference')}</th><th>{t('inventory.count.items.remarks')}</th><th></th></tr></thead><tbody>{rows.map((row, idx) => {
            const stock = stockRows.find(s => s.StockId === row.StockId);
            const systemQty = Number(stock?.AvailableQuantity || 0);
            return (
              <tr key={idx}>
                <td><select className="input min-w-64" value={row.StockId} onChange={e => selectStock(idx, Number(e.target.value))}><option value="">{t('inventory.count.selectStock')}</option>{stockRows.map(stock => <option key={stock.StockId} value={stock.StockId}>{stock.ItemName} · {stock.BatchNo || t('inventory.count.items.batch')} · {stock.AvailableQuantity}</option>)}</select></td>
                <td>{row.BatchNo || '—'}</td>
                <td className="font-data">{stock?.AvailableQuantity ?? '—'}</td>
                <td><input className="input w-24" type="number" min="0" value={row.CountedQuantity} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, CountedQuantity: Number(e.target.value) || 0 } : r))} /></td>
                <td className={`font-data ${row.CountedQuantity - systemQty === 0 ? '' : row.CountedQuantity > systemQty ? 'text-green-600' : 'text-red-600'}`}>{row.CountedQuantity - systemQty}</td>
                <td><input className="input w-44" value={row.Remarks} onChange={e => setRows(prev => prev.map((r, i) => i === idx ? { ...r, Remarks: e.target.value } : r))} /></td>
                <td><button type="button" className="btn-ghost p-1" onClick={() => setRows(prev => [...prev, { ItemId: 0, StockId: 0, BatchNo: '', CountedQuantity: 0, Remarks: '' }])}><Plus className="w-4 h-4" /></button></td>
              </tr>
            );
          })}</tbody></table></div>
          <div className="p-4 border-t border-[var(--color-border)] flex justify-end gap-2">
            <button className="btn-secondary" disabled={!activeSessionId || saveItems.isPending} onClick={() => saveItems.mutate({ Items: rows.filter(row => row.StockId).map(row => ({ ItemId: row.ItemId, StockId: row.StockId, BatchNo: row.BatchNo || undefined, CountedQuantity: row.CountedQuantity, Remarks: row.Remarks || undefined })) })}><Plus className="w-4 h-4" /> {t('inventory.count.saveCount')}</button>
            <button className="btn-secondary" disabled={!activeSessionId} onClick={() => submitSession.mutate({ id: Number(activeSessionId) })}><Send className="w-4 h-4" /> {t('inventory.count.submit')}</button>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]"><h3 className="font-semibold">{t('inventory.count.recent.heading')}</h3></div>
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('inventory.count.recent.no')}</th><th>{t('inventory.count.recent.date')}</th><th>{t('inventory.count.recent.store')}</th><th>{t('inventory.count.recent.status')}</th><th>{t('inventory.count.recent.actions')}</th></tr></thead><tbody>{sessions.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">{t('inventory.count.recent.empty')}</td></tr> : sessions.map(session => (
            <tr key={session.CountSessionId}><td className="font-medium">{session.CountNo}</td><td>{session.CountDate || '—'}</td><td>{session.StoreName || '—'}</td><td><span className="badge badge-secondary">{session.Status}</span></td><td>{['submitted', 'in_progress'].includes(session.Status) && canApproveInventory && <button className="btn-secondary text-xs" onClick={() => approveSession.mutate({ id: session.CountSessionId })}><CheckCircle className="w-3 h-3" /> {t('inventory.count.recent.approve')}</button>}</td></tr>
          ))}</tbody></table></div>
        </div>
      </div>
    </DashboardLayout>
  );
}
