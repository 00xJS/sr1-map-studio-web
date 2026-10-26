// The developer pages' gate (src/lib/admin.ts): only an account whose email hashes to a developer's. (The developers'
// own addresses are never written in the repository, so this checks the refusals.)
import { describe, expect, it } from 'vitest'
import { isAdmin } from '../src/lib/admin'

describe('developer pages', () => {
  it('are shut to anyone signed out, without an email, or with any other email', async () => {
    expect(await isAdmin(null)).toBe(false)
    expect(await isAdmin({})).toBe(false)
    expect(await isAdmin({ email: 'someone@example.com' })).toBe(false)
    expect(await isAdmin({ email: '' })).toBe(false)
  })
})
