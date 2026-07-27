import { z } from 'zod';

export const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  bizName: z.string().max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  currency: z.string().max(10).optional(),
  timezone: z.string().max(60).optional(),
  themeId: z.coerce.number().int().optional(),
  domainHost: z.string().min(1).max(255),
  adminEmail: z.string().email(),
  adminName: z.string().min(1).max(200),
  defaultLangCode: z.string().max(10).default('en'),
  defaultLangName: z.string().max(100).default('English'),
});

export const updateCompanySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  bizName: z.string().max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  currency: z.string().max(10).optional(),
  timezone: z.string().max(60).optional(),
  themeId: z.coerce.number().int().optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const addDomainSchema = z.object({
  host: z.string().min(1).max(255),
});

export const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  companyId: z.coerce.number().int().optional(),
  action: z.string().max(100).optional(),
});
