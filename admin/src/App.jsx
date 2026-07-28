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
import { CategoriesPage } from './pages/categories/CategoriesPage.jsx';
import { CollectionsListPage } from './pages/collections/CollectionsListPage.jsx';
import { CollectionEditorPage } from './pages/collections/CollectionEditorPage.jsx';
import { MediaLibraryPage } from './pages/media/MediaLibraryPage.jsx';
import { PagesListPage } from './pages/pages/PagesListPage.jsx';
import { PageSectionsPage } from './pages/pages/PageSectionsPage.jsx';
import { BannersPage } from './pages/content/BannersPage.jsx';
import { MenusPage } from './pages/content/MenusPage.jsx';
import { LanguagesPage } from './pages/content/LanguagesPage.jsx';

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
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/collections" element={<CollectionsListPage />} />
            <Route path="/collections/new" element={<CollectionEditorPage />} />
            <Route path="/collections/:id" element={<CollectionEditorPage />} />
            <Route path="/media" element={<MediaLibraryPage />} />
            <Route path="/pages" element={<PagesListPage />} />
            <Route path="/pages/:id" element={<PageSectionsPage />} />
            <Route path="/banners" element={<BannersPage />} />
            <Route path="/menus" element={<MenusPage />} />
            <Route path="/translations" element={<LanguagesPage />} />
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
