import { useTranslation } from 'react-i18next';

export interface ProgressNoteData {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  followUp: string;
}

interface Props {
  data: ProgressNoteData;
  onChange: (field: keyof ProgressNoteData, value: string) => void;
  disabled?: boolean;
}

export default function ProgressNote({ data, onChange, disabled }: Props) {
  const { t } = useTranslation(['clinical']);

  return (
    <div className="space-y-4">
      <div>
        <label className="label">{t('notes.fields.subjective', 'Subjective')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.subjective}
          onChange={e => onChange('subjective', e.target.value)}
          placeholder={t('notes.placeholders.subjective', 'Patient reported symptoms...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.objective', 'Objective')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.objective}
          onChange={e => onChange('objective', e.target.value)}
          placeholder={t('notes.placeholders.objective', 'Physical examination findings...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.assessment', 'Assessment')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.assessment}
          onChange={e => onChange('assessment', e.target.value)}
          placeholder={t('notes.placeholders.assessment', 'Clinical impression...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.plan', 'Plan')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.plan}
          onChange={e => onChange('plan', e.target.value)}
          placeholder={t('notes.placeholders.plan', 'Treatment plan...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.followUp', 'Follow-up')}</label>
        <input
          type="text"
          className="input"
          value={data.followUp}
          onChange={e => onChange('followUp', e.target.value)}
          placeholder={t('notes.placeholders.followUp', 'e.g. 2 weeks')}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
