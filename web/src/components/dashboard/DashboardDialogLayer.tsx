import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export const DASHBOARD_DIALOG_OVERLAY_CLASS = 'z-[60]';
export const DASHBOARD_DETAIL_OVERLAY_CLASS = 'z-[68]';

const layerStack: symbol[] = [];
let originalBodyOverflow: string | null = null;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    return element.tabIndex >= 0;
  });
}

function registerLayer(token: symbol) {
  if (layerStack.length === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  layerStack.push(token);
}

function unregisterLayer(token: symbol): boolean {
  const wasTopmost = layerStack[layerStack.length - 1] === token;
  const index = layerStack.lastIndexOf(token);
  if (index >= 0) layerStack.splice(index, 1);
  if (layerStack.length === 0 && originalBodyOverflow !== null) {
    document.body.style.overflow = originalBodyOverflow;
    originalBodyOverflow = null;
  }
  return wasTopmost;
}

export function DashboardDialogPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export function useDashboardDialogLayer({ open, onClose }: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const token = Symbol('dashboard-dialog-layer');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    registerLayer(token);

    const dialog = dialogRef.current;
    const initialFocus = initialFocusRef.current
      ?? (dialog ? focusableElements(dialog)[0] : null)
      ?? dialog;
    initialFocus?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (layerStack[layerStack.length - 1] !== token) return;
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement
        && dialogRef.current
        && !dialogRef.current.contains(activeElement)
        && activeElement.closest('[role="dialog"][aria-modal="true"]')
      ) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const wasTopmost = unregisterLayer(token);
      if (wasTopmost && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  return { dialogRef, initialFocusRef };
}
