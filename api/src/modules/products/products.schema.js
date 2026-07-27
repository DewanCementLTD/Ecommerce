import { z } from 'zod';
import { SLUG_PATTERN } from '../../lib/slug.js';

const id = z.coerce.number().int().positive();
const bodyId = z.number().int().positive();
const boolFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));
const money = z.number().min(0).max(99_999_999.99).multipleOf(0.01);

export const idParamSchema = z.object({ id });
export const variantParamSchema = z.object({ id, variantId: id });
export const imageParamSchema = z.object({ id, imageId: id });

export const variantInputSchema = z.object({
  sku: z.string().trim().max(100).nullish(),
  barcode: z.string().trim().max(100).nullish(),
  name: z.string().trim().max(200).nullish(),
  /** e.g. { Size: 'M', Cut: 'Boneless' } — validated against the product's options. */
  opts: z.record(z.string().max(100), z.string().max(200)).nullish(),
  price: money.default(0),
  salePrice: money.nullish(),
  cost: money.nullish(),
  stock: z.number().int().min(0).max(9_999_999).default(0),
  weight: z.number().min(0).max(99_999.999).nullish(),
  isDefault: boolFlag.optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  isActive: boolFlag.optional(),
});

export const optionInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  vals: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  position: z.number().int().min(0).max(1000).optional(),
});

export const createBodySchema = z.object({
  name: z.string().trim().min(1).max(300),
  slug: z.string().trim().toLowerCase().max(300).regex(SLUG_PATTERN).optional(),
  descr: z.string().max(500_000).nullish(),
  shortDesc: z.string().max(1000).nullish(),
  brand: z.string().trim().max(200).nullish(),
  isActive: boolFlag.optional(),
  isFeatured: boolFlag.optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).nullish(),
  metaTitle: z.string().max(255).nullish(),
  metaDesc: z.string().max(500).nullish(),
  catIds: z.array(bodyId).max(100).optional(),
  options: z.array(optionInputSchema).max(5).optional(),
  /** Omit to get one default variant at price 0 — every product has at least one. */
  variants: z.array(variantInputSchema).max(100).optional(),
});

export const patchBodySchema = createBodySchema
  .omit({ variants: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  catId: id.optional(),
  collId: id.optional(),
  isActive: z.enum(['0', '1']).transform(Number).optional(),
  isFeatured: z.enum(['0', '1']).transform(Number).optional(),
  sort: z.enum(['name', 'price', 'created', 'updated']).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export const bulkBodySchema = z.object({
  ids: z.array(bodyId).min(1).max(500),
  action: z.enum(['activate', 'deactivate', 'delete']),
});

export const catsBodySchema = z.object({
  catIds: z.array(bodyId).max(100),
});

export const imageBodySchema = z.object({
  mediaId: bodyId,
  alt: z.string().max(255).nullish(),
});

export const imagePatchSchema = z.object({
  alt: z.string().max(255).nullish(),
});

export const imageReorderSchema = z
  .object({
    items: z
      .array(z.object({ id: bodyId, position: z.number().int().min(0).max(10_000) }))
      .min(1)
      .max(200),
  })
  .refine((body) => new Set(body.items.map((item) => item.id)).size === body.items.length, {
    message: 'Each image may appear only once.',
    path: ['items'],
  });

export const optionsBodySchema = z.object({
  options: z.array(optionInputSchema).max(5),
});

/** Either move stock by `delta` or set it outright — never both, never neither. */
export const stockBodySchema = z
  .object({
    delta: z.number().int().min(-9_999_999).max(9_999_999).optional(),
    set: z.number().int().min(0).max(9_999_999).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((body) => (body.delta === undefined) !== (body.set === undefined), {
    message: 'Provide exactly one of delta or set.',
  });
