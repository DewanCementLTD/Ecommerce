const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8003';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', token, body, isForm = false } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? 'Request failed');
  }
  return data;
}

function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export const api = {
  // --- auth ---
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: (token) => request('/auth/me', { token }),
  logout: (token) => request('/auth/logout', { method: 'POST', token }),

  // --- products ---
  listProducts: (token, params) => request(`/products${qs(params)}`, { token }),
  getProduct: (token, id) => request(`/products/${id}`, { token }),
  createProduct: (token, body) => request('/products', { method: 'POST', token, body }),
  patchProduct: (token, id, body) => request(`/products/${id}`, { method: 'PATCH', token, body }),
  deleteProduct: (token, id) => request(`/products/${id}`, { method: 'DELETE', token }),
  bulkProducts: (token, ids, action) =>
    request('/products/bulk', { method: 'POST', token, body: { ids, action } }),
  putProductCats: (token, id, catIds) =>
    request(`/products/${id}/cats`, { method: 'PUT', token, body: { catIds } }),
  putProductOptions: (token, id, options) =>
    request(`/products/${id}/options`, { method: 'PUT', token, body: { options } }),

  listVariants: (token, id) => request(`/products/${id}/variants`, { token }),
  createVariant: (token, id, body) => request(`/products/${id}/variants`, { method: 'POST', token, body }),
  patchVariant: (token, id, variantId, body) =>
    request(`/products/${id}/variants/${variantId}`, { method: 'PATCH', token, body }),
  deleteVariant: (token, id, variantId) =>
    request(`/products/${id}/variants/${variantId}`, { method: 'DELETE', token }),
  adjustStock: (token, id, variantId, body) =>
    request(`/products/${id}/variants/${variantId}/stock`, { method: 'POST', token, body }),

  listImages: (token, id) => request(`/products/${id}/images`, { token }),
  addImage: (token, id, mediaId, alt) =>
    request(`/products/${id}/images`, { method: 'POST', token, body: { mediaId, alt } }),
  reorderImages: (token, id, items) =>
    request(`/products/${id}/images/reorder`, { method: 'POST', token, body: { items } }),
  patchImage: (token, id, imageId, body) =>
    request(`/products/${id}/images/${imageId}`, { method: 'PATCH', token, body }),
  deleteImage: (token, id, imageId) =>
    request(`/products/${id}/images/${imageId}`, { method: 'DELETE', token }),

  // --- categories ---
  listCats: (token) => request('/cats', { token }),
  getCatTree: (token) => request('/cats/tree', { token }),
  getCat: (token, id) => request(`/cats/${id}`, { token }),
  createCat: (token, body) => request('/cats', { method: 'POST', token, body }),
  patchCat: (token, id, body) => request(`/cats/${id}`, { method: 'PATCH', token, body }),
  deleteCat: (token, id) => request(`/cats/${id}`, { method: 'DELETE', token }),
  reorderCats: (token, items) => request('/cats/reorder', { method: 'POST', token, body: { items } }),

  // --- collections ---
  listColls: (token, params) => request(`/colls${qs(params)}`, { token }),
  getColl: (token, id) => request(`/colls/${id}`, { token }),
  createColl: (token, body) => request('/colls', { method: 'POST', token, body }),
  patchColl: (token, id, body) => request(`/colls/${id}`, { method: 'PATCH', token, body }),
  deleteColl: (token, id) => request(`/colls/${id}`, { method: 'DELETE', token }),
  getCollProducts: (token, id) => request(`/colls/${id}/products`, { token }),
  putCollProducts: (token, id, productIds) =>
    request(`/colls/${id}/products`, { method: 'PUT', token, body: { productIds } }),
  reorderCollProducts: (token, id, items) =>
    request(`/colls/${id}/products/reorder`, { method: 'POST', token, body: { items } }),

  // --- media ---
  listMedia: (token, params) => request(`/media${qs(params)}`, { token }),
  getMedia: (token, id) => request(`/media/${id}`, { token }),
  uploadMedia: (token, file, onProgress) => uploadFile(`${API_URL}/media`, token, file, onProgress),
  patchMedia: (token, id, body) => request(`/media/${id}`, { method: 'PATCH', token, body }),
  deleteMedia: (token, id) => request(`/media/${id}`, { method: 'DELETE', token }),
  mediaUrl: (id, width) => `${API_URL}/media/${id}/file${width ? `?width=${width}` : ''}`,

  // --- pages / sections ---
  listPages: (token) => request('/pages', { token }),
  getPage: (token, id) => request(`/pages/${id}`, { token }),
  createPage: (token, body) => request('/pages', { method: 'POST', token, body }),
  patchPage: (token, id, body) => request(`/pages/${id}`, { method: 'PATCH', token, body }),
  deletePage: (token, id) => request(`/pages/${id}`, { method: 'DELETE', token }),
  listSections: (token, pageId) => request(`/pages/${pageId}/sections`, { token }),
  createSection: (token, pageId, body) => request(`/pages/${pageId}/sections`, { method: 'POST', token, body }),
  reorderSections: (token, pageId, items) =>
    request(`/pages/${pageId}/sections/reorder`, { method: 'POST', token, body: { items } }),
  patchSection: (token, id, body) => request(`/sections/${id}`, { method: 'PATCH', token, body }),
  deleteSection: (token, id) => request(`/sections/${id}`, { method: 'DELETE', token }),
  getSectionRegistry: (token) => request('/sections/registry', { token }),

  // --- banners ---
  listBanners: (token) => request('/banners', { token }),
  getBanner: (token, id) => request(`/banners/${id}`, { token }),
  createBanner: (token, body) => request('/banners', { method: 'POST', token, body }),
  patchBanner: (token, id, body) => request(`/banners/${id}`, { method: 'PATCH', token, body }),
  deleteBanner: (token, id) => request(`/banners/${id}`, { method: 'DELETE', token }),

  // --- menus ---
  listMenus: (token) => request('/menus', { token }),
  patchMenu: (token, id, body) => request(`/menus/${id}`, { method: 'PATCH', token, body }),
  listMenuItems: (token, menuId) => request(`/menus/${menuId}/items`, { token }),
  createMenuItem: (token, menuId, body) => request(`/menus/${menuId}/items`, { method: 'POST', token, body }),
  reorderMenuItems: (token, menuId, items) =>
    request(`/menus/${menuId}/items/reorder`, { method: 'POST', token, body: { items } }),
  patchMenuItem: (token, id, body) => request(`/menu-items/${id}`, { method: 'PATCH', token, body }),
  deleteMenuItem: (token, id) => request(`/menu-items/${id}`, { method: 'DELETE', token }),

  // --- languages & translations ---
  listLangs: (token) => request('/langs', { token }),
  createLang: (token, body) => request('/langs', { method: 'POST', token, body }),
  patchLang: (token, id, body) => request(`/langs/${id}`, { method: 'PATCH', token, body }),
  deleteLang: (token, id) => request(`/langs/${id}`, { method: 'DELETE', token }),
  getTranslations: (token, entity, id) => request(`/trans/${entity}/${id}`, { token }),
  putTranslations: (token, entity, id, lang, fields) =>
    request(`/trans/${entity}/${id}`, { method: 'PUT', token, body: { lang, fields } }),

  // --- settings ---
  getSettings: (token) => request('/settings', { token }),
  putSettings: (token, values) => request('/settings', { method: 'PUT', token, body: { values } }),

  // --- staff & roles ---
  listAdmins: (token) => request('/admins', { token }),
  createAdmin: (token, body) => request('/admins', { method: 'POST', token, body }),
  patchAdmin: (token, id, body) => request(`/admins/${id}`, { method: 'PATCH', token, body }),
  deleteAdmin: (token, id) => request(`/admins/${id}`, { method: 'DELETE', token }),
  listRoles: (token) => request('/roles', { token }),
  createRole: (token, body) => request('/roles', { method: 'POST', token, body }),
  patchRole: (token, id, body) => request(`/roles/${id}`, { method: 'PATCH', token, body }),
  deleteRole: (token, id) => request(`/roles/${id}`, { method: 'DELETE', token }),

  // --- orders (Part B) ---
  listOrders: (token, params) => request(`/orders${qs(params)}`, { token }),
  getOrder: (token, id) => request(`/orders/${id}`, { token }),
  patchOrderStatus: (token, id, body) => request(`/orders/${id}/status`, { method: 'PATCH', token, body }),
  patchOrder: (token, id, body) => request(`/orders/${id}`, { method: 'PATCH', token, body }),
  exportOrders: (token, params) => downloadFile(`${API_URL}/orders/export${qs(params)}`, token, 'orders.csv'),

  // --- dashboard (Part B) ---
  getDashboardSummary: (token, params) => request(`/dashboard/summary${qs(params)}`, { token }),

  // --- customers (Part B) ---
  listCustomers: (token, params) => request(`/customers${qs(params)}`, { token }),
  getCustomer: (token, id) => request(`/customers/${id}`, { token }),
  patchCustomer: (token, id, body) => request(`/customers/${id}`, { method: 'PATCH', token, body }),
};

/** CSV export needs the Bearer header, so it can't be a plain <a href> link. */
async function downloadFile(url, token, filename) {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Export failed.');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

function uploadFile(url, token, file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? 'Upload failed'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Upload failed — check your connection.'));
    xhr.send(form);
  });
}
