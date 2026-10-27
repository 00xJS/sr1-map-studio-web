// The Ship tab: is it ready, what it is called in the game, and getting it out: into your game, to a link
// anyone can play, to the hub, or a saved version to come back to.
import { useEditor } from '../store'
import { Checklist, useApplyFix, useChecklist } from '../Checklist'
import { toggleOverlay } from '../overlays'
import { More } from '../More'
import { Field, Status } from '../../ui'
import { blockers } from '../../lib/checklist'
import { statusSentence } from '../../lib/featureStatus'
import { maxMapName } from '../../lib/project'
import { hubEnabled } from '../../lib/backend'
import { useLastBuild } from '../useExport'

const sanitize = (s: string) => s.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()

export function ShipTab({ onInstall, onShare, onPublish, onSamples }: { onInstall: () => void; onShare: () => void; onPublish: () => void; onSamples: () => void }) {
  const project = useEditor((s) => s.project)!
  const update = useEditor((s) => s.update)
  const items = useChecklist()
  const fix = useApplyFix(onSamples)
  const blocked = blockers(items).length > 0
  const s = project.settings
  const name = sanitize(s.base_name)
  const maxName = maxMapName(s)
  const nameError = !name ? 'Enter a file name.'
    : name.length > maxName ? `File names must be ${maxName} characters or fewer${s.surface_preload ? ' with early surface registration' : ''}.` : ''
  return (
    <>
      <div className="section">
        <span className="section-title">Ready to play?</span>
        <Checklist items={items} onFix={fix} />
      </div>

      <div className="section">
        <span className="section-title">In the game</span>
        <Field label="Name in the game's map list">
          <input value={s.display_name} maxLength={40} onChange={(e) => update('Map name in game', (d) => { d.settings.display_name = e.target.value }, { merge: 'set-display_name' })} />
        </Field>
        <Field label={<>Description <Status id="map_description" /></>} hint={"The map's help text in the game's menus, in every game language. One paragraph; blank gives a short default." + statusSentence('map_description')}>
          <textarea rows={2} maxLength={400} value={project.description} onChange={(e) => update('Description', (d) => { d.description = e.target.value }, { merge: 'description' })} />
        </Field>
      </div>

      <div className="section">
        <span className="section-title">Send it out</span>
        <button className="primary big" data-tour="ship" onClick={onInstall}>{blocked ? 'Install in game…' : '▶ Install in game'}</button>
        <span className="faint small">Builds the map in your browser and puts it in your game's maps folder, or downloads it as a zip.</span>
        <div className="row wrap">
          <button className="sm" onClick={onShare} title="A link anyone can open to play this map in their browser, no game or account needed">🔗 Share a link…</button>
          {hubEnabled && <button className="sm" onClick={onPublish}>Publish to the hub…</button>}
          <button className="sm" onClick={() => toggleOverlay('versions', true)} title="Keep a copy of the map and go back to it later (Ctrl+Shift+S)">Saved versions…</button>
        </div>
      </div>

      <LastBuild />

      <More id="ship" title="File name">
        <div className="section">
          <Field label={`File name (${maxName} characters at most)`} hint={nameError || `The map's files are called ${name || '…'}.bbchunk_xbox2 and so on. Left as mymap, Install in game picks a name of its own.`}>
            <input value={s.base_name} maxLength={11} aria-invalid={!!nameError} onChange={(e) => update('File name', (d) => { d.settings.base_name = e.target.value }, { merge: 'set-base_name' })} />
          </Field>
        </div>
      </More>
    </>
  )
}

/** What the last build came to: triangles drawn and solid, native objects, lights. */
function LastBuild() {
  const id = useEditor((s) => s.project!.id)
  const summary = useLastBuild((s) => (s.projectId === id ? s.summary : null))
  if (!summary) return null
  const n = (k: string) => (summary[k] ?? 0).toLocaleString()
  return (
    <div className="section">
      <span className="section-title">Last build</span>
      <span className="small">Drawn: {n('render_triangles')} triangles in {n('render_meshes')} meshes, {n('material_batches')} material batches.</span>
      <span className="small">Solid: {n('collision_triangles')} of {n('source_triangles')} triangles. Native objects: {n('native_objects')}. Lights: {n('lights')}.</span>
    </div>
  )
}
