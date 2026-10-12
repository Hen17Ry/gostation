import * as z from 'zod/mini'

import { zodResolver } from './zod-resolver'

const schema = z
  .object({ email: z.string().check(z.minLength(1, { error: 'Champ obligatoire.' })), code: z.string() })
  .check(z.refine((v) => v.code.length === 6, { error: 'Le code compte 6 chiffres.', path: ['code'] }))

const opts = { fields: {}, shouldUseNativeValidation: false } as never

describe('zodResolver (zod/mini)', () => {
  it('renvoie les valeurs validées', async () => {
    expect(await zodResolver(schema)({ email: 'a@b.bj', code: '123456' }, undefined, opts)).toEqual({
      values: { email: 'a@b.bj', code: '123456' },
      errors: {},
    })
  })

  it('rattache la première erreur à chaque champ, raffinements compris', async () => {
    const r = await zodResolver(schema)({ email: '', code: '12' }, undefined, opts)
    expect(r.values).toEqual({})
    expect(r.errors).toMatchObject({
      email: { message: 'Champ obligatoire.' },
      code: { message: 'Le code compte 6 chiffres.' },
    })
  })
})
