import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';

// Code-split every authenticated page so the initial bundle stays small.
// Each chunk loads on-demand when the user navigates to it.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Hospitals = lazy(() => import('./pages/Hospitals'));
const HospitalDetail = lazy(() => import('./pages/HospitalDetail'));
const Users = lazy(() => import('./pages/Users'));
const PlatformStaff = lazy(() => import('./pages/PlatformStaff'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const Analytics = lazy(() => import('./pages/Analytics'));
const SystemHealth = lazy(() => import('./pages/SystemHealth'));
const RemoteControl = lazy(() => import('./pages/RemoteControl'));
const LocalSchemaSync = lazy(() => import('./pages/LocalSchemaSync'));
const NotFound = lazy(() => import('./pages/NotFound'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={
            <Suspense fallback={<PageFallback />}>
              <Dashboard />
            </Suspense>
          }
        />
        <Route
          path="hospitals"
          element={
            <Suspense fallback={<PageFallback />}>
              <Hospitals />
            </Suspense>
          }
        />
        <Route
          path="hospitals/:id"
          element={
            <Suspense fallback={<PageFallback />}>
              <HospitalDetail />
            </Suspense>
          }
        />
        <Route
          path="users"
          element={
            <Suspense fallback={<PageFallback />}>
              <Users />
            </Suspense>
          }
        />
        <Route
          path="platform-staff"
          element={
            <Suspense fallback={<PageFallback />}>
              <PlatformStaff />
            </Suspense>
          }
        />
        <Route
          path="onboarding"
          element={
            <Suspense fallback={<PageFallback />}>
              <Onboarding />
            </Suspense>
          }
        />
        <Route
          path="audit-logs"
          element={
            <Suspense fallback={<PageFallback />}>
              <AuditLogs />
            </Suspense>
          }
        />
        <Route
          path="analytics"
          element={
            <Suspense fallback={<PageFallback />}>
              <Analytics />
            </Suspense>
          }
        />
        <Route
          path="system-health"
          element={
            <Suspense fallback={<PageFallback />}>
              <SystemHealth />
            </Suspense>
          }
        />
        <Route
          path="remote-control"
          element={
            <Suspense fallback={<PageFallback />}>
              <RemoteControl />
            </Suspense>
          }
        />
        <Route
          path="schema-sync"
          element={
            <Suspense fallback={<PageFallback />}>
              <LocalSchemaSync />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={<PageFallback />}>
              <NotFound />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  );
}
