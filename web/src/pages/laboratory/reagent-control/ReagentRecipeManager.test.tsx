import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReagentRecipeManager from './ReagentRecipeManager';

const baseProps = {
  labTests: [{ id: 101, code: 'CBC', name: 'Complete Blood Count' }],
  consumables: [{ id: 5, code: 'CBC-DIL', name: 'CBC Diluent', category: 'reagent', unit: 'ml' }],
  mappings: [{
    id: 1,
    lab_test_id: 101,
    consumable_id: 5,
    qty_per_test: 1,
    is_mandatory: true,
    notes: 'Analyzer pack',
    test_name: 'Complete Blood Count',
    test_code: 'CBC',
    consumable_name: 'CBC Diluent',
    consumable_code: 'CBC-DIL',
    unit: 'ml',
    category: 'reagent',
  }],
  missingRecipeCount: 2,
  form: { lab_test_id: '', consumable_id: '', qty_per_test: '1', is_mandatory: true, notes: '' },
  bulkText: '',
  editingId: null as number | null,
  editForm: { qty_per_test: '1', is_mandatory: true, notes: '' },
  loading: false,
  onFormChange: vi.fn(),
  onSave: vi.fn(),
  onLoadStarterCatalog: vi.fn(),
  onBulkTextChange: vi.fn(),
  onBulkImport: vi.fn(),
  onStartEdit: vi.fn(),
  onEditFormChange: vi.fn(),
  onUpdate: vi.fn(),
  onCancelEdit: vi.fn(),
  onRemove: vi.fn(),
};

describe('ReagentRecipeManager', () => {
  it('shows only the three essential recipe fields by default', () => {
    render(<ReagentRecipeManager {...baseProps} />);

    expect(screen.getByRole('heading', { name: 'Test Recipes' })).toBeInTheDocument();
    expect(screen.getByText('2 tests still need a recipe')).toBeInTheDocument();
    expect(screen.getByLabelText('Lab test')).toBeInTheDocument();
    expect(screen.getByLabelText('Reagent or consumable')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity per test')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mandatory recipe item')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Recipe notes')).not.toBeInTheDocument();
    expect(screen.queryByText('Bulk recipe import')).not.toBeInTheDocument();
    expect(screen.queryByText('Strict production mode')).not.toBeInTheDocument();
  });

  it('reveals optional recipe fields separately from bulk tools', () => {
    render(<ReagentRecipeManager {...baseProps} />);

    const moreOptions = screen.getByRole('button', { name: 'More recipe options' });
    expect(moreOptions).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(moreOptions);
    expect(moreOptions).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Mandatory recipe item')).toBeInTheDocument();
    expect(screen.getByLabelText('Recipe notes')).toBeInTheDocument();
    expect(screen.queryByText('Bulk recipe import')).not.toBeInTheDocument();

    const advancedTools = screen.getByRole('button', { name: 'Advanced recipe tools' });
    fireEvent.click(advancedTools);
    expect(screen.getByText('Bulk recipe import')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load starter reagent catalog' })).toBeInTheDocument();
  });

  it('passes primary form changes and save action to the parent', () => {
    const onFormChange = vi.fn();
    const onSave = vi.fn();
    render(<ReagentRecipeManager
      {...baseProps}
      form={{ ...baseProps.form, lab_test_id: '101', consumable_id: '5', qty_per_test: '1' }}
      onFormChange={onFormChange}
      onSave={onSave}
    />);

    fireEvent.change(screen.getByLabelText('Lab test'), { target: { value: '101' } });
    expect(onFormChange).toHaveBeenCalledWith({ lab_test_id: '101' });

    fireEvent.change(screen.getByLabelText('Reagent or consumable'), { target: { value: '5' } });
    expect(onFormChange).toHaveBeenCalledWith({ consumable_id: '5' });

    fireEvent.change(screen.getByLabelText('Quantity per test'), { target: { value: '1.5' } });
    expect(onFormChange).toHaveBeenCalledWith({ qty_per_test: '1.5' });

    fireEvent.click(screen.getByRole('button', { name: 'Save recipe item' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps edit and remove actions available in the recipe list', () => {
    const onStartEdit = vi.fn();
    const onRemove = vi.fn();
    render(<ReagentRecipeManager {...baseProps} onStartEdit={onStartEdit} onRemove={onRemove} />);

    expect(screen.getByText('Complete Blood Count')).toBeInTheDocument();
    expect(screen.getByText('CBC Diluent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit CBC Diluent recipe item' }));
    expect(onStartEdit).toHaveBeenCalledWith(baseProps.mappings[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove CBC Diluent recipe item' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});
