import { z } from 'zod';

const id = z.coerce.number().int().positive();
const bodyId = z.number().int().positive();
const boolFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

/** Locale-tolerant: digits, spaces, +, -, (, ) — not a US-only shape. */
const phone = z.string().trim().min(5).max(40).regex(/^[0-9+\-() .]+$/, 'That does not look like a phone number.');

export const idParamSchema = z.object({ id });

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(200),
  phone: phone.optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export const customerPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    phone: phone.optional(),
    acceptsMarketing: boolFlag.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

export const addrCreateSchema = z.object({
  label: z.string().trim().max(100).nullish(),
  name: z.string().trim().min(1).max(200),
  phone,
  line1: z.string().trim().min(1).max(300),
  line2: z.string().trim().max(300).nullish(),
  city: z.string().trim().min(1).max(150),
  area: z.string().trim().max(150).nullish(),
  notes: z.string().trim().max(500).nullish(),
  isDefault: boolFlag.optional(),
});

export const addrPatchSchema = addrCreateSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

export const adminPatchSchema = z
  .object({ isActive: boolFlag.optional() })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

/** Used internally by checkout (Task 4), not exposed as its own endpoint. */
export const guestCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone,
  email: z.string().trim().toLowerCase().email().max(320).nullish(),
});

export { bodyId };
