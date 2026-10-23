// Development only: lets the dev server hand the "From my game" library a local game install, since a test
// browser can't be driven through the folder picker. Off unless SR1_PACKFILES names the game's packfiles
// folder; then GET /__sr1dev/packfiles lists the library's packfiles and /__sr1dev/packfiles/<name> serves
// byte ranges of one. Never part of a build: Vite only runs configureServer for `vite` (serve).
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

const NAMES = ['sr_city_stream.vpp_xbox2', 'mp_city_stream.vpp_xbox2', 'misc2.vpp_xbox2', 'misc.vpp_xbox2']

export function devGameFiles(): Plugin {
  return {
    name: 'sr1-dev-game-files',
    apply: 'serve',
    configureServer(server) {
      const dir = process.env.SR1_PACKFILES
      if (!dir || !existsSync(dir)) return
      server.middlewares.use('/__sr1dev/packfiles', (req, res) => {
        const name = decodeURIComponent((req.url || '/').slice(1).split('?')[0])
        if (!name) {
          const list = Object.fromEntries(NAMES.filter((n) => existsSync(join(dir, n))).map((n) => [n, statSync(join(dir, n)).size]))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(list))
          return
        }
        if (!NAMES.includes(name) || !existsSync(join(dir, name))) { res.statusCode = 404; res.end(); return }
        const path = join(dir, name), size = statSync(path).size
        const m = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range || ''))
        const start = m ? +m[1] : 0, end = m && m[2] ? Math.min(+m[2], size - 1) : size - 1
        res.statusCode = m ? 206 : 200
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Length', String(end - start + 1))
        if (m) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
        createReadStream(path, { start, end }).pipe(res)
      })
    },
  }
}
