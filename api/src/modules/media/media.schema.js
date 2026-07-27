import { z } from 'zod';

export const uploadBodySchema = z.object({
  alt: z.string().max(255).optional(),
  folder: z.string().max(100).optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  folder: z.string().max(100).optional(),
});

export const patchBodySchema = z.object({
  alt: z.string().max(255).optional(),
  folder: z.string().max(100).optional(),
});
