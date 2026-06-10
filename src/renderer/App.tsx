import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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
import { DepartmentSegmentPage } from './pages/DepartmentSegmentPage';
import { MaintenanceQueuePage } from './pages/MaintenanceQueuePage';
import { MaintenanceNewPage } from './pages/MaintenanceNewPage';
import { MaintenanceDetailPage } from './pages/MaintenanceDetailPage';
import { PartsDetailPage } from './pages/PartsDetailPage';
import { StockAdjustmentPage } from './pages/StockAdjustmentPage';
import { EquipmentUseCountPage } from './pages/EquipmentUseCountPage';
import { FormsPage } from './pages/FormsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ToastContainer } from './components/common/Toast';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  if (!role || (!roles.includes(role) && role !== 'admin')) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function DefaultRedirect() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  if (isAdmin) return <Navigate to="/dashboard" replace />;
  const dept = user?.department || 'camera';
  return <Navigate to={`/dept/${dept}`} replace />;
}

export default function App() {
  const initSync = useSyncStore((s) => s.initialize);
  const cleanupSync = useSyncStore((s) => s.cleanup);

  useEffect(() => {
    initSync();
    initRealtimeListeners();
    return () => {
      cleanupSync();
      cleanupRealtimeListeners();
    };
  }, [initSync, cleanupSync]);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<DefaultRedirect />} />
                  <Route path="/dashboard" element={<RoleGuard roles={[]}><DashboardPage /></RoleGuard>} />
                  <Route path="/equipment" element={<EquipmentDashboardPage />} />
                  <Route path="/equipment/new" element={<RoleGuard roles={['inventory_manager']}><EquipmentAddPage /></RoleGuard>} />
                  <Route path="/equipment/use-count" element={<EquipmentUseCountPage />} />
                  <Route path="/equipment/:dept" element={<EquipmentListPage />} />
                  <Route path="/equipment/detail/:id" element={<EquipmentDetailPage />} />
                  <Route path="/dept/:dept" element={<DepartmentSegmentPage />} />
                  <Route path="/maintenance" element={<MaintenanceQueuePage />} />
                  <Route path="/maintenance/new" element={<RoleGuard roles={['equipment_manager', 'inventory_manager', 'maintenance_lead']}><MaintenanceNewPage /></RoleGuard>} />
                  <Route path="/maintenance/:id" element={<RoleGuard roles={['equipment_manager', 'inventory_manager', 'maintenance_lead', 'technician']}><MaintenanceDetailPage /></RoleGuard>} />
                  <Route path="/parts/adjust" element={<RoleGuard roles={['parts_clerk']}><StockAdjustmentPage /></RoleGuard>} />
                  <Route path="/parts/:id" element={<RoleGuard roles={['maintenance_lead', 'parts_clerk']}><PartsDetailPage /></RoleGuard>} />
                  <Route path="/forms" element={<FormsPage />} />
                  <Route path="/settings" element={<RoleGuard roles={[]}><SettingsPage /></RoleGuard>} />
                  <Route path="*" element={<DefaultRedirect />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
      <ToastContainer />
    </>
  );
}
