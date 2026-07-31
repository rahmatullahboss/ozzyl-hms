import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle, XCircle, RefreshCw, Loader2, ClipboardList, Trash2
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';

interface PendingGRN {
  id: number; grn_no: string; grn_date: string;
  total_amount: number; supplier_name: string; created_by_name: string;
  approval_status: string;
}
interface PendingWriteOff {
  id: number; write_off_no: string; write_off_date: string;
  total_value: number; reason: string; created_by_name: string;
  approval_status: string;
}

const fmt = (paisa: number) => `৳${(paisa / 100).toFixed(2)}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' });

function ApprovalDialog({
  title, onConfirm, onCancel
}: {
  title: string;
  onConfirm: (action: 'approve' | 'reject', notes: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('pharmacy');
  const [action, setAction] = useState<'approve' | 'reject'>('approve');
  const [notes, setNotes] = useState('');
  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h2 className="modal-title">Review: {title}</h2>
        </div>
        <div className="modal-body space-y-4">
          <div className="flex gap-3">
            <button
              className={`btn flex-1 ${action === 'approve' ? 'btn-success' : 'btn-ghost'}`}
              onClick={() => setAction('approve')}>
              <CheckCircle className="h-4 w-4 mr-1" /> Approve
            </button>
            <button
              className={`btn flex-1 ${action === 'reject' ? 'btn-error' : 'btn-ghost'}`}
              onClick={() => setAction('reject')}>
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </button>
          </div>
          <div>
            <label className="form-label">{t("pharmacy.notes")}</label>
            <textarea className="form-control" rows={3}
              placeholder={action === 'reject' ? 'Rejection reason (required for rejection)' : 'Optional approval notes…'}
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button
              className={`btn ${action === 'approve' ? 'btn-success' : 'btn-error'}`}
              onClick={() => {
                if (action === 'reject' && !notes.trim()) {
                  toast.error(t('pharmacy.please_provide_a_rejection_reason'));
                  return;
                }
                onConfirm(action, notes);
              }}>
              Confirm {action === 'approve' ? 'Approval' : 'Rejection'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalQueuePage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('pharmacy');
  const [grns, setGrns] = useState<PendingGRN[]>([]);
  const [writeOffs, setWriteOffs] = useState<PendingWriteOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ type: 'grn' | 'writeoff'; id: number; label: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'grn' | 'writeoff'>('grn');

  const token = () => localStorage.getItem('hms_token');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [grnRes, woRes] = await Promise.all([
        axios.get('/api/pharmacy/grn/pending-approval',        { headers: { Authorization: `Bearer ${token()}` } }),
        axios.get('/api/pharmacy/write-offs/pending-approval', { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      setGrns(grnRes.data.data ?? []);
      setWriteOffs(woRes.data.data ?? []);
    } catch { toast.error(t('pharmacy.failed_to_load_pending_approvals')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprovalConfirm = async (action: 'approve' | 'reject', notes: string) => {
    if (!dialog) return;
    try {
      const url = dialog.type === 'grn'
        ? `/api/pharmacy/grn/${dialog.id}/approve`
        : `/api/pharmacy/write-offs/${dialog.id}/approve`;
      await axios.put(url, { action, notes }, { headers: { Authorization: `Bearer ${token()}` } });
      toast.success(t('pharmacy.approvalActionSuccess', { type: dialog.type === 'grn' ? 'GRN' : 'Write-off', action }));
      setDialog(null);
      load();
    } catch { toast.error(t('pharmacy.failed_to_update_approval_status')); }
  };

  const totalPending = grns.length + writeOffs.length;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-lg mx-auto">

        <div className="page-header">
          <div>
            <h1 className="page-title">
              Approval Queue
              {totalPending > 0 && (
                <span className="ml-2 badge badge-error">{totalPending}</span>
              )}
            </h1>
            <p className="page-subtitle">Pending GRN and write-off approvals</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="tabs tabs-bordered">
          <button
            className={`tab ${activeTab === 'grn' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('grn')}>
            GRNs
            {grns.length > 0 && <span className="ml-2 badge badge-warning badge-sm">{grns.length}</span>}
          </button>
          <button
            className={`tab ${activeTab === 'writeoff' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('writeoff')}>
            Write-offs
            {writeOffs.length > 0 && <span className="ml-2 badge badge-warning badge-sm">{writeOffs.length}</span>}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* GRNs */}
            {activeTab === 'grn' && (
              <div className="card">
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>GRN No.</th>
                        <th>Date</th>
                        <th>Supplier</th>
                        <th>Created By</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grns.length === 0 && (
                        <tr><td colSpan={6}>
                          <div className="flex flex-col items-center py-10 text-gray-400">
                            <ClipboardList className="h-8 w-8 mb-2 opacity-30" />
                            <p>No GRNs pending approval</p>
                          </div>
                        </td></tr>
                      )}
                      {grns.map(g => (
                        <tr key={g.id}>
                          <td className="font-mono text-sm">{g.grn_no}</td>
                          <td className="text-sm">{fmtDate(g.grn_date)}</td>
                          <td className="text-sm">{g.supplier_name}</td>
                          <td className="text-sm text-gray-500">{g.created_by_name}</td>
                          <td className="text-right font-semibold">{fmt(g.total_amount)}</td>
                          <td>
                            <div className="flex justify-end gap-1">
                              <button
                                className="btn btn-xs btn-success"
                                onClick={() => setDialog({ type: 'grn', id: g.id, label: g.grn_no })}>
                                Review
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Write-offs */}
            {activeTab === 'writeoff' && (
              <div className="card">
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Write-off No.</th>
                        <th>Date</th>
                        <th>Reason</th>
                        <th>Created By</th>
                        <th className="text-right">Value</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {writeOffs.length === 0 && (
                        <tr><td colSpan={6}>
                          <div className="flex flex-col items-center py-10 text-gray-400">
                            <Trash2 className="h-8 w-8 mb-2 opacity-30" />
                            <p>No write-offs pending approval</p>
                          </div>
                        </td></tr>
                      )}
                      {writeOffs.map(w => (
                        <tr key={w.id}>
                          <td className="font-mono text-sm">{w.write_off_no}</td>
                          <td className="text-sm">{fmtDate(w.write_off_date)}</td>
                          <td className="text-sm max-w-xs truncate">{w.reason}</td>
                          <td className="text-sm text-gray-500">{w.created_by_name}</td>
                          <td className="text-right font-semibold text-red-600">{fmt(w.total_value)}</td>
                          <td>
                            <div className="flex justify-end gap-1">
                              <button
                                className="btn btn-xs btn-success"
                                onClick={() => setDialog({ type: 'writeoff', id: w.id, label: w.write_off_no })}>
                                Review
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Approval Dialog */}
      {dialog && (
        <ApprovalDialog
          title={dialog.label}
          onConfirm={handleApprovalConfirm}
          onCancel={() => setDialog(null)}
        />
      )}
    </DashboardLayout>
  );
}
