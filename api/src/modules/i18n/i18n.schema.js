import { z } from 'zod';
import { TRANSLATABLE_ENTITIES } from './i18n.service.js';

const id = z.coerce.number().int().positive();
const boolFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

/** BCP-47-ish: `en`, `ar`, `pt-BR`. Lower-cased so `EN` and `en` are one language. */
const langCode = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(10)
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'Use a language code like "en" or "pt-br".');

export const idParamSchema = z.object({ id });

export const entityParamSchema = z.object({
  entity: z.enum(TRANSLATABLE_ENTITIES),
  id,
});

export const langCreateSchema = z.object({
  code: langCode,
  name: z.string().trim().min(1).max(100),
  isDefault: boolFlag.optional(),
  isActive: boolFlag.optional(),
});

export const langPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    isActive: boolFlag.optional(),
    isDefault: boolFlag.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update.' });

export const transPutSchema = z.object({
  lang: langCode,
  fields: z.record(z.string().max(40), z.string().max(500_000).nullable()),
});
