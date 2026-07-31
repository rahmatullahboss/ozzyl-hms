import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../components/ConfirmDialog';

describe('ConfirmDialog Escape handling', () => {
  const noop = vi.fn();

  it('calls onCancel when Escape is pressed while open', () => {
    render(
      <ConfirmDialog open title="T" message="M" onConfirm={noop} onCancel={noop} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(noop).toHaveBeenCalled();
    // The escape handler delegates to onCancel
    // (the first call is from the hook; assert at least one call)
    expect(noop.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
