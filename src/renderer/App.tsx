import { useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuthStore } from './stores/auth.store';
import { useSyncStore } from './stores/sync.store';
import { initRealtimeListeners, cleanupRealtimeListeners } from './stores/realtime-listeners';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { EquipmentDashboardPage } from './pages/EquipmentDashboardPage';
import { EquipmentListPage } from './pages/EquipmentListPage';
import { EquipmentAddPage } from './pages/EquipmentAddPage';
import { EquipmentDetailPage } from './pages/EquipmentDetailPage';
import { MaintenanceQueuePage } from './pages/MaintenanceQueuePage';
import { MaintenanceNewPage } from './pages/MaintenanceNewPage';
import { MaintenanceDetailPage } from './pages/MaintenanceDetailPage';
import { PartsDetailPage } from './pages/PartsDetailPage';
import { PartsInventoryPage } from './pages/PartsInventoryPage';
import { StockAdjustmentPage } from './pages/StockAdjustmentPage';
import { EquipmentUseCountPage } from './pages/EquipmentUseCountPage';
import { LoansPage } from './pages/LoansPage';
import { LoanNewPage } from './pages/LoanNewPage';
import { LoanDetailPage } from './pages/LoanDetailPage';
import { PurchaseRequestsPage } from './pages/PurchaseRequestsPage';
import { PurchaseRequestNewPage } from './pages/PurchaseRequestNewPage';
import { PurchaseRequestDetailPage } from './pages/PurchaseRequestDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { VendorsPage } from './pages/VendorsPage';
import { ArchivesPage } from './pages/ArchivesPage';
import { ToastContainer } from './components/common/Toast';
import { ErrorBoundary } from './components/common/ErrorBoundary';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  if (!role || (!roles.includes(role) && role !== 'admin')) {
    // Bounce to the role-aware landing instead of a fixed page, so a blocked
    // user (e.g. a viewer hitting a write-only route) never lands on another
    // route they cannot access.
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

// Blocks non-admin users from opening a department-scoped URL (`:dept`) that is
// not their own; they are redirected to their own department workspace.
function DepartmentGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const { dept } = useParams<{ dept: string }>();
  if (user && user.role !== 'admin' && user.department && dept && dept !== user.department) {
    return <Navigate to={`/equipment/${user.department}`} replace />;
  }
  return <>{children}</>;
}

function DefaultRedirect() {
  const user = useAuthStore((s) => s.user);
  // Admins and read-only viewers both land on the combined, cross-department
  // dashboard; department users land in their own department workspace.
  if (user?.role === 'admin' || user?.role === 'viewer') {
    return <Navigate to="/dashboard" replace />;
  }
  // Department users no longer have a dedicated department page; the Maintenance
  // page is their landing/overview.
  return <Navigate to="/maintenance" replace />;
}

export default function App() {
  const initSync = useSyncStore((s) => s.initialize);
  const cleanupSync = useSyncStore((s) => s.cleanup);
  const hydrate = useAuthStore((s) => s.hydrate);
  const hydrated = useAuthStore((s) => s.hydrated);

  useEffect(() => {
    hydrate();
    initSync();
    initRealtimeListeners();
    return () => {
      cleanupSync();
      cleanupRealtimeListeners();
    };
  }, [hydrate, initSync, cleanupSync]);

  // Until the session-restore attempt finishes, render nothing so a reload of an
  // authenticated app doesn't briefly flash the login screen (H-2).
  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-950 text-surface-500">
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<DefaultRedirect />} />
                  <Route path="/dashboard" element={<RoleGuard roles={['viewer']}><DashboardPage /></RoleGuard>} />
                  <Route path="/equipment" element={<EquipmentDashboardPage />} />
                  <Route path="/equipment/new" element={<RoleGuard roles={['equipment_manager']}><EquipmentAddPage /></RoleGuard>} />
                  <Route path="/equipment/use-count" element={<EquipmentUseCountPage />} />
                  <Route path="/equipment/:dept" element={<DepartmentGuard><EquipmentListPage /></DepartmentGuard>} />
                  <Route path="/equipment/detail/:id" element={<EquipmentDetailPage />} />
                  <Route path="/vendors" element={<VendorsPage />} />
                  <Route path="/loans" element={<LoansPage />} />
                  <Route path="/loans/new" element={<RoleGuard roles={['equipment_manager']}><LoanNewPage /></RoleGuard>} />
                  <Route path="/loans/:id" element={<LoanDetailPage />} />
                  <Route path="/purchase-requests" element={<PurchaseRequestsPage />} />
                  <Route path="/purchase-requests/new" element={<RoleGuard roles={['equipment_manager']}><PurchaseRequestNewPage /></RoleGuard>} />
                  <Route path="/purchase-requests/:id" element={<PurchaseRequestDetailPage />} />
                  <Route path="/maintenance" element={<MaintenanceQueuePage />} />
                  <Route path="/maintenance/new" element={<RoleGuard roles={['equipment_manager']}><MaintenanceNewPage /></RoleGuard>} />
                  <Route path="/maintenance/:id" element={<RoleGuard roles={['equipment_manager', 'viewer']}><MaintenanceDetailPage /></RoleGuard>} />
                  <Route path="/parts" element={<RoleGuard roles={['equipment_manager']}><PartsInventoryPage /></RoleGuard>} />
                  <Route path="/parts/adjust" element={<RoleGuard roles={['equipment_manager']}><StockAdjustmentPage /></RoleGuard>} />
                  <Route path="/parts/:id" element={<RoleGuard roles={['equipment_manager']}><PartsDetailPage /></RoleGuard>} />
                  <Route path="/settings" element={<RoleGuard roles={[]}><SettingsPage /></RoleGuard>} />
                  <Route path="/archives" element={<ArchivesPage />} />
                  <Route path="*" element={<DefaultRedirect />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
      <ToastContainer />
    </ErrorBoundary>
  );
}
