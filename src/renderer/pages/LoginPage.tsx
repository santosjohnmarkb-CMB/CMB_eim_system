import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';
import { Lock } from 'lucide-react';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const user = await login(username, password);
    if (user) {
      navigate('/');
    } else {
      setError('Invalid username or password');
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-surface-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-600/20 mb-4">
            <Lock size={28} className="text-primary-400" />
          </div>
          <h1 className="text-2xl font-bold text-gradient">CMB EIM</h1>
          <p className="text-sm text-surface-500 mt-1">Equipment Inventory Management</p>
        </div>
        <form onSubmit={handleSubmit} className="glass-panel rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
              placeholder="Enter username"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
              placeholder="Enter password"
            />
          </div>
          {error && <p className="text-sm text-danger-400">{error}</p>}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className="text-center text-2xs text-surface-600 mt-4">CMB Film Services, Inc.</p>
      </div>
    </div>
  );
}
