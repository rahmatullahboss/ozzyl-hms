import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ResultInput from './ResultInput';

describe('ResultInput', () => {
  it('renders numeric input for numeric value_type', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="numeric" value="" onChange={onChange} />);

    const input = screen.getByRole('spinbutton');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('step', 'any');
  });

  it('renders text input for string value_type', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="string" value="" onChange={onChange} />);

    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('renders textarea for memo value_type', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="memo" value="" onChange={onChange} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('rows', '4');
  });

  it('renders select dropdown for coded value_type with blood group options', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="coded" value="" onChange={onChange} testName="Blood Group" />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    expect(screen.getByText('Select...')).toBeInTheDocument();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('O-')).toBeInTheDocument();
  });

  it('renders select dropdown for coded value_type with positive/negative options', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="coded" value="" onChange={onChange} testName="HBsAg" />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    expect(screen.getByText('Positive')).toBeInTheDocument();
    expect(screen.getByText('Negative')).toBeInTheDocument();
  });

  it('falls back to text input for coded type when no matching options', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="coded" value="" onChange={onChange} testName="Custom Test" />);

    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('renders numeric input for ratio value_type', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="ratio" value="" onChange={onChange} />);

    const input = screen.getByRole('spinbutton');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('step', 'any');
  });

  it('calls onChange when value changes', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="string" value="" onChange={onChange} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test value' } });

    expect(onChange).toHaveBeenCalledWith('test value');
  });

  it('displays the current value', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="string" value="current" onChange={onChange} />);

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('current');
  });

  it('applies placeholder text', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="string" value="" onChange={onChange} placeholder="Enter result" />);

    const input = screen.getByPlaceholderText('Enter result');
    expect(input).toBeInTheDocument();
  });

  it('renders as disabled when disabled prop is true', () => {
    const onChange = vi.fn();
    render(<ResultInput valueType="string" value="" onChange={onChange} disabled />);

    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });
});
