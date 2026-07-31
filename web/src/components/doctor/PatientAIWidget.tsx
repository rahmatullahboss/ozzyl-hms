import { useState } from 'react';
import { Brain, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { formatDisplayDate } from '../../lib/date-utils';

interface PatientAIWidgetProps {
  patientId: number;
  tenantHasAi: boolean;
}

export function PatientAIWidget({ patientId, tenantHasAi }: PatientAIWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation(['dashboard', 'common']);
  
  const { data, isLoading, isError } = useApiQuery<{
    summary: string;
    cached: boolean;
    generated_at?: string;
  }>(
    queryKeys.ai.patientSummary(patientId),
    `/api/ai/patient-summary/${patientId}`,
    {
      enabled: isOpen && tenantHasAi,
    }
  );

  if (!tenantHasAi) return null; // Don't show if AI not enabled

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-[var(--color-bg)] transition-colors text-sm"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-600" />
          <span className="font-medium text-[var(--color-text)]">
            {t('aiSummary', { defaultValue: 'AI Clinical Overview' })}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isLoading && isOpen && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-text-muted)]" />
          )}
          {isOpen ? 
            <ChevronUp className="w-4 h-4 text-[var(--color-text-muted)]" /> : 
            <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" />
          }
        </div>
      </button>
      
      {isOpen && (
        <div className="px-3 pb-3 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
          {isLoading && (
            <div className="flex items-center gap-2 py-3 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t('generatingSummary', { defaultValue: 'Generating AI summary...' })}
            </div>
          )}
          
          {isError && (
            <div className="flex items-center gap-2 py-3 text-xs text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              {t('aiError', { defaultValue: 'Failed to load AI summary' })}
            </div>
          )}
          
          {data && (
            <div className="py-3">
              <div className="text-xs text-[var(--color-text)] whitespace-pre-line leading-relaxed">
                {data.summary}
              </div>
              {data.cached && (
                <div className="flex items-center gap-1 mt-2 text-[10px] text-[var(--color-text-muted)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                  {t('cachedSummary', { defaultValue: 'Cached' })}
                  {data.generated_at && (
                    <span>({formatDisplayDate(data.generated_at)})</span>
                  )}
                </div>
              )}
              <div className="mt-2 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                {t('aiSourceCaution', { defaultValue: 'Summary is based on available chart records. Verify source reports before decisions.' })}
              </div>
            </div>
          )}
          
          {!data && !isLoading && !isError && (
            <div className="py-3 text-xs text-[var(--color-text-muted)]">
              {t('clickToView', { defaultValue: 'Click to generate AI summary' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
