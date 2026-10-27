// The map wizard off the main thread: builds a map from the wizard's choices (wizardSample, pure) so dragging a
// slider or rerolling never stalls the dialog. With Game pieces, the player's library and their labels come over
// once (they stay in this worker until they change) and each map is built from them here. See wizardClient.ts.
import { buildWizard, type CityInfo, type GameLibrary } from './wizardJob'
import type { WizardOptions } from './mapWizard'
import type { Sample } from './sampleKit'

export type WizardRequest =
  | { kind: 'library'; lib: GameLibrary }
  | { kind: 'build'; id: number; o: WizardOptions; game: boolean }

export type WizardReply =
  | { id: number; kind: 'built'; sample: Sample; city?: CityInfo }
  | { id: number; kind: 'error'; message: string }

let lib: GameLibrary | null = null

const post = (m: WizardReply) => (self as unknown as Worker).postMessage(m)

self.onmessage = (e: MessageEvent<WizardRequest>) => {
  const m = e.data
  if (m.kind === 'library') { lib = m.lib; return }
  try {
    post({ id: m.id, kind: 'built', ...buildWizard(m.o, m.game ? lib : null) })
  } catch (err) {
    post({ id: m.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
