import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FoodLogModal from './FoodLogModal';

// Mock the Auth Hook
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ token: 'mock-token' }),
}));

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('FoodLogModal', () => {
  const mockOnClose = vi.fn();
  const mockOnLogged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'Apple',
        calories: 95,
        macros: { protein: 0.5, carbs: 25, fat: 0.3 }
      })
    });
  });

  it('renders nothing when not isOpen', () => {
    const { container } = render(
      <FoodLogModal isOpen={false} onClose={mockOnClose} onLogged={mockOnLogged} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders correctly when isOpen is true', () => {
    render(<FoodLogModal isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    
    expect(screen.getByText(/লগ ফুড/)).toBeInTheDocument();
    expect(screen.getByText(/ছবি তুলুন/)).toBeInTheDocument();
  });

  it('shows error when image is too large (> 5MB)', async () => {
    render(<FoodLogModal isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    
    const largeFile = new File(['a'.repeat(6 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, largeFile);
    
    expect(screen.getByText(/Image must be < 5MB/)).toBeInTheDocument();
    expect(screen.queryByAltText('Food preview')).not.toBeInTheDocument();
  });

  it('displays image preview after valid file selection', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'mock-url');
    
    render(<FoodLogModal isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    
    const validFile = new File(['valid'], 'food.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, validFile);
    
    expect(screen.getByAltText('Food preview')).toBeInTheDocument();
    expect(screen.getByText('AI Analyze')).toBeInTheDocument();
  });

  it('calls AI API and displays nutritional info when Analyze is clicked', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'mock-url');
    render(<FoodLogModal isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    
    const validFile = new File(['valid'], 'food.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, validFile);
    
    const analyzeButton = screen.getByText('AI Analyze');
    fireEvent.click(analyzeButton);
    
    await waitFor(() => {
      expect(screen.getByText('Apple')).toBeInTheDocument();
      expect(screen.getByText('95')).toBeInTheDocument();
      expect(screen.getByText('25g')).toBeInTheDocument();
    });
    
    expect(mockFetch).toHaveBeenCalledWith('/api/food/identify', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer mock-token' }
    }));
  });

  it('calls onLogged and onClose when Save to Diary is clicked', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'mock-url');
    render(<FoodLogModal isOpen={true} onClose={mockOnClose} onLogged={mockOnLogged} />);
    
    const validFile = new File(['valid'], 'food.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, validFile);
    
    const analyzeButton = screen.getByText('AI Analyze');
    fireEvent.click(analyzeButton);
    
    await waitFor(() => {
      expect(screen.getByText('Save to Diary')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Save to Diary'));
    
    expect(mockOnLogged).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });
});
