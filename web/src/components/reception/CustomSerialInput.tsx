import { useTranslation } from 'react-i18next';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function CustomSerialInput({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="label">
        {t('customSerial', { ns: 'queue', defaultValue: 'Custom Serial' })}
      </label>
      <input
        type="number"
        min={1}
        max={99999}
        className="input w-full"
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
        placeholder={t('customSerialPlaceholder', { ns: 'queue', defaultValue: 'Auto' })}
        title={t('customSerialHelp', { ns: 'queue', defaultValue: 'Leave empty to auto-assign' })}
      />
    </div>
  );
}
