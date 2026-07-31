import { useState, useEffect, useCallback, useRef } from 'react';
import { useApiQuery, useApiMutation, useQueryClient } from './useApiQuery';
import toast from 'react-hot-toast';

/**
 * Coerce a raw string value from the API to match the type of the default value.
 * The API stores everything as strings in D1, so 'true' → true, '42' → 42, etc.
 */
function coerceValue(raw: unknown, defaultValue: unknown): unknown {
  if (raw === null || raw === undefined) return defaultValue;
  if (typeof defaultValue === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') return raw === 'true';
    return Boolean(raw);
  }
  if (typeof defaultValue === 'number') {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const parsed = Number(raw);
      return isNaN(parsed) ? defaultValue : parsed;
    }
    return defaultValue;
  }
  return raw;
}

/**
 * Shared hook for settings pages that fetch, sync, and save settings.
 *
 * The backend stores all settings as flat key-value pairs in a single
 * `settings` table. GET /api/settings returns everything; PUT /api/settings
 * bulk-uprites. This hook namespaces keys with an optional prefix so
 * multiple pages can coexist without collisions.
 */
export function useSettingsForm<T extends object>({
  queryKey,
  /** Key prefix for this settings group (e.g., 'appointment_'). Keys are stored as `prefix_fieldName`. */
  prefix = '',
  defaultValues,
  successMessage = 'Settings saved',
  errorMessage = 'Failed to save settings',
}: {
  queryKey: string[];
  prefix?: string;
  defaultValues: T;
  successMessage?: string;
  errorMessage?: string;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<T>(defaultValues);
  const [dirty, setDirty] = useState(false);
  const defaultsRef = useRef(defaultValues);
  defaultsRef.current = defaultValues;

  // ── Fetch all settings (single endpoint) ──
  const { data, isLoading } = useApiQuery<{ settings: Record<string, string> }>(
    queryKey,
    '/api/settings',
  );

  // ── Extract prefixed keys from the flat settings object ──
  useEffect(() => {
    if (!data?.settings) return;
    const defaults = defaultsRef.current as Record<string, unknown>;
    const extracted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data.settings)) {
      if (prefix && key.startsWith(prefix)) {
        const field = key.slice(prefix.length);
        extracted[field] = coerceValue(value, defaults[field]);
      } else if (!prefix) {
        extracted[key] = coerceValue(value, defaults[key]);
      }
    }
    setValues(prev => ({ ...prev, ...extracted } as T));
    setDirty(false);
  }, [data, prefix]);

  // ── Save mutation (bulk PUT to /api/settings) ──
  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    'put',
    '/api/settings',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        setDirty(false);
        toast.success(successMessage);
      },
      onError: () => toast.error(errorMessage),
    },
  );

  // ── Update a single field ──
  const update = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  // ── Save: prefix all keys before sending ──
  const save = useCallback(() => {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      payload[`${prefix}${key}`] = value;
    }
    saveMutation.mutate(payload);
  }, [saveMutation, values, prefix]);

  // ── Unsaved changes warning ──
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  return {
    values,
    setValues,
    update,
    save,
    dirty,
    loading: isLoading,
    saving: saveMutation.isPending,
  };
}
