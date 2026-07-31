import { useState } from 'react';
import { Check, X, Download } from 'lucide-react';

export interface BulkAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  variant?: 'primary' | 'danger' | 'secondary';
  confirmMessage?: string;
}

interface BulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  actions: BulkAction[];
  onAction: (actionId: string) => void;
}

const DEFAULT_ACTIONS: BulkAction[] = [
  { id: 'approve', label: 'Approve Selected', icon: <Check className="w-4 h-4" />, variant: 'primary', confirmMessage: 'Approve all selected items?' },
  { id: 'reject', label: 'Reject Selected', icon: <X className="w-4 h-4" />, variant: 'danger', confirmMessage: 'Reject all selected items?' },
  { id: 'export', label: 'Export Selected', icon: <Download className="w-4 h-4" />, variant: 'secondary' },
];

export default function BulkActionsBar({ selectedCount, onClearSelection, actions = DEFAULT_ACTIONS, onAction }: BulkActionsBarProps) {
  const [showConfirm, setShowConfirm] = useState<string | null>(null);

  if (selectedCount === 0) return null;

  const handleAction = (action: BulkAction) => {
    if (action.confirmMessage) {
      setShowConfirm(action.id);
    } else {
      onAction(action.id);
    }
  };

  const confirmAction = () => {
    if (showConfirm) {
      onAction(showConfirm);
      setShowConfirm(null);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4">
      <span className="text-sm font-medium">
        {selectedCount} selected
      </span>
      <button
        onClick={onClearSelection}
        className="text-xs text-gray-400 hover:text-white transition-colors"
      >
        Clear
      </button>
      <div className="w-px h-6 bg-gray-700" />
      {actions.map(action => (
        <button
          key={action.id}
          onClick={() => handleAction(action)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            action.variant === 'primary' ? 'bg-emerald-600 hover:bg-emerald-700' :
            action.variant === 'danger' ? 'bg-red-600 hover:bg-red-700' :
            'bg-gray-700 hover:bg-gray-600'
          }`}
        >
          {action.icon}
          {action.label}
        </button>
      ))}

      {/* Confirm Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full mx-4 shadow-xl">
            <p className="text-gray-900 font-medium mb-4">
              {actions.find(a => a.id === showConfirm)?.confirmMessage ?? 'Are you sure?'}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowConfirm(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={confirmAction} className={`btn-primary text-sm ${showConfirm === 'reject' ? 'bg-red-600 hover:bg-red-700' : ''}`}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Checkbox for table rows to integrate with BulkActionsBar */
export function BulkCheckbox({ checked, onChange, indeterminate = false }: { checked: boolean; onChange: (checked: boolean) => void; indeterminate?: boolean }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={el => { if (el) el.indeterminate = indeterminate; }}
      onChange={e => onChange(e.target.checked)}
      className="rounded border-gray-300"
    />
  );
}
