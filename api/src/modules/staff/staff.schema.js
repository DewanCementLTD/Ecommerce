import { z } from 'zod';

const id = z.coerce.number().int().positive();
const boolFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));
const roleCode = z.string().trim().min(1).max(50);

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
