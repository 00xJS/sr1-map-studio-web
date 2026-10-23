// Ported from SR1-Creator (github.com/00xJS/SR1-Creator)
// Saints Row (2006) Xbox 360 packfile (.vpp_xbox2): magic 0x51890ACE version 3, big-endian.
// Entry records (28 bytes) start at 0x800; names follow; data follows. When the "compressed" flag is set
// each entry is its own zlib stream stored back to back at 2048-byte alignment, so a single entry can be
// read from a File by slicing just its bytes. Nothing but the directory and the entries asked for is read.
// Compressed and condensed packfiles (preload.vpp_xbox2) hold one zlib stream for all entries: it is inflated in
// chunks only as far as the entry asked for, keeping just that entry's bytes.
import { Inflate, Unzlib, inflateSync } from 'fflate'

const up = (x: number) => (x + 2047) & ~2047

export type VppSource = Blob | Uint8Array

interface Entry { name: string; at: number; size: number; ssize: number }

export interface Vpp {
  label: string
  entries: Map<string, Entry>
  has(name: string): boolean
  list(): string[]
  read(name: string): Promise<Uint8Array>
  /** The first `bytes` bytes of an entry (or all of it, if shorter), inflating no more than that needs. */
  readHead(name: string, bytes: number): Promise<Uint8Array>
}

async function readRange(src: VppSource, start: number, end: number): Promise<Uint8Array> {
  if (src instanceof Uint8Array) return src.subarray(start, end)
  return new Uint8Array(await src.slice(start, end).arrayBuffer())
}

const CHUNK = 1 << 20

/** One entry of a condensed packfile: inflate the shared stream until the entry's bytes have gone by. */
async function readCondensed(src: VppSource, dataAt: number, e: Entry, label: string): Promise<Uint8Array> {
  const out = new Uint8Array(e.size), total = src instanceof Uint8Array ? src.byteLength : src.size
  let pos = 0, got = 0
  const inf = new Unzlib((chunk) => {
    if (got >= e.size) return
    const s = Math.max(e.at - pos, 0), end = Math.min(chunk.length, e.at + e.size - pos)
    if (end > s) { out.set(chunk.subarray(s, end), pos + s - e.at); got += end - s }
    pos += chunk.length
  })
  for (let at = dataAt; at < total && got < e.size; at += CHUNK) inf.push(await readRange(src, at, Math.min(total, at + CHUNK)), false)
  if (got < e.size) throw new Error(e.name + ': the data in ' + label + ' ends early')
  return out
}

export async function openVpp(src: VppSource, label = 'packfile'): Promise<Vpp> {
  const head = await readRange(src, 0, 0x800)
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  if (head.byteLength < 0x800 || dv.getUint32(0) !== 0x51890ace || dv.getUint32(4) !== 3) throw new Error(label + ' is not a Saints Row packfile')
  const flags = head[0x14f], comp = !!(flags & 1), cond = !!(flags & 2)
  const n = dv.getUint32(0x154), namesAt = up(0x800 + dv.getUint32(0x15c)), dataAt = up(namesAt + dv.getUint32(0x160))
  const dir = await readRange(src, 0, dataAt)
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength)
  const entries = new Map<string, Entry>()
  let stored = dataAt
  for (let i = 0; i < n; i++) {
    const e = 0x800 + 28 * i
    let na = namesAt + ddv.getUint32(e), s = ''
    while (dir[na]) s += String.fromCharCode(dir[na++])
    const size = ddv.getUint32(e + 16), ssize = ddv.getUint32(e + 20)
    let at = ddv.getUint32(e + 8)
    if (comp && !cond) { at = stored; stored = up(stored + ssize) }
    entries.set(s.toLowerCase(), { name: s, at, size, ssize })
  }
  return {
    label, entries,
    has: (name) => entries.has(name.toLowerCase()),
    list: () => [...entries.values()].map((e) => e.name),
    async read(name) {
      const e = entries.get(name.toLowerCase())
      if (!e) throw new Error(name + ' not in ' + label)
      if (!comp) return readRange(src, dataAt + e.at, dataAt + e.at + e.size)
      if (cond) return readCondensed(src, dataAt, e, label)
      const raw = await readRange(src, e.at, e.at + e.ssize)
      // 2-byte zlib header, then raw deflate that ends with a sync-flush marker (no final block).
      // Append an empty final stored block so the inflater sees a complete stream.
      const body = raw.subarray(2), fin = new Uint8Array(body.length + 5)
      fin.set(body)
      fin.set([1, 0, 0, 0xff, 0xff], body.length)
      const out = inflateSync(fin)
      return out.length > e.size ? out.subarray(0, e.size) : out
    },
    async readHead(name, bytes) {
      const e = entries.get(name.toLowerCase())
      if (!e) throw new Error(name + ' not in ' + label)
      const want = Math.min(bytes, e.size)
      if (!comp) return readRange(src, dataAt + e.at, dataAt + e.at + want)
      if (cond) return (await readCondensed(src, dataAt, e, label)).subarray(0, want)
      // Raw deflate after the 2-byte zlib header, fed a slice at a time until enough has come out.
      const out = new Uint8Array(want)
      let got = 0
      const inf = new Inflate((chunk) => { const n = Math.min(chunk.length, want - got); if (n > 0) { out.set(chunk.subarray(0, n), got); got += n } })
      for (let at = e.at + 2, end = e.at + e.ssize; at < end && got < want; at += 65536) inf.push(await readRange(src, at, Math.min(end, at + 65536)), false)
      return out.subarray(0, got)
    },
  }
}
