import { RefreshCw } from 'lucide-react';

interface PatientDashboardLoadingStateProps {
  description: string;
  title: string;
}

export function PatientDashboardLoadingState({
  description,
  title,
}: PatientDashboardLoadingStateProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="max-w-md w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_12px_40px_rgba(0,96,103,0.06)]">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-600">
          <RefreshCw className="h-6 w-6 animate-spin" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}
