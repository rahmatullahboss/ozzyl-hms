import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { apiFetch } from '../lib/apiClient';

type ManagerSummary = {
  reception: { patientsToday: number; appointmentsToday: number; activeCounters: number; pendingHandovers: number; waitingQueue: number };
  lab: { pendingOrders: number; readyReports: number; delayedReports: number };
  billing: { dueInvoices: number; pendingPayments: number };
  ipd?: { admissionsToday: number; availableBeds: number };
  alerts: Array<{ id: string; title: string; description?: string }>;
};

const emptySummary: ManagerSummary = {
  reception: { patientsToday: 0, appointmentsToday: 0, activeCounters: 0, pendingHandovers: 0, waitingQueue: 0 },
  lab: { pendingOrders: 0, readyReports: 0, delayedReports: 0 },
  billing: { dueInvoices: 0, pendingPayments: 0 },
  ipd: { admissionsToday: 0, availableBeds: 0 },
  alerts: [],
};

function MetricCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{hint}</p>
    </div>
  );
}

export default function ManagerDashboard() {
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const [summary, setSummary] = useState<ManagerSummary>(emptySummary);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch<{ data: ManagerSummary }>('/api/manager/dashboard-summary')
      .then((response) => { if (active) setSummary(response.data ?? emptySummary); })
      .catch(() => { if (active) setSummary(emptySummary); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const metrics = useMemo(() => [
    { label: 'Today OPD', value: summary.reception.patientsToday, hint: 'New patients registered today' },
    { label: 'Appointments', value: summary.reception.appointmentsToday, hint: 'OPD serial and scheduled visits' },
    { label: 'Active counters', value: summary.reception.activeCounters, hint: 'Open billing counters to monitor' },
    { label: 'Pending lab', value: summary.lab.pendingOrders, hint: 'Lab items still in progress' },
    { label: 'Ready reports', value: summary.lab.readyReports, hint: 'Reports ready or verified' },
    { label: 'Pending handover', value: summary.reception.pendingHandovers, hint: 'Counter handovers needing follow-up' },
    { label: 'Due invoices', value: summary.billing.dueInvoices, hint: 'Invoices with outstanding due' },
    { label: 'Beds available', value: summary.ipd?.availableBeds ?? 0, hint: 'Available or vacant beds' },
  ], [summary]);

  const quickLinks = [
    ['Reception dashboard', `${basePath}/reception/dashboard`],
    ['Billing counter', `${basePath}/reception/billing-counter`],
    ['Cash operations', `${basePath}/reception/cash-operations`],
    ['Lab dashboard', `${basePath}/lab/dashboard`],
    ['Lab orders', `${basePath}/lab/orders`],
    ['Patient search', `${basePath}/reception/patients`],
  ];

  return (
    <section className="space-y-6 p-6" data-testid="manager-dashboard-page">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-500">Operations supervisor workspace</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Manager Dashboard</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">Monitor reception, lab, billing handover, and IPD flow without MD, Administration, accounting, profit, or shareholder controls.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link className="rounded-full border px-3 py-1 font-medium text-slate-700" to={`${basePath}/manager/dashboard`}>Manager</Link>
          <Link className="rounded-full border px-3 py-1 font-medium text-slate-700" to={`${basePath}/reception/dashboard`}>Reception</Link>
          <Link className="rounded-full border px-3 py-1 font-medium text-slate-700" to={`${basePath}/lab/dashboard`}>Lab</Link>
        </div>
      </div>

      {loading && <div className="rounded-xl border bg-white p-4 text-sm text-slate-500">Loading manager summary...</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Operations board</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>Reception queue: {summary.reception.waitingQueue}</li>
            <li>Lab delayed items: {summary.lab.delayedReports}</li>
            <li>Pending payments: {summary.billing.pendingPayments}</li>
            <li>Admissions today: {summary.ipd?.admissionsToday ?? 0}</li>
          </ul>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Alerts and follow-up</h2>
          {summary.alerts.length === 0 ? <p className="mt-3 text-sm text-slate-600">No operational alerts right now.</p> : <ul className="mt-3 space-y-2 text-sm text-slate-600">{summary.alerts.map((alert) => <li key={alert.id}>{alert.title}{alert.description ? ` — ${alert.description}` : ''}</li>)}</ul>}
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Quick links</h2>
          <div className="mt-3 grid gap-2 text-sm">
            {quickLinks.map(([label, href]) => <Link key={label} className="rounded-xl border px-3 py-2 font-medium text-slate-700 hover:bg-slate-50" to={href}>{label}</Link>)}
          </div>
        </div>
      </div>
    </section>
  );
}
