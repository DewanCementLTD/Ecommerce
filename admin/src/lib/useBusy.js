import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';

/**
 * Shared busy/error/toast lifecycle for save & destructive actions, lifted from the
 * ad hoc pattern in superadmin's CompanyDetailPage so every screen in this app
 * handles loading state, error surfacing, and success feedback the same way.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn, { successMessage, errorMessage } = {}) => {
    setBusy(true);
    try {
      const result = await fn();
      if (successMessage) toast.success(successMessage);
      return result;
    } catch (err) {
      toast.error(err.message ?? errorMessage ?? 'Something went wrong.');
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
