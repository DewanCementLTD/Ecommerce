import { z } from 'zod';
import { SLUG_PATTERN } from '../../lib/slug.js';

const id = z.coerce.number().int().positive();
const bodyId = z.number().int().positive();
const boolFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

export const idParamSchema = z.object({ id });

/**
 * Shape only — which operators a field accepts, and whether its value makes
 * sense, is decided by the rule compiler in colls.repo.js so there is one
 * authority on the grammar instead of two that can disagree.
 */
export const rulesSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  conditions: z
    .array(
      z.object({
        field: z.enum(['cat_id', 'brand', 'tag', 'price', 'is_featured']),
        op: z.enum(['eq', 'neq', 'gt', 'lt', 'in']),
        value: z.union([
          z.string().max(200),
          z.number(),
          z.boolean(),
          z.array(z.union([z.string().max(200), z.number()])).max(50),
        ]),
      }),
    )
    .max(20),
});

export const createBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: z.string().trim().toLowerCase().max(200).regex(SLUG_PATTERN).optional(),
    descr: z.string().max(200_000).nullish(),
    imageId: bodyId.nullish(),
    type: z.enum(['manual', 'auto']).default('manual'),
    rules: rulesSchema.nullish(),
    isActive: boolFlag.optional(),
    productIds: z.array(bodyId).max(500).optional(),
  })
  .refine((body) => body.type !== 'auto' || (body.rules?.conditions?.length ?? 0) > 0, {
    message: 'An automatic collection needs at least one rule.',
    path: ['rules'],
  })
  .refine((body) => body.type !== 'auto' || !body.productIds?.length, {
    message: 'An automatic collection picks its own products; remove productIds.',
    path: ['productIds'],
  });

export const patchBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: z.string().trim().toLowerCase().max(200).regex(SLUG_PATTERN).optional(),
    descr: z.string().max(200_000).nullish(),
    imageId: bodyId.nullish(),
    type: z.enum(['manual', 'auto']).optional(),
    rules: rulesSchema.nullish(),
    isActive: boolFlag.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  type: z.enum(['manual', 'auto']).optional(),
  isActive: z.enum(['0', '1']).transform(Number).optional(),
});

export const productsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const membersBodySchema = z.object({
  productIds: z.array(bodyId).max(500),
});

export const reorderBodySchema = z
  .object({
    items: z
      .array(z.object({ productId: bodyId, position: z.number().int().min(0).max(100_000) }))
      .min(1)
      .max(500),
  })
  .refine((body) => new Set(body.items.map((item) => item.productId)).size === body.items.length, {
    message: 'Each product may appear only once.',
    path: ['items'],
  });
