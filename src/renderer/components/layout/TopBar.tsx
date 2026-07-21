import { useLocation } from 'react-router-dom';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useSyncStore } from '../../stores/sync.store';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/equipment': 'Equipment Catalog',
  '/equipment/new': 'Add Equipment',
  '/packages': 'Packages',
  '/maintenance': 'Maintenance Queue',
  '/maintenance/new': 'New Repair Ticket',
  '/parts': 'Parts Inventory',
  '/parts/adjust': 'Stock Adjustment',
  '/vendors': 'Vendor Management',
  '/reports': 'Reports & Analytics',
  '/settings': 'Settings',
};

export function TopBar() {
  const location = useLocation();
  const syncStatus = useSyncStore((s) => s.status);

  let title = PAGE_TITLES[location.pathname] || '';
  if (!title && location.pathname.startsWith('/equipment/')) title = 'Equipment Detail';
  if (!title && location.pathname.startsWith('/maintenance/')) title = 'Ticket Detail';
  if (!title && location.pathname.startsWith('/parts/')) title = 'Part Detail';
  if (!title) title = 'CMB EIM';

  return (
    <div className="h-14 px-6 flex items-center justify-between border-b border-surface-800/50 bg-surface-950/50">
        <h2 className="text-base font-semibold text-surface-200">{title}</h2>
      <div className="flex items-center gap-2">
        <div className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
          {
            'bg-success-500/10 text-success-400': syncStatus === 'online',
            'bg-surface-700 text-surface-400': syncStatus === 'offline',
            'bg-primary-500/10 text-primary-400': syncStatus === 'syncing',
            'bg-danger-500/10 text-danger-400': syncStatus === 'error',
          },
        )}>
          {syncStatus === 'online' && <><Wifi size={12} /> Online</>}
          {syncStatus === 'offline' && <><WifiOff size={12} /> Offline</>}
          {syncStatus === 'syncing' && <><RefreshCw size={12} className="animate-spin" /> Syncing</>}
          {syncStatus === 'error' && <><WifiOff size={12} /> Error</>}
        </div>
      </div>
    </div>
  );
}
