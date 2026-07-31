import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface GRN { id: number; grn_no: string; received_date: string; supplier_name?: string; po_no?: string; total_amount: number; is_cancelled: number; }

export default function GoodsReceiptList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [grns, setGRNs] = useState<GRN[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/pharmacy/goods-receipts', { headers: { Authorization: `Bearer ${token}` } });
      setGRNs(data.goodsReceipts ?? []);
    } catch { setGRNs([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">{t('goodsReceipts', { defaultValue: 'Goods Receipts (GRN)' })}</h1></div>
          <Link to={`${base}/pharmacy/grn/new`}><button className="btn-primary"><Plus className="w-4 h-4" /> Receive Goods</button></Link>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>GRN #</th><th>Date</th><th>Supplier</th><th>PO #</th><th className="text-right">Amount (৳)</th><th>Status</th></tr></thead>
              <tbody>
                {loading ? ([...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : grns.length === 0 ? (<tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">No goods receipts</td></tr>)
                : grns.map(g => (
                  <tr key={g.id}>
                    <td className="font-medium font-mono text-sm">{g.grn_no}</td>
                    <td className="text-[var(--color-text-secondary)]">{new Date(g.received_date).toLocaleDateString()}</td>
                    <td>{g.supplier_name || '—'}</td>
                    <td className="font-mono text-xs">{g.po_no || '—'}</td>
                    <td className="text-right font-data">৳{((g.total_amount ?? 0) / 100).toLocaleString()}</td>
                    <td><span className={`badge ${g.is_cancelled ? 'badge-danger' : 'badge-success'}`}>{g.is_cancelled ? 'Cancelled' : 'Received'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
