// Packs the unmodified SR1 Map Studio Python modules (studio-py/) and the
// browser bridge (py/) into public/py/studio.zip for the Pyodide worker.
// Only source code goes in here: game data is never bundled with the site.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = {}
for (const dir of ['studio-py', 'py']) {
  for (const name of readdirSync(join(root, dir))) {
    if (!name.endsWith('.py')) continue
    files[name] = new Uint8Array(readFileSync(join(root, dir, name)))
  }
}
const out = join(root, 'public', 'py')
mkdirSync(out, { recursive: true })
const zip = zipSync(files, { level: 9 })
writeFileSync(join(out, 'studio.zip'), zip)
const newest = Math.max(...Object.keys(files).map((n) => {
  for (const dir of ['studio-py', 'py']) {
    try { return statSync(join(root, dir, n)).mtimeMs } catch { /* other dir */ }
  }
  return 0
}))
writeFileSync(join(out, 'version.json'), JSON.stringify({ files: Object.keys(files).length, built: Math.round(newest) }))
console.log(`bundled ${Object.keys(files).length} Python modules (${(zip.length / 1024).toFixed(0)} KB)`)
