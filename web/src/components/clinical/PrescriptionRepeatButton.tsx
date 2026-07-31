import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/apiClient';

interface RepeatedPrescription {
  patient_id: number;
  chief_complaint?: string;
  diagnosis?: string;
  examination_notes?: string;
  advice?: string;
  lab_tests?: string[];
  follow_up_date?: string;
  items?: {
    medicine_name: string;
    dosage: string;
    frequency: string;
    duration: string;
    instructions: string;
  }[];
}

interface RepeatResponse {
  prescription: RepeatedPrescription;
}

export default function PrescriptionRepeatButton({
  prescriptionId,
  patientId,
}: {
  prescriptionId: number;
  patientId: number;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleRepeat = async () => {
    setLoading(true);
    try {
      const data = await api.get<RepeatResponse>(`/api/prescriptions/${prescriptionId}/repeat`);
      navigate(`/h/${slug}/prescriptions/new?patient=${patientId}`, {
        state: { repeatData: data.prescription },
      });
    } catch {
      toast.error(t('rxToast.repeatFailed', { ns: 'patients', defaultValue: 'Failed to load prescription for repeat' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleRepeat}
      disabled={loading}
      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline"
      title={t('medications.repeat', { defaultValue: 'Repeat Prescription' })}
    >
      <Copy className="w-3.5 h-3.5" />
      {loading
        ? t('common.loading', { defaultValue: 'Loading...' })
        : t('actions.repeatRx', { ns: 'patients', defaultValue: 'Repeat Rx' })}
    </button>
  );
}
