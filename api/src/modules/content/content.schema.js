import { z } from 'zod';
import { SECTION_TYPES } from '@storeforge/shared';
import { SLUG_PATTERN } from '../../lib/slug.js';

const id = z.coerce.number().int().positive();
const bodyId = z.number().int().positive();
const boolFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

export const idParamSchema = z.object({ id });
export const slugParamSchema = z.object({ slug: z.string().trim().toLowerCase().min(1).max(300) });

/* -------------------------------------------------------------------- pages */

export const pageCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().toLowerCase().max(300).regex(SLUG_PATTERN).optional(),
  content: z.string().max(500_000).nullish(),
  isActive: boolFlag.optional(),
  metaTitle: z.string().max(255).nullish(),
  metaDesc: z.string().max(500).nullish(),
  ogImageId: bodyId.nullish(),
});

export const pagePatchSchema = pageCreateSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

export const pageListQuerySchema = z.object({
  isActive: z.enum(['0', '1']).transform(Number).optional(),
});

/* ----------------------------------------------------------------- sections */

/**
 * `settings` is validated against the shared registry, not spelled out here —
 * that is the whole point of the registry existing. The type must be one it
 * knows, and the service normalises the object against the type's field list.
 */
export const sectionCreateSchema = z.object({
  type: z.enum(SECTION_TYPES),
  position: z.number().int().min(0).max(1000).optional(),
  isActive: boolFlag.optional(),
  settings: z.record(z.string(), z.any()).optional(),
});

export const sectionPatchSchema = z
  .object({
    isActive: boolFlag.optional(),
    settings: z.record(z.string(), z.any()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

export const sectionReorderSchema = z
  .object({
    items: z
      .array(z.object({ id: bodyId, position: z.number().int().min(0).max(1000) }))
      .min(1)
      .max(100),
  })
  .refine((body) => new Set(body.items.map((item) => item.id)).size === body.items.length, {
    message: 'Each section may appear only once.',
    path: ['items'],
  });

/* ------------------------------------------------------------------ banners */

export const bannerCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    mediaId: bodyId.nullish(),
    mediaMobileId: bodyId.nullish(),
    link: z.string().trim().max(500).nullish(),
    alt: z.string().trim().max(255).nullish(),
    position: z.number().int().min(0).max(10_000).optional(),
    isActive: boolFlag.optional(),
    startsAt: z.string().datetime({ offset: true }).nullish(),
    endsAt: z.string().datetime({ offset: true }).nullish(),
  })
  .refine((body) => !body.startsAt || !body.endsAt || new Date(body.endsAt) > new Date(body.startsAt), {
    message: 'The end of the schedule must be after its start.',
    path: ['endsAt'],
  });

export const bannerPatchSchema = bannerCreateSchema
  .innerType()
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' })
  .refine((body) => !body.startsAt || !body.endsAt || new Date(body.endsAt) > new Date(body.startsAt), {
    message: 'The end of the schedule must be after its start.',
    path: ['endsAt'],
  });

export const bannerListQuerySchema = z.object({
  isActive: z.enum(['0', '1']).transform(Number).optional(),
  live: z.enum(['0', '1']).transform((v) => v === '1').optional(),
});

/* -------------------------------------------------------------------- menus */

export const menuPatchSchema = z.object({ name: z.string().trim().min(1).max(120) });

export const menuItemCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    linkType: z.enum(['url', 'cat', 'coll', 'page', 'product']).default('url'),
    url: z.string().trim().max(500).nullish(),
    linkId: bodyId.nullish(),
    parentId: bodyId.nullish(),
    position: z.number().int().min(0).max(1000).optional(),
    isActive: boolFlag.optional(),
  })
  .refine((body) => (body.linkType === 'url' ? Boolean(body.url) : Boolean(body.linkId)), {
    message: 'A url link needs a url; every other link type needs something to point at.',
    path: ['linkId'],
  });

export const menuItemPatchSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    linkType: z.enum(['url', 'cat', 'coll', 'page', 'product']).optional(),
    url: z.string().trim().max(500).nullish(),
    linkId: bodyId.nullish(),
    parentId: bodyId.nullish(),
    position: z.number().int().min(0).max(1000).optional(),
    isActive: boolFlag.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

export const menuItemReorderSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: bodyId,
          position: z.number().int().min(0).max(1000),
          parentId: bodyId.nullish(),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine((body) => new Set(body.items.map((item) => item.id)).size === body.items.length, {
    message: 'Each menu item may appear only once.',
    path: ['items'],
  });
