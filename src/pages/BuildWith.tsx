// "Build with" at the top of the Start a map dialog: the site's own pieces, or real buildings and props from the
// player's own game. The choice holds for every way to start a map (the wizard, Describe it, City and the catalogue
// samples), which each build with game pieces when it is on (gameSample.ts, wizardModules.ts); a whole generated city
// stays the site's (the real one is on the Stilwater page).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toastError } from '../ui'
import { buildIndex, loadIndex, useGameObjects } from '../lib/gameObjects/client'
import { loadCityLabels, loadLabels, useCityLabels, useGameLabels } from '../lib/gameObjects/labels'
import { GameCity } from '../lib/gameObjects/wizardModules'
import type { GameObjectEntry } from '../lib/gameObjects/indexer'
import type { WizardSetting } from '../lib/mapWizard'
import type { Sample } from '../lib/sampleKit'
import { COMPACT_TARGETS, SAMPLES } from '../lib/samples'
import { gameSampleFor, settingFor } from '../lib/gameObjects/gameSample'

const KEY = 'sr1-build-with'

/** The choice, remembered in this browser. */
export function useBuildWith(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(KEY) === 'game' } catch { return false } })
  return [on, (v) => { setOn(v); try { localStorage.setItem(KEY, v ? 'game' : 'site') } catch { /* private window: just this time */ } }]
}

/** What building with game pieces needs: the player's library and their labels for it (read in this browser). */
export function useGameSource() {
  const entries = useGameObjects((s) => s.entries)
  const { labels, version } = useGameLabels()
  const cityLabels = useCityLabels()
  useEffect(() => { void loadIndex().catch(() => {}); void loadLabels(); void loadCityLabels() }, [])
  return { entries, labels, version, cityLabels }
}
export type GameSource = ReturnType<typeof useGameSource>

/** Whether the player chose game pieces (outside the dialog: the home page's and the catalogue's samples). */
export const buildsWithGame = () => { try { return localStorage.getItem(KEY) === 'game' } catch { return false } }

/** The game source as it is now, outside React (its library and labels read from this browser first). */
export async function gameSourceNow(): Promise<GameSource> {
  await Promise.all([loadIndex().catch(() => {}), loadLabels(), loadCityLabels()])
  const { labels, version } = useGameLabels.getState()
  return { entries: useGameObjects.getState().entries, labels, version, cityLabels: useCityLabels.getState() }
}

/** A catalogue sample built with game pieces; null when there is no library, or the game has nothing like it (cyber). */
export function gameSampleOf(id: string, compact: boolean, src: GameSource): Sample | null {
  const s = SAMPLES.find((x) => x.id === id), setting = s ? settingFor(s) : null
  const city = s && setting ? gameCity(src, setting, 1) : null
  return s && setting && city ? gameSampleFor(s, compact, COMPACT_TARGETS, city.pieces, setting) : null
}

/** Game pieces for one map: whole Stilwater modules and groups where they fit, single models otherwise. */
export function gameCity(src: GameSource, setting: WizardSetting, seed: number): GameCity | null {
  return src.entries ? new GameCity(src.entries as GameObjectEntry[], { setting, seed, labels: src.labels, labelsVersion: src.version, cityLabels: src.cityLabels }) : null
}

/** The two buttons, and what game pieces need and mean. */
export function BuildWith({ on, setOn }: { on: boolean; setOn: (v: boolean) => void }) {
  const { entries, status, progress } = useGameObjects()
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try { await buildIndex(true); setOn(true) } catch (e) { toastError(e) } finally { setLoading(false) }
  }
  return (
    <div className="col" style={{ gap: 6, paddingBottom: 8, borderBottom: '1px solid var(--border, #2a2a33)' }}>
      <span className="section-title">Build with</span>
      <div className="row wrap">
        <button className={'sm' + (!on ? ' on' : '')} onClick={() => setOn(false)} title="The site's own buildings, shapes and prefabs: shareable anywhere">Site pieces</button>
        <button className={'sm' + (on ? ' on' : '')} disabled={!entries} onClick={() => setOn(true)}
          title={entries ? 'Real buildings and props from your own Saints Row game files' : 'Load your game library first'}>🎮 Game pieces</button>
      </div>
      {!entries && (
        <span className="faint small">
          Game pieces builds every kind of map (the wizard, Describe it, City and the samples) from real buildings and props in your own game. It needs your game library, read from your Saints Reborn folder on this device:{' '}
          {status === 'indexing' || loading
            ? <b>reading your game ({progress ? `${progress.done}/${progress.total || '…'}` : '…'})</b>
            : <button className="link small" onClick={() => void load()}>load my game library</button>}
        </span>
      )}
      {on && entries && (
        <span className="small" style={{ color: 'var(--warn, #e0b050)' }}>
          Built from models in your own game files, kept on this device: you can put the map in your game, but it can't be shared, put on the Showcase or synced. Cyber maps keep the site's pieces (the game has nothing like them).{' '}
          <Link to="/game-pieces" className="small">Check which models it picks →</Link>
        </span>
      )}
    </div>
  )
}
