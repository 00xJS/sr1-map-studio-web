# SR1 Map Studio (web)

A browser version of **SR1 Map Studio v1.13**, the Saints Row 1 / Saints Reborn map editor, with
cloud saves and a community hub. The original Python exporter runs unmodified inside the browser
through [Pyodide](https://pyodide.org); the editor interface is rebuilt with React and three.js.

- **Phase 1, editor:** import OBJ (+MTL, textures), GLB, glTF or FBX; move/rotate/scale with gizmos,
  pivots, undo/redo and autosave; textures, alpha and surface types; spawns, weapons, vehicles,
  triggers and NPC markers; point lights; breakable glass and wood; movable and explosive props;
  the collision face editor; importing a map from your own game files; export to a folder you
  drop into `SaintsReborn/dist/maps`, with Gangsta Brawl, Big Ass Chains (team and solo) and
  Protect Tha Pimp entries (PTP gets its own `<map>_ptp.cts`), stable level IDs and an optional
  random time and weather.
- **Building and textures:** block-out shapes (floor, wall, box, platform, ramp, stairs, pillar)
  with world-scaled texture mapping; grid and angle snapping; a texture studio (photo or camera,
  a generator of 11 tiling materials, a starter library of 29 CC0 textures) that also sets the
  physical surface; "Install to game" writes exports straight into `SaintsReborn/dist/maps`
  (Chrome/Edge).
- **Start with nothing:** 30 sample maps in three themes (5 starters, 13 urban paintball, 12 cyber)
  built in the browser from shapes and free textures, with spawns, weapons and lights for every mode.
  Layouts live in `src/lib/samples*.ts`; the picker's previews in `public/samples` are rendered by
  the editor itself;
  a Paint-style tool strip (select/rotate/scale, shape, paint bucket, eyedropper, spawn, weapon,
  light, eraser) with a texture palette.
- **Simple and Advanced modes:** Simple (the default) has one side panel that shows whatever is
  selected, or a "ready to play" checklist when nothing is; a first-run tour; camera buttons; and
  one Play button that checks, names, builds and installs the map. Advanced keeps every setting in
  tabs.
- **Phase 2, accounts:** sign in, save projects to the cloud and open them on another device.
- **Phase 3, hub:** publish projects, browse/search/sort, like, remix, report and moderate.

## Game data policy

The site never hosts or uploads Saints Row files.

- The exporter needs reference files (Beaver Creek template, glass/prop prefabs, sky presets, CTS
  templates). Each user loads them once from their own copy of the SR1 Map Studio package on the
  **Data pack** page; they're checked against the package's SHA-256 list and stored only in the browser.
- Files that come from a game install (CTS templates, BBCity donors, maps imported from the game)
  are marked `origin: 'game'`. They stay on the device: they're never uploaded to cloud saves, and a
  project that uses them can't be published.
- The hub shares projects (your meshes, textures, markers, lights, settings), never exported maps.
  The publish function re-checks every stored file and rejects Saints Row formats.

## Develop

```sh
npm install
npm run dev
```

`npm run dev` bundles the Python (`studio-py/` + `py/`) into `public/py/studio.zip` and starts Vite.
Set `VITE_BACKEND=local` in `.env.development.local` to try accounts, cloud saves and the hub against a
simulated server in IndexedDB. `npm test` runs the hub-rule tests; `npm run build` type-checks and builds.

Deploying with Supabase and Netlify: see [docs/DEPLOY.md](docs/DEPLOY.md).

## Layout

| Path | What it is |
| --- | --- |
| `studio-py/` | The desktop package's Python modules, **unmodified** (Qt UI and tests excluded). |
| `py/web_api.py` | Bridge: repeats what the desktop `MainWindow` did around each exporter call, without Qt. |
| `py/fast_dxt.py` | Vectorized texture compression, byte-identical to the original and about 20× faster (`py -3 tests/fast_dxt_check.py`). |
| `src/lib/py.worker.ts`, `py.ts` | Pyodide worker and its client. |
| `src/lib/geometry.ts` | JS port of the OBJ parser and scene transforms (must match the Python face order). |
| `src/editor/` | Editor UI, three.js viewer, actions, undo/redo store. |
| `src/lib/backend/` | Account/hub API: `supabase.ts` (production), `local.ts` (simulated). |
| `src/lib/hubRules.ts` | Publish rules shared by the browser and `netlify/functions/publish.mts`. |
| `supabase/migrations/` | Database schema, row-level security and storage policies. |

Project files keep the desktop scene-item schema, so the original Python reads them unchanged.
Desktop `.sr1map.json` projects can be imported from the home page together with their files.

## Updating the exporter

Copy the new desktop version's Python modules into `studio-py/`, then run
`py -3 scripts/dump-catalogs.py` to refresh the marker/weapon/vehicle catalogs, and check
`src/lib/datapack-manifest.json` against the new `PACKAGE_MANIFEST.json`.

## Verified

- The exporter self-test passes in the browser.
- An export from the editor is byte-identical to the same project exported by desktop Python (all six
  map files: BBChunk, PEG, BBCity, HMAP, PVSV, CTS).
- Not yet tested: loading exported maps in the game, and the Supabase backend against a real project.

## License

GPL-3.0-or-later (see `LICENSE`), like SR1 Map Studio and the Saints Reborn Map Converter by
whompay that its map-format code is ported from (`studio-py/SOURCE_ATTRIBUTION.md`).
