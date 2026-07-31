import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SymptomLoggerModal from './SymptomLoggerModal';
import toast from 'react-hot-toast';

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SymptomLoggerModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(<SymptomLoggerModal isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders correctly when isOpen is true', () => {
    render(<SymptomLoggerModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText('Log Symptoms')).toBeInTheDocument();
    expect(screen.getByText('How are you feeling?')).toBeInTheDocument();
    expect(screen.getByText('Headache')).toBeInTheDocument();
    expect(screen.getByText('Severity')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<SymptomLoggerModal isOpen={true} onClose={mockOnClose} />);
    
    // Find the close button (the one inside the header usually contains an SVG or X icon, we can find it by its onClick handler or by querying button inside the header)
    const closeButtons = screen.getAllByRole('button');
    // First button should be the X button
    fireEvent.click(closeButtons[0]);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('toggles symptoms on click', () => {
    render(<SymptomLoggerModal isOpen={true} onClose={mockOnClose} />);
    
    const headacheButton = screen.getByText('Headache');
    
    // Clicking once should select it
    fireEvent.click(headacheButton);
    expect(headacheButton).toHaveClass('bg-emerald-100');
    
    // Clicking again should deselect it
    fireEvent.click(headacheButton);
    expect(headacheButton).not.toHaveClass('bg-emerald-100');
  });

  it('shows error if trying to save with no symptoms', () => {
    render(<SymptomLoggerModal isOpen={true} onClose={mockOnClose} />);
    
    const saveButton = screen.getByText('Save Entry');
    expect(saveButton).toBeDisabled(); // Given the UI, the button should be disabled when length is 0
  });

  it('saves successfully when symptoms are selected', async () => {
    render(<SymptomLoggerModal isOpen={true} onClose={mockOnClose} />);
    
    const headacheButton = screen.getByText('Headache');
    fireEvent.click(headacheButton);
    
    const saveButton = screen.getByText('Save Entry');
    expect(saveButton).not.toBeDisabled();
    
    fireEvent.click(saveButton);
    expect(screen.getByText('Saving...')).toBeInTheDocument();
    
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Symptoms logged successfully');
    });
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
