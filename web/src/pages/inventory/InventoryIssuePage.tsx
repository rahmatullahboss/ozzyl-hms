import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ClipboardCheck, Plus, QrCode, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { api } from '../../lib/apiClient';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Store { StoreId: number; StoreName: string; }
interface Item { ItemId: number; ItemName: string; ItemCode?: string; SalePrice?: number; }
interface IssueRow { ItemId: number; StockId: string; BatchNo: string; Quantity: number; Chargeable: boolean; ChargeAmount: number; Remarks: string; }

const ISSUE_TYPES = [
  ['department_issue', 'issueTypes.departmentIssue'],
  ['patient_issue', 'issueTypes.patientIssue'],
  ['lab_consumption', 'issueTypes.labConsumption'],
  ['ot_consumption', 'issueTypes.otConsumption'],
  ['emergency_issue', 'issueTypes.emergencyIssue'],
  ['pharmacy_sale', 'issueTypes.pharmacySale'],
] as const;

type IssueSubmissionIdentity = { signature: string; key: string };

export function resolveIssueSubmissionKey(
  current: IssueSubmissionIdentity | null,
  payload: unknown,
  generateKey: () => string = () => crypto.randomUUID(),
): IssueSubmissionIdentity {
  const signature = JSON.stringify(payload);
  if (current?.signature === signature) return current;
  return { signature, key: generateKey() };
}

export default function InventoryIssuePage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const queryClient = useQueryClient();
  const submissionIdentityRef = useRef<IssueSubmissionIdentity | null>(null);
  const [scan, setScan] = useState('');
  const [form, setForm] = useState({
    IssueType: 'department_issue',
    FromStoreId: '',
    ToDepartment: 'Ward',
    PatientId: '',
    DepartmentId: '',
    LabOrderId: '',
    SurgeryId: '',
    Chargeable: false,
    Remarks: '',
  });
  const [rows, setRows] = useState<IssueRow[]>([{ ItemId: 0, StockId: '', BatchNo: '', Quantity: 1, Chargeable: false, ChargeAmount: 0, Remarks: '' }]);

  const { data: storesData } = useApiQuery<{ data: Store[] }>(queryKeys.inventory.stores(), '/api/inventory/stores?page=1&limit=100');
  const { data: itemsData } = useApiQuery<{ data: Item[] }>(queryKeys.inventory.items(), '/api/inventory/items?page=1&limit=300');
  const stores = storesData?.data ?? [];
  const items = itemsData?.data ?? [];

  const createIssue = useApiMutation<any, any>('post', '/api/inventory/issues', {
    onSuccess: () => {
      submissionIdentityRef.current = null;
      toast.success(t('inventory.issue.recorded'));
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() });
      setRows([{ ItemId: 0, StockId: '', BatchNo: '', Quantity: 1, Chargeable: false, ChargeAmount: 0, Remarks: '' }]);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateRow = (idx: number, patch: Partial<IssueRow>) => {
    setRows(prev => prev.map((row, i) => i === idx ? { ...row, ...patch } : row));
  };

  const addRow = (patch: Partial<IssueRow> = {}) => {
    setRows(prev => [...prev, { ItemId: 0, StockId: '', BatchNo: '', Quantity: 1, Chargeable: form.Chargeable, ChargeAmount: 0, Remarks: '', ...patch }]);
  };

  const handleScan = async () => {
    const code = scan.trim();
    if (!code) return;
    try {
      const resolved = await api.get<{ tag?: { EntityType?: string; EntityId?: number }; entity?: any }>(`/api/inventory/qr/scan/${encodeURIComponent(code)}?purpose=stock_issue`);
      const entity = resolved.entity ?? {};
      if (resolved.tag?.EntityType === 'stock' || entity.StockId) {
        addRow({ ItemId: Number(entity.ItemId || 0), StockId: String(entity.StockId || resolved.tag?.EntityId || ''), BatchNo: entity.BatchNo || '', Quantity: 1 });
      } else if (resolved.tag?.EntityType === 'item' || entity.ItemId) {
        addRow({ ItemId: Number(entity.ItemId || resolved.tag?.EntityId || 0), Quantity: 1 });
      } else {
        toast.error(t('inventory.issue.unsupportedQr'));
      }
      setScan('');
    } catch (err: any) {
      toast.error(err.message || t('inventory.issue.scanFailed'));
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.FromStoreId || rows.some(row => !row.ItemId || row.Quantity <= 0)) {
      toast.error(t('inventory.issue.selectStoreAndItems'));
      return;
    }
    const payload = {
      IssueType: form.IssueType,
      FromStoreId: Number(form.FromStoreId),
      ToDepartment: form.ToDepartment || undefined,
      PatientId: form.PatientId ? Number(form.PatientId) : undefined,
      DepartmentId: form.DepartmentId ? Number(form.DepartmentId) : undefined,
      LabOrderId: form.LabOrderId ? Number(form.LabOrderId) : undefined,
      SurgeryId: form.SurgeryId ? Number(form.SurgeryId) : undefined,
      Chargeable: form.Chargeable,
      Remarks: form.Remarks || undefined,
      Items: rows.map(row => ({
        ItemId: row.ItemId,
        StockId: row.StockId ? Number(row.StockId) : undefined,
        BatchNo: row.BatchNo || undefined,
        Quantity: row.Quantity,
        Chargeable: row.Chargeable,
        ChargeAmount: row.ChargeAmount || undefined,
        Remarks: row.Remarks || undefined,
      })),
    };
    const identity = resolveIssueSubmissionKey(submissionIdentityRef.current, payload);
    submissionIdentityRef.current = identity;
    createIssue.mutate({ ...payload, IdempotencyKey: identity.key });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><ClipboardCheck className="w-6 h-6 inline mr-2" />{t('inventory.issue.title')}</h1>
            <p className="section-subtitle">{t('inventory.issue.subtitle')}</p>
          </div>
          <Link to={`${base}/inventory/stock`} className="btn-secondary text-sm">{t('inventory.issue.stockOverview')}</Link>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><label className="label">{t('inventory.issue.issueType')}</label><select className="input" value={form.IssueType} onChange={e => setForm({ ...form, IssueType: e.target.value })}>{ISSUE_TYPES.map(([value, labelKey]) => <option key={value} value={value}>{t(labelKey)}</option>)}</select></div>
            <div><label className="label">{t('inventory.issue.fromStore')}</label><select className="input" required value={form.FromStoreId} onChange={e => setForm({ ...form, FromStoreId: e.target.value })}><option value="">{t('inventory.issue.selectStore')}</option>{stores.map(store => <option key={store.StoreId} value={store.StoreId}>{store.StoreName}</option>)}</select></div>
            <div><label className="label">{t('inventory.issue.department')}</label><input className="input" value={form.ToDepartment} onChange={e => setForm({ ...form, ToDepartment: e.target.value })} /></div>
            <div><label className="label">{t('inventory.issue.patientId')}</label><input className="input" inputMode="numeric" value={form.PatientId} onChange={e => setForm({ ...form, PatientId: e.target.value })} /></div>
            <div><label className="label">{t('inventory.issue.labOrderId')}</label><input className="input" inputMode="numeric" value={form.LabOrderId} onChange={e => setForm({ ...form, LabOrderId: e.target.value })} /></div>
            <div><label className="label">{t('inventory.issue.surgeryId')}</label><input className="input" inputMode="numeric" value={form.SurgeryId} onChange={e => setForm({ ...form, SurgeryId: e.target.value })} /></div>
            <div><label className="label">{t('inventory.issue.remarks')}</label><input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm mt-7"><input type="checkbox" checked={form.Chargeable} onChange={e => setForm({ ...form, Chargeable: e.target.checked })} /> {t('inventory.issue.chargePatientBill')}</label>
          </div>

          <div className="card p-4">
            <label className="label">{t('inventory.issue.scanner')}</label>
            <div className="flex gap-2">
              <div className="relative flex-1 max-w-md"><QrCode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input className="input pl-9 w-full" value={scan} onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } }} placeholder={t('inventory.issue.scanPlaceholder')} /></div>
              <button type="button" onClick={handleScan} className="btn-secondary">{t('inventory.issue.addScan')}</button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center"><h3 className="font-semibold">{t('inventory.issue.issueItems')}</h3><button type="button" onClick={() => addRow()} className="btn-secondary text-sm"><Plus className="w-4 h-4" /> {t('inventory.issue.add')}</button></div>
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('inventory.issue.itemCol')}</th><th>{t('inventory.issue.stockIdCol')}</th><th>{t('inventory.issue.batchCol')}</th><th>{t('inventory.issue.qtyCol')}</th><th>{t('inventory.issue.chargeCol')}</th><th>{t('inventory.issue.rateCol')}</th><th>{t('inventory.issue.remarksCol')}</th><th></th></tr></thead><tbody>{rows.map((row, idx) => (
              <tr key={idx}>
                <td><select className="input min-w-48" value={row.ItemId} onChange={e => updateRow(idx, { ItemId: Number(e.target.value), ChargeAmount: Number(items.find(item => item.ItemId === Number(e.target.value))?.SalePrice || 0) })}><option value="">{t('inventory.issue.selectItem')}</option>{items.map(item => <option key={item.ItemId} value={item.ItemId}>{item.ItemName}</option>)}</select></td>
                <td><input className="input w-24" value={row.StockId} onChange={e => updateRow(idx, { StockId: e.target.value })} /></td>
                <td><input className="input w-28" value={row.BatchNo} onChange={e => updateRow(idx, { BatchNo: e.target.value })} /></td>
                <td><input className="input w-20" type="number" min="1" value={row.Quantity} onChange={e => updateRow(idx, { Quantity: Number(e.target.value) || 1 })} /></td>
                <td><input type="checkbox" checked={row.Chargeable} onChange={e => updateRow(idx, { Chargeable: e.target.checked })} /></td>
                <td><input className="input w-24" type="number" min="0" value={row.ChargeAmount} onChange={e => updateRow(idx, { ChargeAmount: Number(e.target.value) || 0 })} /></td>
                <td><input className="input w-40" value={row.Remarks} onChange={e => updateRow(idx, { Remarks: e.target.value })} /></td>
                <td>{rows.length > 1 && <button type="button" onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))} className="btn-ghost p-1 text-red-500"><Trash2 className="w-4 h-4" /></button>}</td>
              </tr>
            ))}</tbody></table></div>
          </div>

          <div className="flex justify-end"><button type="submit" disabled={createIssue.isPending} className="btn-primary"><Save className="w-4 h-4" /> {createIssue.isPending ? t('inventory.issue.saving') : t('inventory.issue.recordIssue')}</button></div>
        </form>
      </div>
    </DashboardLayout>
  );
}
