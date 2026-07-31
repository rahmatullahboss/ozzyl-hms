import { useMemo, useState } from 'react';
import { CheckCircle2, Search, X } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';

export type CodedDiagnosisSystem = 'ICD-10' | 'ICD-11';

export interface CodedDiagnosisSelection {
  system: CodedDiagnosisSystem;
  code: string;
  description: string;
}

interface QuickCodedDiagnosisProps {
  value: CodedDiagnosisSelection | null;
  onChange: (value: CodedDiagnosisSelection | null) => void;
  disabled?: boolean;
}

interface ICD10Result {
  ICD10ID: number;
  ICD10Code: string;
  DiseaseName: string;
}

interface ICD11Result {
  id: number;
  code: string;
  title: string;
  is_bd_subset?: number;
}

interface DiagnosisSearchResponse {
  Results?: Array<ICD10Result | ICD11Result>;
}

function normalizeResult(system: CodedDiagnosisSystem, row: ICD10Result | ICD11Result): CodedDiagnosisSelection | null {
  if (system === 'ICD-10') {
    const result = row as ICD10Result;
    if (!result.ICD10Code || !result.DiseaseName) return null;
    return {
      system,
      code: String(result.ICD10Code),
      description: String(result.DiseaseName),
    };
  }

  const result = row as ICD11Result;
  if (!result.code || !result.title) return null;
  return {
    system,
    code: String(result.code),
    description: String(result.title),
  };
}

export function QuickCodedDiagnosis({ value, onChange, disabled = false }: QuickCodedDiagnosisProps) {
  const [system, setSystem] = useState<CodedDiagnosisSystem>(value?.system ?? 'ICD-10');
  const [searchTerm, setSearchTerm] = useState('');
  const normalizedSearch = searchTerm.trim();
  const endpoint = system === 'ICD-10'
    ? `/api/clinical/diagnosis/icd10/search?q=${encodeURIComponent(normalizedSearch)}`
    : `/api/clinical/diagnosis/icd11/search?q=${encodeURIComponent(normalizedSearch)}`;
  const searchQuery = useApiQuery<DiagnosisSearchResponse>(
    ['doctor', 'coded-diagnosis', system, normalizedSearch],
    endpoint,
    { enabled: normalizedSearch.length >= 2 && !disabled && !value },
  );
  const results = useMemo(
    () => (searchQuery.data?.Results ?? [])
      .map((row) => normalizeResult(system, row))
      .filter((row): row is CodedDiagnosisSelection => row !== null),
    [searchQuery.data?.Results, system],
  );

  const selectDiagnosis = (selection: CodedDiagnosisSelection) => {
    onChange(selection);
    setSearchTerm('');
  };

  if (value) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="coded-diagnosis-selected">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              {value.system} · <span className="font-mono">{value.code}</span>
            </div>
            <p className="mt-1 text-sm text-emerald-950">{value.description}</p>
          </div>
          <button
            type="button"
            className="btn-ghost p-1 text-emerald-800"
            aria-label="Remove coded diagnosis"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          className="input sm:w-32"
          aria-label="Diagnosis coding system"
          value={system}
          disabled={disabled}
          onChange={(event) => {
            setSystem(event.target.value as CodedDiagnosisSystem);
            setSearchTerm('');
          }}
        >
          <option value="ICD-10">ICD-10</option>
          <option value="ICD-11">ICD-11</option>
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            className="input w-full pl-9"
            aria-label="Search coded diagnosis"
            placeholder={`Search ${system} code or diagnosis...`}
            value={searchTerm}
            disabled={disabled}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
      </div>

      {normalizedSearch.length > 0 && normalizedSearch.length < 2 && (
        <p className="text-xs text-[var(--color-text-muted)]">Type at least 2 characters.</p>
      )}
      {searchQuery.isLoading && (
        <p className="text-xs text-[var(--color-text-muted)]">Searching diagnosis catalog…</p>
      )}
      {normalizedSearch.length >= 2 && !searchQuery.isLoading && results.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">No matching active code found.</p>
      )}
      {results.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-1">
          {results.map((result) => (
            <button
              key={`${result.system}-${result.code}`}
              type="button"
              className="block w-full rounded-md px-3 py-2 text-left hover:bg-[var(--color-primary)]/5"
              onClick={() => selectDiagnosis(result)}
            >
              <span className="mr-2 font-mono text-xs font-semibold text-[var(--color-primary)]">{result.code}</span>
              <span className="text-sm text-[var(--color-text)]">{result.description}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[var(--color-text-muted)]">
        Optional. Free-text assessment remains available; selected code is verified again by the server when saving.
      </p>
    </div>
  );
}

export default QuickCodedDiagnosis;
