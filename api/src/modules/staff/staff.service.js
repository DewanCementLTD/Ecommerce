import argon2 from 'argon2';
import { withCompany } from '../../db/pool.js';
import { generateTempPassword } from '../../lib/password.js';
import { camelRow, camelRows } from '../../lib/rows.js';
import { parseJson, stringifyJson } from '../../lib/json.js';
import { AppError } from '../../middleware/error.js';
import { isUniqueViolation } from '../../lib/dbErrors.js';
import { insertLog } from '../logs/logs.repo.js';
import * as repo from './staff.repo.js';

function toAdminDto(row) {
  return camelRow(row);
}

function toRoleDto(row) {
  const role = camelRow(row);
  if (!role) return null;
  role.perms = parseJson(role.perms, []);
  return role;
}

/* --------------------------------------------------------------------- admins */

export async function listAdmins({ companyId }) {
  const rows = await withCompany(companyId, (conn) => repo.listAdmins(conn, { companyId }));
  return { rows: camelRows(rows) };
}

export async function createAdmin({ companyId, actorAdminId, ip, email, name, role }) {
  const tempPassword = generateTempPassword();
  const passHash = await argon2.hash(tempPassword);

  const adminId = await withCompany(companyId, async (conn) => {
    try {
      const id = await repo.insertAdmin(conn, { companyId, email, passHash, name, role });
      await insertLog(conn, {
        companyId,
        adminId: actorAdminId,
        action: 'staff_created',
        entity: 'admin',
        entityId: id,
        meta: { email, role },
        ip,
      });
      await conn.commit();
      return id;
    } catch (err) {
      await conn.rollback();
      if (isUniqueViolation(err, 'admins_email_uq')) {
        throw new AppError(409, 'EMAIL_TAKEN', 'That email is already in use.');
      }
      throw err;
    }
  });

  const row = await withCompany(companyId, (conn) => repo.findAdminById(conn, { companyId, id: adminId }));
  return { admin: toAdminDto(row), tempPassword };
}

export async function patchAdmin({ companyId, id, actorAdminId, ip, name, role, isActive, resetPassword }) {
  let tempPassword;
  let passHash;
  if (resetPassword) {
    tempPassword = generateTempPassword();
    passHash = await argon2.hash(tempPassword);
  }

  await withCompany(companyId, async (conn) => {
    const existing = await repo.findAdminById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'ADMIN_NOT_FOUND', 'Staff member not found.');
    }
    if (isActive === 0 && existing.ROLE !== 'platform') {
      const activeCount = await repo.countActiveAdmins(conn, { companyId });
      if (activeCount <= 1) {
        throw new AppError(409, 'LAST_ADMIN', 'This store needs at least one active staff login — deactivate someone else first, or invite a replacement before removing this one.');
      }
    }
    await repo.updateAdmin(conn, { companyId, id, name, role, isActive, passHash });
    const changed = { name, role, isActive, resetPassword };
    await insertLog(conn, {
      companyId,
      adminId: actorAdminId,
      action: 'staff_updated',
      entity: 'admin',
      entityId: id,
      meta: { fields: Object.keys(changed).filter((k) => changed[k] !== undefined) },
      ip,
    });
    await conn.commit();
  });

  const row = await withCompany(companyId, (conn) => repo.findAdminById(conn, { companyId, id }));
  return { admin: toAdminDto(row), tempPassword };
}

export async function deleteAdmin({ companyId, id, actorAdminId, ip }) {
  if (id === actorAdminId) {
    throw new AppError(400, 'CANNOT_DELETE_SELF', 'You cannot remove your own account.');
  }

  await withCompany(companyId, async (conn) => {
    const existing = await repo.findAdminById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'ADMIN_NOT_FOUND', 'Staff member not found.');
    }
    const activeCount = await repo.countActiveAdmins(conn, { companyId });
    if (existing.IS_ACTIVE === 1 && activeCount <= 1) {
      throw new AppError(409, 'LAST_ADMIN', 'This store needs at least one active staff login.');
    }
    await repo.deleteAdmin(conn, { companyId, id });
    await insertLog(conn, {
      companyId,
      adminId: actorAdminId,
      action: 'staff_deleted',
      entity: 'admin',
      entityId: id,
      meta: { email: existing.EMAIL },
      ip,
    });
    await conn.commit();
  });

  return { ok: true };
}

/* ---------------------------------------------------------------------- roles */

export async function listRoles({ companyId }) {
  const rows = await withCompany(companyId, (conn) => repo.listRoles(conn, { companyId }));
  return { rows: rows.map(toRoleDto) };
}

export async function createRole({ companyId, code, name, perms }) {
  const roleId = await withCompany(companyId, async (conn) => {
    try {
      const id = await repo.insertRole(conn, { companyId, code, name, perms: stringifyJson(perms) });
      await conn.commit();
      return id;
    } catch (err) {
      await conn.rollback();
      if (isUniqueViolation(err, 'roles_company_code_uq')) {
        throw new AppError(409, 'ROLE_CODE_TAKEN', `"${code}" is already a role in this store.`);
      }
      throw err;
    }
  });

  const row = await withCompany(companyId, (conn) => repo.findRoleById(conn, { companyId, id: roleId }));
  return { role: toRoleDto(row) };
}

export async function patchRole({ companyId, id, name, perms }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findRoleById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found.');
    }
    await repo.updateRole(conn, { companyId, id, name, perms: perms ? stringifyJson(perms) : null });
    await conn.commit();
  });

  const row = await withCompany(companyId, (conn) => repo.findRoleById(conn, { companyId, id }));
  return { role: toRoleDto(row) };
}

export async function deleteRole({ companyId, id }) {
  const deleted = await withCompany(companyId, async (conn) => {
    const result = await repo.deleteRole(conn, { companyId, id });
    await conn.commit();
    return result;
  });
  if (!deleted) {
    throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found.');
  }
  return { ok: true };
}
