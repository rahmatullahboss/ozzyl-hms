import { useTranslation } from 'react-i18next';

export interface ConsultNoteData {
  consultantName: string;
  reasonForConsult: string;
  chiefComplaint: string;
  hpi: string;
  ros: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

interface Props {
  data: ConsultNoteData;
  onChange: (field: keyof ConsultNoteData, value: string) => void;
  disabled?: boolean;
}

export default function ConsultNote({ data, onChange, disabled }: Props) {
  const { t } = useTranslation(['clinical']);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">{t('notes.fields.consultantName', 'Consultant Name')}</label>
          <input
            type="text"
            className="input"
            value={data.consultantName}
            onChange={e => onChange('consultantName', e.target.value)}
            placeholder={t('notes.placeholders.consultantName', 'Consultant name')}
            disabled={disabled}
          />
        </div>
      </div>
      <div>
        <label className="label">{t('notes.fields.reasonForConsult', 'Reason for Consult')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.reasonForConsult}
          onChange={e => onChange('reasonForConsult', e.target.value)}
          placeholder={t('notes.placeholders.reasonForConsult', 'Reason for consultation...')}
          disabled={disabled}
        />
      </div>
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
          placeholder={t('notes.placeholders.hpi', 'Detailed history...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.ros', 'Review of Systems')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.ros}
          onChange={e => onChange('ros', e.target.value)}
          placeholder={t('notes.placeholders.ros', 'Systematic review...')}
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
    </div>
  );
}
