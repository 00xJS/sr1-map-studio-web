# Developing SR1 Map Studio (web)

Notes for working on the code. The [README](../README.md) covers what the site does.

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
| `py/map_features.py`, `bor_mode.py`, `sound_zones.py`, `crate_debris.py` | Post-export extras (water, presets, loading screen, Blinged Out Ride, sound zones, smashing crates); `retail_features.py` is the hook `web_api.py` calls. Checks: `py -3 tests/map_features_check.py`, `tests/retail_features_check.py` (full export with `SR1_DATA_PACK`, real crate effect with `SR1_GAME_PACKFILES`). |
| `src/lib/gameFiles.ts` | Reads the player's own packfiles in the browser (sound names, crate effect); nothing is stored or uploaded. |
| `py/fast_dxt.py` | Vectorized texture compression, byte-identical to the original and about 20× faster (`py -3 tests/fast_dxt_check.py`). |
| `src/lib/py.worker.ts`, `py.ts` | Pyodide worker and its client. |
| `src/lib/geometry.ts` | JS port of the OBJ parser and scene transforms (must match the Python face order). |
| `src/editor/` | Editor UI, three.js viewer, actions, undo/redo store. |
| `src/lib/analysis/` | Map health checks (sight lines, spawn safety, red vs blue fairness, bot playtest): `analyzeMap(input)` is pure; `client.ts` runs it in workers. |
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

## Notes

- Python changes (`studio-py/`, `py/`) only reach the browser after `npm run bundle:py`; `npm run dev` runs it on start.
- The AI assistant calls NVIDIA's chat API through `netlify/functions/ai.mts` (in development, the Vite proxy in `vite.config.ts`). Users bring their own key; the relay stores nothing.
- Sample-map previews in `public/samples` are rendered by the editor; regenerate `stats.json` with `UPDATE_STATS=1 npx vitest run tests/sampleStats.test.ts`.
