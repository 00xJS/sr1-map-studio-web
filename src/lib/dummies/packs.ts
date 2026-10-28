// The packfiles a dummy is built from (sr1char/folder.ts PACKFILES), opened from the remembered game folder and
// read by byte range in the browser, once per tab.
import { gameFolderFiles, PACKFILES } from '../sr1char/folder'
import { openVpp, type Vpp } from '../sr1char/vpp'

let opened: { key: string; packs: Promise<Vpp[]> } | null = null

/** `ask` may prompt for the folder (needs a click). Null when there is none or it lacks the packfiles. */
export async function dummyPacks(ask: boolean): Promise<Vpp[] | null> {
  const found = await gameFolderFiles(PACKFILES, ask).catch(() => null)
  if (!found?.has('misc2.vpp_xbox2') || !found.has('cmesh_stream.vpp_xbox2')) return null
  const key = PACKFILES.map((n) => { const f = found.get(n); return f ? `${n}:${f.size}:${f.lastModified}` : '' }).join('|')
  if (opened?.key !== key) {
    const packs = Promise.all(PACKFILES.filter((n) => found.has(n)).map((n) => openVpp(found.get(n)!, n)))
    opened = { key, packs }
    packs.catch(() => { if (opened?.packs === packs) opened = null })
  }
  return opened.packs
}
