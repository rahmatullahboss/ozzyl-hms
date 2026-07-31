import { useCallback } from 'react';

type ValueType = 'numeric' | 'string' | 'memo' | 'coded' | 'ratio';

interface ResultInputProps {
  valueType?: ValueType | null;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testName?: string;
  className?: string;
}

const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const POSITIVE_NEGATIVE_OPTIONS = ['Positive', 'Negative'];

function getCodedOptions(testName?: string): string[] | null {
  if (!testName) return null;
  const lower = testName.toLowerCase();
  if (lower.includes('blood group') || lower.includes('blood type') || lower.includes('abo')) {
    return BLOOD_GROUP_OPTIONS;
  }
  if (
    lower.includes('hbsag') ||
    lower.includes('hcv') ||
    lower.includes('hiv') ||
    lower.includes('vdrl') ||
    lower.includes('rpr') ||
    lower.includes('serology') ||
    lower.includes('dengue') ||
    lower.includes('malaria') ||
    lower.includes('widal') ||
    lower.includes('typhoid')
  ) {
    return POSITIVE_NEGATIVE_OPTIONS;
  }
  return null;
}

export default function ResultInput({
  valueType,
  value,
  onChange,
  placeholder,
  disabled,
  testName,
  className = 'w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-cyan-500',
}: ResultInputProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  if (valueType === 'numeric' || valueType === 'ratio') {
    return (
      <input
        type="number"
        step="any"
        value={value}
        onChange={handleChange}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  }

  if (valueType === 'memo') {
    return (
      <textarea
        value={value}
        onChange={handleChange}
        rows={4}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  }

  if (valueType === 'coded') {
    const options = getCodedOptions(testName);
    if (options) {
      return (
        <select
          value={value}
          onChange={handleChange}
          className={className}
          disabled={disabled}
        >
          <option value="">Select...</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={handleChange}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}
