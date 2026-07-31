import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DoctorCombobox, { type DoctorOption } from '../DoctorCombobox';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import type { Doctor } from '../doctor/types';
import { queryKeys } from '../../lib/queryKeys';

export type DoctorRoundSource = 'nurse_station' | 'ipd_billing';

type DoctorRoundFormProps = {
  patientId: number;
  patientName: string;
  admissionId: number;
  admissionNo: string;
  entrySource: DoctorRoundSource;
  onSuccess?: () => void;
  onCancel?: () => void;
};

type CreateDoctorRoundPayload = {
  admissionId: number;
  patientId: number;
  doctorId: number;
  roundDate: string;
  roundTime: string;
  entrySource: DoctorRoundSource;
  idempotencyKey: string;
};

function newIdempotencyKey() {
  return crypto.randomUUID();
}

export function getDhakaRoundDefaults(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    roundDate: `${value('year')}-${value('month')}-${value('day')}`,
    roundTime: `${value('hour')}:${value('minute')}`,
  };
}

export default function DoctorRoundForm({
  patientId,
  patientName,
  admissionId,
  admissionNo,
  entrySource,
  onSuccess,
  onCancel,
}: DoctorRoundFormProps) {
  const { t } = useTranslation(['nursing', 'billing']);
  const queryClient = useQueryClient();
  const defaults = useMemo(() => getDhakaRoundDefaults(), []);
  const [doctor, setDoctor] = useState<DoctorOption | null>(null);
  const [roundDate, setRoundDate] = useState(defaults.roundDate);
  const [roundTime, setRoundTime] = useState(defaults.roundTime);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [submitError, setSubmitError] = useState('');

  const doctorsQuery = useApiQuery<{ doctors: Doctor[] }>(
    ['doctors', 'ipd-round-fees'],
    '/api/doctors?is_active=active&limit=200',
  );
  const selectedDoctor = doctorsQuery.data?.doctors.find((item) => item.id === doctor?.id);
  const fee = Number(selectedDoctor?.ipd_round_fee ?? selectedDoctor?.ipdRoundFee ?? 0);

  const mutation = useApiMutation<unknown, CreateDoctorRoundPayload>(
    'post',
    '/api/ipd-doctor-rounds',
    {
      onSuccess: () => {
        setIdempotencyKey(newIdempotencyKey());
        setSubmitError('');
        queryClient.invalidateQueries({ queryKey: queryKeys.ipdDoctorRounds.list(admissionId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.pending(admissionId) });
        queryClient.invalidateQueries({ queryKey: ['ip-billing'] });
        onSuccess?.();
      },
      onError: (error) => setSubmitError(error.message || t('doctorRound.saveFailed')),
    },
  );

  const canSubmit = Boolean(doctor && fee > 0 && roundDate && roundTime && !mutation.isPending);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!doctor || !canSubmit) return;
        mutation.mutate({
          admissionId,
          patientId,
          doctorId: doctor.id,
          roundDate,
          roundTime,
          entrySource,
          idempotencyKey,
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-xs">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('doctorRound.patient')}</span>
          <span className="block truncate font-medium text-[var(--color-text)]">{patientName}</span>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-xs">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('doctorRound.admission')}</span>
          <span className="block truncate font-medium text-[var(--color-text)]">{admissionNo}</span>
        </div>
      </div>

      <div>
        <label className="label">{t('doctorRound.doctor')}</label>
        <DoctorCombobox
          value={doctor}
          onChange={(value) => {
            setDoctor(value);
            setSubmitError('');
          }}
          placeholder={t('doctorRound.searchDoctor')}
          disabled={doctorsQuery.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="doctor-round-date">{t('doctorRound.date')}</label>
          <input id="doctor-round-date" className="input" type="date" value={roundDate} onChange={(event) => setRoundDate(event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="doctor-round-time">{t('doctorRound.time')}</label>
          <input id="doctor-round-time" className="input" type="time" value={roundTime} onChange={(event) => setRoundTime(event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="doctor-round-fee">{t('doctorRound.fee')}</label>
          <input id="doctor-round-fee" className="input" type="number" value={fee} readOnly />
        </div>
      </div>

      {doctor && fee <= 0 && <p className="text-sm text-red-600">{t('doctorRound.feeNotConfigured')}</p>}
      {submitError && <p className="text-sm text-red-600">{submitError}</p>}

      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>{t('doctorRound.cancel')}</button>}
        <button type="submit" className="btn-primary" disabled={!canSubmit}>
          {mutation.isPending ? t('doctorRound.saving') : t('doctorRound.save')}
        </button>
      </div>
    </form>
  );
}
