import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../components/ConfirmDialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders nothing when open is false', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument();
  });

  it('renders title and message when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    
    const backdrop = screen.getByText('Confirm Action').closest('.fixed');
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows custom confirm label', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Delete" />);
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows custom cancel label', () => {
    render(<ConfirmDialog {...defaultProps} cancelLabel="Nope" />);
    expect(screen.getByText('Nope')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);
    expect(screen.getByText('Processing…')).toBeInTheDocument();
  });

  it('disables buttons when loading', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);
    expect(screen.getByText('Processing…')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });

  it('applies danger variant styles', () => {
    render(<ConfirmDialog {...defaultProps} variant="danger" confirmLabel="Delete" />);
    const deleteBtn = screen.getByText('Delete');
    expect(deleteBtn.className).toContain('bg-red-600');
  });

  it('applies warning variant styles', () => {
    render(<ConfirmDialog {...defaultProps} variant="warning" confirmLabel="Enable" />);
    const enableBtn = screen.getByText('Enable');
    expect(enableBtn.className).toContain('bg-yellow-500');
  });
});
