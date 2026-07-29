import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';

/**
 * `/media/:id/file` requires a Bearer token (company-scoped, same as every other
 * admin endpoint), but a plain `<img src>` can't carry an Authorization header.
 * This fetches the file as a blob and renders it through an object URL instead —
 * keeping the token out of the URL (no query-string auth, nothing to leak into
 * logs/referrers).
 */
export function AuthedImage({ src, alt, className, fallback = null }) {
  const { token } = useAuth();
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src || !token) return undefined;
    let cancelled = false;
    let url = null;
    setFailed(false);

    // `X-Storeforge-Api` as well as the token: this is the one place that
    // calls fetch() directly instead of going through lib/api.js, and without
    // that header the same-origin proxy treats `/media/…` as a storefront path
    // and never reaches the API. Every thumbnail in the media library 404'd.
    fetch(src, { headers: { Authorization: `Bearer ${token}`, 'X-Storeforge-Api': '1' } })
      .then((res) => {
        if (!res.ok) throw new Error('image fetch failed');
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, token]);

  if (!src || failed) return fallback;
  if (!objectUrl) return <div className={`animate-pulse bg-gray-100 ${className ?? ''}`} aria-hidden="true" />;
  return <img src={objectUrl} alt={alt ?? ''} className={className} />;
}
