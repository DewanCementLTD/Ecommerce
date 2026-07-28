import { z } from 'zod';

const id = z.coerce.number().int().positive();
const boolFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));
/**
 * `platform` is not a role a store can hand out.
 *
 * Roles are otherwise free-form per company — a client invents "packer" or
 * "cashier" and defines its permissions — but `platform` is the one value the
 * API itself gives meaning to: `requireRole('platform')` gates every
 * cross-company route, including company creation, suspension and
 * impersonation. Without this check any company owner could `POST /admins`
 * with `role: "platform"` and read every other client's data through
 * `/platform/*`. Found by writing the escalation test the phase brief asks
 * for, and it passed straight through validation before this line existed.
 *
 * Platform admins are created by `scripts/seed-platform-admin.js` with
 * `company_id IS NULL`, never through this API.
 */
const RESERVED_ROLES = new Set(['platform']);

const roleCode = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .refine((value) => !RESERVED_ROLES.has(value.toLowerCase()), {
    message: 'That role is reserved by the platform and cannot be assigned to store staff.',
  });

export const idParamSchema = z.object({ id });

export const adminCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  name: z.string().trim().min(1).max(200),
  role: roleCode,
});

export const adminPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    role: roleCode.optional(),
    isActive: boolFlag.optional(),
    resetPassword: z.literal(true).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

export const roleCreateSchema = z.object({
  code: roleCode,
  name: z.string().trim().min(1).max(120),
  perms: z.array(z.string().max(100)).max(200).default([]),
});

export const rolePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    perms: z.array(z.string().max(100)).max(200).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });
