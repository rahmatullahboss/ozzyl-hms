import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarcodeScanner } from './BarcodeScanner';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ token: 'mock-token' }),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('BarcodeScanner', () => {
  const mockOnClose = vi.fn();
  const mockOnLogged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupMockSuccess = () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'Pran Mango Juice',
        brand: 'Pran',
        serving_size: '250ml',
        calories: 120,
        macros: { protein: 0, carbohydrates: 30, fat: 0 }
      })
    });
  };

  const setupMockError = () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'Product not found in database'
      })
    });
  };

  it('renders nothing when closed', () => {
    const { container } = render(
      <BarcodeScanner isOpen={false} onClose={mockOnClose} onLogged={mockOnLogged} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders correctly when open', () => {
    render(<BarcodeScanner isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    expect(screen.getByText('বারকোড স্ক্যান (Scan Barcode)')).toBeInTheDocument();
    expect(screen.getByText('Tap to Scan')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. 8941113200155')).toBeInTheDocument();
  });

  it('simulates camera scan and fetches barcode data', async () => {
    setupMockSuccess();
    vi.useFakeTimers();

    render(<BarcodeScanner isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    
    fireEvent.click(screen.getByText('Tap to Scan'));
    expect(screen.getByText('Scanning...')).toBeInTheDocument();

    vi.runAllTimers();
    vi.useRealTimers();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/food/barcode/8941113200155', expect.any(Object));
    });

    await waitFor(() => {
      expect(screen.getByText('Pran Mango Juice')).toBeInTheDocument();
      expect(screen.getByText('120')).toBeInTheDocument();
      expect(screen.getByText('30g')).toBeInTheDocument();
    });
  });

  it('looks up manually typed barcodes', async () => {
    setupMockSuccess();
    render(<BarcodeScanner isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    
    const input = screen.getByPlaceholderText('e.g. 8941113200155');
    await userEvent.type(input, '123456');
    
    const submitButton = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/food/barcode/123456', expect.any(Object));
      expect(screen.getByText('Pran Mango Juice')).toBeInTheDocument();
    });
  });

  it('displays API errors for missing products', async () => {
    setupMockError();
    render(<BarcodeScanner isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    
    const input = screen.getByPlaceholderText('e.g. 8941113200155');
    await userEvent.type(input, '999');
    
    const submitButton = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Product not found in database')).toBeInTheDocument();
    });
  });

  it('saves food and closes when confirmed', async () => {
    setupMockSuccess();
    render(<BarcodeScanner isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    
    const input = screen.getByPlaceholderText('e.g. 8941113200155');
    await userEvent.type(input, '123456');
    fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => expect(screen.getByText('Save Food')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Save Food'));

    expect(mockOnLogged).toHaveBeenCalledOnce();
    expect(mockOnClose).toHaveBeenCalledOnce();
  });
});
