// Puts the Pyodide runtime the exporter needs into public/pyodide/, so the site serves it itself instead of
// every visitor's browser fetching it from a CDN: export keeps working if the CDN is slow or down, and
// offline once the page has loaded it. The runtime comes from node_modules/pyodide (the same version as the
// loader the worker imports); the numpy and Pillow wheels aren't in that package, so they are downloaded once
// from Pyodide's CDN, checked against the SHA-256 in pyodide-lock.json, and kept in .cache/ for next time.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'node_modules', 'pyodide')
const out = join(root, 'public', 'pyodide')
const cache = join(root, '.cache', 'pyodide')
const PACKAGES = ['numpy', 'pillow']

const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version
const lock = JSON.parse(readFileSync(join(pkg, 'pyodide-lock.json'), 'utf8'))
mkdirSync(out, { recursive: true })
mkdirSync(cache, { recursive: true })

for (const name of ['pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) copyFileSync(join(pkg, name), join(out, name))

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
let fetched = 0
for (const name of PACKAGES) {
  const p = lock.packages[name]
  if (!p) throw new Error(`pyodide-lock.json has no ${name}`)
  if (p.depends?.length) throw new Error(`${name} now depends on ${p.depends.join(', ')}: add them to PACKAGES`)
  const kept = join(cache, p.file_name)
  let data = existsSync(kept) ? readFileSync(kept) : null
  if (!data || sha256(data) !== p.sha256) {
    const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${p.file_name}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Couldn't download ${url}: ${res.status}`)
    data = Buffer.from(await res.arrayBuffer())
    if (sha256(data) !== p.sha256) throw new Error(`${p.file_name} doesn't match pyodide-lock.json`)
    writeFileSync(kept, data)
    fetched++
  }
  writeFileSync(join(out, p.file_name), data)
}
writeFileSync(join(out, 'version.json'), JSON.stringify({ pyodide: version, packages: PACKAGES }))
console.log(`Pyodide ${version} in public/pyodide (${PACKAGES.join(', ')}${fetched ? `, ${fetched} downloaded` : ''})`)
