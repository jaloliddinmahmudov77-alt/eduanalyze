import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { FeedbackProvider } from './components/feedback';
import Layout from './components/Layout';
import { PageLoader } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import Admin from './pages/Admin';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Messages from './pages/Messages';
import NewReport from './pages/NewReport';
import ReportEditor from './pages/ReportEditor';
import Reports from './pages/Reports';
import ScanStart from './pages/ScanStart';
import Settings from './pages/Settings';
import './index.css';

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? <>{children}</> : <Navigate to="/" replace />;
}

/** Har bir hisobot (va ?tab) uchun muharrir yangidan yaratiladi — eski holat boshqa hisobotga o'tib qolmasin */
function ReportEditorRoute() {
  const { id } = useParams();
  const { search } = useLocation();
  return <ReportEditor key={`${id}${new URLSearchParams(search).get('tab') || ''}`} />;
}

function App() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/new" element={<NewReport />} />
        <Route path="reports/:id" element={<ReportEditorRoute />} />
        <Route path="scan" element={<ScanStart />} />
        <Route path="messages" element={<Messages />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin" element={<AdminOnly><Admin /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <FeedbackProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </FeedbackProvider>
    </BrowserRouter>
  </StrictMode>,
);
