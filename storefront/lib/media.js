/**
 * Media URLs are deliberately same-origin and relative.
 *
 * The media route is tenant-scoped by Host: a browser asking the API directly
 * on localhost:8003 sends the wrong Host and gets a 404, because that hostname
 * belongs to no store. Serving images from the storefront's own origin and
 * letting next.config.js proxy them keeps the store's Host on the request — and
 * matches production, where Nginx does the same job.
 */
export function mediaUrl(path, width) {
  if (!path) return null;
  return width ? `${path}${path.includes('?') ? '&' : '?'}width=${width}` : path;
}

/** srcSet across the widths the media pipeline generates. */
export function mediaSrcSet(path, widths = [320, 640, 1024, 1600]) {
  if (!path) return undefined;
  return widths.map((width) => `${mediaUrl(path, width)} ${width}w`).join(', ');
}
