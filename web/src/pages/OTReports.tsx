import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Calendar, DollarSign, Package, Clock } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery } from '../hooks/useApiQuery';

const today = () => new Date().toISOString().split('T')[0];
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
};

type ReportTab = 'daily' | 'financial' | 'inventory' | 'utilization';

export default function OTReports({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantClinical']);
  const [activeTab, setActiveTab] = useState<ReportTab>('daily');
  const [date, setDate] = useState(today());
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(today());

  const TABS: { key: ReportTab; label: string; icon: typeof BarChart3 }[] = [
    { key: 'daily', label: t('otReports.tab.daily'), icon: Calendar },
    { key: 'financial', label: t('otReports.tab.financial'), icon: DollarSign },
    { key: 'inventory', label: t('otReports.tab.inventory'), icon: Package },
    { key: 'utilization', label: t('otReports.tab.utilization'), icon: Clock },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('otReports.title')}</h1>
              <p className="section-subtitle">{t('otReports.subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="card p-1 flex gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border-light)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Date Filters */}
        <div className="card p-3 flex flex-wrap items-center gap-3">
          {activeTab === 'daily' ? (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input py-1.5" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-muted)]">{t('otReports.from')}</span>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input py-1.5" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-muted)]">{t('otReports.to')}</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input py-1.5" />
              </div>
            </>
          )}
          <button onClick={() => { setDate(today()); setDateFrom(monthStart()); setDateTo(today()); }} className="btn-ghost text-xs ml-auto">{t('otReports.reset')}</button>
        </div>

        {/* Report Content */}
        {activeTab === 'daily' && <DailyReportView date={date} />}
        {activeTab === 'financial' && <FinancialReportView from={dateFrom} to={dateTo} />}
        {activeTab === 'inventory' && <InventoryReportView from={dateFrom} to={dateTo} />}
        {activeTab === 'utilization' && <UtilizationReportView from={dateFrom} to={dateTo} />}
      </div>
    </DashboardLayout>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
        <p className="text-xl font-bold font-data">{value}</p>
      </div>
    </div>
  );
}

function DailyReportView({ date }: { date: string }) {
  const { t } = useTranslation(['tenantClinical']);
  const { data, isLoading } = useApiQuery<{ report: {
    total_scheduled: number; completed: number; cancelled: number; emergency: number; in_progress: number;
    room_utilization: Array<{ room_name: string; bookings: number; utilization_pct: number }>;
    surgeon_cases: Array<{ surgeon_name: string; cases: number }>;
    procedure_cases: Array<{ surgery_type: string; cases: number }>;
  } }>(['ot', 'reports', 'daily', date], `/api/ot/reports/daily?date=${date}`);

  if (isLoading) return <div className="skeleton h-64 w-full" />;
  const r = data?.report;
  if (!r) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label={t('otReports.daily.scheduled')} value={r.total_scheduled} icon={<Calendar className="w-5 h-5" />} color="bg-blue-50 text-blue-600" />
        <StatCard label={t('otReports.daily.completed')} value={r.completed} icon={<Calendar className="w-5 h-5" />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label={t('otReports.daily.cancelled')} value={r.cancelled} icon={<Calendar className="w-5 h-5" />} color="bg-red-50 text-red-600" />
        <StatCard label={t('otReports.daily.emergency')} value={r.emergency} icon={<Calendar className="w-5 h-5" />} color="bg-orange-50 text-orange-600" />
        <StatCard label={t('otReports.daily.inProgress')} value={r.in_progress} icon={<Clock className="w-5 h-5" />} color="bg-amber-50 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">{t('otReports.daily.roomUtilization')}</h3>
          {r.room_utilization.length === 0 ? <p className="text-xs text-[var(--color-text-muted)]">{t('otReports.noData')}</p> : (
            <div className="space-y-2">
              {r.room_utilization.map((room, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{room.room_name}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--color-primary)] rounded-full" style={{ width: `${room.utilization_pct}%` }} />
                    </div>
                    <span className="font-data text-xs w-12 text-right">{room.utilization_pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">{t('otReports.daily.surgeonCases')}</h3>
          {r.surgeon_cases.length === 0 ? <p className="text-xs text-[var(--color-text-muted)]">{t('otReports.noData')}</p> : (
            <div className="space-y-2">
              {r.surgeon_cases.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{s.surgeon_name}</span>
                  <span className="font-data font-medium">{s.cases}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">{t('otReports.daily.procedures')}</h3>
          {r.procedure_cases.length === 0 ? <p className="text-xs text-[var(--color-text-muted)]">{t('otReports.noData')}</p> : (
            <div className="space-y-2">
              {r.procedure_cases.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{p.surgery_type}</span>
                  <span className="font-data font-medium">{p.cases}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FinancialReportView({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation(['tenantClinical']);
  const { data, isLoading } = useApiQuery<{ report: {
    total_revenue: number; surgery_charges: number; medicine_charges: number; implant_charges: number;
    surgeon_commission: number; anesthetist_commission: number; total_discount: number; net_revenue: number;
  } }>(['ot', 'reports', 'financial', from, to], `/api/ot/reports/financial?from=${from}&to=${to}`);

  if (isLoading) return <div className="skeleton h-64 w-full" />;
  const r = data?.report;
  if (!r) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t('otReports.financial.totalRevenue')} value={`৳${r.total_revenue.toLocaleString()}`} icon={<DollarSign className="w-5 h-5" />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label={t('otReports.financial.netRevenue')} value={`৳${r.net_revenue.toLocaleString()}`} icon={<DollarSign className="w-5 h-5" />} color="bg-blue-50 text-blue-600" />
        <StatCard label={t('otReports.financial.totalDiscount')} value={`৳${r.total_discount.toLocaleString()}`} icon={<DollarSign className="w-5 h-5" />} color="bg-red-50 text-red-600" />
        <StatCard label={t('otReports.financial.surgeonCommission')} value={`৳${r.surgeon_commission.toLocaleString()}`} icon={<DollarSign className="w-5 h-5" />} color="bg-purple-50 text-purple-600" />
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-semibold mb-3">{t('otReports.financial.revenueBreakdown')}</h3>
        <div className="space-y-3">
          {[
            { label: t('otReports.financial.surgeryCharges'), value: r.surgery_charges, color: 'bg-blue-500' },
            { label: t('otReports.financial.medicineCharges'), value: r.medicine_charges, color: 'bg-emerald-500' },
            { label: t('otReports.financial.implantCharges'), value: r.implant_charges, color: 'bg-purple-500' },
            { label: t('otReports.financial.surgeonCommissionRow'), value: r.surgeon_commission, color: 'bg-orange-500' },
            { label: t('otReports.financial.anesthetistCommission'), value: r.anesthetist_commission, color: 'bg-red-500' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-sm w-40">{item.label}</span>
              <div className="flex-1 h-6 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                <div className={`h-full ${item.color} rounded`} style={{ width: `${r.total_revenue ? (item.value / r.total_revenue) * 100 : 0}%` }} />
              </div>
              <span className="font-data text-sm w-24 text-right">৳{item.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InventoryReportView({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation(['tenantClinical']);
  const { data, isLoading } = useApiQuery<{ report: {
    total_items_used: number; total_value: number;
    by_source: Array<{ source: string; items: number; value: number }>;
    by_charge_head: Array<{ charge_head: string; items: number; value: number }>;
    wastage: { items: number; value: number };
    returned: { items: number; value: number };
  } }>(['ot', 'reports', 'inventory', from, to], `/api/ot/reports/inventory?from=${from}&to=${to}`);

  if (isLoading) return <div className="skeleton h-64 w-full" />;
  const r = data?.report;
  if (!r) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t('otReports.inventory.itemsUsed')} value={r.total_items_used} icon={<Package className="w-5 h-5" />} color="bg-blue-50 text-blue-600" />
        <StatCard label={t('otReports.inventory.totalValue')} value={`৳${r.total_value.toLocaleString()}`} icon={<DollarSign className="w-5 h-5" />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label={t('otReports.inventory.wastage')} value={`${r.wastage.items} ${t('otReports.items')}`} icon={<Package className="w-5 h-5" />} color="bg-red-50 text-red-600" />
        <StatCard label={t('otReports.inventory.returned')} value={`${r.returned.items} ${t('otReports.items')}`} icon={<Package className="w-5 h-5" />} color="bg-amber-50 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">{t('otReports.inventory.bySource')}</h3>
          <div className="space-y-2">
            {r.by_source.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="capitalize">{s.source.replace(/_/g, ' ')}</span>
                <span className="font-data">{s.items} {t('otReports.items')} (৳{s.value.toLocaleString()})</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">{t('otReports.inventory.byChargeHead')}</h3>
          <div className="space-y-2">
            {r.by_charge_head.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="capitalize">{h.charge_head.replace(/_/g, ' ')}</span>
                <span className="font-data">{h.items} {t('otReports.items')} (৳{h.value.toLocaleString()})</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UtilizationReportView({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation(['tenantClinical']);
  const { data, isLoading } = useApiQuery<{ report: {
    room_utilization: Array<{ room_name: string; total_bookings: number; avg_duration_min: number; utilization_pct: number }>;
    avg_surgery_duration_min: number; avg_cleaning_duration_min: number;
    delay_reasons: Array<{ reason: string; count: number }>;
  } }>(['ot', 'reports', 'utilization', from, to], `/api/ot/reports/utilization?from=${from}&to=${to}`);

  if (isLoading) return <div className="skeleton h-64 w-full" />;
  const r = data?.report;
  if (!r) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label={t('otReports.utilization.avgSurgeryDuration')} value={`${r.avg_surgery_duration_min} ${t('otReports.minutes')}`} icon={<Clock className="w-5 h-5" />} color="bg-blue-50 text-blue-600" />
        <StatCard label={t('otReports.utilization.avgCleaningDuration')} value={`${r.avg_cleaning_duration_min} ${t('otReports.minutes')}`} icon={<Clock className="w-5 h-5" />} color="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-semibold mb-3">{t('otReports.utilization.roomUtilization')}</h3>
        {r.room_utilization.length === 0 ? <p className="text-xs text-[var(--color-text-muted)]">{t('otReports.noData')}</p> : (
          <div className="overflow-x-auto">
            <table className="table-base text-xs">
              <thead><tr><th>{t('otReports.utilization.room')}</th><th>{t('otReports.utilization.bookings')}</th><th>{t('otReports.utilization.avgDuration')}</th><th>{t('otReports.utilization.utilization')}</th></tr></thead>
              <tbody>
                {r.room_utilization.map((room, i) => (
                  <tr key={i}>
                    <td className="font-medium">{room.room_name}</td>
                    <td className="font-data">{room.total_bookings}</td>
                    <td className="font-data">{room.avg_duration_min} {t('otReports.minutes')}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-[var(--color-primary)] rounded-full" style={{ width: `${room.utilization_pct}%` }} />
                        </div>
                        <span className="font-data">{room.utilization_pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {r.delay_reasons.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">{t('otReports.utilization.delayReasons')}</h3>
          <div className="space-y-2">
            {r.delay_reasons.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{d.reason}</span>
                <span className="font-data font-medium">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
