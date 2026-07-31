import { useState } from 'react';
import { ChevronDown, ChevronRight, FileUp, FlaskConical, Pencil, Save, Trash2 } from 'lucide-react';

export type RecipeTest = {
  id: number;
  code?: string | null;
  name: string;
};

export type RecipeConsumable = {
  id: number;
  code?: string | null;
  name: string;
  category?: string | null;
  unit?: string | null;
};

export type RecipeMapping = {
  id: number;
  lab_test_id: number;
  consumable_id: number;
  qty_per_test: number;
  is_mandatory: number | boolean;
  notes?: string | null;
  test_name?: string | null;
  test_code?: string | null;
  consumable_name?: string | null;
  consumable_code?: string | null;
  unit?: string | null;
  category?: string | null;
};

export type RecipeForm = {
  lab_test_id: string;
  consumable_id: string;
  qty_per_test: string;
  is_mandatory: boolean;
  notes: string;
};

export type RecipeEditForm = {
  qty_per_test: string;
  is_mandatory: boolean;
  notes: string;
};

const inputClass = 'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

export default function ReagentRecipeManager({
  labTests,
  consumables,
  mappings,
  missingRecipeCount,
  form,
  bulkText,
  editingId,
  editForm,
  loading,
  onFormChange,
  onSave,
  onLoadStarterCatalog,
  onBulkTextChange,
  onBulkImport,
  onStartEdit,
  onEditFormChange,
  onUpdate,
  onCancelEdit,
  onRemove,
}: {
  labTests: RecipeTest[];
  consumables: RecipeConsumable[];
  mappings: RecipeMapping[];
  missingRecipeCount: number;
  form: RecipeForm;
  bulkText: string;
  editingId: number | null;
  editForm: RecipeEditForm;
  loading: boolean;
  onFormChange: (patch: Partial<RecipeForm>) => void;
  onSave: () => void;
  onLoadStarterCatalog: () => void;
  onBulkTextChange: (value: string) => void;
  onBulkImport: () => void;
  onStartEdit: (mapping: RecipeMapping) => void;
  onEditFormChange: (patch: Partial<RecipeEditForm>) => void;
  onUpdate: (id: number) => void;
  onCancelEdit: () => void;
  onRemove: (id: number) => void;
}) {
  const [showOptions, setShowOptions] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  return (
    <div
      id="reagent-control-panel-recipes"
      role="tabpanel"
      aria-labelledby="reagent-control-tab-recipes"
      className="space-y-5"
    >
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-violet-600" aria-hidden="true" />
              <h2 className="text-xl font-bold text-[var(--color-text)]">Test Recipes</h2>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Choose which reagent or consumable a lab test uses and how much is expected for one test.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${missingRecipeCount > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {missingRecipeCount > 0
              ? `${missingRecipeCount} ${missingRecipeCount === 1 ? 'test still needs' : 'tests still need'} a recipe`
              : 'All active tests have recipes'}
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm font-medium text-[var(--color-text)]">
            <span>Lab test</span>
            <select
              aria-label="Lab test"
              value={form.lab_test_id}
              onChange={event => onFormChange({ lab_test_id: event.target.value })}
              className={inputClass}
            >
              <option value="">Select lab test</option>
              {labTests.map(test => <option key={test.id} value={test.id}>{test.name}{test.code ? ` (${test.code})` : ''}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-[var(--color-text)]">
            <span>Reagent or consumable</span>
            <select
              aria-label="Reagent or consumable"
              value={form.consumable_id}
              onChange={event => onFormChange({ consumable_id: event.target.value })}
              className={inputClass}
            >
              <option value="">Select reagent or consumable</option>
              {consumables.map(item => <option key={item.id} value={item.id}>{item.name}{item.code ? ` (${item.code})` : ''}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-[var(--color-text)]">
            <span>Quantity per test</span>
            <input
              aria-label="Quantity per test"
              type="number"
              min="0.0001"
              step="0.0001"
              value={form.qty_per_test}
              onChange={event => onFormChange({ qty_per_test: event.target.value })}
              className={inputClass}
            />
          </label>
        </div>

        <div className="mt-4">
          <button
            type="button"
            aria-expanded={showOptions}
            onClick={() => setShowOptions(value => !value)}
            className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700"
          >
            {showOptions ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            More recipe options
          </button>
          {showOptions && (
            <div className="mt-3 grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 md:grid-cols-[220px_1fr]">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  aria-label="Mandatory recipe item"
                  type="checkbox"
                  checked={form.is_mandatory}
                  onChange={event => onFormChange({ is_mandatory: event.target.checked })}
                />
                Required for this test
              </label>
              <label className="space-y-1 text-sm font-medium text-[var(--color-text)]">
                <span>Notes</span>
                <input
                  aria-label="Recipe notes"
                  value={form.notes}
                  onChange={event => onFormChange({ notes: event.target.value })}
                  className={inputClass}
                  placeholder="Analyzer pack, tube rule or repeat-run note"
                />
              </label>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            aria-label="Save recipe item"
            disabled={!form.lab_test_id || !form.consumable_id || Number(form.qty_per_test) <= 0}
            onClick={onSave}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save recipe item
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
        <button
          type="button"
          aria-label="Advanced recipe tools"
          aria-expanded={showAdvancedTools}
          onClick={() => setShowAdvancedTools(value => !value)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-[var(--color-text)]">Advanced recipe tools</span>
            <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Starter catalog and CSV import for large setup jobs.</span>
          </span>
          {showAdvancedTools ? <ChevronDown className="h-5 w-5" aria-hidden="true" /> : <ChevronRight className="h-5 w-5" aria-hidden="true" />}
        </button>
        {showAdvancedTools && (
          <div className="mt-4 space-y-4 border-t border-[var(--color-border)] pt-4">
            <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-violet-900">Starter reagent catalog</p>
                <p className="mt-1 text-xs text-violet-800">Load editable starter values, then review them against the hospital analyzer kit or SOP.</p>
              </div>
              <button
                type="button"
                onClick={onLoadStarterCatalog}
                className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-700"
              >
                Load starter reagent catalog
              </button>
            </div>
            <div className="rounded-xl border border-dashed border-[var(--color-border)] p-4">
              <div className="flex items-center gap-2">
                <FileUp className="h-4 w-4 text-violet-600" aria-hidden="true" />
                <p className="text-sm font-semibold text-[var(--color-text)]">Bulk recipe import</p>
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">For administrators setting up many tests. Existing ID-based CSV remains supported.</p>
              <textarea
                aria-label="Bulk recipe CSV"
                value={bulkText}
                onChange={event => onBulkTextChange(event.target.value)}
                rows={4}
                className={`${inputClass} mt-3 font-mono`}
                placeholder="lab_test_id,consumable_id,qty_per_test,mandatory,notes"
              />
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={!bulkText.trim()}
                  onClick={onBulkImport}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Import recipe items
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)]">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="font-semibold text-[var(--color-text)]">Configured recipe items</h3>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">A test can use more than one reagent, tube, film, kit or consumable.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Test</th>
                <th className="px-4 py-3 text-left font-medium">Recipe item</th>
                <th className="px-4 py-3 text-left font-medium">Quantity</th>
                <th className="px-4 py-3 text-left font-medium">Options</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-muted)]">Loading test recipes…</td></tr>
              ) : mappings.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-muted)]">No recipe items yet. Select a test and add the first reagent or consumable.</td></tr>
              ) : mappings.map(mapping => {
                const editing = editingId === mapping.id;
                const itemName = mapping.consumable_name || `Consumable ${mapping.consumable_id}`;
                return (
                  <tr key={mapping.id} className="align-top hover:bg-[var(--color-bg-secondary)]">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--color-text)]">{mapping.test_name || `Test ${mapping.lab_test_id}`}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{mapping.test_code || `ID ${mapping.lab_test_id}`}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--color-text)]">{itemName}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{mapping.consumable_code || `ID ${mapping.consumable_id}`}{mapping.category ? ` · ${mapping.category}` : ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <input
                          aria-label={`Quantity for ${itemName}`}
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          value={editForm.qty_per_test}
                          onChange={event => onEditFormChange({ qty_per_test: event.target.value })}
                          className={`${inputClass} w-28`}
                        />
                      ) : (
                        <span className="font-semibold text-[var(--color-text)]">{mapping.qty_per_test} {mapping.unit || ''}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={editForm.is_mandatory}
                              onChange={event => onEditFormChange({ is_mandatory: event.target.checked })}
                            />
                            Required
                          </label>
                          <input
                            aria-label={`Notes for ${itemName}`}
                            value={editForm.notes}
                            onChange={event => onEditFormChange({ notes: event.target.value })}
                            className={inputClass}
                            placeholder="Notes"
                          />
                        </div>
                      ) : (
                        <div className="text-xs text-[var(--color-text-muted)]">
                          <p>{Boolean(mapping.is_mandatory) ? 'Required' : 'Optional'}</p>
                          <p className="mt-1">{mapping.notes || 'No notes'}</p>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editing ? (
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => onUpdate(mapping.id)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">Save</button>
                          <button type="button" onClick={onCancelEdit} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            aria-label={`Edit ${itemName} recipe item`}
                            onClick={() => onStartEdit(mapping)}
                            className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-700"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${itemName} recipe item`}
                            onClick={() => onRemove(mapping.id)}
                            className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
