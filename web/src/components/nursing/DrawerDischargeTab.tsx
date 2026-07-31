import { useState, useCallback, useEffect } from 'react';
import { ClipboardCheck, Plus, X, RefreshCw, CheckCircle, Circle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import type { BedGridItem } from './WardBedGrid';

interface DischargeChecklistItem {
  id: number;
  admission_id: number;
  item_name: string;
  category?: string;
  is_completed: boolean;
  completed_at?: string;
  completed_by?: number;
  notes?: string;
  created_at: string;
}

interface DrawerDischargeTabProps {
  bed: BedGridItem;
}

const DEFAULT_CHECKLIST_ITEMS = [
  { name: 'Doctor clearance obtained', category: 'medical' },
  { name: 'Medications dispensed', category: 'pharmacy' },
  { name: 'Patient education provided', category: 'education' },
  { name: 'Follow-up appointment scheduled', category: 'scheduling' },
  { name: 'Discharge summary completed', category: 'documentation' },
  { name: 'Belongings returned', category: 'administrative' },
  { name: 'Bill settled', category: 'billing' },
];

export default function DrawerDischargeTab({ bed }: DrawerDischargeTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const [items, setItems] = useState<DischargeChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');

  const fetchItems = useCallback(async () => {
    if (!bed.admission_id) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ admission_id: String(bed.admission_id) });
      const data = await apiFetch<{ Results?: DischargeChecklistItem[] }>(`/api/discharge-planning/checklist?${qs}`);
      setItems(data.Results ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [bed.admission_id]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleToggle = async (item: DischargeChecklistItem) => {
    try {
      await apiFetch(`/api/discharge-planning/checklist/${item.id}`, {
        method: 'PUT',
        body: { is_completed: !item.is_completed },
      });
      fetchItems();
    } catch {
      toast.error(t('drawer.discharge.updateFailed', { defaultValue: 'Failed to update' }));
    }
  };

  const handleAddItem = async () => {
    if (!newItemName.trim()) {
      toast.error(t('drawer.discharge.nameRequired', { defaultValue: 'Item name required' }));
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/discharge-planning/checklist', {
        method: 'POST',
        body: {
          admission_id: bed.admission_id,
          item_name: newItemName.trim(),
          category: newItemCategory || undefined,
        },
      });
      toast.success(t('drawer.discharge.added', { defaultValue: 'Checklist item added' }));
      setNewItemName('');
      setNewItemCategory('');
      setShowForm(false);
      fetchItems();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('drawer.discharge.failed', { defaultValue: 'Failed to add item' }));
    } finally {
      setSaving(false);
    }
  };

  const handleAddDefaults = async () => {
    setSaving(true);
    try {
      for (const def of DEFAULT_CHECKLIST_ITEMS) {
        const exists = items.some(i => i.item_name.toLowerCase() === def.name.toLowerCase());
        if (!exists) {
          await apiFetch('/api/discharge-planning/checklist', {
            method: 'POST',
            body: {
              admission_id: bed.admission_id,
              item_name: def.name,
              category: def.category,
            },
          });
        }
      }
      toast.success(t('drawer.discharge.defaultsAdded', { defaultValue: 'Default checklist added' }));
      fetchItems();
    } catch {
      toast.error(t('drawer.discharge.failed', { defaultValue: 'Failed to add items' }));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('common:confirmDelete', { defaultValue: 'Delete this record?' }))) return;
    try {
      await apiFetch(`/api/discharge-planning/checklist/${id}`, { method: 'DELETE' });
      toast.success(t('common:deleted', { defaultValue: 'Deleted' }));
      fetchItems();
    } catch {
      toast.error(t('common:deleteFailed', { defaultValue: 'Delete failed' }));
    }
  };

  const completedCount = items.filter(i => i.is_completed).length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-4" data-testid="discharge-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t('drawer.discharge.title', { defaultValue: 'Discharge Checklist' })}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={fetchItems} className="btn-ghost p-1.5" aria-label="Refresh" data-testid="discharge-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-ghost p-1.5 text-[var(--color-primary)]"
            aria-label="Add item"
            data-testid="add-discharge-item-btn"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      {totalCount > 0 && (
        <div data-testid="discharge-progress">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-[var(--color-text-muted)]">
              {completedCount}/{totalCount} {t('drawer.discharge.completed', { defaultValue: 'completed' })}
            </span>
            <span className={`text-xs font-bold ${progressPercent === 100 ? 'text-emerald-600' : 'text-[var(--color-text)]'}`}>
              {progressPercent}%
            </span>
          </div>
          <div className="w-full bg-[var(--color-border-light)] rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${progressPercent === 100 ? 'bg-emerald-500' : 'bg-[var(--color-primary)]'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {progressPercent === 100 && (
            <div className="flex items-center gap-1.5 mt-2 text-emerald-600" data-testid="discharge-complete-badge">
              <AlertCircle className="w-4 h-4" />
              <span className="text-xs font-medium">{t('drawer.discharge.readyForDischarge', { defaultValue: 'Ready for discharge clearance' })}</span>
            </div>
          )}
        </div>
      )}

      {/* Quick Add Defaults */}
      {totalCount === 0 && !loading && (
        <button
          onClick={handleAddDefaults}
          disabled={saving}
          className="w-full btn-secondary text-xs py-2.5"
          data-testid="add-defaults-btn"
        >
          <ClipboardCheck className="w-4 h-4" />
          {t('drawer.discharge.addDefaults', { defaultValue: 'Add Default Checklist' })}
        </button>
      )}

      {/* Add Item Form */}
      {showForm && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30 space-y-3" data-testid="discharge-form">
          <div>
            <label className="label text-xs">{t('drawer.discharge.itemName', { defaultValue: 'Item Name' })} *</label>
            <input
              type="text"
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              className="input text-sm"
              placeholder={t('drawer.discharge.itemPlaceholder', { defaultValue: 'e.g., Insurance form signed' })}
              data-testid="discharge-item-name-input"
            />
          </div>
          <div>
            <label className="label text-xs">{t('drawer.discharge.category', { defaultValue: 'Category' })}</label>
            <select
              value={newItemCategory}
              onChange={e => setNewItemCategory(e.target.value)}
              className="input text-sm"
              data-testid="discharge-category-select"
            >
              <option value="">{t('common:select', { defaultValue: 'Select...' })}</option>
              <option value="medical">{t('drawer.discharge.categories.medical', { defaultValue: 'Medical' })}</option>
              <option value="pharmacy">{t('drawer.discharge.categories.pharmacy', { defaultValue: 'Pharmacy' })}</option>
              <option value="education">{t('drawer.discharge.categories.education', { defaultValue: 'Education' })}</option>
              <option value="scheduling">{t('drawer.discharge.categories.scheduling', { defaultValue: 'Scheduling' })}</option>
              <option value="documentation">{t('drawer.discharge.categories.documentation', { defaultValue: 'Documentation' })}</option>
              <option value="administrative">{t('drawer.discharge.categories.administrative', { defaultValue: 'Administrative' })}</option>
              <option value="billing">{t('drawer.discharge.categories.billing', { defaultValue: 'Billing' })}</option>
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setNewItemName(''); setNewItemCategory(''); }} className="btn-secondary text-xs">
              {t('common:cancel')}
            </button>
            <button
              onClick={handleAddItem}
              disabled={saving || !newItemName.trim()}
              className="btn-primary text-xs"
              data-testid="save-discharge-item-btn"
            >
              {saving ? t('common:saving') : t('common:add')}
            </button>
          </div>
        </div>
      )}

      {/* Checklist Items */}
      <div className="space-y-1.5" data-testid="discharge-list">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-12 w-full rounded-lg" />
          ))
        ) : items.length === 0 ? (
          <div className="text-center py-6 text-[var(--color-text-muted)]" data-testid="discharge-empty">
            <ClipboardCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('drawer.discharge.noItems', { defaultValue: 'No discharge checklist items' })}</p>
          </div>
        ) : (
          items.map(item => (
            <div
              key={item.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors group ${
                item.is_completed
                  ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/20'
                  : 'border-[var(--color-border)] hover:bg-[var(--color-border-light)]/20'
              }`}
              data-testid="discharge-item"
            >
              <button
                onClick={() => handleToggle(item)}
                className="flex-shrink-0"
                data-testid="toggle-discharge-item"
              >
                {item.is_completed ? (
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                ) : (
                  <Circle className="w-5 h-5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)]" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.is_completed ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
                  {item.item_name}
                </p>
                {item.category && (
                  <span className="inline-block mt-0.5 px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-border-light)] text-[var(--color-text-muted)]">
                    {item.category}
                  </span>
                )}
              </div>
              {item.is_completed && item.completed_at && (
                <span className="text-[10px] text-emerald-600 flex-shrink-0">
                  {new Date(item.completed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button
                onClick={() => handleDelete(item.id)}
                className="btn-ghost p-1 text-red-500 opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                title={t('common:delete')}
                data-testid="delete-discharge-item-btn"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
