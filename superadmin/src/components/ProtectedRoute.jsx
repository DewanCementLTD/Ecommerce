import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';

export function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Loading&hellip;
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
