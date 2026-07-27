import { z } from 'zod';
import { SLUG_PATTERN } from '../../lib/slug.js';

const id = z.coerce.number().int().positive();
const optionalId = z.number().int().positive();
const boolFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

export const idParamSchema = z.object({ id });

export const createBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().toLowerCase().max(200).regex(SLUG_PATTERN).optional(),
  descr: z.string().max(200_000).nullish(),
  imageId: optionalId.nullish(),
  parentId: optionalId.nullish(),
  position: z.number().int().min(0).max(100_000).optional(),
  isActive: boolFlag.optional(),
  metaTitle: z.string().max(255).nullish(),
  metaDesc: z.string().max(500).nullish(),
});

export const patchBodySchema = createBodySchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  { message: 'Provide at least one field to update.' },
);

export const listQuerySchema = z.object({
  parentId: id.optional(),
  rootOnly: z.enum(['0', '1', 'true', 'false']).transform((v) => v === '1' || v === 'true').optional(),
  isActive: z.enum(['0', '1']).transform((v) => Number(v)).optional(),
  search: z.string().trim().max(200).optional(),
});

export const treeQuerySchema = z.object({
  isActive: z.enum(['0', '1']).transform((v) => Number(v)).optional(),
});

export const reorderBodySchema = z
  .object({
    items: z
      .array(
        z.object({
          id: optionalId,
          position: z.number().int().min(0).max(100_000),
          // Absent means "leave the parent alone"; explicit null means "make it top level".
          parentId: optionalId.nullish(),
        }),
      )
      .min(1)
      .max(1000),
  })
  .refine((body) => new Set(body.items.map((item) => item.id)).size === body.items.length, {
    message: 'Each category may appear only once.',
    path: ['items'],
  });
