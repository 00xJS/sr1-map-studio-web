// A file stored by work called off meanwhile (Stop on Fix all's stair ramps) is taken out again, unless it was there
// before: files are shared by content, so another map may use it.
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { storeFile, storeFileIf } from '../src/lib/files'
import { db, sha256 } from '../src/lib/db'

const obj = (text: string) => new Blob([text], { type: 'model/obj' })

describe('storeFileIf', () => {
  it('keeps the file while the work still wants it', async () => {
    const out = await storeFileIf(obj('v 0 0 0 kept'), 'ramps.obj', () => true)
    expect(await db.hasBlob(out!.ref.hash)).toBe(true)
  })

  it('takes out a file it added once the work was called off', async () => {
    const data = obj('v 0 0 0 dropped')
    expect(await storeFileIf(data, 'ramps.obj', () => false)).toBeNull()
    expect(await db.hasBlob(await sha256(data))).toBe(false)
  })

  it('leaves a file stored before, which another map may share', async () => {
    const data = obj('v 0 0 0 shared')
    const { ref } = await storeFile(data, 'ramps.obj')
    expect(await storeFileIf(data, 'ramps.obj', () => false)).toBeNull()
    expect(await db.hasBlob(ref.hash)).toBe(true)
  })
})
