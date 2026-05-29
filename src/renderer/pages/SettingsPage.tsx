import { useState, useEffect } from 'react';
import { useSyncStore } from '../stores/sync.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';
import { RefreshCw, Database, Cloud } from 'lucide-react';

export function SettingsPage() {
  const syncStore = useSyncStore();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (syncStore.config) {
      setUrl(syncStore.config.supabaseUrl || '');
      setAnonKey(syncStore.config.supabaseAnonKey || '');
    }
  }, [syncStore.config]);

  const handleSave = async () => {
    if (!url || !anonKey) { toast.error('Please fill in both fields'); return; }
    setSaving(true);
    const success = await syncStore.setConfig(url, anonKey);
    setSaving(false);
    if (success) { toast.success('Supabase connected successfully'); }
    else { toast.error('Failed to connect to Supabase'); }
  };

  const handleForceSync = async () => {
    await syncStore.forceSync();
    toast.success('Sync completed');
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="glass-panel rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Cloud size={20} className="text-primary-400" />
          <h3 className="text-base font-semibold text-surface-200">Supabase Configuration</h3>
        </div>
        <div className="space-y-4">
          <Input label="Supabase URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-project.supabase.co" />
          <Input label="Anon Key" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIs..." type="password" />
          <Button onClick={handleSave} loading={saving}>Save & Connect</Button>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Database size={20} className="text-primary-400" />
          <h3 className="text-base font-semibold text-surface-200">Sync Status</h3>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-surface-400">Status</span><span className="text-surface-200 capitalize">{syncStore.status}</span></div>
          <div className="flex justify-between"><span className="text-surface-400">Last Sync</span><span className="text-surface-200">{syncStore.lastSyncAt ? new Date(syncStore.lastSyncAt).toLocaleString() : 'Never'}</span></div>
          <div className="flex justify-between"><span className="text-surface-400">Pending Changes</span><span className="text-surface-200">{syncStore.pendingChanges}</span></div>
        </div>
        <Button variant="secondary" onClick={handleForceSync} className="mt-4"><RefreshCw size={14} /> Force Sync</Button>
      </div>
    </div>
  );
}
