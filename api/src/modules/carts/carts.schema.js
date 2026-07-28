import { z } from 'zod';

const id = z.coerce.number().int().positive();

export const idParamSchema = z.object({ id });

export const addItemSchema = z.object({
  variantId: z.number().int().positive(),
  qty: z.number().int().min(1).max(999).default(1),
});

export const patchItemSchema = z.object({
  qty: z.number().int().min(1).max(999),
});
