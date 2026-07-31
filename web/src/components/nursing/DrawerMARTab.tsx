import { useMemo, useState } from 'react';
import { Check, Clock, MoreVertical, AlertTriangle, XCircle, PauseCircle, PackageX, Ban, ScanBarcode, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { usePatientVerification } from '../../hooks/usePatientVerification';
import BarcodeScanner from './BarcodeScanner';
import toast from 'react-hot-toast';
import type { BedGridItem } from './WardBedGrid';

interface DrawerMARTabProps {
  bed: BedGridItem;
}

interface MARSchedule {
  schedule_id: number;
  medication_name: string;
  generic_name?: string;
  dose: string;
  route: string;
  frequency: string;
  scheduled_time: string;
  status: string;
  administered_at?: string;
  administered_by?: string;
  is_prn?: boolean;
  reason_not_given?: string;
}

const HIGH_RISK_KEYWORDS = ['insulin', 'heparin', 'potassium', 'warfarin', 'morphine', 'fentanyl', 'dopamine', 'norepinephrine'];

const PRN_REASON_KEYS = [
  { key: 'fever', value: 'Fever' },
  { key: 'pain', value: 'Pain' },
  { key: 'vomiting', value: 'Vomiting' },
  { key: 'breathlessness', value: 'Breathlessness' },
  { key: 'highBp', value: 'High BP' },
  { key: 'anxiety', value: 'Anxiety' },
  { key: 'other', value: 'Other' },
] as const;

const MISSED_DOSE_REASON_KEYS = [
  { key: 'patientRefused', value: 'Patient refused' },
  { key: 'patientAsleep', value: 'Patient asleep' },
  { key: 'vomiting', value: 'Vomiting' },
  { key: 'notAvailable', value: 'Medicine not available' },
  { key: 'doctorHold', value: 'Doctor hold' },
  { key: 'npo', value: 'NPO' },
  { key: 'transferred', value: 'Transferred' },
  { key: 'other', value: 'Other' },
] as const;

const HOLD_REASON_KEYS = [
  { key: 'doctorHold', value: 'Doctor hold' },
  { key: 'patientConditionImproved', value: 'Patient condition improved' },
  { key: 'sideEffects', value: 'Side effects' },
] as const;

const LATE_THRESHOLD_MINUTES = 30;

export default function DrawerMARTab({ bed }: DrawerMARTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();

  const [prnModal, setPrnModal] = useState<{ scheduleId: number; medicationName: string } | null>(null);
  const [prnReason, setPrnReason] = useState('');

  const [missedModal, setMissedModal] = useState<{ scheduleId: number; status: 'withheld' | 'refused'; medicationName: string } | null>(null);
  const [missedReason, setMissedReason] = useState('');

  const [holdModal, setHoldModal] = useState<{ scheduleId: number; medicationName: string } | null>(null);
  const [holdReason, setHoldReason] = useState('');

  const [notAvailableModal, setNotAvailableModal] = useState<{ scheduleId: number; medicationName: string } | null>(null);

  const [highRiskModal, setHighRiskModal] = useState<{ scheduleId: number; medicationName: string } | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);

  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const scheduleQuery = useApiQuery<{ Results: MARSchedule[] }>(
    queryKeys.nursing.marSchedule(bed.patient_id!, today),
    `/api/nursing/mar/schedule?patient_id=${bed.patient_id}&date=${today}`,
  );
  const schedules = scheduleQuery.data?.Results ?? [];

  const administerMutation = useApiMutation<unknown, { _id: number; status: string; reason?: string }>(
    'put',
    (vars) => `/api/nursing/mar/${vars._id}/administer`,
    {
      onSuccess: () => {
        toast.success(t('mar.administered', { defaultValue: 'Medication administered' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.marSchedule(bed.patient_id!, today) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.all });
      },
      onError: () => toast.error(t('mar.administerFailed', { defaultValue: 'Failed to record administration' })),
    },
  );

  const patientVerification = usePatientVerification({
    patientId: bed.patient_id,
    barcode: scannedBarcode,
    enabled: showBarcodeScanner && !!scannedBarcode,
  });

  const handleAdminister = (scheduleId: number) => {
    administerMutation.mutate({ _id: scheduleId, status: 'given' });
  };

  const handlePRNGive = () => {
    if (!prnModal || !prnReason) return;
    administerMutation.mutate({ _id: prnModal.scheduleId, status: 'given', reason: prnReason });
    setPrnModal(null);
    setPrnReason('');
  };

  const handleMissedConfirm = () => {
    if (!missedModal || !missedReason) return;
    administerMutation.mutate({ _id: missedModal.scheduleId, status: missedModal.status, reason: missedReason });
    setMissedModal(null);
    setMissedReason('');
  };

  const handleHoldConfirm = () => {
    if (!holdModal || !holdReason) return;
    administerMutation.mutate({ _id: holdModal.scheduleId, status: 'hold', reason: holdReason });
    setHoldModal(null);
    setHoldReason('');
  };

  const handleNotAvailableConfirm = () => {
    if (!notAvailableModal) return;
    administerMutation.mutate({ _id: notAvailableModal.scheduleId, status: 'not_available', reason: 'Medicine not available' });
    setNotAvailableModal(null);
  };

  const isHighRisk = (name: string) =>
    HIGH_RISK_KEYWORDS.some(kw => name.toLowerCase().includes(kw));

  const isLate = (schedule: MARSchedule) => {
    if (schedule.status !== 'given' || !schedule.scheduled_time || !schedule.administered_at) return false;
    const scheduled = new Date(schedule.scheduled_time).getTime();
    const administered = new Date(schedule.administered_at).getTime();
    return administered > scheduled + LATE_THRESHOLD_MINUTES * 60 * 1000;
  };

  const handleCheckboxClick = (schedule: MARSchedule) => {
    if (schedule.status === 'given') return;
    if (schedule.is_prn) {
      setPrnModal({ scheduleId: schedule.schedule_id, medicationName: schedule.medication_name });
      setPrnReason('');
    } else if (isHighRisk(schedule.medication_name)) {
      setHighRiskModal({ scheduleId: schedule.schedule_id, medicationName: schedule.medication_name });
    } else {
      handleAdminister(schedule.schedule_id);
    }
  };

  const handleHighRiskConfirm = () => {
    if (!highRiskModal) return;
    administerMutation.mutate({ _id: highRiskModal.scheduleId, status: 'given' });
    setHighRiskModal(null);
    setShowBarcodeScanner(false);
    setScannedBarcode(null);
  };

  const handleBarcodeScan = (value: string) => {
    setScannedBarcode(value);
    setShowBarcodeScanner(false);
  };

  const grouped = useMemo(() => schedules.reduce<Record<string, MARSchedule[]>>((acc, s) => {
    const hour = s.scheduled_time ? new Date(s.scheduled_time).getHours() : 0;
    const slot = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    (acc[slot] ??= []).push(s);
    return acc;
  }, {}), [schedules]);

  const slotLabels: Record<string, string> = {
    morning: t('mar.slots.morning', { defaultValue: 'Morning (6AM-12PM)' }),
    afternoon: t('mar.slots.afternoon', { defaultValue: 'Afternoon (12PM-5PM)' }),
    evening: t('mar.slots.evening', { defaultValue: 'Evening (5PM-12AM)' }),
  };

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'given':
        return 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800';
      case 'late':
        return 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800';
      case 'withheld':
        return 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800';
      case 'refused':
        return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800';
      case 'hold':
        return 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800';
      case 'not_available':
      case 'cancelled':
        return 'bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-800';
      default:
        return 'bg-[var(--color-bg)] border-[var(--color-border)]';
    }
  };

  const getCheckboxStyles = (status: string) => {
    switch (status) {
      case 'given':
        return 'bg-emerald-500 text-white';
      case 'late':
        return 'bg-amber-500 text-white';
      case 'withheld':
        return 'bg-amber-500 text-white';
      case 'refused':
        return 'bg-red-500 text-white';
      case 'hold':
        return 'bg-blue-500 text-white';
      case 'not_available':
      case 'cancelled':
        return 'bg-slate-400 text-white';
      default:
        return 'border-2 border-[var(--color-border)] hover:border-emerald-400 hover:bg-emerald-50 active:scale-90';
    }
  };

  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'given':
      case 'late':
        return <Check className="w-5 h-5" />;
      case 'withheld':
        return <AlertTriangle className="w-5 h-5" />;
      case 'refused':
        return <XCircle className="w-5 h-5" />;
      case 'hold':
        return <PauseCircle className="w-5 h-5" />;
      case 'not_available':
        return <PackageX className="w-5 h-5" />;
      case 'cancelled':
        return <Ban className="w-5 h-5" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4" data-testid="mar-tab">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        {t('drawer.mar.title', { defaultValue: 'Medication Administration' })}
        <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
          {today}
        </span>
      </h3>

      {(bed.allergy_count ?? 0) > 0 && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2" data-testid="mar-allergy-warning">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <span className="text-sm font-medium text-red-700 dark:text-red-300">
            {t('mar.allergyWarning', { count: bed.allergy_count, defaultValue: `Patient has ${bed.allergy_count} allergy(ies)` })}
          </span>
        </div>
      )}

      {schedules.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] text-center py-8" data-testid="mar-empty">
          {t('drawer.mar.noScheduled', { defaultValue: 'No medications scheduled for today' })}
        </p>
      ) : (
        Object.entries(grouped).map(([slot, items]) => (
          <div key={slot} data-testid={`mar-slot-${slot}`}>
            <h4 className="text-xs font-medium text-[var(--color-text-muted)] mb-2">
              {slotLabels[slot] ?? slot}
            </h4>
            <div className="space-y-2">
              {items.map(s => {
                const isGiven = s.status === 'given';
                const isLateStatus = s.status === 'late' || isLate(s);
                const isWithheld = s.status === 'withheld';
                const isRefused = s.status === 'refused';
                const isHold = s.status === 'hold';
                const isNotAvailable = s.status === 'not_available';
                const isCancelled = s.status === 'cancelled';
                const isResolved = isGiven || isLateStatus || isWithheld || isRefused || isHold || isNotAvailable || isCancelled;
                const time = s.scheduled_time
                  ? new Date(s.scheduled_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                  : '';

                return (
                  <div
                    key={s.schedule_id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${getStatusStyles(isLateStatus && s.status !== 'late' ? 'late' : s.status)}`}
                    data-testid={`mar-item-${s.schedule_id}`}
                  >
                    <button
                      onClick={() => handleCheckboxClick(s)}
                      disabled={isResolved || administerMutation.isPending}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all flex-shrink-0 ${getCheckboxStyles(isLateStatus && s.status !== 'late' ? 'late' : s.status)}`}
                      data-testid={`mar-checkbox-${s.schedule_id}`}
                      aria-label={isGiven ? 'Given' : isLateStatus ? 'Late' : isWithheld ? 'Withheld' : isRefused ? 'Refused' : isHold ? 'Hold' : isNotAvailable ? 'Not Available' : isCancelled ? 'Cancelled' : 'Mark as given'}
                    >
                      {renderStatusIcon(isLateStatus && s.status !== 'late' ? 'late' : s.status)}
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${(isResolved || isCancelled) ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
                        {s.medication_name}
                        {s.generic_name && <span className="text-xs text-[var(--color-text-muted)] ml-1">({s.generic_name})</span>}
                        {s.is_prn && (
                          <span
                            className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                            data-testid={`mar-prn-badge-${s.schedule_id}`}
                          >
                            PRN
                          </span>
                        )}
                        {isLateStatus && (
                          <span
                            className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            data-testid={`mar-late-badge-${s.schedule_id}`}
                          >
                            LATE
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {s.dose} · {s.route} · {s.frequency}
                      </p>
                      {(isGiven || isLateStatus) && s.administered_at && (
                        <p className="text-xs text-emerald-600 mt-0.5">
                          ✓ {t('mar.givenAt', { defaultValue: 'Given at' })} {new Date(s.administered_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                      {(isWithheld || isRefused || isHold || isNotAvailable) && s.reason_not_given && (
                        <p className={`text-xs mt-0.5 ${isWithheld || isLateStatus ? 'text-amber-600' : isHold ? 'text-blue-600' : isRefused ? 'text-red-600' : 'text-slate-500'}`}>
                          {s.reason_not_given}
                        </p>
                      )}
                      {isCancelled && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {t('mar.orderCancelled', { defaultValue: 'Order cancelled by doctor' })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {time}
                      </span>
                      {!isResolved && !isCancelled && (
                        <div className="relative">
                          <button
                            onClick={() => setOpenMenuId(openMenuId === s.schedule_id ? null : s.schedule_id)}
                            className="p-1 rounded hover:bg-[var(--color-border-light)] transition-colors"
                            data-testid={`mar-menu-btn-${s.schedule_id}`}
                            aria-label="More actions"
                          >
                            <MoreVertical className="w-4 h-4 text-[var(--color-text-muted)]" />
                          </button>
                          {openMenuId === s.schedule_id && (
                            <div className="absolute right-0 top-8 z-10 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-[var(--color-border)] py-1 min-w-[140px]">
                              <button
                                onClick={() => {
                                  setMissedModal({ scheduleId: s.schedule_id, status: 'withheld', medicationName: s.medication_name });
                                  setMissedReason('');
                                  setOpenMenuId(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-700 dark:text-amber-400 flex items-center gap-2"
                                data-testid={`mar-menu-withhold-${s.schedule_id}`}
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {t('mar.withhold', { defaultValue: 'Withhold' })}
                              </button>
                              <button
                                onClick={() => {
                                  setMissedModal({ scheduleId: s.schedule_id, status: 'refused', medicationName: s.medication_name });
                                  setMissedReason('');
                                  setOpenMenuId(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-700 dark:text-red-400 flex items-center gap-2"
                                data-testid={`mar-menu-refused-${s.schedule_id}`}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                {t('mar.refused', { defaultValue: 'Refused' })}
                              </button>
                              <button
                                onClick={() => {
                                  setHoldModal({ scheduleId: s.schedule_id, medicationName: s.medication_name });
                                  setHoldReason('');
                                  setOpenMenuId(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-700 dark:text-blue-400 flex items-center gap-2"
                                data-testid={`mar-menu-hold-${s.schedule_id}`}
                              >
                                <PauseCircle className="w-3.5 h-3.5" />
                                {t('mar.hold', { defaultValue: 'Hold' })}
                              </button>
                              <button
                                onClick={() => {
                                  setNotAvailableModal({ scheduleId: s.schedule_id, medicationName: s.medication_name });
                                  setOpenMenuId(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-900/20 text-slate-700 dark:text-slate-400 flex items-center gap-2"
                                data-testid={`mar-menu-not-available-${s.schedule_id}`}
                              >
                                <PackageX className="w-3.5 h-3.5" />
                                {t('mar.notAvailable', { defaultValue: 'Not Available' })}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* ── PRN Reason Modal ── */}
      {prnModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm" data-testid="prn-reason-modal">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg w-full max-w-sm">
            <div className="p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold text-[var(--color-text)]">
                {t('mar.prnReasonTitle', { defaultValue: 'PRN Administration' })}
              </h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {prnModal.medicationName}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                  {t('mar.prnReasonLabel', { defaultValue: 'Reason for administration *' })}
                </label>
                <select
                  value={prnReason}
                  onChange={e => setPrnReason(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
                  data-testid="prn-reason-select"
                >
                  <option value="">{t('mar.selectReason', { defaultValue: 'Select reason...' })}</option>
                  {PRN_REASON_KEYS.map(r => (
                    <option key={r.value} value={r.value}>{t(`mar.prnReasons.${r.key}`, { defaultValue: r.value })}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setPrnModal(null); setPrnReason(''); }}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors"
                  data-testid="prn-cancel-btn"
                >
                  {t('mar.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={handlePRNGive}
                  disabled={!prnReason}
                  className="px-4 py-2 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  data-testid="prn-confirm-btn"
                >
                  {t('mar.confirmGive', { defaultValue: 'Confirm' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Missed Dose Modal ── */}
      {missedModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm" data-testid="missed-dose-modal">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg w-full max-w-sm">
            <div className="p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold text-[var(--color-text)]">
                {missedModal.status === 'withheld'
                  ? t('mar.withholdTitle', { defaultValue: 'Withhold Medication' })
                  : t('mar.refusedTitle', { defaultValue: 'Medication Refused' })}
              </h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {missedModal.medicationName}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                  {t('mar.missedReasonLabel', { defaultValue: 'Reason *' })}
                </label>
                <select
                  value={missedReason}
                  onChange={e => setMissedReason(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
                  data-testid="missed-dose-select"
                >
                  <option value="">{t('mar.selectReason', { defaultValue: 'Select reason...' })}</option>
                  {MISSED_DOSE_REASON_KEYS.map(r => (
                    <option key={r.value} value={r.value}>{t(`mar.missedReasons.${r.key}`, { defaultValue: r.value })}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setMissedModal(null); setMissedReason(''); }}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors"
                  data-testid="missed-dose-cancel-btn"
                >
                  {t('mar.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={handleMissedConfirm}
                  disabled={!missedReason}
                  className={`px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                    missedModal.status === 'withheld'
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : 'bg-red-500 hover:bg-red-600'
                  }`}
                  data-testid="missed-dose-confirm-btn"
                >
                  {t('mar.confirm', { defaultValue: 'Confirm' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Hold Medication Modal ── */}
      {holdModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm" data-testid="hold-modal">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg w-full max-w-sm">
            <div className="p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold text-blue-600 flex items-center gap-2">
                <PauseCircle className="w-5 h-5" />
                {t('mar.holdTitle', { defaultValue: 'Hold Medication' })}
              </h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {holdModal.medicationName}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                  {t('mar.holdReasonLabel', { defaultValue: 'Reason for hold *' })}
                </label>
                <select
                  value={holdReason}
                  onChange={e => setHoldReason(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
                  data-testid="hold-reason-select"
                >
                  <option value="">{t('mar.selectReason', { defaultValue: 'Select reason...' })}</option>
                  {HOLD_REASON_KEYS.map(r => (
                    <option key={r.value} value={r.value}>{t(`mar.holdReasons.${r.key}`, { defaultValue: r.value })}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setHoldModal(null); setHoldReason(''); }}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors"
                  data-testid="hold-cancel-btn"
                >
                  {t('mar.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={handleHoldConfirm}
                  disabled={!holdReason}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  data-testid="hold-confirm-btn"
                >
                  {t('mar.confirmHold', { defaultValue: 'Confirm Hold' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Not Available Modal ── */}
      {notAvailableModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm" data-testid="not-available-modal">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg w-full max-w-sm">
            <div className="p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold text-slate-600 flex items-center gap-2">
                <PackageX className="w-5 h-5" />
                {t('mar.notAvailableTitle', { defaultValue: 'Medication Not Available' })}
              </h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {notAvailableModal.medicationName}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t('mar.notAvailableMessage', { defaultValue: 'This medication is not available in stock. Pharmacy will be notified.' })}
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setNotAvailableModal(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors"
                  data-testid="not-available-cancel-btn"
                >
                  {t('mar.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={handleNotAvailableConfirm}
                  className="px-4 py-2 text-sm rounded-lg bg-slate-500 text-white hover:bg-slate-600 transition-colors"
                  data-testid="not-available-confirm-btn"
                >
                  {t('mar.confirmNotAvailable', { defaultValue: 'Confirm' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── High-Risk Medication Modal ── */}
      {highRiskModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm" data-testid="high-risk-modal">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg w-full max-w-sm">
            <div className="p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold text-red-600 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                {t('mar.highRiskTitle', { defaultValue: 'High-Risk Medication' })}
              </h3>
              <p className="text-sm font-medium text-[var(--color-text)] mt-1">
                {highRiskModal.medicationName}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t('mar.highRiskMessage', { defaultValue: 'Second nurse verification required. I confirm a second nurse has verified this medication.' })}
              </p>

              {/* Barcode verification section */}
              <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-3">
                <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  {t('barcode.scanPatient', { defaultValue: 'Scan Patient Wristband' })}
                </p>

                {patientVerification.isVerified && (
                  <div className="flex items-center gap-2 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg" data-testid="barcode-verified">
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      {t('barcode.patientVerified', { defaultValue: 'Patient verified' })}
                    </span>
                  </div>
                )}

                {patientVerification.isMismatch && (
                  <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg" data-testid="barcode-mismatch">
                    <ShieldAlert className="w-5 h-5 text-red-600" />
                    <span className="text-sm font-medium text-red-700 dark:text-red-300">
                      {t('barcode.patientMismatch', { expected: patientVerification.matchedPatient?.name, defaultValue: `Patient mismatch! Expected ${patientVerification.matchedPatient?.name}` })}
                    </span>
                  </div>
                )}

                {showBarcodeScanner ? (
                  <BarcodeScanner
                    onScan={handleBarcodeScan}
                    onError={(err) => toast.error(err)}
                  />
                ) : (
                  <button
                    onClick={() => { setShowBarcodeScanner(true); setScannedBarcode(null); }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors text-sm w-full justify-center"
                    data-testid="barcode-scan-btn"
                  >
                    <ScanBarcode className="w-4 h-4" />
                    {scannedBarcode ? t('barcode.startScan', { defaultValue: 'Rescan' }) : t('barcode.startScan', { defaultValue: 'Start Scan' })}
                  </button>
                )}

                {scannedBarcode && !patientVerification.isVerified && !patientVerification.isMismatch && patientVerification.isLoading && (
                  <p className="text-xs text-[var(--color-text-muted)]">{t('barcode.scanning', { defaultValue: 'Scanning...' })}</p>
                )}
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setHighRiskModal(null); setShowBarcodeScanner(false); setScannedBarcode(null); }}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors"
                  data-testid="high-risk-cancel-btn"
                >
                  {t('mar.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={handleHighRiskConfirm}
                  disabled={!patientVerification.isVerified}
                  className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  data-testid="high-risk-confirm-btn"
                >
                  {t('mar.confirmGiven', { defaultValue: 'Confirm Given' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
