import { useState, useEffect } from 'react';
import { useSyncStore } from '../stores/sync.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { useToast } from '../hooks';
import { RefreshCw, Database, Cloud, Users, Plus, Edit2, Trash2, HardDrive, AlertTriangle } from 'lucide-react';
import { ipcInvoke } from '../lib/ipc';
import type { User } from '../../shared/types';
import { DEPARTMENT_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';

const ROLES = [
  'admin', 'equipment_manager', 'accounts_manager', 'billing_user', 'payroll_user',
  'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk',
  'camera_personnel', 'lighting_personnel', 'viewer',
] as const;

const ROLE_LABELS: Record<string, string> = {
  camera_personnel: 'Camera Dept. Personnel',
  lighting_personnel: 'Lighting Dept. Personnel',
};

const roleLabel = (role: string) => ROLE_LABELS[role] || role.replace(/_/g, ' ');

export function SettingsPage() {
  const syncStore = useSyncStore();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [saving, setSaving] = useState(false);

  // Google Drive auto-archive config
  interface GDriveConfig {
    client_id: string;
    folder_id: string;
    account_email: string;
    has_client_secret: boolean;
    has_refresh_token: boolean;
    token_expiry: string;
  }
  const [gdrive, setGdrive] = useState<GDriveConfig | null>(null);
  const [gdriveClientId, setGdriveClientId] = useState('');
  const [gdriveClientSecret, setGdriveClientSecret] = useState('');
  const [gdriveFolderId, setGdriveFolderId] = useState('');
  const [savingGdrive, setSavingGdrive] = useState(false);
  const [connectingGdrive, setConnectingGdrive] = useState(false);
  const [testingGdrive, setTestingGdrive] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState({
    username: '', password: '', full_name: '', email: '',
    role: 'viewer' as string, department: '' as string,
  });
  const [savingUser, setSavingUser] = useState(false);

  useEffect(() => {
    if (syncStore.config) {
      setUrl(syncStore.config.supabaseUrl || '');
      setAnonKey(syncStore.config.supabaseAnonKey || '');
    }
  }, [syncStore.config]);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const result = await ipcInvoke<User[]>('db:users:getAll');
      setUsers(result || []);
    } catch { /* ignore */ }
    setLoadingUsers(false);
  };

  useEffect(() => { loadUsers(); }, []);

  const loadGdrive = async () => {
    try {
      const cfg = await ipcInvoke<GDriveConfig | null>('gdrive:config:get');
      setGdrive(cfg);
      setGdriveClientId(cfg?.client_id || '');
      setGdriveFolderId(cfg?.folder_id || '');
    } catch { /* ignore */ }
  };

  useEffect(() => { loadGdrive(); }, []);

  const handleSaveGdrive = async () => {
    if (!gdriveClientId.trim()) { toast.error('Client ID is required'); return; }
    setSavingGdrive(true);
    try {
      const payload: Record<string, any> = {
        client_id: gdriveClientId.trim(),
        folder_id: gdriveFolderId.trim(),
      };
      // Only send the secret when the operator typed a new one, so re-saving
      // does not wipe the stored secret.
      if (gdriveClientSecret) payload.client_secret = gdriveClientSecret;
      await ipcInvoke('gdrive:config:set', payload);
      setGdriveClientSecret('');
      await loadGdrive();
      toast.success('Google Drive credentials saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save Google Drive credentials');
    }
    setSavingGdrive(false);
  };

  const handleConnectGdrive = async () => {
    setConnectingGdrive(true);
    try {
      const cfg = await ipcInvoke<GDriveConfig | null>('gdrive:connect');
      setGdrive(cfg);
      toast.success(cfg?.account_email ? `Connected as ${cfg.account_email}` : 'Google Drive connected');
    } catch (err: any) {
      toast.error(err.message || 'Failed to connect Google Drive');
    }
    setConnectingGdrive(false);
  };

  const handleTestGdrive = async () => {
    setTestingGdrive(true);
    try {
      const res = await ipcInvoke<{
        ok: boolean;
        email: string;
        folderId: string;
        folderName: string;
        usedFallback: boolean;
      }>('gdrive:test');
      if (res?.usedFallback) {
        toast.error(
          `Drive works, but the configured folder is not writable — archives will go to "My Drive" (${res.folderName}). Check the Folder ID and that ${res.email || 'the account'} has edit access.`,
        );
      } else {
        toast.success(
          `Success! Test file written to "${res.folderName}"${res.email ? ` as ${res.email}` : ''}. Archiving is ready.`,
        );
      }
    } catch (err: any) {
      toast.error(err.message || 'Google Drive test failed');
    }
    setTestingGdrive(false);
  };

  const handleDisconnectGdrive = async () => {
    try {
      await ipcInvoke('gdrive:disconnect');
      await loadGdrive();
      toast.success('Google Drive disconnected');
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect Google Drive');
    }
  };

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
    if (useSyncStore.getState().schemaOutdated) {
      toast.error('Sync blocked: the cloud database needs migration. See the warning below.');
    } else {
      toast.success('Sync completed');
    }
  };

  const openAddUser = () => {
    setEditingUser(null);
    setUserForm({ username: '', password: '', full_name: '', email: '', role: 'viewer', department: '' });
    setShowUserModal(true);
  };

  const openEditUser = (user: User) => {
    setEditingUser(user);
    setUserForm({
      username: user.username,
      password: '',
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      department: user.department || '',
    });
    setShowUserModal(true);
  };

  const handleSaveUser = async () => {
    if (!userForm.full_name || !userForm.role) { toast.error('Name and role are required'); return; }
    setSavingUser(true);
    try {
      const deptValue = userForm.department || null;
      if (editingUser) {
        const payload: Record<string, any> = {
          full_name: userForm.full_name,
          email: userForm.email,
          role: userForm.role,
          department: deptValue,
        };
        if (userForm.password) payload.password = userForm.password;
        await ipcInvoke('db:users:update', editingUser.id, payload);
        toast.success('User updated');
      } else {
        if (!userForm.username || !userForm.password) { toast.error('Username and password are required'); setSavingUser(false); return; }
        await ipcInvoke('db:users:create', {
          username: userForm.username,
          password: userForm.password,
          full_name: userForm.full_name,
          email: userForm.email,
          role: userForm.role,
          department: deptValue,
        });
        toast.success('User created');
      }
      setShowUserModal(false);
      loadUsers();
    } catch (err: any) { toast.error(err.message || 'Failed to save user'); }
    setSavingUser(false);
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await ipcInvoke('db:users:delete', id);
      toast.success('User deactivated');
      loadUsers();
    } catch { toast.error('Failed to deactivate user'); }
  };

  const setField = (f: string, v: string) => setUserForm((p) => ({ ...p, [f]: v }));

  const getDeptLabel = (dept: string | null) => {
    if (!dept) return 'None (Admin)';
    return DEPARTMENT_CONFIG[dept as Department]?.shortLabel || dept;
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* User Management */}
      <div className="glass-panel rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Users size={20} className="text-primary-400" />
          <h3 className="text-base font-semibold text-surface-200">User Management</h3>
          <div className="flex-1" />
          <Button size="sm" onClick={openAddUser}><Plus size={14} /> Add User</Button>
        </div>
        {loadingUsers ? (
          <p className="text-surface-500 text-sm py-4">Loading users...</p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-800/40 hover:bg-surface-800/70 transition-colors">
                <div className="w-8 h-8 rounded-full bg-primary-600/20 flex items-center justify-center text-primary-400 text-xs font-bold flex-shrink-0">
                  {u.full_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-200">{u.full_name}</p>
                  <p className="text-2xs text-surface-500">{u.username} &middot; {roleLabel(u.role)}</p>
                </div>
                <span className={`text-2xs px-2 py-0.5 rounded-full ${u.department ? 'bg-primary-600/15 text-primary-400' : 'bg-surface-700 text-surface-400'}`}>
                  {getDeptLabel(u.department)}
                </span>
                <span className={`text-2xs ${u.is_active ? 'text-success-400' : 'text-surface-600'}`}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => openEditUser(u)} className="p-1.5 rounded text-surface-500 hover:text-primary-400 hover:bg-surface-700 transition-colors">
                  <Edit2 size={14} />
                </button>
                {u.is_active && (
                  <button onClick={() => handleDeleteUser(u.id)} className="p-1.5 rounded text-surface-500 hover:text-danger-400 hover:bg-surface-700 transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            {users.length === 0 && <p className="text-surface-500 text-sm py-4 text-center">No users found</p>}
          </div>
        )}
      </div>

      {/* Supabase Config */}
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

      {/* Google Drive Auto-Archive */}
      <div className="glass-panel rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <HardDrive size={20} className="text-primary-400" />
          <h3 className="text-base font-semibold text-surface-200">Google Drive Archive</h3>
          <div className="flex-1" />
          {gdrive?.has_refresh_token ? (
            <span className="text-2xs px-2 py-0.5 rounded-full bg-success-600/15 text-success-400">Connected</span>
          ) : (
            <span className="text-2xs px-2 py-0.5 rounded-full bg-surface-700 text-surface-400">Not connected</span>
          )}
        </div>
        <p className="text-2xs text-surface-500 mb-4">
          Completed equipment tickets, returned loans, and fulfilled purchase requests are
          automatically saved as PDFs to Google Drive, filed by workflow then year and month.
          Requires a Google Cloud OAuth client of type &ldquo;Desktop app&rdquo;.
        </p>
        <div className="space-y-4">
          <Input
            label="OAuth Client ID"
            value={gdriveClientId}
            onChange={(e) => setGdriveClientId(e.target.value)}
            placeholder="xxxxxxxx.apps.googleusercontent.com"
          />
          <Input
            label={gdrive?.has_client_secret ? 'OAuth Client Secret (saved — type to replace)' : 'OAuth Client Secret'}
            type="password"
            value={gdriveClientSecret}
            onChange={(e) => setGdriveClientSecret(e.target.value)}
            placeholder={gdrive?.has_client_secret ? '••••••••••••••••' : 'GOCSPX-...'}
          />
          <Input
            label="Root Folder ID or URL (optional — leave blank to use My Drive)"
            value={gdriveFolderId}
            onChange={(e) => setGdriveFolderId(e.target.value)}
            placeholder="Paste the Drive folder link or its ID"
          />
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleSaveGdrive} loading={savingGdrive}>Save Credentials</Button>
            <Button
              variant="secondary"
              onClick={handleConnectGdrive}
              loading={connectingGdrive}
              disabled={!gdrive?.has_client_secret}
            >
              {gdrive?.has_refresh_token ? 'Reconnect' : 'Connect Google Drive'}
            </Button>
            {gdrive?.has_refresh_token && (
              <Button
                variant="secondary"
                onClick={handleTestGdrive}
                loading={testingGdrive}
              >
                Test Connection
              </Button>
            )}
            {gdrive?.has_refresh_token && (
              <Button variant="ghost" onClick={handleDisconnectGdrive}>Disconnect</Button>
            )}
          </div>
          {gdrive?.account_email && (
            <div className="flex justify-between text-sm pt-1">
              <span className="text-surface-400">Connected Account</span>
              <span className="text-surface-200">{gdrive.account_email}</span>
            </div>
          )}
        </div>
      </div>

      {/* Sync Status */}
      <div className="glass-panel rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Database size={20} className="text-primary-400" />
          <h3 className="text-base font-semibold text-surface-200">Sync Status</h3>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-surface-400">Status</span><span className="text-surface-200 capitalize">{syncStore.status}</span></div>
          <div className="flex justify-between"><span className="text-surface-400">Last Sync</span><span className="text-surface-200">{syncStore.lastSyncAt ? new Date(syncStore.lastSyncAt).toLocaleString() : 'Never'}</span></div>
          <div className="flex justify-between">
            <span className="text-surface-400">Pending Changes</span>
            <span className={syncStore.schemaOutdated && syncStore.pendingChanges > 0 ? 'text-warning-400' : 'text-surface-200'}>
              {syncStore.pendingChanges}
            </span>
          </div>
        </div>

        {syncStore.schemaOutdated && (
          <div className="mt-4 rounded-lg border border-warning-500/40 bg-warning-500/10 p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle size={16} className="text-warning-400 flex-shrink-0" />
              <p className="text-sm font-semibold text-warning-400">Cloud database needs migration</p>
            </div>
            <p className="text-2xs text-surface-400 mb-2">
              Your changes can&rsquo;t sync because the Supabase database is missing tables or
              columns this app expects. Run <code className="text-surface-300">database/supabase-migration.sql</code> in
              the Supabase SQL Editor, then press Force Sync.
            </p>
            {syncStore.schemaIssues.length > 0 && (
              <ul className="list-disc list-inside space-y-0.5 text-2xs text-surface-400">
                {syncStore.schemaIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Button variant="secondary" onClick={handleForceSync} className="mt-4"><RefreshCw size={14} /> Force Sync</Button>
      </div>

      {/* User Modal */}
      <Modal isOpen={showUserModal} onClose={() => setShowUserModal(false)} title={editingUser ? 'Edit User' : 'Add User'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Full Name *" value={userForm.full_name} onChange={(e) => setField('full_name', e.target.value)} />
            <Input label="Username *" value={userForm.username} onChange={(e) => setField('username', e.target.value)} disabled={!!editingUser} />
            <Input label={editingUser ? 'New Password (leave empty to keep)' : 'Password *'} type="password" value={userForm.password} onChange={(e) => setField('password', e.target.value)} />
            <Input label="Email" value={userForm.email} onChange={(e) => setField('email', e.target.value)} />
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">Role *</label>
              <select value={userForm.role} onChange={(e) => setField('role', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">Department</label>
              <select value={userForm.department} onChange={(e) => setField('department', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
                <option value="">None (Admin / Unrestricted)</option>
                {(Object.keys(DEPARTMENT_CONFIG) as Department[]).map((dept) => (
                  <option key={dept} value={dept}>{DEPARTMENT_CONFIG[dept].label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setShowUserModal(false)}>Cancel</Button>
            <Button onClick={handleSaveUser} loading={savingUser}>{editingUser ? 'Update User' : 'Create User'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
