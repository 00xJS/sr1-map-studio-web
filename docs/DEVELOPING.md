# Developing SR1 Map Studio (web)

Notes for working on the code. The [README](../README.md) covers what the site does.

## Develop

```sh
npm install
npm run dev
```

`npm run dev` bundles the Python (`studio-py/` + `py/`) into `public/py/studio.zip` and starts Vite.
Set `VITE_BACKEND=local` in `.env.development.local` to try accounts, cloud saves and the Showcase against a
simulated server in IndexedDB. `npm run build` type-checks and builds.

## Test

| Command | What it runs |
| --- | --- |
| `npm test` | Everything except the slow extras below, in about a minute. Each new-map-wizard setting and layout is built with one seed (the four seed setups take turns, so all are covered). |
| `npm run test:game` | The checks that read a local Saints Row install (`tests/gameObjects.test.ts`, `city.test.ts`, `sr1char.test.ts`, `gameSky.test.ts`): `SR1_PACKFILES`, or `C:/Games/SaintsReborn/dist/game/packfiles`. Skipped when there is no install. Nothing from the game is copied into the repo. |
| `npm run test:full` | All of it: the game install checks and every wizard setting and layout with all four seeds. Run before a release or after changing the generators. |
| `npm run lint` | ESLint: TypeScript's recommended rules and React's rules of hooks (warnings for effect dependencies). Type errors are `npm run typecheck` (`tsc -b`). |
| `npm run test:e2e` | Playwright: the core loop in Chromium (`tests/e2e/smoke.spec.ts`). Set `E2E_URL` to test a running site or a deploy preview; otherwise it starts the dev server on port 4188. First time: `npx playwright install chromium`. |

Component tests are `tests/**/*.test.tsx` (jsdom, Testing Library). `tests/prefabGeometry.test.ts` hashes every prefab's parts: update its snapshot (`-u`) only when a prefab changed on purpose. The mode is vitest's `--mode` (`game` or `full`), read in `tests/testMode.ts`. Showcase rules are tested in `tests/showcase.test.ts`. The Python checks in `tests/*_check.py` run separately (see the table below).

Deploying with Supabase and Netlify: see [docs/DEPLOY.md](docs/DEPLOY.md).

## After an in-game test

Change the feature in `src/lib/featureStatus.ts`: its `state` (`'proven'` once it works in game) and `tested` (when, and on which map, as `'2026-10-24, Dust and Sublot'`), and its `note` to what was seen. Every badge and note on the site reads from there: the `<Status>` chips, the hints, the export summary and the [/proven](/proven) page, which also builds the sprint's test maps (`src/lib/testMaps.ts`; checks in `tests/testMaps.test.ts`).

## Layout

| Path | What it is |
| --- | --- |
| `studio-py/` | The desktop package's Python modules, **unmodified** (Qt UI and tests excluded). |
| `py/web_api.py` | Bridge: repeats what the desktop `MainWindow` did around each exporter call, without Qt. |
| `py/map_features.py`, `bor_mode.py`, `sound_zones.py`, `crate_debris.py` | Post-export extras (water, presets, loading screen, Blinged Out Ride, sound zones, smashing crates); `retail_features.py` is the hook `web_api.py` calls. Checks: `py -3 tests/map_features_check.py`, `tests/retail_features_check.py` (full export with `SR1_DATA_PACK`, real crate effect with `SR1_GAME_PACKFILES`). |
| `src/lib/gameFiles.ts` | Reads the player's own packfiles in the browser (sound names, crate effect); nothing is stored or uploaded. |
| `py/native_sky.py`, `src/lib/gameSky.ts` | The game's own sky at export: the five sky objects of retail `mp_bac_01` (Sun, Moon, Stars, Atmosphere, Cloud Layer: records, meshes, materials, pictures) copied from the player's `mp_city_stream.vpp_xbox2` into free slots of the map template, listed in the chunk's sky list; the fake sky box is emptied when it goes in, and stays as the fallback otherwise. The editor's walk-through shows a painted stand-in (`src/editor/skyLook.ts`). Checks: `tests/gameSky.test.ts`; `py -3 tests/native_sky_check.py` (with `SR1_GAME_PACKFILES`, and `SR1_DATA_PACK` for full exports). Untested in game. |
| `src/lib/gameObjects/` | The "From my game" library: a TypeScript reader for map chunks (`chunk.ts`, the reading half of `sr_reborn_core.read_chunk`), the index of distinct objects (`indexer.ts`), cutting one out with its textures (`extract.ts`, `textures.ts`) in a worker (`worker.ts`), and placing it as an OBJ + PNGs stored with origin `game` (`place.ts`). Backups carry only where each object came from (`policy.ts`); hub, Showcase and share links refuse or leave them out. UI: `src/editor/GameObjectsTab.tsx`, `gameObjectActions.ts`. Tests: `tests/gameObjects.test.ts` (with `npm run test:game` it also indexes a local install when there is one: `SR1_PACKFILES`); full export of a real object: `tests/game_objects_check.py`. In the dev server, `SR1_PACKFILES=<packfiles folder> npx vite` and `await __sr1GameObjects.useDevServer()` in the console stand in for the folder picker (dev only, not in builds). |
| `py/surface_registration.py` | Early surface registration (desktop v1.15's "Register surface impacts early", Export tab, off by default): upstream copies the map's surface textures into a map-specific `sf_<hash>` environment pair (a stock sky, `sr_custom000001` unless a native sky is chosen) that a full-size city file built from the bundled `surface_preload_presets/surftest.bbcity_xbox2` loads first. This module passes the template and pair from the data pack folder, and after the web's own changes to the map PEG re-runs v1.15's export check on the pair, building it again if a surface texture changed. Map names ≤ 10 characters; the game's own sky is off with it. Check: `tests/surface_registration_check.py` (with `SR1_DATA_PACK`). Untested in game. |
| `py/prop_library.py`, `src/lib/propLibrary.ts` | v1.15's stock object library (`native_props/expanded_v114`, v1.15 package only): upstream reads it when `sr1_prop_catalog` is imported, before the browser has mounted the data pack, so a stand-in keeps v1.13 behaviour until `refresh()` finds it. With it, the physics props whose profile it lists use the retail object record it copied (`map_features.prepare_breakables`), native objects wear their profile's surface, and the Physics panel lists its other profiles (read from the player's data pack in the browser; nothing from it is committed). |
| `py/item_props.py` | "Item prop" markers: the game's own items placed by name in the map CTS `#Items` (names read from the player's game in `src/lib/gameObjects/items.ts`). Untested in game. |
| `py/fast_dxt.py` | Vectorized texture compression, byte-identical to the original and about 40× faster (`py -3 tests/fast_dxt_check.py`). |
| `py/export_runner.py` | What the worker calls to export: stage progress for the UI, reuse of the last geometry build and of a whole unchanged export, old job folders cleared. |
| `py/export_cache.py`, `py/fast_geometry.py` | Export speed-ups swapped in over upstream functions: compressed textures cached by pixel hash (in memory and in IndexedDB at `/cache`), numpy tiling, collision trees and checks. Same bytes out: `py -3 tests/export_cache_check.py`. |
| `src/lib/py.worker.ts`, `py.ts` | Pyodide worker and its client. |
| `src/lib/geometry.ts` | JS port of the OBJ parser and scene transforms (must match the Python face order). |
| `src/editor/` | Editor UI, three.js viewer, undo/redo store (selection follows each thing by uid through edits and undo). Commands are in `act/` (`actions.ts` re-exports them); every key and the `?` sheet come from `shortcuts.ts`. |
| `src/lib/featureStatus.ts` | What has been tried in game. Every "not yet tried in game" note (`<Status>` in `ui.tsx`, `statusSentence`, the export summary) reads from it: after an in-game test, change the feature's state there. |
| `src/lib/testMaps.ts` | The in-game test sprint's maps, one per batch (the defaults, dry interiors, the opt-ins), built from sample-map parts with a checklist from the features' notes; shown on `/proven` (`src/pages/Proven.tsx`). |
| `src/lib/prefabKit.ts` | The helpers the prefab packs share (`pf`, `pfp`, `num`, `sel`, `yesNo`, `solid`). |
| `src/lib/units.ts`, `src/lib/touch.ts` | Editor units to game metres (by the map's world scale) and metre formatting; pointer and screen checks. |
| `scripts/bundle-pyodide.mjs` | Run by `bundle:py`: the Python runtime into `public/pyodide` (numpy and Pillow wheels downloaded once, checked against `pyodide-lock.json`, kept in `.cache/`), so export doesn't depend on a CDN. |
| `src/lib/analysis/` | Map health checks (sight lines, spawn safety, red vs blue fairness, bot playtest): `analyzeMap(input)` is pure; `client.ts` runs it in workers. |
| `src/lib/backend/` | Account/hub API: `supabase.ts` (production), `local.ts` (simulated). |
| `src/lib/hubRules.ts` | Publish rules shared by the browser and `netlify/functions/publish.mts`. |
| `supabase/migrations/` | Database schema, row-level security and storage policies. |

Project files keep the desktop scene-item schema, so the original Python reads them unchanged.
Desktop `.sr1map.json` projects can be imported from the home page together with their files.

## Updating the exporter

Copy the new desktop version's Python modules into `studio-py/` (leave out the Qt UI ones: `sr1_halo_map_studio.py`, `*_ui.py`, and the tests), then run
`py -3 scripts/dump-catalogs.py` to refresh the marker/weapon/vehicle catalogs, and check
`src/lib/datapack-manifest.json` against the new `PACKAGE_MANIFEST.json`.
The speed-ups in `py/export_cache.py`, `py/fast_geometry.py` and `py/export_runner.py` replace
upstream functions by name, so rerun `tests/export_cache_check.py` and `tests/fast_dxt_check.py`
(with `SR1_DATA_PACK` set) after an update: they compare against the new originals. Run every `tests/*_check.py`
with both a v1.13 and a v1.15 folder as `SR1_DATA_PACK`: the data pack page accepts either package.

## Verified

- The exporter self-test passes in the browser.
- An export from the editor is byte-identical to the same project exported by desktop Python (all six
  map files: BBChunk, PEG, BBCity, HMAP, PVSV, CTS).
- Exports through the caches write the same bytes as without them (`tests/export_cache_check.py`: cold
  cache, nothing changed, a marker moved, a new page reading the disk cache; and the full Downtown
  Crossroads sample compared by hand against an export from before the caches existed).
- Not yet tested: loading exported maps in the game, and the Supabase backend against a real project.

## Notes

- Python changes (`studio-py/`, `py/`) only reach the browser after `npm run bundle:py`; `npm run dev` runs it on start.
- The AI assistant calls NVIDIA's chat API through the edge function `netlify/edge-functions/ai.ts` (in development, the Vite proxy in `vite.config.ts`). Users bring their own key; the relay stores nothing.
- Sample-map previews in `public/samples` are rendered by the editor; regenerate `stats.json` with `UPDATE_STATS=1 npx vitest run tests/sampleStats.test.ts`.
