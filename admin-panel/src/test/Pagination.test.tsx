import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Pagination from '../components/Pagination';

describe('Pagination', () => {
  const defaultProps = {
    page: 1,
    totalPages: 5,
    total: 100,
    limit: 20,
    onPageChange: vi.fn(),
  };

  it('renders nothing when totalPages is 1', () => {
    const { container } = render(<Pagination {...defaultProps} totalPages={1} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders page info', () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByText('Showing 1 - 20 of 100')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument();
  });

  it('disables previous button on first page', () => {
    render(<Pagination {...defaultProps} page={1} />);
    const prevButton = screen.getByLabelText('Previous page');
    expect(prevButton).toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(<Pagination {...defaultProps} page={5} />);
    const nextButton = screen.getByLabelText('Next page');
    expect(nextButton).toBeDisabled();
  });

  it('calls onPageChange with previous page', () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} page={3} onPageChange={onPageChange} />);
    
    fireEvent.click(screen.getByLabelText('Previous page'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with next page', () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} page={3} onPageChange={onPageChange} />);
    
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('shows correct range for middle page', () => {
    render(<Pagination {...defaultProps} page={3} total={100} limit={20} />);
    expect(screen.getByText('Showing 41 - 60 of 100')).toBeInTheDocument();
  });

  it('shows correct range for last page with partial results', () => {
    render(<Pagination {...defaultProps} page={5} total={95} limit={20} />);
    expect(screen.getByText('Showing 81 - 95 of 95')).toBeInTheDocument();
  });
});
