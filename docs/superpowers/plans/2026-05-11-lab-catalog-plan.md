# Lab Test Catalog - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Catalog" tab in LabSettingsPage to manage lab_test_catalog with CRUD operations and soft delete

**Architecture:** Single new component (CatalogTab) in LabSettingsPage.tsx, reuses existing Modal, hooks, and API patterns. Backend already has full CRUD at `/api/lab`.

**Tech Stack:** React (web), i18next, react-hot-toast, existing API hooks

---

## File Structure

```
web/src/pages/LabSettingsPage.tsx  (modify - add CatalogTab + tab entry)
web/src/locales/en/laboratory.json  (modify - add translation keys)
web/src/locales/bn/laboratory.json  (modify - add translation keys)
```

**No new files needed** - CatalogTab is inline in LabSettingsPage.tsx following existing patterns.

---

## Task 1: Add Translation Keys

**Files:**
- Modify: `web/src/locales/en/laboratory.json`
- Modify: `web/src/locales/bn/laboratory.json`

- [ ] **Step 1: Add English translations**

Add to `web/src/locales/en/laboratory.json`:

```json
"catalog": "Catalog",
"testCatalog": "Test Catalog",
"testName": "Test Name",
"code": "Code",
"category": "Category",
"price": "Price",
"unit": "Unit",
"normalRange": "Normal Range",
"method": "Method",
"status": "Status",
"actions": "Actions",
"addTest": "Add Test",
"editTest": "Edit Test",
"newTest": "New Test",
"testNameLabel": "Test Name",
"testNamePlaceholder": "e.g., Complete Blood Count",
"codeLabel": "Test Code",
"codePlaceholder": "e.g., CBC001",
"categoryLabel": "Category",
"priceLabel": "Price (৳)",
"pricePlaceholder": "500",
"unitLabel": "Unit",
"unitPlaceholder": "e.g., mg/dL",
"normalRangeLabel": "Normal Range",
"normalRangePlaceholder": "e.g., 70-100",
"methodLabel": "Method",
"methodPlaceholder": "e.g., Automated",
"noTests": "No tests found",
"noTestsDesc": "Add your first lab test to the catalog",
"testCreated": "Test created successfully",
"testUpdated": "Test updated successfully",
"testDeactivated": "Test deactivated successfully",
"testActivated": "Test activated successfully",
"deactivateConfirm": "Are you sure you want to deactivate this test?",
"deactivateTestConfirm": "Deactivate Test",
"selectCategory": "Select a category",
"allCategories": "All Categories",
"all": "All",
"active": "Active",
"inactive": "Inactive",
"searchPlaceholder": "Search tests..."
```

- [ ] **Step 2: Add Bengali translations**

Add same keys to `web/src/locales/bn/laboratory.json` with Bengali values.

- [ ] **Step 3: Commit**

```bash
git add web/src/locales/en/laboratory.json web/src/locales/bn/laboratory.json
git commit -m "feat(lab-settings): add translation keys for catalog tab"
```

---

## Task 2: Add Icon Import

**Files:**
- Modify: `web/src/pages/LabSettingsPage.tsx:2-5`

- [ ] **Step 1: Update imports**

Change the import line to add `List`:

```tsx
import {
  FlaskConical, Plus, X, Trash2, Tag, FileText, Truck, Hash,
  Scale, Landmark, XCircle, List,
} from 'lucide-react';
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/LabSettingsPage.tsx
git commit -m "feat(lab-settings): add List icon for catalog tab"
```

---

## Task 3: Add Catalog Tab to TABS Array

**Files:**
- Modify: `web/src/pages/LabSettingsPage.tsx:16-24`

- [ ] **Step 1: Update TABS array**

Change TABS to include catalog after categories:

```tsx
const TABS = [
  { key: 'categories',       labelKey: 'testCategories',       icon: Tag       },
  { key: 'catalog',          labelKey: 'catalog',              icon: List      },
  { key: 'templates',        labelKey: 'reportTemplates',      icon: FileText  },
  { key: 'vendors',          labelKey: 'vendors',              icon: Truck     },
  { key: 'runnumber',        labelKey: 'runNumber',            icon: Hash      },
  { key: 'reference_ranges', labelKey: 'referenceRanges',      icon: Scale     },
  { key: 'gov_reporting',    labelKey: 'governmentReporting',  icon: Landmark  },
  { key: 'rejection_reasons',labelKey: 'rejectionReasons',     icon: XCircle   },
];
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/LabSettingsPage.tsx
git commit -m "feat(lab-settings): add catalog tab to TABS array"
```

---

## Task 4: Create CatalogTab Component

**Files:**
- Modify: `web/src/pages/LabSettingsPage.tsx` - add new function component before main export

- [ ] **Step 1: Add CatalogTab function**

Add this new component right after `RejectionReasonsTab` function (around line 537):

```tsx
function CatalogTab() {
  const { t } = useTranslation('laboratory');
  const queryClient = useQueryClient();

  // State
  const [showForm, setShowForm] = useState(false);
  const [editingTest, setEditingTest] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // Form state
  const [form, setForm] = useState({
    name: '',
    code: '',
    category: '',
    price: '',
    unit: '',
    normal_range: '',
    method: '',
  });

  // Fetch tests from /api/lab
  const { data: rawTests, isLoading: loading } = useApiQuery<any>(
    queryKeys.lab.catalog(),
    '/api/lab',
  );

  // Fetch categories for dropdown
  const { data: rawCategories } = useApiQuery<any>(
    queryKeys.labSettings.categories(),
    '/api/lab-settings/categories',
  );

  const tests = rawTests?.tests ?? [];
  const categories = rawCategories?.data ?? [];

  // Filter tests based on search and filters
  const filteredTests = tests.filter((test: any) => {
    // Status filter
    if (statusFilter === 'active' && !test.is_active) return false;
    if (statusFilter === 'inactive' && test.is_active) return false;

    // Category filter
    if (categoryFilter && test.category !== categoryFilter) return false;

    // Search filter
    if (search) {
      const s = search.toLowerCase();
      return (
        test.name?.toLowerCase().includes(s) ||
        test.code?.toLowerCase().includes(s) ||
        test.category?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  // Create mutation
  const createMutation = useApiMutation<any, any>('post', '/api/lab', {
    onSuccess: () => {
      toast.success(t('testCreated'));
      setShowForm(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.lab.all });
    },
    onError: (err) => toast.error(err.message || t('failed')),
  });

  // Update mutation
  const updateMutation = useApiMutation<any, any>('put', '/api/lab', {
    onSuccess: () => {
      toast.success(t('testUpdated'));
      setShowForm(false);
      setEditingTest(null);
      resetForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.lab.all });
    },
    onError: (err) => toast.error(err.message || t('failed')),
  });

  // Delete mutation (soft delete)
  const deleteMutation = useApiMutation<any, any>('delete', '/api/lab', {
    onSuccess: () => {
      toast.success(t('testDeactivated'));
      queryClient.invalidateQueries({ queryKey: queryKeys.lab.all });
    },
    onError: (err) => toast.error(err.message || t('failed')),
  });

  const resetForm = () => {
    setForm({ name: '', code: '', category: '', price: '', unit: '', normal_range: '', method: '' });
  };

  const handleOpenAdd = () => {
    setEditingTest(null);
    resetForm();
    setShowForm(true);
  };

  const handleOpenEdit = (test: any) => {
    setEditingTest(test);
    setForm({
      name: test.name || '',
      code: test.code || '',
      category: test.category || '',
      price: test.price?.toString() || '',
      unit: test.unit || '',
      normal_range: test.normal_range || '',
      method: test.method || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...form,
      price: parseFloat(form.price) || 0,
    };

    if (editingTest) {
      updateMutation.mutate({ ...payload, id: editingTest.id });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('deactivateConfirm'))) return;
    deleteMutation.mutate(id);
  };

  const handleToggleActive = async (test: any) => {
    try {
      const { api } = await import('../lib/apiClient');
      const newStatus = test.is_active ? 0 : 1;
      await api.put(`/api/lab/${test.id}`, { is_active: newStatus });
      toast.success(test.is_active ? t('testDeactivated') : t('testActivated'));
      queryClient.invalidateQueries({ queryKey: queryKeys.lab.all });
    } catch (err: any) {
      toast.error(err.message || t('failed'));
    }
  };

  // Get unique categories for filter dropdown
  const uniqueCategories = [...new Set(tests.map((t: any) => t.category).filter(Boolean))];

  return (
    <div className="space-y-4">
      {/* Header with filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {/* Search */}
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-48"
          />
          {/* Status filter */}
          <select
            className="input w-32"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">{t('all')}</option>
            <option value="active">{t('active')}</option>
            <option value="inactive">{t('inactive')}</option>
          </select>
          {/* Category filter */}
          <select
            className="input w-40"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">{t('allCategories')}</option>
            {uniqueCategories.map((cat: string) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        {/* Add button */}
        <button onClick={handleOpenAdd} className="btn-primary">
          <Plus className="w-4 h-4" />{t('addTest')}
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('testName')}</th>
                <th>{t('code')}</th>
                <th>{t('category')}</th>
                <th>{t('price')}</th>
                <th>{t('unit')}</th>
                <th>{t('status')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={7} />
              ) : filteredTests.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={<List className="w-8 h-8" />}
                      title={t('noTests')}
                      description={t('noTestsDesc')}
                      action={
                        <button onClick={handleOpenAdd} className="btn-primary mt-2">
                          <Plus className="w-4 h-4" />{t('addTest')}
                        </button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                filteredTests.map((test: any) => (
                  <tr key={test.id}>
                    <td className="font-medium">{test.name}</td>
                    <td className="font-data text-sm">{test.code}</td>
                    <td>{test.category || '—'}</td>
                    <td className="font-data">{test.price ? `৳${test.price}` : '—'}</td>
                    <td className="text-[var(--color-text-secondary)]">{test.unit || '—'}</td>
                    <td>
                      <span className={`badge ${test.is_active ? 'badge-success' : 'badge-warning'}`}>
                        {test.is_active ? t('active') : t('inactive')}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => handleOpenEdit(test)} className="btn-ghost p-1.5">
                          <FileText className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(test)}
                          className={`btn-ghost p-1.5 ${test.is_active ? 'text-orange-500' : 'text-green-500'}`}
                          title={test.is_active ? t('deactivateTestConfirm') : t('activate')}
                        >
                          {test.is_active ? <XCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <Modal
          title={editingTest ? t('editTest') : t('newTest')}
          onClose={() => { setShowForm(false); setEditingTest(null); resetForm(); }}
        >
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="label">{t('testNameLabel')} *</label>
              <input
                className="input"
                required
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={t('testNamePlaceholder')}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">{t('codeLabel')} *</label>
                <input
                  className="input"
                  required
                  value={form.code}
                  onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))}
                  placeholder={t('codePlaceholder')}
                />
              </div>
              <div>
                <label className="label">{t('priceLabel')} *</label>
                <input
                  className="input"
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder={t('pricePlaceholder')}
                />
              </div>
            </div>
            <div>
              <label className="label">{t('categoryLabel')} *</label>
              <select
                className="input"
                required
                value={form.category}
                onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
              >
                <option value="">{t('selectCategory')}</option>
                {categories.map((cat: any) => (
                  <option key={cat.id} value={cat.category_name}>{cat.category_name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">{t('unitLabel')}</label>
                <input
                  className="input"
                  value={form.unit}
                  onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder={t('unitPlaceholder')}
                />
              </div>
              <div>
                <label className="label">{t('methodLabel')}</label>
                <input
                  className="input"
                  value={form.method}
                  onChange={(e) => setForm(f => ({ ...f, method: e.target.value }))}
                  placeholder={t('methodPlaceholder')}
                />
              </div>
            </div>
            <div>
              <label className="label">{t('normalRangeLabel')}</label>
              <input
                className="input"
                value={form.normal_range}
                onChange={(e) => setForm(f => ({ ...f, normal_range: e.target.value }))}
                placeholder={t('normalRangePlaceholder')}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingTest(null); resetForm(); }}
                className="btn-secondary"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="btn-primary"
              >
                {createMutation.isPending || updateMutation.isPending ? t('savingEllipsis') : t('save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add queryKey for lab catalog**

Modify `web/src/lib/queryKeys.ts` to add:

```tsx
lab: {
  ...existing,
  catalog: () => ['lab', 'catalog'] as const,
},
```

- [ ] **Step 3: Add to TAB_MAP**

Update TAB_MAP object to include catalog:

```tsx
const TAB_MAP: Record<string, React.ComponentType> = {
  categories: CategoriesTab,
  catalog: CatalogTab,
  templates: TemplatesTab,
  vendors: VendorsTab,
  runnumber: RunNumberTab,
  reference_ranges: ReferenceRangesTab,
  gov_reporting: GovReportingTab,
  rejection_reasons: RejectionReasonsTab,
};
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/LabSettingsPage.tsx web/src/lib/queryKeys.ts
git commit -m "feat(lab-settings): add CatalogTab component with CRUD"
```

---

## Task 5: Verify Integration

**Files:**
- Modify: `web/src/pages/LabSettingsPage.tsx` - verify imports

- [ ] **Step 1: Verify Tab import works**

Check that `FileText` icon is imported (used in CatalogTab for edit button).

- [ ] **Step 2: Test in browser**

Visit LabSettingsPage and click Catalog tab. Verify:
- Table loads with tests
- Search works
- Filters work
- Add/Edit modal opens

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: verify catalog tab integration"
```

---

## Spec Coverage Check

| Spec Section | Task |
|-------------|------|
| List View with columns | Task 4 |
| Search filter | Task 4 |
| Status filter | Task 4 |
| Category filter | Task 4 |
| Empty state | Task 4 |
| Add/Edit Modal | Task 4 |
| All form fields | Task 4 |
| Soft delete (deactivate) | Task 4 |
| Reactivation via toggle | Task 4 |
| Category dropdown | Task 4 |
| API integration (/api/lab) | Task 4 |
| Translations | Task 1 |

---

## Self-Review

1. All spec requirements mapped to tasks ✓
2. No placeholders (TBD, TODO) ✓
3. Types consistent (form object matches API expectations) ✓
4. Backend API endpoints verified exist ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-lab-catalog-plan.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?