import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

const emptyForm = {
  name: '',
  bizName: '',
  email: '',
  domainHost: '',
  adminEmail: '',
  adminName: '',
  currency: '',
  timezone: '',
  themeId: '',
};

export function CompanyCreatePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);
  const [themes, setThemes] = useState([]);

  /*
   * Added after the Phase 3 pilot. The onboarding runbook tells you to agree a
   * theme with the client, and there was nowhere to enter it — a store created
   * from this form got `theme_id = null` and rendered in the fallback palette
   * until a developer ran an UPDATE. That is exactly the kind of step the
   * pilot exists to catch.
   */
  useEffect(() => {
    api
      .listThemes(token)
      .then((res) => setThemes(res.themes))
      .catch(() => setThemes([]));
  }, [token]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
      if (body.themeId) body.themeId = Number(body.themeId);
      const res = await api.createCompany(token, body);
      setCreated(res);
    } catch (err) {
      setError(err.message ?? 'Failed to create company.');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="max-w-xl space-y-4 rounded-lg border border-green-200 bg-green-50 p-6">
        <h1 className="text-lg font-semibold text-green-900">Company created</h1>
        <p className="text-sm text-green-800">
          <strong>{created.company.NAME}</strong> is live at <code>{created.domain.host}</code>.
        </p>
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">One-time admin password — shown only now:</p>
          <p className="mt-1">
            Email: <code>{created.admin.email}</code>
            <br />
            Password: <code className="font-mono">{created.admin.tempPassword}</code>
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate(`/companies/${created.company.ID}`)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            View company
          </button>
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              setForm(emptyForm);
            }}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">New company</h1>

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <Field id="name" label="Company name" value={form.name} onChange={update('name')} required />
        <Field id="bizName" label="Legal / business name" value={form.bizName} onChange={update('bizName')} />
        <Field id="email" label="Company email" type="email" value={form.email} onChange={update('email')} />
        <Field
          id="domainHost"
          label="Domain (host)"
          value={form.domainHost}
          onChange={update('domainHost')}
          placeholder="acme.storeforge.app"
          required
        />
        <div className="grid grid-cols-2 gap-4">
          <Field id="currency" label="Currency" value={form.currency} onChange={update('currency')} placeholder="USD" />
          <Field id="timezone" label="Timezone" value={form.timezone} onChange={update('timezone')} placeholder="UTC" />
        </div>

        <div>
          <label htmlFor="themeId" className="block text-sm font-medium text-gray-700">
            Theme
          </label>
          <select
            id="themeId"
            value={form.themeId}
            onChange={update('themeId')}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <option value="">Default palette</option>
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
        </div>
        <hr className="border-gray-200" />
        <Field
          id="adminName"
          label="First admin — name"
          value={form.adminName}
          onChange={update('adminName')}
          required
        />
        <Field
          id="adminEmail"
          label="First admin — email"
          type="email"
          value={form.adminEmail}
          onChange={update('adminEmail')}
          required
        />

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {submitting ? 'Creating…' : 'Create company'}
        </button>
      </form>
    </div>
  );
}

function Field({ id, label, type = 'text', value, onChange, required, placeholder }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      />
    </div>
  );
}
