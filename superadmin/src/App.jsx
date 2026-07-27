import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { Layout } from './components/Layout.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { CompaniesListPage } from './pages/CompaniesListPage.jsx';
import { CompanyCreatePage } from './pages/CompanyCreatePage.jsx';
import { CompanyDetailPage } from './pages/CompanyDetailPage.jsx';
import { LogsPage } from './pages/LogsPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/companies" element={<CompaniesListPage />} />
            <Route path="/companies/new" element={<CompanyCreatePage />} />
            <Route path="/companies/:id" element={<CompanyDetailPage />} />
            <Route path="/logs" element={<LogsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/companies" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
