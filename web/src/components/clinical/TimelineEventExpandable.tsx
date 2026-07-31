import { ChevronDown, ChevronUp, Loader2, AlertTriangle } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

export interface TimelineEvent {
  id: number;
  type: 'visit' | 'prescription' | 'lab' | 'admission' | 'discharge' | 'appointment' | 'document' | 'referral' | 'consultation' | 'radiology_order' | 'radiology_report' | 'soap';
  title: string;
  description: string;
  date: string;
  doctor?: string;
  status?: string;
  details?: Record<string, string>;
  encounter_id?: number;
}

interface TimelineEventExpandableProps {
  event: TimelineEvent;
  isExpanded: boolean;
  onToggle: () => void;
}

interface EncounterSummary {
  encounter?: {
    chief_complaint?: string;
    vitals?: Record<string, number>;
    diagnosis?: string;
    follow_up?: string;
    doctor_name?: string;
    notes?: string;
  };
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d: string): string {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function InlineDetails({ details }: { details: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {Object.entries(details).map(([k, v]) => (
        <span key={k} className="bg-gray-100 text-xs px-2 py-1 rounded-md text-[var(--color-text-muted)]">
          <strong>{k}:</strong> {v}
        </span>
      ))}
    </div>
  );
}

function VisitDetail({ encounterId }: { encounterId: number }) {
  const { data, isLoading, isError } = useApiQuery<EncounterSummary>(
    queryKeys.clinical.encounterSummary(encounterId),
    `/api/clinical/encounters/${encounterId}/summary`,
    { enabled: !!encounterId }
  );

  if (isLoading) {
    return (
      <div data-testid="detail-loading" className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-3">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading encounter details...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600 py-3">
        <AlertTriangle className="w-4 h-4" />
        Failed to load encounter details
      </div>
    );
  }

  const enc = data?.encounter;
  if (!enc) {
    return <p className="text-sm text-[var(--color-text-muted)] py-3">No encounter details available</p>;
  }

  return (
    <div className="space-y-3 text-sm">
      {enc.chief_complaint && (
        <div>
          <span className="font-medium text-[var(--color-text-muted)]">Chief Complaint: </span>
          <span className="text-[var(--color-text)]">{enc.chief_complaint}</span>
        </div>
      )}
      {enc.vitals && (
        <div>
          <span className="font-medium text-[var(--color-text-muted)]">Vitals: </span>
          <span className="text-[var(--color-text)]">
            {Object.entries(enc.vitals)
              .filter(([, v]) => v != null)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' | ')}
          </span>
        </div>
      )}
      {enc.diagnosis && (
        <div>
          <span className="font-medium text-[var(--color-text-muted)]">Diagnosis: </span>
          <span className="text-[var(--color-text)]">{enc.diagnosis}</span>
        </div>
      )}
      {enc.follow_up && (
        <div>
          <span className="font-medium text-[var(--color-text-muted)]">Follow-up: </span>
          <span className="text-[var(--color-text)]">{enc.follow_up}</span>
        </div>
      )}
    </div>
  );
}

export default function TimelineEventExpandable({ event, isExpanded, onToggle }: TimelineEventExpandableProps) {
  const showVisitDetail = isExpanded && event.type === 'visit' && event.encounter_id;
  const showInlineDetail = isExpanded && event.details && Object.keys(event.details).length > 0;
  const hasExpandableContent = event.type === 'visit' ? !!event.encounter_id : !!event.details;

  return (
    <div>
      <div
        data-testid="timeline-event-card"
        className="card p-4 hover:shadow-md transition-shadow cursor-pointer"
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div>
              <p className="font-semibold text-sm text-[var(--color-text)]">{event.title}</p>
              {event.doctor && <p className="text-xs text-[var(--color-text-muted)]">{event.doctor}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right">
              <p className="text-xs text-[var(--color-text-muted)]">{fmtDate(event.date)}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{fmtTime(event.date)}</p>
            </div>
            {hasExpandableContent && (
              isExpanded ? (
                <ChevronUp data-testid="collapse-icon" className="w-4 h-4 text-[var(--color-text-muted)]" />
              ) : (
                <ChevronDown data-testid="expand-icon" className="w-4 h-4 text-[var(--color-text-muted)]" />
              )
            )}
          </div>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">{event.description}</p>

        {event.status && (
          <div>
            <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${
              event.status === 'completed' || event.status === 'final' ? 'bg-emerald-100 text-emerald-700' :
              event.status === 'active' ? 'bg-blue-100 text-blue-700' :
              event.status === 'upcoming' ? 'bg-amber-100 text-amber-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {event.status}
            </span>
          </div>
        )}
      </div>

      {isExpanded && (
        <div data-testid="timeline-event-detail" className="card border-t-0 rounded-t-none px-4 pb-4 pt-2">
          {showVisitDetail ? (
            <VisitDetail encounterId={event.encounter_id!} />
          ) : showInlineDetail ? (
            <InlineDetails details={event.details!} />
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No additional details</p>
          )}
        </div>
      )}
    </div>
  );
}
