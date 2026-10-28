import { Link } from 'react-router-dom'
import { catalogs } from '../lib/catalogs'
import { Kewizzle, ZeroXJS } from '../ui'

export default function About() {
  return (
    <div className="page page-narrow">
      <h1>About</h1>
      <div className="card">
        <p>SR1 Map Studio began as <b>SR1 Map Studio v1.13</b> by <Kewizzle />, the Saints Row 1 / Saints Reborn map editor: Kewizzle had the original idea and wrote the desktop program and the map exporter. <ZeroXJS /> rebuilt it from the ground up for the browser and has taken it much further, working out more of how the game builds its maps along the way.</p>
        <ul className="small" style={{ margin: '0 0 10px', paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li><b>A 3D editor in your browser</b>, nothing to install, with a walk mode to try a map on foot.</li>
          <li><b>A map wizard</b> that builds a playable map from a setting, a layout and a player count, dressed the way Stilwater dresses each kind of place.</li>
          <li><b>Your own game's pieces</b>: real Stilwater buildings and props read from your copy of the game, each catalogued by what it is and how the game stands it, and set on the ground the way the city sets it.</li>
          <li><b>Stilwater cuts and finished maps</b>: turn a piece of the city into a multiplayer map (shrunk to fit if its textures won't), or open a finished map folder and upgrade it in place: the game's own sky, a minimap, lighting like the game's own maps, invisible walls taken out.</li>
          <li><b>Working minimaps</b>, after working out how the game finds a map's minimap.</li>
          <li><b>No invisible walls</b>: the paper-thin triangles in converted maps that stop players and cameras are taken out.</li>
          <li><b>A map health check</b>: spawns that are easy to camp, sight lines judged by what each weapon can actually hit, how fair the two halves are, spawns and guns with no stairs up or no way down without a fall, gaps and drops that hurt or kill, a bot playtest showing where players run, and textures that would overflow the game's memory (the map that loads black). One click moves spawns and weapons to where players can use them.</li>
          <li><b>Walkable stairs</b>: invisible ramps over steps and kerbs too tall to walk up.</li>
          <li><b>More in the map itself</b>: water you can swim in, physics props, glass, lighting and the game's own sky.</li>
        </ul>
        <p className="small muted">Kewizzle's Python exporter still builds every map, running inside your browser through Pyodide (Python compiled to WebAssembly), with the new map-format work added on top. Exporter version {catalogs.exporter_version}. Map-format code is a Python port of the Saints Reborn Map Converter by whompay.</p>
      </div>
      <div className="card">
        <h3>License</h3>
        <p className="small">Free software under the GNU General Public License v3.0 or later, like the desktop SR1 Map Studio and the Saints Reborn Map Converter it builds on. The full source of this site, including the Python modules it runs, is published with it.</p>
      </div>
      <div className="card">
        <h3>Starter textures</h3>
        <p className="small">The texture studio's starter library comes from <a href="https://polyhaven.com" target="_blank" rel="noreferrer">Poly Haven</a> (CC0, public domain). Generated textures are made from scratch in your browser. Both are free to use and share in your maps.</p>
      </div>
      <div className="card">
        <h3>Game data</h3>
        <p className="small">This site doesn't host or distribute any Saints Row files. Reference files load from your own copy of the SR1 Map Studio package and stay in your browser; exported maps are built and downloaded on your device. The Showcase, when a site turns it on, shares only how a map is built from Map Studio's own textures, shapes and prefabs, plus the author's screenshots. Saints Row is a trademark of its owners; this project is not affiliated with them.</p>
      </div>
      <div className="card">
        <h3>Limits carried over from the desktop version</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Custom native props support one material and fitted box collision; holes in a mesh do not become holes in the collider.</li>
          <li>Breakable wood still uses glass damage and shards. Movable and explosive props use stock behavior profiles.</li>
          <li>Up to {catalogs.limits.max_native_objects} native props and glass panes per map, subject to free native slots.</li>
          <li>Lighting, native skies and new prop behaviors still need in-game testing.</li>
        </ul>
        <p className="small" style={{ margin: 0 }}><Link to="/proven">What's been tried in game</Link>: every feature by how far it has got, with test maps to try them.</p>
      </div>
    </div>
  )
}
