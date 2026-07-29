const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8003';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? 'Request failed');
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: (token) => request('/auth/me', { token }),

  listCompanies: (token, params) =>
    request(`/platform/companies?${new URLSearchParams(params)}`, { token }),
  createCompany: (token, body) => request('/platform/companies', { method: 'POST', token, body }),
  getCompany: (token, id) => request(`/platform/companies/${id}`, { token }),
  patchCompany: (token, id, body) => request(`/platform/companies/${id}`, { method: 'PATCH', token, body }),
  suspendCompany: (token, id) => request(`/platform/companies/${id}/suspend`, { method: 'POST', token }),
  activateCompany: (token, id) => request(`/platform/companies/${id}/activate`, { method: 'POST', token }),
  getCompanyDomains: (token, id) => request(`/platform/companies/${id}/domains`, { token }),
  getCompanySettings: (token, id) => request(`/platform/companies/${id}/settings`, { token }),
  addDomain: (token, id, host) =>
    request(`/platform/companies/${id}/domains`, { method: 'POST', token, body: { host } }),
  removeDomain: (token, domainId) => request(`/platform/domains/${domainId}`, { method: 'DELETE', token }),
  impersonate: (token, id) => request(`/platform/companies/${id}/impersonate`, { method: 'POST', token }),

  listLogs: (token, params) => request(`/platform/logs?${new URLSearchParams(params)}`, { token }),

  getOverview: (token) => request('/platform/overview', { token }),
  listThemes: (token) => request('/platform/themes', { token }),
  getCompanyHealth: (token, id, withSsl = false) =>
    request(`/platform/companies/${id}/health${withSsl ? '?ssl=1' : ''}`, { token }),
};
