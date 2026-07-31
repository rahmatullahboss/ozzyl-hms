import { useTranslation } from 'react-i18next';

export interface HistoryPhysicalData {
  chiefComplaint: string;
  hpi: string;
  ros: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

interface Props {
  data: HistoryPhysicalData;
  onChange: (field: keyof HistoryPhysicalData, value: string) => void;
  disabled?: boolean;
}

export default function HistoryPhysicalNote({ data, onChange, disabled }: Props) {
  const { t } = useTranslation(['clinical']);

  return (
    <div className="space-y-4">
      <div>
        <label className="label">{t('notes.fields.chiefComplaints', 'Chief Complaints')}</label>
        <input
          type="text"
          className="input"
          value={data.chiefComplaint}
          onChange={e => onChange('chiefComplaint', e.target.value)}
          placeholder={t('notes.placeholders.chiefComplaints', 'Comma-separated complaints')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.hpi', 'History of Presenting Illness')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.hpi}
          onChange={e => onChange('hpi', e.target.value)}
          placeholder={t('notes.placeholders.hpi', 'Detailed history of presenting illness...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.ros', 'Review of Systems')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.ros}
          onChange={e => onChange('ros', e.target.value)}
          placeholder={t('notes.placeholders.ros', 'Systematic review of systems...')}
          disabled={disabled}
        />
      </div>
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
          className="input min-h-[120px]"
          value={data.objective}
          onChange={e => onChange('objective', e.target.value)}
          placeholder={t('notes.placeholders.objectiveHp', 'Physical examination findings including HEENT, Chest, CVS, Abdomen, Extremity, Skin, Neurological...')}
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
    </div>
  );
}
