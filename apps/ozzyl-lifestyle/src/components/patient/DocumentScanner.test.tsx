import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentScanner } from './DocumentScanner';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ token: 'mock-token' }),
}));

describe('DocumentScanner', () => {
  const mockOnClose = vi.fn();
  const mockOnUploaded = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<DocumentScanner isOpen={false} onClose={mockOnClose} onUploaded={mockOnUploaded} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders initial state correctly', () => {
    render(<DocumentScanner isOpen={true} onClose={mockOnClose} onUploaded={mockOnUploaded} />);
    expect(screen.getByText('Scan Document')).toBeInTheDocument();
    expect(screen.getByText('Scan New Page')).toBeInTheDocument();
  });

  it('validates file size < 10MB', async () => {
    render(<DocumentScanner isOpen={true} onClose={mockOnClose} onUploaded={mockOnUploaded} />);
    
    const hugeFile = new File(['a'.repeat(11 * 1024 * 1024)], 'report.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, hugeFile);
    
    expect(screen.getByText('Document must be < 10MB')).toBeInTheDocument();
  });

  it('shows document preview after valid selection', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'mock-pdf-url');
    render(<DocumentScanner isOpen={true} onClose={mockOnClose} onUploaded={mockOnUploaded} />);

    const validFile = new File(['valid'], 'report.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, validFile);
    
    expect(screen.getByAltText('Document preview')).toBeInTheDocument();
    expect(screen.getByText('Confirm & Upload')).toBeInTheDocument();
  });

  it('handles document upload and auto-tagging flow', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'mock-pdf-url');

    render(<DocumentScanner isOpen={true} onClose={mockOnClose} onUploaded={mockOnUploaded} />);

    const validFile = new File(['valid'], 'report.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, validFile);
    
    const confirmBtn = screen.getByText('Confirm & Upload');
    fireEvent.click(confirmBtn);

    // Should indicate uploading
    expect(screen.getByText('Uploading & Analyzing...')).toBeInTheDocument();

    // Wait for the simulated API (1.5s) to resolve and show auto-tags
    await waitFor(() => {
      expect(screen.getByText('Document Categorized!')).toBeInTheDocument();
      expect(screen.getByText('Lab Report')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Wait for the completion handler (2s setTimeout) to fire
    await waitFor(() => {
      expect(mockOnUploaded).toHaveBeenCalledOnce();
      expect(mockOnClose).toHaveBeenCalledOnce();
    }, { timeout: 4000 });
  }, 10000); // extend test timeout to 10s
});
