import { useState, useCallback } from 'react';
import { FlaskConical, Pill, Receipt, CheckCircle, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/apiClient';

type ClearanceStep = 'lab' | 'pharmacy' | 'billing' | 'final';
type StepStatus = 'pending' | 'in-progress' | 'cleared' | 'na' | 'error';

interface Step {
  key: ClearanceStep;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const STEPS: Step[] = [
  {
    key: 'lab',
    label: 'Lab Clearance',
    description: 'All lab tests ordered have results',
    icon: <FlaskConical className="w-5 h-5" />,
  },
  {
    key: 'pharmacy',
    label: 'Pharmacy Clearance',
    description: 'All medications prescribed are dispensed',
    icon: <Pill className="w-5 h-5" />,
  },
  {
    key: 'billing',
    label: 'Billing Clearance',
    description: 'Discharge bill is finalized',
    icon: <Receipt className="w-5 h-5" />,
  },
  {
    key: 'final',
    label: 'Final Discharge',
    description: 'All clearances complete, ready for final discharge',
    icon: <CheckCircle className="w-5 h-5" />,
  },
];

interface ClearanceState {
  lab: StepStatus;
  pharmacy: StepStatus;
  billing: StepStatus;
}

interface Props {
  admissionId: number;
}

export default function DischargeClearancePanel({ admissionId }: Props) {
  const [statuses, setStatuses] = useState<ClearanceState>({
    lab: 'pending',
    pharmacy: 'pending',
    billing: 'pending',
  });
  const [checking, setChecking] = useState<ClearanceStep | null>(null);

  const clearedCount = Object.values(statuses).filter(s => s === 'cleared').length;
  const allCleared = clearedCount === 3;

  const checkStep = useCallback(async (step: Exclude<ClearanceStep, 'final'>) => {
    if (!admissionId) return;
    setChecking(step);
    setStatuses(prev => ({ ...prev, [step]: 'in-progress' }));

    try {
      if (step === 'billing') {
        const data = await api.get<{ summary?: { net_payable?: number | null } }>(
          `/api/ip-billing/pending/${admissionId}`,
        );
        const balance = Math.max(0, Number(data?.summary?.net_payable ?? 0));
        setStatuses(prev => ({
          ...prev,
          [step]: balance <= 0 ? 'cleared' : 'pending',
        }));
        if (balance > 0) {
          toast.error(`Billing not settled — BDT ${balance.toLocaleString()} pending`);
        }
      } else {
        const data = await api.get<{ summary?: { pending_reports?: string | null; medicines_on_discharge?: unknown[] | null } | null }>(
          `/api/discharge/${admissionId}`,
        );
        const summary = data?.summary;
        if (step === 'lab') {
          const hasPendingReports = Boolean(summary?.pending_reports?.trim());
          setStatuses(prev => ({ ...prev, [step]: hasPendingReports ? 'pending' : 'cleared' }));
          if (hasPendingReports) toast.error('Pending investigation reports remain');
        } else {
          const meds = summary?.medicines_on_discharge ?? [];
          setStatuses(prev => ({ ...prev, [step]: 'cleared' }));
          if (meds.length === 0) toast.success('No discharge medicines recorded — marked as not required');
        }
      }
    } catch {
      setStatuses(prev => ({ ...prev, [step]: 'error' }));
      toast.error(`Could not reach ${step} API — toggle manually`);
    } finally {
      setChecking(null);
    }
  }, [admissionId]);

  const manualToggle = (step: Exclude<ClearanceStep, 'final'>) => {
    setStatuses(prev => ({
      ...prev,
      [step]: prev[step] === 'cleared' ? 'pending' : 'cleared',
    }));
  };

  const isPending = (s: StepStatus) => s === 'pending' || s === 'error';
  const isCleared = (s: StepStatus) => s === 'cleared';

  return (
    <div className="card p-5 space-y-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-[var(--color-primary)]" />
        Discharge Clearance Checklist
      </h2>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[var(--color-text-muted)]">
            {clearedCount} of 3 clearances complete
          </span>
          <span className="text-xs font-semibold text-[var(--color-text)]">
            {allCleared ? 'Ready for Discharge' : 'In Progress'}
          </span>
        </div>
        <div className="w-full h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${(clearedCount / 3) * 100}%`,
              backgroundColor: allCleared ? 'var(--color-primary)' : '#f59e0b',
            }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-0">
        {STEPS.map((step, idx) => {
          const isFinal = step.key === 'final';
          const status: StepStatus = isFinal
            ? allCleared
              ? 'cleared'
              : 'pending'
            : statuses[step.key as keyof ClearanceState];
          const busy = checking === step.key;

          const stepKey = step.key;

          return (
            <div key={step.key}>
              {/* Connector line */}
              {idx > 0 && (
                <div className="ml-5 -my-1 h-5 w-0.5 bg-[var(--color-border)]" />
              )}

              <div className="flex items-start gap-3 py-2">
                {/* Status indicator */}
                <div className="flex-shrink-0 mt-0.5">
                  {busy ? (
                    <div className="w-5 h-5 rounded-full flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary)]" />
                    </div>
                  ) : isCleared(status) ? (
                    <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                  ) : status === 'in-progress' ? (
                    <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                      {step.icon}
                    </div>
                  ) : status === 'error' ? (
                    <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                      <AlertTriangle className="w-3.5 h-3.5 text-white" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className={`text-sm font-medium ${isCleared(status) ? 'text-emerald-700' : 'text-[var(--color-text)]'}`}>
                        {step.label}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {step.description}
                      </p>
                    </div>

                    {isFinal ? (
                      <span className={`text-xs font-medium rounded-full px-2 py-0.5 flex-shrink-0 ${
                        allCleared
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {allCleared ? 'Ready' : `${3 - clearedCount} remaining`}
                      </span>
                    ) : (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {status === 'error' && (
                          <button
                             onClick={() => manualToggle(stepKey as Exclude<ClearanceStep, 'final'>)}
                            className="text-xs text-[var(--color-primary)] hover:underline"
                            aria-label={`Manually toggle ${step.label} clearance status`}
                          >
                            Manual toggle
                          </button>
                        )}
                        <button
                           onClick={() => isCleared(status) ? manualToggle(stepKey as Exclude<ClearanceStep, 'final'>) : checkStep(stepKey as Exclude<ClearanceStep, 'final'>)}
                          disabled={busy}
                          aria-label={isCleared(status) ? `Uncheck ${step.label} clearance` : `Check ${step.label} clearance`}
                          className={`text-xs font-medium rounded-full px-3 py-1 transition-colors ${
                            isCleared(status)
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                              : 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)] border border-[var(--color-primary)]/30 hover:bg-[var(--color-primary)]/15'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {busy ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" /> Checking
                            </span>
                          ) : isCleared(status) ? (
                            <span className="flex items-center gap-1">
                              <RefreshCw className="w-3 h-3" /> Uncheck
                            </span>
                          ) : (
                            'Check'
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Status text */}
                  {!isFinal && (
                    <p className={`text-xs mt-1 ${
                      isCleared(status) ? 'text-emerald-600' :
                      status === 'error' ? 'text-red-500' :
                      status === 'in-progress' ? 'text-amber-600' :
                      'text-[var(--color-text-muted)]'
                    }`}>
                      {busy ? 'Checking...' :
                       isCleared(status) ? 'Cleared' :
                       status === 'error' ? 'API unreachable' :
                       status === 'in-progress' ? 'In progress' :
                       'Pending'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
