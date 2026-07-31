import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import DetailDrawer from './DetailDrawer';

describe('DetailDrawer', () => {
  it('renders as a labelled modal drawer with keyboard close, scroll lock, and focus restoration', async () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = 'Open drawer';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <DetailDrawer open title="Approval #55" subtitle="Refund review" onClose={onClose}>
        <button type="button">First drawer action</button>
      </DetailDrawer>,
    );

    const drawer = screen.getByRole('dialog', { name: 'Approval #55' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('button', { name: 'Close Approval #55' })).toHaveClass('min-h-11', 'min-w-11');
    await waitFor(() => expect(screen.getByRole('button', { name: 'First drawer action' })).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close Approval #55' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <DetailDrawer open={false} title="Approval #55" subtitle="Refund review" onClose={onClose}>
        <button type="button">First drawer action</button>
      </DetailDrawer>,
    );
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
