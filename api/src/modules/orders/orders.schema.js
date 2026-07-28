import { z } from 'zod';

const id = z.coerce.number().int().positive();
const bodyId = z.number().int().positive();

/** Locale-tolerant: digits, spaces, +, -, (, ) — not a US-only shape. */
const phone = z.string().trim().min(5).max(40).regex(/^[0-9+\-() .]+$/, 'That does not look like a phone number.');

export const idParamSchema = z.object({ id });

const inlineAddressSchema = z.object({
  label: z.string().trim().max(100).nullish(),
  line1: z.string().trim().min(1).max(300),
  line2: z.string().trim().max(300).nullish(),
  city: z.string().trim().min(1).max(150),
  area: z.string().trim().max(150).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export const checkoutSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone,
    email: z.string().trim().toLowerCase().email().max(320).nullish(),
    note: z.string().trim().max(1000).nullish(),
    addrId: bodyId.optional(),
    address: inlineAddressSchema.optional(),
  })
  .refine((body) => (body.addrId === undefined) !== (body.address === undefined), {
    message: 'Provide either a saved addrId or an inline address, not both or neither.',
    path: ['address'],
  });

export const STATUS_VALUES = ['new', 'confirmed', 'delivered', 'cancelled'];

export const statusPatchSchema = z.object({
  status: z.enum(STATUS_VALUES),
  note: z.string().trim().max(1000).nullish(),
});

export const orderPatchSchema = z
  .object({
    note: z.string().trim().max(1000).nullish(),
    name: z.string().trim().min(1).max(200).optional(),
    phone: phone.optional(),
    email: z.string().trim().toLowerCase().email().max(320).nullish(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(STATUS_VALUES).optional(),
  search: z.string().trim().max(200).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
});

export const exportQuerySchema = listQuerySchema.omit({ page: true, pageSize: true });
