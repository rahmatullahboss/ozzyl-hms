import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../../hooks/useFmt';

interface Staff { id: number; name: string; position: string; status: string; }
interface StaffResponse { staff: Staff[]; }
interface SalaryHead { id: number; head_name: string; head_type: 'earning' | 'deduction'; is_taxable: number; }
interface StructureItem { id: number; salary_head_id: number; head_name: string; head_type: string; amount: number; calculation_type: string; }
interface StructureSummary { totalEarning: number; totalDeduction: number; netPay: number; }
interface StructureResponse { data: StructureItem[]; summary: StructureSummary; }
interface ListResponse<T> { data: T[]; }
interface MessageResponse { message?: string; }

interface DraftRow { salaryHeadId: number; amount: number; calculationType: 'fixed' | 'percentage'; }

export default function SalaryStructureTab() {
  const { t } = useTranslation(['hr']);
  const { fmtCurrency } = useFmt();
  const queryClient = useQueryClient();

  const staffQuery = useApiQuery<StaffResponse>(queryKeys.hr.staff(), '/api/staff');
  const staffList = (staffQuery.data?.staff ?? []).filter((s) => s.status !== 'inactive');

  const headsQuery = useApiQuery<ListResponse<SalaryHead>>(queryKeys.hr.salaryHeads(), '/api/hr/payroll/salary-heads');
  const heads = headsQuery.data?.data ?? [];

  const [staffId, setStaffId] = useState<string>('');
  const [draft, setDraft] = useState<Record<number, DraftRow>>({});

  const structureQuery = useApiQuery<StructureResponse>(
    queryKeys.hr.salaryStructure(staffId),
    `/api/hr/payroll/structure/${staffId}`,
    { enabled: !!staffId },
  );
  const summary = structureQuery.data?.summary ?? { totalEarning: 0, totalDeduction: 0, netPay: 0 };

  // When the loaded structure arrives, seed the draft
  useEffect(() => {
    if (!structureQuery.data?.data) { setDraft({}); return; }
    const next: Record<number, DraftRow> = {};
    for (const row of structureQuery.data.data) {
      next[row.salary_head_id] = {
        salaryHeadId: row.salary_head_id,
        amount: Number(row.amount),
        calculationType: (row.calculation_type as 'fixed' | 'percentage') ?? 'fixed',
      };
    }
    setDraft(next);
  }, [structureQuery.data]);

  const saveMutation = useApiMutation<MessageResponse, { staffId: number; items: DraftRow[] }>(
    'post',
    '/api/hr/payroll/structure',
    {
      onSuccess: () => {
        toast.success(t('hr:payroll.structure.saved'));
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.salaryStructure(String(staffId)) });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const onSave = () => {
    if (!staffId) return;
    const items = Object.values(draft).filter((d) => d.amount > 0);
    if (items.length === 0) { toast.error(t('hr:toasts.failed')); return; }
    saveMutation.mutate({ staffId: Number(staffId), items });
  };

  const headsByType = useMemo(() => ({
    earning: heads.filter((h) => h.head_type === 'earning'),
    deduction: heads.filter((h) => h.head_type === 'deduction'),
  }), [heads]);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="section-title mb-3">{t('hr:payroll.salaryStructure')}</h3>
        <select className="input max-w-md" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">{t('hr:payroll.selectStaff')}</option>
          {staffList.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.position}</option>)}
        </select>
      </div>

      {!staffId && <div className="card p-6 text-center text-[var(--color-text-muted)]">{t('hr:payroll.empty.noStructure')}</div>}

      {staffId && heads.length === 0 && (
        <div className="card p-6 text-center text-[var(--color-text-muted)]">{t('hr:payroll.structure.noHeads')}</div>
      )}

      {staffId && heads.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('hr:payroll.headName')}</th>
                  <th>{t('hr:payroll.headType')}</th>
                  <th className="text-right">{t('hr:payroll.structure.amount')}</th>
                  <th className="text-right">{t('hr:payroll.structure.calculationType')}</th>
                </tr>
              </thead>
              <tbody>
                {(['earning', 'deduction'] as const).flatMap((type) =>
                  headsByType[type].map((h) => (
                    <tr key={h.id}>
                      <td className="font-medium">{h.head_name}</td>
                      <td>
                        <span className={`badge ${type === 'earning' ? 'badge-success' : 'badge-danger'}`}>
                          {t(`hr:payroll.${type}`)}
                        </span>
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="input w-28 text-right font-data"
                          value={draft[h.id]?.amount ?? 0}
                          onChange={(e) => setDraft((d) => ({ ...d, [h.id]: {
                            salaryHeadId: h.id,
                            amount: Number(e.target.value),
                            calculationType: d[h.id]?.calculationType ?? 'fixed',
                          }}))}
                        />
                      </td>
                      <td className="text-right">
                        <select
                          className="input w-32 text-sm"
                          value={draft[h.id]?.calculationType ?? 'fixed'}
                          onChange={(e) => setDraft((d) => ({ ...d, [h.id]: {
                            salaryHeadId: h.id,
                            amount: d[h.id]?.amount ?? 0,
                            calculationType: e.target.value as 'fixed' | 'percentage',
                          }}))}
                          disabled={type === 'deduction'}
                        >
                          <option value="fixed">{t('hr:payroll.structure.fixed')}</option>
                          <option value="percentage" disabled={type === 'deduction'}>
                            {t('hr:payroll.structure.percentage')}
                          </option>
                        </select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--color-border)] bg-[var(--color-bg-secondary)] font-bold">
                  <td colSpan={2}>{t('hr:payroll.netPay')}</td>
                  <td className="text-right font-data">{fmtCurrency(summary.netPay)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="p-4 border-t border-[var(--color-border)] flex justify-end">
            <button onClick={onSave} disabled={saveMutation.isPending} className="btn-primary gap-2">
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? t('common:saving') : t('hr:payroll.structure.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
