import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { usePartsStore } from '../stores/parts.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import type { PartsCatalogItem, PartsTransaction } from '../../shared/types';

export function PartsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getById, getTransactions } = usePartsStore();
  const [part, setPart] = useState<PartsCatalogItem | null>(null);
  const [transactions, setTransactions] = useState<PartsTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setLoading(false); setError('No part was specified.'); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const p = await getById(id);
        if (cancelled) return;
        if (!p) { setError('This part could not be found. It may have been deleted.'); return; }
        setPart(p);
        const tx = await getTransactions(id).catch(() => [] as PartsTransaction[]);
        if (!cancelled) setTransactions(tx);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load this part.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, getById, getTransactions]);

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;
  if (error || !part) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/parts')}><ArrowLeft size={16} /> Back</Button>
        <div className="glass-panel rounded-xl p-8 text-center">
          <p className="text-surface-300">{error || 'Part not found.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/parts')}><ArrowLeft size={16} /> Back</Button>
        <div><h2 className="text-lg font-semibold text-surface-100">{part.name}</h2><p className="text-sm text-surface-500">{part.part_code}</p></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-surface-300">Part Details</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-surface-500">Category</span><span className="text-surface-200 capitalize">{part.category}</span>
            <span className="text-surface-500">Unit Cost</span><span className="text-surface-200">P{part.unit_cost.toLocaleString()}</span>
            <span className="text-surface-500">Stock</span><span className="text-surface-200">{part.qty_on_hand ?? 0}</span>
            <span className="text-surface-500">Reorder Point</span><span className="text-surface-200">{part.reorder_point ?? 0}</span>
            <span className="text-surface-500">Vendor</span><span className="text-surface-200">{part.vendor_name || '-'}</span>
          </div>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <h3 className="text-sm font-semibold text-surface-300 mb-4">Transaction History</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {transactions.length === 0 ? <p className="text-sm text-surface-500">No transactions</p> : transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between text-sm border-b border-surface-800/50 pb-2">
                <div>
                  <Badge variant={tx.transaction_type === 'receive' ? 'success' : tx.transaction_type === 'consume' ? 'danger' : 'default'}>{tx.transaction_type}</Badge>
                  <span className="ml-2 text-surface-300">{tx.notes || ''}</span>
                </div>
                <span className={tx.quantity > 0 ? 'text-success-400' : 'text-danger-400'}>{tx.quantity > 0 ? '+' : ''}{tx.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
