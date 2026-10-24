// Development only: lets a test browser open the maps installed in a local SaintsReborn/dist/maps, since it
// can't be driven through the folder picker. Off unless SR1_MAPS names that folder (or SR1_PACKFILES does the
// packfiles one, with maps two folders up). GET /__sr1dev/maps lists the map folders, /__sr1dev/maps/<name> the
// files in one, /__sr1dev/maps/<name>/<path> serves one file. Read only, and never part of a build: Vite only
// runs configureServer for `vite` (serve).
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

function mapsDir(): string | null {
  const own = process.env.SR1_MAPS
  if (own && existsSync(own)) return own
  const packs = process.env.SR1_PACKFILES
  const guess = packs ? resolve(packs, '..', '..', 'maps') : ''
  return guess && existsSync(guess) ? guess : null
}

function list(dir: string, base = dir, out: Record<string, number> = {}) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const s = statSync(p)
    if (s.isDirectory()) list(p, base, out)
    else out[relative(base, p).split(sep).join('/')] = s.size
  }
  return out
}

export function devMaps(): Plugin {
  return {
    name: 'sr1-dev-maps',
    apply: 'serve',
    configureServer(server) {
      const dir = mapsDir()
      if (!dir) return
      server.middlewares.use('/__sr1dev/maps', (req, res) => {
        const parts = decodeURIComponent((req.url || '/').split('?')[0]).split('/').filter(Boolean)
        const json = (v: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)) }
        if (!parts.length) return json(readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()))
        const root = resolve(dir, parts[0])
        const path = resolve(root, ...parts.slice(1))
        // Nothing outside the maps folder.
        if (!root.startsWith(resolve(dir) + sep) || !(path === root || path.startsWith(root + sep)) || !existsSync(path)) { res.statusCode = 404; res.end(); return }
        if (statSync(path).isDirectory()) return json(list(path))
        res.setHeader('Content-Length', String(statSync(path).size))
        createReadStream(path).pipe(res)
      })
    },
  }
}
