import { ShieldAlert } from 'lucide-react';

export interface ClinicalSafetyFinding {
  type: string;
  severity: string;
  blocking: boolean;
  title: string;
  description: string;
  recommendation?: string;
}

export interface RxValidationWarning {
  field: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export function safetyUiLevel(finding: ClinicalSafetyFinding): 'error' | 'warning' | 'info' {
  if (finding.blocking || finding.severity === 'contraindicated') return 'error';
  if (finding.severity === 'critical' || finding.severity === 'warning' || finding.severity === 'major') return 'warning';
  return 'info';
}

function formWarningClass(severity: RxValidationWarning['severity']): string {
  if (severity === 'error') return 'text-red-700';
  if (severity === 'warning') return 'text-amber-700';
  return 'text-blue-700';
}

function formWarningDotClass(severity: RxValidationWarning['severity']): string {
  if (severity === 'error') return 'bg-red-500';
  if (severity === 'warning') return 'bg-amber-500';
  return 'bg-blue-500';
}

function clinicalFindingClass(finding: ClinicalSafetyFinding): string {
  const level = safetyUiLevel(finding);
  if (level === 'error') return 'text-red-700';
  if (level === 'warning') return 'text-amber-800';
  return 'text-blue-700';
}

function clinicalFindingDotClass(finding: ClinicalSafetyFinding): string {
  const level = safetyUiLevel(finding);
  if (level === 'error') return 'bg-red-600';
  if (level === 'warning') return 'bg-amber-500';
  return 'bg-blue-500';
}

export function DoctorPrescriptionSafetyPanel({
  rxWarnings,
  clinicalFindings,
  checking,
  title = 'Safety Check',
}: {
  rxWarnings: RxValidationWarning[];
  clinicalFindings: ClinicalSafetyFinding[];
  checking?: boolean;
  title?: string;
}) {
  if (rxWarnings.length === 0 && clinicalFindings.length === 0 && !checking) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
        <ShieldAlert className="w-3.5 h-3.5" />
        {title}
        {checking && <span className="font-normal text-amber-700">· checking…</span>}
      </div>

      {rxWarnings.map((warning, index) => (
        <div key={`form-${warning.field}-${index}`} className={`text-[11px] flex items-start gap-1.5 ${formWarningClass(warning.severity)}`}>
          <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${formWarningDotClass(warning.severity)}`} />
          <span>{warning.message}</span>
        </div>
      ))}

      {clinicalFindings.map((finding, index) => (
        <div key={`clinical-${finding.type}-${index}`} className={`text-[11px] flex items-start gap-1.5 ${clinicalFindingClass(finding)}`}>
          <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${clinicalFindingDotClass(finding)}`} />
          <span>
            <span className="font-semibold">{finding.title}</span>
            {finding.description ? ` — ${finding.description}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
