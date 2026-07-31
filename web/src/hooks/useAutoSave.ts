import { useRef, useCallback, useEffect, useState } from 'react';
import { useApiMutation, useQueryClient } from './useApiQuery';

interface UseAutoSaveOptions {
  endpoint: string;
  method?: 'post' | 'put';
  invalidateKeys?: unknown[][];
  debounceMs?: number;
  onSuccess?: () => void;
  onSaveResponse?: (data: unknown) => void;
  onError?: (err: Error) => void;
  /** Enable visibility change handler (save when tab hidden) */
  handleVisibilityChange?: boolean;
  /** Enable beforeunload handler (warn if dirty) */
  handleBeforeUnload?: boolean;
}

export function useAutoSave({
  endpoint,
  method = 'post',
  invalidateKeys = [],
  debounceMs = 1500,
  onSuccess,
  onSaveResponse,
  onError,
  handleVisibilityChange = false,
  handleBeforeUnload = false,
}: UseAutoSaveOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<Record<string, unknown> | null>(null);
  const queryClient = useQueryClient();
  const [isDirty, setIsDirty] = useState(false);

  const mutation = useApiMutation<unknown, Record<string, unknown>>(
    method,
    endpoint,
    {
      onSuccess: (data) => {
        setIsDirty(false);
        for (const key of invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        onSaveResponse?.(data);
        onSuccess?.();
      },
      onError: (err) => {
        onError?.(err);
      },
    },
  );

  const save = useCallback((data: Record<string, unknown>) => {
    pendingDataRef.current = data;
    setIsDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (pendingDataRef.current) {
        mutation.mutate(pendingDataRef.current);
        pendingDataRef.current = null;
      }
    }, debounceMs);
  }, [mutation, debounceMs]);

  const saveImmediate = useCallback((data: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingDataRef.current = null;
    setIsDirty(false);
    mutation.mutate(data);
  }, [mutation]);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pendingDataRef.current) {
      mutation.mutate(pendingDataRef.current);
      pendingDataRef.current = null;
      setIsDirty(false);
    }
  }, [mutation]);

  // Save when tab becomes hidden
  useEffect(() => {
    if (!handleVisibilityChange) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && pendingDataRef.current) {
        flush();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [handleVisibilityChange, flush]);

  // Warn on beforeunload if dirty
  useEffect(() => {
    if (!handleBeforeUnload) return;
    const handleUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [handleBeforeUnload, isDirty]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    save,
    saveImmediate,
    flush,
    isDirty,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
}
