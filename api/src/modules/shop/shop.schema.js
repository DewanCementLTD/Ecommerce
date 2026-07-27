import { z } from 'zod';

const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(48).default(24);

export const slugParamSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1).max(300),
});

export const listQuerySchema = z.object({
  page,
  pageSize,
  search: z.string().trim().max(200).optional(),
  catId: z.coerce.number().int().positive().optional(),
  collId: z.coerce.number().int().positive().optional(),
  featured: z.enum(['0', '1']).transform((v) => v === '1').optional(),
  sort: z.enum(['name', 'price', 'created']).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export const catProductsQuerySchema = z.object({
  page,
  pageSize,
  sort: z.enum(['name', 'price', 'created']).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export const collProductsQuerySchema = z.object({ page, pageSize });

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  page,
  pageSize,
});
