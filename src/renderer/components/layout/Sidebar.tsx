import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Wrench, Box, Truck,
  BarChart3, Settings, LogOut, ChevronRight, Camera, Lightbulb,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth.store';
import { useDepartmentStore } from '../../stores/department.store';
import { useAppVersion } from '../../hooks/useAppVersion';
import { DEPARTMENT_CONFIG } from '../../../shared/constants';
import type { Department } from '../../../shared/constants';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  roles: string[];
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, roles: ['admin', 'inventory_manager', 'viewer'] },
  { path: '/equipment', label: 'Equipment', icon: <Package size={20} />, roles: ['admin', 'inventory_manager', 'viewer'] },
  { path: '/maintenance', label: 'Maintenance', icon: <Wrench size={20} />, roles: ['admin', 'inventory_manager', 'maintenance_lead', 'technician'] },
  { path: '/parts', label: 'Parts', icon: <Box size={20} />, roles: ['admin', 'maintenance_lead', 'parts_clerk'] },
  { path: '/vendors', label: 'Vendors', icon: <Truck size={20} />, roles: ['admin', 'parts_clerk'] },
  { path: '/reports', label: 'Reports', icon: <BarChart3 size={20} />, roles: ['admin', 'inventory_manager'] },
  { path: '/settings', label: 'Settings', icon: <Settings size={20} />, roles: ['admin'] },
];

const DEPT_ICON: Record<Department, React.ReactNode> = {
  camera: <Camera size={14} />,
  lights_grips: <Lightbulb size={14} />,
};

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const version = useAppVersion();
  const activeDepartment = useDepartmentStore((s) => s.activeDepartment);
  const setDepartment = useDepartmentStore((s) => s.setDepartment);

  const userRole = user?.role || '';
  const isAdmin = userRole === 'admin';

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.roles.includes(userRole) || isAdmin
  );

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="w-[260px] h-full glass-panel flex flex-col border-r border-surface-800/50">
      <div className="px-5 py-5 border-b border-surface-800/50">
        <h1 className="text-lg font-bold text-gradient">CMB EIM</h1>
        <p className="text-2xs text-surface-500 mt-0.5">Equipment Inventory Management</p>
      </div>

      {/* Department selector / badge */}
      <div className="px-3 pt-3 pb-1">
        {isAdmin ? (
          <div className="flex gap-1 p-0.5 bg-surface-900 rounded-lg">
            {(Object.keys(DEPARTMENT_CONFIG) as Department[]).map((dept) => (
              <button
                key={dept}
                onClick={() => setDepartment(dept)}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-semibold transition-all duration-150',
                  activeDepartment === dept
                    ? 'bg-primary-600/20 text-primary-400 shadow-sm'
                    : 'text-surface-500 hover:text-surface-300 hover:bg-surface-800/50',
                )}
              >
                {DEPT_ICON[dept]}
                <span>{DEPARTMENT_CONFIG[dept].shortLabel}</span>
              </button>
            ))}
          </div>
        ) : activeDepartment ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-900 rounded-lg">
            {DEPT_ICON[activeDepartment]}
            <span className="text-xs font-semibold text-surface-300">
              {DEPARTMENT_CONFIG[activeDepartment].label}
            </span>
          </div>
        ) : null}
      </div>

      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/dashboard' && location.pathname.startsWith(item.path));

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-primary-600/15 text-primary-400'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50',
              )}
            >
              {item.icon}
              <span>{item.label}</span>
              {isActive && <ChevronRight size={14} className="ml-auto opacity-50" />}
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-surface-800/50">
        <div className="flex items-center gap-3 mb-3 px-1">
          <div className="w-8 h-8 rounded-full bg-primary-600/20 flex items-center justify-center text-primary-400 text-xs font-bold">
            {user?.full_name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-surface-200 truncate">{user?.full_name}</p>
            <p className="text-2xs text-surface-500 truncate">{user?.role?.replace(/_/g, ' ')}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-surface-500 hover:text-danger-400 hover:bg-surface-800/50 transition-colors"
        >
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
        {version && (
          <p className="text-center text-2xs text-surface-600 mt-2">v{version}</p>
        )}
      </div>
    </div>
  );
}
