import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickPrescriptionForm } from '../QuickPrescriptionForm';
import type { QuickRxItem } from '../QuickPrescriptionForm';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => opts?.defaultValue ?? k }),
}));

const createRxItem = (overrides?: Partial<QuickRxItem>): QuickRxItem => ({
  medicine_name: 'Paracetamol 500mg',
  dosage: '',
  frequency: '',
  duration: '',
  instructions: '',
  route: '',
  ...overrides,
});

const defaultProps = {
  rxItems: [createRxItem()],
  onAddItem: vi.fn(),
  onUpdateItem: vi.fn(),
  onRemoveItem: vi.fn(),
  rxSearch: '',
  onRxSearchChange: vi.fn(),
  rxResults: [],
  onSelectMedicine: vi.fn(),
};

describe('QuickPrescriptionForm', () => {
  it('renders all dosage buttons', () => {
    render(<QuickPrescriptionForm {...defaultProps} />);

    const dosageValues = ['1+0+0', '0+1+0', '0+0+1', '1+0+1', '1+1+1', '½+0+½', 'SOS', 'Stat', 'Weekly', 'Monthly'];
    for (const value of dosageValues) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
  });

  it('clicking dosage button sets the dosage field', () => {
    const onUpdateItem = vi.fn();
    render(<QuickPrescriptionForm {...defaultProps} onUpdateItem={onUpdateItem} />);

    fireEvent.click(screen.getByText('1+1+1'));

    expect(onUpdateItem).toHaveBeenCalledWith(0, 'dosage', '1+1+1');
  });

  it('renders all meal timing buttons', () => {
    render(<QuickPrescriptionForm {...defaultProps} />);

    const mealTimings = ['খাবার আগে', 'খাবার পরে', 'খালি পেটে', 'রাতে ঘুমানোর আগে', 'প্রয়োজন হলে'];
    for (const value of mealTimings) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
  });

  it('clicking meal timing button sets instructions', () => {
    const onUpdateItem = vi.fn();
    render(<QuickPrescriptionForm {...defaultProps} onUpdateItem={onUpdateItem} />);

    fireEvent.click(screen.getByText('খাবার পরে'));

    expect(onUpdateItem).toHaveBeenCalledWith(0, 'instructions', 'খাবার পরে');
  });

  it('clicking meal timing button appends to existing instructions', () => {
    const onUpdateItem = vi.fn();
    const items = [createRxItem({ instructions: 'Take with water' })];
    render(<QuickPrescriptionForm {...defaultProps} rxItems={items} onUpdateItem={onUpdateItem} />);

    fireEvent.click(screen.getByText('খাবার পরে'));

    expect(onUpdateItem).toHaveBeenCalledWith(0, 'instructions', 'Take with water\u001Fখাবার পরে');
  });

  it('renders all duration buttons', () => {
    render(<QuickPrescriptionForm {...defaultProps} />);

    const durations = ['৩ দিন', '৫ দিন', '৭ দিন', '১০ দিন', '১৪ দিন', '১ মাস', 'চলবে'];
    for (const value of durations) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
  });

  it('clicking duration button sets duration field', () => {
    const onUpdateItem = vi.fn();
    render(<QuickPrescriptionForm {...defaultProps} onUpdateItem={onUpdateItem} />);

    fireEvent.click(screen.getByText('৭ দিন'));

    expect(onUpdateItem).toHaveBeenCalledWith(0, 'duration', '৭ দিন');
  });

  it('route selector works', () => {
    const onUpdateItem = vi.fn();
    render(<QuickPrescriptionForm {...defaultProps} onUpdateItem={onUpdateItem} />);

    fireEvent.click(screen.getByText('IV'));

    expect(onUpdateItem).toHaveBeenCalledWith(0, 'route', 'IV');
  });

  it('instruction checkboxes work - adding', () => {
    const onUpdateItem = vi.fn();
    render(<QuickPrescriptionForm {...defaultProps} onUpdateItem={onUpdateItem} />);

    fireEvent.click(screen.getByText('কোর্স সম্পূর্ণ করবেন'));

    expect(onUpdateItem).toHaveBeenCalledWith(0, 'instructions', 'কোর্স সম্পূর্ণ করবেন');
  });

  it('instruction checkboxes work - toggling off', () => {
    const onUpdateItem = vi.fn();
    const items = [createRxItem({ instructions: 'কোর্স সম্পূর্ণ করবেন\u001Fবেশি পানি খাবেন' })];
    render(<QuickPrescriptionForm {...defaultProps} rxItems={items} onUpdateItem={onUpdateItem} />);

    fireEvent.click(screen.getByText('কোর্স সম্পূর্ণ করবেন'));

    expect(onUpdateItem).toHaveBeenCalledWith(0, 'instructions', 'বেশি পানি খাবেন');
  });

  it('renders medicine name input for each item', () => {
    const items = [createRxItem({ medicine_name: 'Aspirin' }), createRxItem({ medicine_name: 'Metformin' })];
    render(<QuickPrescriptionForm {...defaultProps} rxItems={items} />);

    expect(screen.getByDisplayValue('Aspirin')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Metformin')).toBeInTheDocument();
  });

  it('renders empty state when no items', () => {
    render(<QuickPrescriptionForm {...defaultProps} rxItems={[]} />);

    expect(screen.getByText(/No medicine added/)).toBeInTheDocument();
  });

  it('calls onAddItem when add blank medicine button is clicked', () => {
    const onAddItem = vi.fn();
    render(<QuickPrescriptionForm {...defaultProps} onAddItem={onAddItem} />);

    fireEvent.click(screen.getByText(/Add blank medicine/));

    expect(onAddItem).toHaveBeenCalled();
  });

  it('calls onRemoveItem when remove button is clicked', () => {
    const onRemoveItem = vi.fn();
    render(<QuickPrescriptionForm {...defaultProps} onRemoveItem={onRemoveItem} />);

    const removeButton = screen.getByLabelText(/Remove medicine/);
    fireEvent.click(removeButton);

    expect(onRemoveItem).toHaveBeenCalledWith(0);
  });

  it('renders search input', () => {
    render(<QuickPrescriptionForm {...defaultProps} />);

    expect(screen.getByPlaceholderText(/Search medicine/)).toBeInTheDocument();
  });

  it('shows search results when rxResults provided', () => {
    const rxResults = [
      { name: 'Paracetamol', generic: 'Paracetamol', manufacturer: 'Beximco' },
      { name: 'Paracetamol Plus', generic: 'Paracetamol + Caffeine', manufacturer: 'Square' },
    ];
    render(<QuickPrescriptionForm {...defaultProps} rxResults={rxResults} />);

    expect(screen.getByText('Paracetamol')).toBeInTheDocument();
    expect(screen.getByText('Paracetamol Plus')).toBeInTheDocument();
  });

  it('shows medicine strength and dosage form in search results', () => {
    const rxResults = [
      { name: 'Napa', generic: 'Paracetamol', manufacturer: 'Beximco', strength: '500mg', dosage_form: 'Tablet' },
    ];
    render(<QuickPrescriptionForm {...defaultProps} rxResults={rxResults} />);

    expect(screen.getByText('500mg')).toBeInTheDocument();
    expect(screen.getByText('Tablet')).toBeInTheDocument();
  });

  it('highlights the selected dosage button', () => {
    const items = [createRxItem({ dosage: '1+1+1' })];
    render(<QuickPrescriptionForm {...defaultProps} rxItems={items} />);

    const btn = screen.getByText('1+1+1');
    expect(btn.className).toContain('bg-blue-600');
  });

  it('highlights the selected duration button', () => {
    const items = [createRxItem({ duration: '৭ দিন' })];
    render(<QuickPrescriptionForm {...defaultProps} rxItems={items} />);

    const btn = screen.getByText('৭ দিন');
    expect(btn.className).toContain('bg-purple-600');
  });

  it('defaults to last item when no item selected', () => {
    const onUpdateItem = vi.fn();
    const items = [createRxItem(), createRxItem({ medicine_name: 'Metformin' })];
    render(<QuickPrescriptionForm {...defaultProps} rxItems={items} onUpdateItem={onUpdateItem} />);

    fireEvent.click(screen.getByText('1+0+0'));

    expect(onUpdateItem).toHaveBeenCalledWith(1, 'dosage', '1+0+0');
  });
});
