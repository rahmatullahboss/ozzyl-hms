import { useEffect } from 'react';

/**
 * useEscapeKey — call the handler when the user presses Escape.
 * No-op if no handler is provided. Cleans up the listener on unmount.
 */
export default function useEscapeKey(handler: (() => void) | undefined): void {
  useEffect(() => {
    if (!handler) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handler]);
}
