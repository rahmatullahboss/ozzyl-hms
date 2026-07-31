import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VisitPassQR from './VisitPassQR';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('VisitPassQR', () => {
  it('renders default props correctly', () => {
    render(<VisitPassQR />);
    expect(screen.getByText('Arif Rahman')).toBeInTheDocument();
    expect(screen.getByText('UHID-839210')).toBeInTheDocument();
    expect(screen.getByText('Ready to Scan')).toBeInTheDocument();
  });

  it('renders passed props correctly', () => {
    render(<VisitPassQR patientName="John Doe" patientId="UHID-123456" />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('UHID-123456')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const mockOnClose = vi.fn();
    render(<VisitPassQR onClose={mockOnClose} />);
    
    // There is an X button for closing.
    const buttons = screen.getAllByRole('button');
    // Assuming the first button is the close button
    fireEvent.click(buttons[0]);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
