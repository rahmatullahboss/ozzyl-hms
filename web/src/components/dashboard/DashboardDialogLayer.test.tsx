import { useEffect, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DashboardDialogPortal,
  useDashboardDialogLayer,
} from './DashboardDialogLayer';

function FallbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dialogRef } = useDashboardDialogLayer({ open, onClose });
  if (!open) return null;
  return (
    <DashboardDialogPortal>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-label="Fallback dialog">
        No focusable controls
      </section>
    </DashboardDialogPortal>
  );
}

function StatefulDialog() {
  const [open, setOpen] = useState(false);
  const { dialogRef, initialFocusRef } = useDashboardDialogLayer({
    open,
    onClose: () => setOpen(false),
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open settings</button>
      {open ? (
        <DashboardDialogPortal>
          <section ref={dialogRef} tabIndex={-1} role="dialog" aria-label="Settings dialog">
            <button ref={initialFocusRef} type="button" onClick={() => setOpen(false)}>Close settings</button>
            <button type="button">Last action</button>
          </section>
        </DashboardDialogPortal>
      ) : null}
    </>
  );
}

function NestedDialogs() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  const parentLayer = useDashboardDialogLayer({
    open: parentOpen,
    onClose: () => setParentOpen(false),
  });
  const childLayer = useDashboardDialogLayer({
    open: childOpen,
    onClose: () => setChildOpen(false),
  });

  return (
    <>
      <button type="button" onClick={() => setParentOpen(true)}>Open parent</button>
      {parentOpen ? (
        <DashboardDialogPortal>
          <section ref={parentLayer.dialogRef} tabIndex={-1} role="dialog" aria-label="Parent dialog">
            <button ref={parentLayer.initialFocusRef} type="button" onClick={() => setParentOpen(false)}>Close parent</button>
            <button type="button" onClick={() => setChildOpen(true)}>Open child</button>
          </section>
        </DashboardDialogPortal>
      ) : null}
      {childOpen ? (
        <DashboardDialogPortal>
          <section ref={childLayer.dialogRef} tabIndex={-1} role="dialog" aria-label="Child dialog">
            <button ref={childLayer.initialFocusRef} type="button" onClick={() => setChildOpen(false)}>Close child</button>
          </section>
        </DashboardDialogPortal>
      ) : null}
    </>
  );
}

function DialogWithExternalOverlay() {
  const [parentOpen, setParentOpen] = useState(true);
  const [externalOpen, setExternalOpen] = useState(false);
  const parentLayer = useDashboardDialogLayer({
    open: parentOpen,
    onClose: () => setParentOpen(false),
  });

  useEffect(() => {
    if (!externalOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExternalOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [externalOpen]);

  return (
    <>
      {parentOpen ? (
        <DashboardDialogPortal>
          <section ref={parentLayer.dialogRef} tabIndex={-1} role="dialog" aria-label="Dashboard parent dialog">
            <button ref={parentLayer.initialFocusRef} type="button" onClick={() => setParentOpen(false)}>Close dashboard parent</button>
            <button type="button" onClick={() => setExternalOpen(true)}>Open external overlay</button>
          </section>
        </DashboardDialogPortal>
      ) : null}
      {externalOpen ? (
        <DashboardDialogPortal>
          <section role="dialog" aria-modal="true" aria-label="External overlay">
            <button type="button" onClick={() => setExternalOpen(false)}>Close external overlay</button>
          </section>
        </DashboardDialogPortal>
      ) : null}
    </>
  );
}

describe('DashboardDialogLayer', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('focuses the dialog fallback and locks body scrolling while open', () => {
    document.body.style.overflow = 'clip';
    const onClose = vi.fn();
    const { rerender } = render(<FallbackDialog open={false} onClose={onClose} />);

    rerender(<FallbackDialog open onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'Fallback dialog' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<FallbackDialog open={false} onClose={onClose} />);
    expect(document.body.style.overflow).toBe('clip');
  });

  it('closes with Escape and restores focus to the opener', () => {
    render(<StatefulDialog />);
    const trigger = screen.getByRole('button', { name: 'Open settings' });

    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('button', { name: 'Close settings' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Settings dialog' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('wraps Tab and Shift+Tab inside the topmost dialog', () => {
    render(<StatefulDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    const first = screen.getByRole('button', { name: 'Close settings' });
    const last = screen.getByRole('button', { name: 'Last action' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('lets only the topmost nested dialog handle Escape and keeps scrolling locked', () => {
    render(<NestedDialogs />);
    const parentTrigger = screen.getByRole('button', { name: 'Open parent' });
    parentTrigger.focus();
    fireEvent.click(parentTrigger);
    const childTrigger = screen.getByRole('button', { name: 'Open child' });
    childTrigger.focus();
    fireEvent.click(childTrigger);

    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Child dialog' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Child dialog' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeInTheDocument();
    expect(childTrigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Parent dialog' })).not.toBeInTheDocument();
    expect(parentTrigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('does not intercept Escape from a higher external overlay', () => {
    render(<DialogWithExternalOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Open external overlay' }));
    const externalClose = screen.getByRole('button', { name: 'Close external overlay' });
    externalClose.focus();

    fireEvent.keyDown(externalClose, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'External overlay' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Dashboard parent dialog' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
  });
});
