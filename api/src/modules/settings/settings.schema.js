import { z } from 'zod';

export const putBodySchema = z.object({
  values: z.record(z.string().min(1).max(100), z.string().max(20_000).nullable()).refine(
    (values) => Object.keys(values).length > 0,
    { message: 'Provide at least one key to update.' },
  ),
});
