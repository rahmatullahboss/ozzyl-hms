import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BulkActionsBar, { BulkCheckbox } from './BulkActionsBar';

describe('BulkActionsBar', () => {
  const defaultActions = [
    { id: 'approve', label: 'Approve Selected', variant: 'primary' as const, confirmMessage: 'Approve all?' },
    { id: 'reject', label: 'Reject Selected', variant: 'danger' as const, confirmMessage: 'Reject all?' },
    { id: 'export', label: 'Export', variant: 'secondary' as const },
  ];

  it('renders nothing when no items selected', () => {
    const { container } = render(
      <BulkActionsBar selectedCount={0} onClearSelection={vi.fn()} actions={defaultActions} onAction={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders bar with selected count', () => {
    render(
      <BulkActionsBar selectedCount={3} onClearSelection={vi.fn()} actions={defaultActions} onAction={vi.fn()} />
    );
    expect(screen.getByText('3 selected')).toBeDefined();
  });

  it('renders action buttons', () => {
    render(
      <BulkActionsBar selectedCount={2} onClearSelection={vi.fn()} actions={defaultActions} onAction={vi.fn()} />
    );
    expect(screen.getByText('Approve Selected')).toBeDefined();
    expect(screen.getByText('Reject Selected')).toBeDefined();
    expect(screen.getByText('Export')).toBeDefined();
  });

  it('calls onClearSelection when clear clicked', () => {
    const onClear = vi.fn();
    render(
      <BulkActionsBar selectedCount={2} onClearSelection={onClear} actions={defaultActions} onAction={vi.fn()} />
    );
    fireEvent.click(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalled();
  });

  it('calls onAction directly for actions without confirm', () => {
    const onAction = vi.fn();
    render(
      <BulkActionsBar selectedCount={2} onClearSelection={vi.fn()} actions={defaultActions} onAction={onAction} />
    );
    fireEvent.click(screen.getByText('Export'));
    expect(onAction).toHaveBeenCalledWith('export');
  });

  it('shows confirm dialog for actions with confirmMessage', () => {
    render(
      <BulkActionsBar selectedCount={2} onClearSelection={vi.fn()} actions={defaultActions} onAction={vi.fn()} />
    );
    fireEvent.click(screen.getByText('Approve Selected'));
    expect(screen.getByText('Approve all?')).toBeDefined();
  });

  it('calls onAction after confirm', () => {
    const onAction = vi.fn();
    render(
      <BulkActionsBar selectedCount={2} onClearSelection={vi.fn()} actions={defaultActions} onAction={onAction} />
    );
    fireEvent.click(screen.getByText('Approve Selected'));
    fireEvent.click(screen.getByText('Confirm'));
    expect(onAction).toHaveBeenCalledWith('approve');
  });

  it('closes confirm dialog on cancel', () => {
    render(
      <BulkActionsBar selectedCount={2} onClearSelection={vi.fn()} actions={defaultActions} onAction={vi.fn()} />
    );
    fireEvent.click(screen.getByText('Approve Selected'));
    expect(screen.getByText('Approve all?')).toBeDefined();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Approve all?')).toBeNull();
  });
});

describe('BulkCheckbox', () => {
  it('renders checkbox', () => {
    render(<BulkCheckbox checked={false} onChange={vi.fn()} />);
    expect(document.querySelector('input[type="checkbox"]')).toBeDefined();
  });

  it('calls onChange when clicked', () => {
    const onChange = vi.fn();
    render(<BulkCheckbox checked={false} onChange={onChange} />);
    fireEvent.click(document.querySelector('input[type="checkbox"]')!);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects checked state', () => {
    render(<BulkCheckbox checked={true} onChange={vi.fn()} />);
    expect(document.querySelector('input[type="checkbox"]')).toHaveProperty('checked', true);
  });
});
