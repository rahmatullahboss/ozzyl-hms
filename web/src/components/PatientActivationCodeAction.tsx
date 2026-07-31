import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/apiClient';

interface ActivationCodeResponse {
  patient_id: number;
  uhid: string | null;
  claim_code: string;
  claim_code_expires_at: string;
}

interface PatientActivationCodeActionProps {
  patientId: number;
  uhid?: string | null;
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function PatientActivationCodeAction({
  patientId,
  uhid,
}: PatientActivationCodeActionProps) {
  const { t } = useTranslation(['patients', 'common']);
  const [issuedCode, setIssuedCode] = useState<ActivationCodeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const claimUhid = issuedCode?.uhid ?? uhid ?? '';
  const claimPath = claimUhid ? `/patient/claim-card?uhid=${encodeURIComponent(claimUhid)}` : '/patient/claim-card';

  async function issueCode() {
    setLoading(true);
    try {
      const response = await api.post<ActivationCodeResponse>(
        `/api/health-record/patients/${patientId}/activation-code`,
        {},
      );
      setIssuedCode(response);
      toast.success(t('activationCodeIssued', { defaultValue: 'Claim code issued' }));
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('activationCodeIssueFailed', { defaultValue: 'Failed to issue claim code' });
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={issueCode}
        disabled={loading}
        className="btn-ghost"
        title={t('issueClaimCode', { defaultValue: 'Issue claim code' })}
      >
        <KeyRound className="w-4 h-4" />
        <span className="hidden sm:inline">
          {loading
            ? t('issuingClaimCode', { defaultValue: 'Issuing...' })
            : issuedCode
              ? t('reissueClaimCode', { defaultValue: 'Reissue claim code' })
              : t('issueClaimCode', { defaultValue: 'Issue claim code' })}
        </span>
      </button>

      {issuedCode && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t('patientCardClaimCode', { defaultValue: 'Patient card claim code' })}
          </p>
          <p className="mt-2 font-mono text-2xl font-bold text-[var(--color-text)]">{issuedCode.claim_code}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {t('claimCodeExpires', { expiry: formatExpiry(issuedCode.claim_code_expires_at), defaultValue: 'Expires {{expiry}}' })}
          </p>
          <div className="mt-3 rounded-md bg-[var(--color-border-light)] p-2">
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('patientClaimScreen', { defaultValue: 'Patient claim screen' })}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-[var(--color-text)]">{claimPath}</p>
          </div>
        </div>
      )}
    </div>
  );
}
