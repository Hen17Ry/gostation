import * as z from 'zod/mini'

export const mapsSearchSchema = z.object({
  tab: z.catch(z.optional(z.enum(['stations', 'shortages'])), undefined),
  status: z.catch(z.optional(z.enum(['all', 'pending', 'approved', 'rejected', 'suspended'])), undefined),
  reported: z.catch(z.optional(z.boolean()), undefined),
  station: z.catch(z.optional(z.string()), undefined),
  period: z.catch(z.optional(z.enum(['24h', '7d', '30d'])), undefined),
  productId: z.catch(z.optional(z.number()), undefined),
  cell: z.catch(z.optional(z.string()), undefined),
})
export type MapsSearch = z.infer<typeof mapsSearchSchema>
