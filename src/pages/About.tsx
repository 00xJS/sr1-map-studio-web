import { catalogs } from '../lib/catalogs'

export default function About() {
  return (
    <div className="page page-narrow">
      <h1>About</h1>
      <div className="card">
        <p>SR1 Map Studio (web) is a browser port of <b>SR1 Map Studio v1.13</b> by <b>kewizzle</b>, the Saints Row 1 / Saints Reborn map editor. It started from kewizzle's original program and exporter and has been built out from there. The original Python exporter runs unmodified inside your browser through Pyodide (Python compiled to WebAssembly); the editor interface was rebuilt for the web.</p>
        <p className="small muted">Exporter version {catalogs.exporter_version}. Map-format code is a Python port of the Saints Reborn Map Converter by whompay.</p>
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
        <p className="small">This site doesn't host or distribute any Saints Row files. Reference files load from your own copy of the SR1 Map Studio package and stay in your browser; exported maps are built and downloaded on your device. The hub shares editable projects made of your own models and textures. Saints Row is a trademark of its owners; this project is not affiliated with them.</p>
      </div>
      <div className="card">
        <h3>Limits carried over from the desktop version</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Custom native props support one material and fitted box collision; holes in a mesh do not become holes in the collider.</li>
          <li>Breakable wood still uses glass damage and shards. Movable and explosive props use stock behavior profiles.</li>
          <li>Up to {catalogs.limits.max_native_objects} native props and glass panes per map, subject to free native slots.</li>
          <li>Lighting, native skies and new prop behaviors still need in-game testing.</li>
        </ul>
      </div>
    </div>
  )
}
