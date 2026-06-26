import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Wrench, Settings, LogOut, Package,
  ChevronRight, ChevronDown, Camera, Lightbulb, PackageCheck, ShoppingCart, Archive,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth.store';
import eimLogo from '../../assets/eim-hor.png';
import { useAppVersion } from '../../hooks/useAppVersion';
import { DEPARTMENT_CONFIG } from '../../../shared/constants';
import type { Department } from '../../../shared/constants';

const DEPT_ICON: Record<Department, React.ReactNode> = {
  camera: <Camera size={16} />,
  lights_grips: <Lightbulb size={16} />,
};

const DEPT_COLOR: Record<Department, { active: string; hover: string }> = {
  camera: { active: 'text-primary-400', hover: 'hover:text-primary-300' },
  lights_grips: { active: 'text-amber-400', hover: 'hover:text-amber-300' },
};

function CollapsibleSection({ icon, label, open, onToggle, isActive, children }: {
  icon: React.ReactNode; label: string; open: boolean; onToggle: () => void;
  isActive: boolean; children: React.ReactNode;
}) {
  return (
    <>
      <button
        onClick={onToggle}
        className={clsx(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
          isActive
            ? 'text-surface-200'
            : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50',
        )}
      >
        {icon}
        <span>{label}</span>
        {open
          ? <ChevronDown size={14} className="ml-auto opacity-50" />
          : <ChevronRight size={14} className="ml-auto opacity-50" />
        }
      </button>
      {open && (
        <div className="ml-5 pl-3 border-l border-surface-800 space-y-0.5">
          {children}
        </div>
      )}
    </>
  );
}

function DeptSubItem({ dept, active, onClick }: {
  dept: Department; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
        active
          ? `bg-surface-800/60 ${DEPT_COLOR[dept].active}`
          : `text-surface-400 ${DEPT_COLOR[dept].hover} hover:bg-surface-800/50`,
      )}
    >
      {DEPT_ICON[dept]}
      <span>{DEPARTMENT_CONFIG[dept].shortLabel}</span>
      {active && <ChevronRight size={14} className="ml-auto opacity-50" />}
    </button>
  );
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const version = useAppVersion();

  const userRole = user?.role || '';
  const isAdmin = userRole === 'admin';
  const isViewer = userRole === 'viewer';
  const userDept = user?.department as Department | null;

  const [equipmentOpen, setEquipmentOpen] = useState(
    location.pathname.startsWith('/equipment')
  );
  const _maintenanceActive = location.pathname.startsWith('/maintenance');

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isEquipmentDeptActive = (dept: Department) =>
    location.pathname === `/equipment/${dept}`;

  // Admins get the full cross-department nav. Viewers get the same cross-department
  // layout (so they can see both departments) but read-only: no Equipment
  // management and no Settings.
  if (isAdmin || isViewer) {
    return (
      <div className="w-[260px] h-full glass-panel flex flex-col border-r border-surface-800/50">
        <div className="px-5 py-5 border-b border-surface-800/50">
          <img src={eimLogo} alt="CMB EIM" className="w-full object-contain" />
        </div>

        {isViewer && (
          <div className="px-3 pt-3 pb-1">
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-900 rounded-lg">
              <span className="text-xs font-semibold text-surface-300">View-Only Access</span>
            </div>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <NavButton
            icon={<LayoutDashboard size={20} />}
            label={isViewer ? 'Dashboard' : 'Admin Dashboard'}
            active={location.pathname === '/dashboard'}
            onClick={() => navigate('/dashboard')}
          />

          {/* Equipment — collapsible (admins only; viewers are read-only) */}
          {isAdmin && (
            <CollapsibleSection
              icon={<Package size={20} />}
              label="Equipment"
              open={equipmentOpen}
              onToggle={() => {
                if (!equipmentOpen) navigate('/equipment');
                setEquipmentOpen(!equipmentOpen);
              }}
              isActive={location.pathname.startsWith('/equipment')}
            >
              {(Object.keys(DEPARTMENT_CONFIG) as Department[]).map((dept) => (
                <DeptSubItem
                  key={dept}
                  dept={dept}
                  active={isEquipmentDeptActive(dept)}
                  onClick={() => navigate(`/equipment/${dept}`)}
                />
              ))}
            </CollapsibleSection>
          )}

          <NavButton
            icon={<Wrench size={20} />}
            label="Maintenance"
            active={_maintenanceActive}
            onClick={() => navigate('/maintenance')}
          />

          <NavButton
            icon={<PackageCheck size={20} />}
            label="Loaned Equipment"
            active={location.pathname.startsWith('/loans')}
            onClick={() => navigate('/loans')}
          />

          <NavButton
            icon={<ShoppingCart size={20} />}
            label="Purchase Requests"
            active={location.pathname.startsWith('/purchase-requests')}
            onClick={() => navigate('/purchase-requests')}
          />
        </nav>

        {/* Admin utilities pinned to the bottom, just above the user footer */}
        {isAdmin && (
          <div className="px-3 py-2 border-t border-surface-800/50 space-y-1">
            <NavButton
              icon={<Archive size={20} />}
              label="Archives"
              active={location.pathname.startsWith('/archives')}
              onClick={() => navigate('/archives')}
            />
            <NavButton
              icon={<Settings size={20} />}
              label="Settings"
              active={location.pathname === '/settings'}
              onClick={() => navigate('/settings')}
            />
          </div>
        )}

        <UserFooter user={user} version={version} onLogout={handleLogout} />
      </div>
    );
  }

  // Non-admin user — locked to their department
  const dept = userDept || 'camera';
  return (
    <div className="w-[260px] h-full glass-panel flex flex-col border-r border-surface-800/50">
      <div className="px-5 py-5 border-b border-surface-800/50">
        <img src={eimLogo} alt="CMB EIM" className="w-full object-contain" />
      </div>

      <div className="px-3 pt-3 pb-1">
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-900 rounded-lg">
          {DEPT_ICON[dept]}
          <span className="text-xs font-semibold text-surface-300">
            {DEPARTMENT_CONFIG[dept].label}
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        <NavButton
          icon={<LayoutDashboard size={20} />}
          label="Dashboard"
          active={location.pathname === `/dept/${dept}`}
          onClick={() => navigate(`/dept/${dept}`)}
        />
        <NavButton
          icon={<Package size={20} />}
          label="Equipment"
          active={location.pathname.startsWith('/equipment')}
          onClick={() => navigate('/equipment')}
        />
        <NavButton
          icon={<Wrench size={20} />}
          label="Maintenance"
          active={location.pathname.startsWith('/maintenance')}
          onClick={() => navigate('/maintenance')}
        />
        <NavButton
          icon={<PackageCheck size={20} />}
          label="Loaned Equipment"
          active={location.pathname.startsWith('/loans')}
          onClick={() => navigate('/loans')}
        />
        <NavButton
          icon={<ShoppingCart size={20} />}
          label="Purchase Requests"
          active={location.pathname.startsWith('/purchase-requests')}
          onClick={() => navigate('/purchase-requests')}
        />
      </nav>

      <UserFooter user={user} version={version} onLogout={handleLogout} />
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
        active
          ? 'bg-primary-600/15 text-primary-400'
          : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50',
      )}
    >
      {icon}
      <span>{label}</span>
      {active && <ChevronRight size={14} className="ml-auto opacity-50" />}
    </button>
  );
}

function UserFooter({ user, version, onLogout }: {
  user: any; version: string | null; onLogout: () => void;
}) {
  return (
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
        onClick={onLogout}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-surface-500 hover:text-danger-400 hover:bg-surface-800/50 transition-colors"
      >
        <LogOut size={16} />
        <span>Sign Out</span>
      </button>
      {version && (
        <p className="text-center text-2xs text-surface-600 mt-2">v{version}</p>
      )}
    </div>
  );
}
