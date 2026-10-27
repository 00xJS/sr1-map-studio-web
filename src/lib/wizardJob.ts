// One map from the map wizard's choices, as plain data, for the wizard's worker (wizard.worker.ts) and for anywhere
// that can't start one (the tests, an old browser): the same build either way.
import { wizardSample, type WizardOptions } from './mapWizard'
import { GameCity } from './gameObjects/wizardModules'
import { gamePiecesSuit } from './gameObjects/wizardPieces'
import type { GameObjectEntry } from './gameObjects/indexer'
import type { CityLabels, GameLabels } from './gameObjects/labels'
import type { Sample } from './sampleKit'

/** What the wizard shows of a Game pieces build (GameCity's summary, as plain data). */
export interface CityInfo {
  used: boolean
  ready: boolean
  problems: string[]
  stats: GameCity['stats']
  pieces: { stats: GameCity['pieces']['stats'] }
}

export interface GameLibrary { key: string; entries: GameObjectEntry[]; labels: GameLabels; labelsVersion: number; cityLabels: CityLabels }

/** One map from the choices, with the player's game pieces when asked and the setting suits them. */
export function buildWizard(o: WizardOptions, game: GameLibrary | null): { sample: Sample; city?: CityInfo } {
  const city = game && gamePiecesSuit(o.setting)
    ? new GameCity(game.entries, { setting: o.setting, seed: o.seed, labels: game.labels, labelsVersion: game.labelsVersion, cityLabels: game.cityLabels })
    : undefined
  const sample = wizardSample(o, city?.pieces)
  return { sample, city: city && { used: city.used, ready: city.ready, problems: [...city.problems], stats: { ...city.stats }, pieces: { stats: { ...city.pieces.stats } } } }
}

