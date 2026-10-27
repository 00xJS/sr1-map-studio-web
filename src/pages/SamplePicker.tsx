// The Start a map dialog, in two steps: first how to start (generate one, describe it, a Stilwater-style city, a map
// from the catalogue, or a finished game map), then that way's own choices with one Reroll and Create pair at the
// bottom. This file stays light so the dialog opens at once; each way's choices load behind a skeleton
// (StartPaths.tsx) and the build itself is startBuild.ts.
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { Modal, toastError } from '../ui'
import type { Project } from '../lib/project'
import type { WizardOptions } from '../lib/mapWizard'
import type { PendingEdits } from '../lib/pendingEdits'
import type { StartChoice } from './startBuild'
import { OpenGameMapPath } from './OpenOrImport'
import './start.css'

const load = () => import('./StartPaths')
const GeneratePath = lazy(() => load().then((m) => ({ default: m.GeneratePath })))
const DescribePath = lazy(() => load().then((m) => ({ default: m.DescribePath })))
const CityPath = lazy(() => load().then((m) => ({ default: m.CityPath })))
const CatalogPath = lazy(() => load().then((m) => ({ default: m.CatalogPath })))

export type StartPath = 'generate' | 'describe' | 'city' | 'catalog' | 'open'

const WAYS: { id: StartPath; icon: string; title: string; hint: string }[] = [
  { id: 'generate', icon: '✨', title: 'Generate', hint: 'Pick a setting, a layout and how many players. See it from above, reroll until you like it.' },
  { id: 'describe', icon: '💬', title: 'Describe it', hint: 'Say what you want in a sentence, and the map is planned from your words.' },
  { id: 'city', icon: '🌆', title: 'From Stilwater', hint: 'An original city in the style of Stilwater, or a real piece of it cut from your own game.' },
  { id: 'catalog', icon: '🗺️', title: 'From the catalog', hint: 'A ready-made sample map to change as you like, or every object in a row to check.' },
  { id: 'open', icon: '📂', title: 'Open a game map', hint: 'A finished map from your SaintsReborn/dist/maps folder, to edit it or add the game sky.' },
]

/** What every way to start gets from the dialog. */
export interface PathProps {
  busy: boolean
  /** Build progress, shown over the preview. */
  progress: string | null
  /** Where the way puts its Reroll and Create buttons (the dialog's footer). */
  footer: HTMLElement | null
  onCreate: (c: StartChoice) => void
  onClose: () => void
}

/** Grey blocks where a way's choices and its preview are about to be. */
export function StartSkeleton() {
  return (
    <div className="wizard start-skeleton" aria-busy="true" aria-label="Loading">
      <div className="col grow" style={{ gap: 12, flex: '1 1 300px' }}>
        {[40, 72, 72, 48, 36].map((h, i) => <div key={i} className="sk" style={{ height: h }} />)}
      </div>
      <div className="col" style={{ gap: 8, flex: '1 1 300px' }}>
        <div className="sk" style={{ aspectRatio: '1' }} />
        <div className="sk" style={{ height: 16, width: '70%' }} />
      </div>
    </div>
  )
}

/**
 * Choose how to start a map. `onBuilt` gets the finished project (and, from "Describe it", edits to make once it is
 * open); with `onBlank`, starting from a blank map is offered too.
 */
export function SamplePicker(props: { onClose: () => void; onBuilt: (p: Project, edits?: PendingEdits) => Promise<void> | void; onBlank?: () => void; initial?: StartPath }) {
  const [path, setPath] = useState<StartPath | null>(props.initial ?? null)
  const [progress, setProgress] = useState<string | null>(null)
  const [footer, setFooter] = useState<HTMLElement | null>(null)
  const [tuned, setTuned] = useState<WizardOptions | undefined>()
  const busy = progress !== null
  const create = async (c: StartChoice) => {
    setProgress('Starting…')
    try {
      const { buildChoice } = await import('./startBuild')
      const { project, job } = await buildChoice(c, setProgress)
      await props.onBuilt(project, job)
      props.onClose()
    } catch (e) {
      toastError(e)
      setProgress(null)
    }
  }
  const close = busy ? undefined : props.onClose
  const way = WAYS.find((w) => w.id === path)
  const shared: PathProps = { busy, progress, footer, onCreate: (c) => void create(c), onClose: props.onClose }
  let body: ReactNode = null
  if (path === 'generate') body = <GeneratePath {...shared} key={tuned?.seed} initial={tuned} />
  else if (path === 'describe') body = <DescribePath {...shared} onTune={(o) => { setTuned(o); setPath('generate') }} />
  else if (path === 'city') body = <CityPath {...shared} />
  else if (path === 'catalog') body = <CatalogPath {...shared} onBlank={props.onBlank} />
  else if (path === 'open') body = <OpenGameMapPath onDone={props.onClose} />
  return (
    <Modal title={way ? <span className="row" style={{ gap: 8 }}><span aria-hidden>{way.icon}</span>{way.title}</span> : 'Start a map'} wide onClose={close}
      footer={<>
        {path && <button className="quiet" onClick={() => { setPath(null); setTuned(undefined) }} disabled={busy}>← Back</button>}
        {busy && path !== 'generate' && <span className="grow small muted row" style={{ gap: 8 }}><span className="progress" style={{ width: 80 }}><div /></span>{progress}</span>}
        <span className="grow" />
        <span className="row wrap start-actions" ref={setFooter} />
        <button className="quiet" onClick={props.onClose} disabled={busy}>Cancel</button>
      </>}>
      {!path && (
        <div className="col" style={{ gap: 10 }}>
          <p className="small muted">How do you want to start? You can change everything once it's open.</p>
          <div className="start-ways">
            {WAYS.map((w) => (
              <button key={w.id} className="start-way" onClick={() => setPath(w.id)} onMouseEnter={() => void load()} onFocus={() => void load()}>
                <span className="icon" aria-hidden>{w.icon}</span>
                <span className="txt"><b>{w.title}</b><span className="small muted">{w.hint}</span></span>
              </button>
            ))}
          </div>
          {props.onBlank && <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={props.onBlank}>or start with a blank map</button>}
        </div>
      )}
      {path && <Suspense fallback={<StartSkeleton />}>{body}</Suspense>}
    </Modal>
  )
}
