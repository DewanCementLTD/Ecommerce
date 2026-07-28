import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';
import { Modal } from '../../components/Modal.jsx';

export function StaffPage() {
  const { token, admin: currentAdmin } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [roles, setRoles] = useState([]);
  const [newAdmin, setNewAdmin] = useState({ email: '', name: '', role: 'staff' });
  const [newRole, setNewRole] = useState({ code: '', name: '', perms: '' });
  const [tempPassword, setTempPassword] = useState(null);

  const load = useCallback(async () => {
    try {
      const [adminsRes, rolesRes] = await Promise.all([api.listAdmins(token), api.listRoles(token)]);
      setAdmins(adminsRes.rows);
      setRoles(rolesRes.rows);
    } catch (err) {
      toast.error(err.message ?? 'Failed to load staff.');
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function createAdmin(e) {
    e.preventDefault();
    try {
      const res = await api.createAdmin(token, newAdmin);
      setNewAdmin({ email: '', name: '', role: 'staff' });
      setTempPassword({ email: res.admin.email, password: res.tempPassword });
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to create staff account.');
    }
  }

  async function toggleActive(admin) {
    try {
      await api.patchAdmin(token, admin.id, { isActive: admin.isActive ? 0 : 1 });
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to update staff account.');
    }
  }

  async function resetPassword(admin) {
    try {
      const res = await api.patchAdmin(token, admin.id, { resetPassword: true });
      setTempPassword({ email: admin.email, password: res.tempPassword });
    } catch (err) {
      toast.error(err.message ?? 'Failed to reset password.');
    }
  }

  async function createRole(e) {
    e.preventDefault();
    try {
      await api.createRole(token, {
        code: newRole.code,
        name: newRole.name,
        perms: newRole.perms ? newRole.perms.split(',').map((p) => p.trim()).filter(Boolean) : [],
      });
      setNewRole({ code: '', name: '', perms: '' });
      toast.success('Role created.');
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to create role.');
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Staff</h1>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Team</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Role</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {admins.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2">{a.name}</td>
                  <td className="px-3 py-2 text-gray-600">{a.email}</td>
                  <td className="px-3 py-2 text-gray-600">{a.role}</td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={!!a.isActive} onChange={() => toggleActive(a)} />
                  </td>
                  <td className="px-3 py-2 space-x-2 whitespace-nowrap">
                    <button type="button" onClick={() => resetPassword(a)} className="text-xs font-medium text-blue-700 hover:underline">
                      Reset password
                    </button>
                    {a.id !== currentAdmin?.id && (
                      <ConfirmButton
                        label="Remove"
                        confirmTitle={`Remove ${a.name}?`}
                        confirmMessage="This deletes their login. They will no longer be able to sign in."
                        onConfirm={async () => {
                          await api.deleteAdmin(token, a.id);
                          toast.success('Removed.');
                          load();
                        }}
                        className="text-xs font-medium text-red-600 hover:underline"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={createAdmin} className="mt-3 flex flex-wrap items-end gap-2">
          <input
            required
            type="email"
            value={newAdmin.email}
            onChange={(e) => setNewAdmin((f) => ({ ...f, email: e.target.value }))}
            placeholder="Email"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            required
            value={newAdmin.name}
            onChange={(e) => setNewAdmin((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            value={newAdmin.role}
            onChange={(e) => setNewAdmin((f) => ({ ...f, role: e.target.value }))}
            placeholder="Role code (e.g. staff)"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            Invite
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Roles</h2>
        <ul className="mt-2 divide-y divide-gray-100">
          {roles.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-medium">{r.name}</span> <span className="text-gray-500">({r.code})</span>
                {r.perms.length > 0 && <span className="ml-2 text-xs text-gray-400">{r.perms.join(', ')}</span>}
              </span>
              <ConfirmButton
                label="Delete"
                confirmTitle={`Delete "${r.name}"?`}
                confirmMessage="Staff already assigned this role keep it as free text; only future assignments are affected."
                onConfirm={async () => {
                  await api.deleteRole(token, r.id);
                  load();
                }}
                className="text-xs font-medium text-red-600 hover:underline"
              />
            </li>
          ))}
          {roles.length === 0 && <li className="py-2 text-sm text-gray-500">No custom roles yet.</li>}
        </ul>

        <form onSubmit={createRole} className="mt-3 flex flex-wrap items-end gap-2">
          <input
            required
            value={newRole.code}
            onChange={(e) => setNewRole((f) => ({ ...f, code: e.target.value }))}
            placeholder="Code (e.g. manager)"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            required
            value={newRole.name}
            onChange={(e) => setNewRole((f) => ({ ...f, name: e.target.value }))}
            placeholder="Display name"
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            value={newRole.perms}
            onChange={(e) => setNewRole((f) => ({ ...f, perms: e.target.value }))}
            placeholder="Permissions, comma separated"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            Add role
          </button>
        </form>
      </section>

      <Modal open={!!tempPassword} onClose={() => setTempPassword(null)} title="One-time password">
        {tempPassword && (
          <div className="space-y-2 text-sm">
            <p>
              Share this with <strong>{tempPassword.email}</strong> — it will not be shown again.
            </p>
            <p className="rounded bg-gray-100 px-3 py-2 font-mono">{tempPassword.password}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
