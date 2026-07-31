import { Link } from 'react-router';
import { Bed, ClipboardList, FlaskConical, Stethoscope, Bell, ArrowRight, CheckCircle2, AlertTriangle, CircleDashed, NotebookPen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VisitType, RecentRx, FollowUp, PendingOrder, Inpatient } from './types';

export { type VisitType, type RecentRx, type FollowUp };

interface RightPanelProps {
  visitTypes: VisitType[];
  recentRx: RecentRx[];
  followUps: FollowUp[];
  pendingOrders?: PendingOrder[];
  inpatients?: Inpatient[];
  basePath: string;
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 3600 * 24));
}

function orderBillingLabel(order: PendingOrder): string {
  const normalized = String(order.billing_status ?? '').toLowerCase();
  if (normalized === 'paid' || (Number(order.due ?? 0) <= 0 && Number(order.total ?? 0) > 0)) return 'Paid';
  if (normalized === 'due_approved') return 'Due approved';
  if (normalized === 'unpaid' || normalized === 'pending' || Number(order.due ?? 0) > 0) return 'Billing pending';
  return order.bill_id ? 'Bill created' : 'No bill';
}

function orderBillingTone(order: PendingOrder): string {
  const label = orderBillingLabel(order).toLowerCase();
  if (label === 'paid') return 'bg-emerald-50 text-emerald-700';
  if (label.includes('pending')) return 'bg-amber-50 text-amber-700';
  if (label.includes('due')) return 'bg-sky-50 text-sky-700';
  return 'bg-slate-100 text-slate-600';
}

export function RightPanel({ visitTypes, recentRx, followUps, pendingOrders = [], inpatients = [], basePath }: RightPanelProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const totalVisits = visitTypes.reduce((s, v) => s + Number(v.count), 0);

  return (
    <div className="space-y-4">
      {/* Visit-type breakdown */}
      <div className="card p-4">
        <h3 className="font-semibold text-sm text-[var(--color-text)] mb-4 flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
          {t('visitTypeBreakdown')}
        </h3>
        {visitTypes.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-4">{t('noData', { defaultValue: 'No data today' })}</p>
        ) : (
          <div className="space-y-3">
            {visitTypes.map(v => {
              const pct = totalVisits > 0 ? Math.round((Number(v.count) / totalVisits) * 100) : 0;
              return (
                <div key={v.visit_type}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--color-text)] capitalize font-medium">{v.visit_type?.replace(/_/g, ' ')}</span>
                    <span className="text-[var(--color-text-muted)]">{v.count} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-[var(--color-bg)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending Orders */}
      <div className="card p-4">
        <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-[var(--color-primary)]" />
          {t('pendingOrders', { defaultValue: 'Pending Orders' })}
        </h3>
        {pendingOrders.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-3">{t('noPendingOrders', { defaultValue: 'No pending diagnostic orders' })}</p>
        ) : (
          <div className="space-y-2">
            {pendingOrders.map(order => (
              <div key={`${order.type}-${order.id}`} className="py-2 border-b border-[var(--color-border)] last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">{order.patient_name}</div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] uppercase text-[var(--color-text-muted)]">{order.type}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-mono text-[var(--color-text-muted)]">{order.order_no} · {order.status}</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${orderBillingTone(order)}`}>{orderBillingLabel(order)}</span>
                  {order.invoice_no && <span className="font-mono text-[var(--color-text-muted)]">{order.invoice_no}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* IPD Patients */}
      <div className="card p-4">
        <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
          <Bed className="w-4 h-4 text-[var(--color-primary)]" />
          {t('ipdPatients', { defaultValue: 'IPD Patients' })}
          <span className="ml-auto text-[10px] font-medium text-[var(--color-text-muted)]">
            {inpatients.filter((p) => p.not_rounded_today).length}/{inpatients.length} {t('unrounded', { defaultValue: 'unrounded' })}
          </span>
        </h3>
        {inpatients.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-3">{t('noIpdPatients', { defaultValue: 'No active inpatients' })}</p>
        ) : (
          <div className="space-y-2">
            {inpatients.map(patient => {
              const condition = (patient.last_patient_condition ?? '').toString();
              const isCritical = condition === 'critical';
              const isDeteriorating = condition === 'deteriorating';
              const cs = patient.today_round_clinical_status ?? null;
              const needsNote = patient.needs_round_note ?? false;
              const statusLabel = needsNote
                ? (patient.today_round_id ? t('round.notePending', { defaultValue: 'Note pending' }) : t('round.notRounded', { defaultValue: 'Not rounded' }))
                : t('round.roundedToday', { defaultValue: 'Rounded today' });
              const badgeTone = needsNote
                ? isCritical || isDeteriorating
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-700'
                : 'bg-emerald-100 text-emerald-700';
              const BadgeIcon = needsNote ? (isCritical || isDeteriorating ? AlertTriangle : CircleDashed) : CheckCircle2;
              return (
                <div key={patient.id} className="py-2 border-b border-[var(--color-border)] last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`${basePath}/doctor/ipd/${patient.id}?tab=round`} className="text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-primary)] truncate">
                      {patient.patient_name}
                    </Link>
                    <span className="text-[10px] text-[var(--color-text-muted)]">{patient.bed_number ?? patient.ward ?? '-'}</span>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">{patient.admission_no} · {patient.status}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium ${badgeTone}`}>
                      <BadgeIcon className="w-3 h-3" />
                      {statusLabel}
                    </span>
                    {isCritical && (
                      <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                        {t('round.critical', { defaultValue: 'Critical' })}
                      </span>
                    )}
                    {isDeteriorating && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                        {t('round.deteriorating', { defaultValue: 'Deteriorating' })}
                      </span>
                    )}
                    {cs && cs === 'signed' && !needsNote && (
                      <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium inline-flex items-center gap-1">
                        <NotebookPen className="w-3 h-3" /> {t('round.signed', { defaultValue: 'Note signed' })}
                      </span>
                    )}
                    <Link
                      to={`${basePath}/doctor/ipd/${patient.id}?tab=round`}
                      className="ml-auto text-[11px] font-medium text-[var(--color-primary)] hover:underline"
                    >
                      {needsNote ? t('round.openRound', { defaultValue: 'Round' }) : t('round.viewNote', { defaultValue: 'View note' })}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Prescriptions */}
      <div className="card p-4">
        <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
          {t('recentPrescriptions', { defaultValue: 'Recent Prescriptions' })}
        </h3>
        {recentRx.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-3">No prescriptions yet</p>
        ) : (
          <div className="space-y-2">
            {recentRx.map(rx => (
              <div key={rx.id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text)]">{rx.patient_name}</div>
                  <div className="text-xs text-[var(--color-text-muted)] font-mono">{rx.rx_no}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${rx.status === 'final' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {rx.status}
                  </span>
                  <Link to={`${basePath}/prescriptions/${rx.id}`}
                    className="text-xs text-[var(--color-primary)] hover:underline">View</Link>
                </div>
              </div>
            ))}
          </div>
        )}
        <Link to={`${basePath}/prescriptions`}
          className="text-xs text-[var(--color-primary)] hover:underline mt-2 flex items-center gap-1">
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Upcoming Follow-ups */}
      <div className="card p-4">
        <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
          <Bell className="w-4 h-4 text-[var(--color-primary)]" />
          {t('upcomingFollowUps')}
        </h3>
        {followUps.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-3">{t('noFollowUps', { defaultValue: 'No follow-ups in next 7 days' })}</p>
        ) : (
          <div className="space-y-2">
            {followUps.map((f, i) => {
              const days = daysUntil(f.follow_up_date);
              return (
                <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text)]">{f.patient_name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{f.follow_up_date}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    days === 0 ? 'bg-red-100 text-red-700' :
                    days === 1 ? 'bg-amber-100 text-amber-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {days === 0 ? t('today') : days === 1 ? t('tomorrow') : t('inDays', { count: days })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
