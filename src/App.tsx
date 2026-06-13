import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store';
import { hasPermission } from '@/utils/permissions';
import Layout from '@/components/Layout';
import Toast from '@/components/Toast';
import Login from '@/pages/Login';
import IssueList from '@/pages/IssueList';
import CreateIssue from '@/pages/CreateIssue';
import IssueDetail from '@/pages/IssueDetail';
import SyncQueue from '@/pages/SyncQueue';
import History from '@/pages/History';
import ConfigImport from '@/pages/ConfigImport';
import Export from '@/pages/Export';
import HandoverPrecheck from '@/pages/HandoverPrecheck';
import MaterialLedger from '@/pages/MaterialLedger';
import RouteManagement from '@/pages/patrol/RouteManagement';
import CheckIn from '@/pages/patrol/CheckIn';
import StorePatrolView from '@/pages/patrol/StorePatrolView';
import PatrolBackup from '@/pages/patrol/PatrolBackup';

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { currentUser } = useAppStore();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  if (permission && !hasPermission(currentUser.role, permission)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">🔒</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">权限不足</h2>
          <p className="text-gray-500 mb-4">您没有访问此页面的权限</p>
          <button
            onClick={() => window.history.back()}
            className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
          >
            返回上一页
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { init, currentUser } = useAppStore();

  useEffect(() => {
    init();
  }, [init]);

  return (
    <Routes>
      <Route
        path="/"
        element={currentUser ? <Navigate to="/issues" replace /> : <Login />}
      />
      <Route element={<Layout />}>
        <Route
          path="/issues"
          element={
            <ProtectedRoute>
              <IssueList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/issues/new"
          element={
            <ProtectedRoute permission="issue:create">
              <CreateIssue />
            </ProtectedRoute>
          }
        />
        <Route
          path="/issues/:id"
          element={
            <ProtectedRoute>
              <IssueDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sync"
          element={
            <ProtectedRoute permission="sync:view">
              <SyncQueue />
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute permission="history:view">
              <History />
            </ProtectedRoute>
          }
        />
        <Route
          path="/config"
          element={
            <ProtectedRoute permission="config:import">
              <ConfigImport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/export"
          element={
            <ProtectedRoute permission="export:data">
              <Export />
            </ProtectedRoute>
          }
        />
        <Route
          path="/handover-precheck"
          element={
            <ProtectedRoute>
              <HandoverPrecheck />
            </ProtectedRoute>
          }
        />
        <Route
          path="/materials"
          element={
            <ProtectedRoute permission="material:view">
              <MaterialLedger />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patrol/routes"
          element={
            <ProtectedRoute permission="patrol:route_manage">
              <RouteManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patrol/checkin"
          element={
            <ProtectedRoute permission="patrol:checkin">
              <CheckIn />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patrol/store-view"
          element={
            <ProtectedRoute permission="patrol:view_store_checkin">
              <StorePatrolView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patrol/backup"
          element={
            <ProtectedRoute permission="patrol:route_manage">
              <PatrolBackup />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/issues" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AppRoutes />
      <Toast />
    </Router>
  );
}
