import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import useEscapeKey from '../hooks/useEscapeKey';

describe('useEscapeKey', () => {
  it('calls the handler when Escape is pressed', () => {
    const onEsc = vi.fn();
    renderHook(() => useEscapeKey(onEsc));
    const ev = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(ev);
    expect(onEsc).toHaveBeenCalledOnce();
  });

  it('does not call the handler when other keys are pressed', () => {
    const onEsc = vi.fn();
    renderHook(() => useEscapeKey(onEsc));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(onEsc).not.toHaveBeenCalled();
  });

  it('does nothing when handler is undefined', () => {
    expect(() => {
      renderHook(() => useEscapeKey(undefined));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }).not.toThrow();
  });

  it('removes the listener on unmount', () => {
    const onEsc = vi.fn();
    const { unmount } = renderHook(() => useEscapeKey(onEsc));
    unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onEsc).not.toHaveBeenCalled();
  });
});
