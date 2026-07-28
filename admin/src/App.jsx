import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './lib/AuthContext.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { Layout } from './components/Layout.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { ComingSoonPage } from './pages/ComingSoonPage.jsx';
import { ProductsListPage } from './pages/products/ProductsListPage.jsx';
import { ProductEditorPage } from './pages/products/ProductEditorPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
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
            <Route path="/" element={<DashboardPage />} />
            <Route path="/products" element={<ProductsListPage />} />
            <Route path="/products/new" element={<ProductEditorPage />} />
            <Route path="/products/:id" element={<ProductEditorPage />} />
            <Route path="/categories" element={<ComingSoonPage title="Categories" />} />
            <Route path="/collections" element={<ComingSoonPage title="Collections" />} />
            <Route path="/media" element={<ComingSoonPage title="Media" />} />
            <Route path="/pages" element={<ComingSoonPage title="Pages" />} />
            <Route path="/banners" element={<ComingSoonPage title="Banners" />} />
            <Route path="/menus" element={<ComingSoonPage title="Menus" />} />
            <Route path="/translations" element={<ComingSoonPage title="Translations" />} />
            <Route path="/orders" element={<ComingSoonPage title="Orders" />} />
            <Route path="/settings" element={<ComingSoonPage title="Settings" />} />
            <Route path="/staff" element={<ComingSoonPage title="Staff" />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
