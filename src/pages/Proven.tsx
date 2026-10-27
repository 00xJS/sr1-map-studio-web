// What has been tried in game: every export feature by its state in lib/featureStatus.ts, what every export ships
// first, and a test map for each batch of the in-game test sprint with a checklist to print (lib/testMaps.ts).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FEATURES, type Feature, type FeatureId, type FeatureState } from '../lib/featureStatus'
import { TEST_BATCHES, UNBATCHED, buildTestMap, testChecklist, type BatchId, type TestBatch } from '../lib/testMaps'
import { db, requestPersistence } from '../lib/db'
import { toastError } from '../ui'
import './proven.css'

const GROUPS: { state: FeatureState; title: string; hint: string }[] = [
  { state: 'proven', title: 'Tried in game', hint: 'Someone put a map with it in the game and it worked.' },
  { state: 'exports', title: 'Exports checked, not tried in game', hint: 'The export writes it and a check reads it back, but nobody has tried it in game yet.' },
  { state: 'untested', title: 'Not tried yet', hint: 'The export writes it; it has not been checked either way.' },
]

const ALL = Object.entries(FEATURES) as [FeatureId, Feature][]
const batchOf = (id: FeatureId) => TEST_BATCHES.find((b) => b.features.includes(id))

export default function Proven() {
  return (
    <div className="page page-narrow proven">
      <div className="col">
        <h1>What's been tried in game</h1>
        <p className="muted">Map Studio writes some things into maps that nobody has tried in the game yet. Here is every feature by how far it has got, starting with what every map gets by default, and a small test map for each round of testing, with a checklist of what to look for.</p>
      </div>
      {GROUPS.map((g) => {
        // What every export ships comes first.
        const list = ALL.filter(([, f]) => f.state === g.state).sort(([, a], [, b]) => Number(!!b.byDefault) - Number(!!a.byDefault))
        if (!list.length) return null
        return (
          <section key={g.state} className="card">
            <div className="col" style={{ gap: 2 }}>
              <h3>{g.title} <span className="faint">· {list.length}</span></h3>
              <span className="small muted">{g.hint}</span>
            </div>
            <ul className="feature-list">
              {list.map(([id, f]) => <FeatureRow key={id} id={id} f={f} />)}
            </ul>
          </section>
        )
      })}
      <h2>Test maps</h2>
      <p className="muted" style={{ marginTop: -14 }}>Test in this order: what every map gets first, then dry interiors, then the features you turn on. Each button builds the map in this browser and opens it in the editor, ready to put in your game.</p>
      {TEST_BATCHES.map((b) => <BatchCard key={b.id} batch={b} />)}
      {UNBATCHED.length > 0 && (
        <p className="small muted">Not in a test map: {UNBATCHED.map((id) => FEATURES[id].label).join(', ')}.</p>
      )}
    </div>
  )
}

function FeatureRow({ id, f }: { id: FeatureId; f: Feature }) {
  const batch = batchOf(id)
  return (
    <li>
      <div className="row wrap">
        <b>{f.label}</b>
        {f.byDefault && <span className="chip accent">In every map</span>}
        {batch && f.state !== 'proven' && <a className="chip" href={`#batch-${batch.id}`}>Test map {batch.id}</a>}
      </div>
      <span className="small muted">{f.note}</span>
      {f.tested && <span className="small ok">Tried {f.tested}</span>}
    </li>
  )
}

function BatchCard({ batch }: { batch: TestBatch }) {
  const navigate = useNavigate()
  const [progress, setProgress] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const lines = testChecklist(batch)

  // Only this card's checklist goes to the printer (proven.css).
  useEffect(() => {
    if (!printing) return
    document.body.classList.add('printing-sheet')
    window.print()
    document.body.classList.remove('printing-sheet')
    setPrinting(false)
  }, [printing])

  const make = async () => {
    setProgress('Starting…')
    try {
      navigate(`/editor/${await makeTestMap(batch.id, setProgress)}`)
    } catch (e) {
      toastError(e)
      setProgress(null)
    }
  }

  return (
    <section id={`batch-${batch.id}`} className={'card print-sheet' + (printing ? ' printing' : '')}>
      <div className="col" style={{ gap: 2 }}>
        <h3>{batch.title}</h3>
        <span className="small muted">{batch.blurb}</span>
      </div>
      <ol className="small test-steps">
        {batch.setup.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <ul className="test-checklist">
        {lines.map((l) => (
          <li key={l.id}>
            <span className="box" aria-hidden>☐</span>
            <div className="col" style={{ gap: 2 }}>
              <b>{FEATURES[l.id].label}</b>
              <span className="small">{l.where}</span>
              {l.look && <span className="small muted">Look for: {l.look}</span>}
            </div>
          </li>
        ))}
      </ul>
      <div className="row wrap no-print">
        <button className="primary" disabled={!!progress} onClick={make}>{progress ? 'Building…' : 'Make this test map'}</button>
        <button onClick={() => setPrinting(true)}>Print checklist</button>
        {progress && <span className="small muted">{progress}</span>}
      </div>
    </section>
  )
}

/** Builds the batch's map, saves it in this browser and returns its id. */
async function makeTestMap(id: BatchId, onProgress: (t: string) => void): Promise<string> {
  const p = await buildTestMap(id, { onProgress })
  await db.putProject({ id: p.id, name: p.name, updated_at: p.updated_at, project: p })
  void requestPersistence()
  return p.id
}

