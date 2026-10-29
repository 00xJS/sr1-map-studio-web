// Decoy dummies in the editor: the Build tab's "Dummy" piece (model, pose and look, placed where the camera looks)
// and a placed dummy's settings in its panel. See lib/dummies and dummyActions.ts.
import { useState } from 'react'
import { useEditor } from './store'
import { getViewer } from './Viewport'
import { Field, Status, toast, useBusy } from '../ui'
import { statusSentence } from '../lib/featureStatus'
import type { SceneItem, Vec3 } from '../lib/project'
import { POSES, POSE_IDS, type PoseId } from '../lib/dummies/figure'
import { HAIRS, MAX_DUMMIES, NPC_MODELS, PLAYER, SKINS, TOPS, fullLook, type DummyLook, type DummySpec, type HairId, type SkinId, type TopId } from '../lib/dummies/models'
import { dummyRefOf } from '../lib/dummies/standIn'
import { buildDummies, changeDummy, dummyCount, placeDummy } from './dummyActions'

const OUTFITS = 4

/** Model, pose and look selects for a dummy. */
function SpecFields({ spec, onChange, disabled }: { spec: DummySpec; onChange: (patch: Partial<DummySpec>) => void; disabled?: boolean }) {
  const look = fullLook(spec.model, spec.look)
  const setLook = (l: DummyLook) => onChange({ look: { ...spec.look, ...l } })
  const player = spec.model === PLAYER
  return (
    <>
      <Field label="Who">
        <select value={spec.model} disabled={disabled} onChange={(e) => onChange({ model: e.target.value, look: {} })}>
          <option value={PLAYER}>Player (dressed as players are in a match)</option>
          <optgroup label="The game's people">
            {Object.entries(NPC_MODELS).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
          </optgroup>
        </select>
      </Field>
      <Field label="Pose">
        <select value={spec.pose} disabled={disabled} onChange={(e) => onChange({ pose: e.target.value as PoseId })}>
          {POSE_IDS.map((p) => <option key={p} value={p}>{POSES[p]}</option>)}
        </select>
      </Field>
      {player ? (
        <div className="row wrap">
          <Field label="Top">
            <select value={look.top} disabled={disabled} onChange={(e) => setLook({ top: e.target.value as TopId })}>
              {Object.entries(TOPS).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Skin">
            <select value={look.skin} disabled={disabled} onChange={(e) => setLook({ skin: e.target.value as SkinId })}>
              {Object.entries(SKINS).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Hair">
            <select value={look.hair} disabled={disabled} onChange={(e) => setLook({ hair: e.target.value as HairId })}>
              {Object.entries(HAIRS).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
            </select>
          </Field>
        </div>
      ) : (
        <div className="row wrap">
          <Field label="Skin">
            <select value={look.skin === 'dark' ? 'dark' : 'light'} disabled={disabled} onChange={(e) => setLook({ skin: e.target.value as SkinId })}>
              <option value="light">Lighter</option><option value="dark">Darker</option>
            </select>
          </Field>
          <Field label="Outfit">
            <select value={look.outfit % OUTFITS} disabled={disabled} onChange={(e) => setLook({ outfit: +e.target.value })}>
              {Array.from({ length: OUTFITS }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
            </select>
          </Field>
        </div>
      )}
    </>
  )
}

/** The Build tab's "Dummy" piece. */
export function DummyPicker({ onClose }: { onClose: () => void }) {
  const count = useEditor((s) => dummyCount(s.project))
  const [spec, setSpec] = useState<DummySpec>({ model: PLAYER, pose: 'standing', look: {} })
  const [run, busy] = useBusy()
  const place = () => run(async () => {
    const v = getViewer()
    const c = (v?.center() ?? [0, 0, 0]) as Vec3
    // On the floor under where the camera looks.
    const at: Vec3 = [c[0], v?.surfaceBelow(c[0], c[1] + 2, c[2]) ?? c[1], c[2]]
    // Facing the camera, so you see its front.
    const cam = v?.camera.position
    const rot = cam ? (Math.atan2(cam.x - at[0], cam.z - at[2]) * 180) / Math.PI + 180 : 0
    await placeDummy(spec, at, ((Math.round(rot) % 360) + 360) % 360)
  })
  return (
    <div className="stack">
      <span className="faint small">
        A real Saints Row player or person standing still, posed like a shop-window mannequin, to keep players guessing
        which ones are real. Solid where the body is. <Status id="decoy_dummies" />
      </span>
      <SpecFields spec={spec} onChange={(p) => setSpec({ ...spec, ...p, look: p.look ?? spec.look })} disabled={busy} />
      <div className="row wrap">
        <button className="sm" disabled={busy || count >= MAX_DUMMIES} onClick={place} title="Where the camera is looking, facing you">
          {busy ? 'Building…' : '+ Place at the camera'}
        </button>
        <button className="sm quiet" onClick={onClose}>Done</button>
        <span className="spacer" />
        <span className={'small ' + (count >= MAX_DUMMIES ? 'tag-warn' : 'muted')}>{count} of {MAX_DUMMIES} in this map</span>
      </div>
      <span className="faint small">Built in your browser from your own game files; share links and the Showcase show a plain stand-in figure instead. Without your game folder it is placed as the stand-in.</span>
    </div>
  )
}

/** A placed dummy's settings. */
export function DummyFields({ it, index }: { it: SceneItem; index: number }) {
  const d = dummyRefOf(it)
  const [run, busy] = useBusy()
  if (!d) return null
  return (
    <div className="section">
      <span className="section-title">Decoy dummy <Status id="decoy_dummies" /></span>
      <SpecFields spec={d} disabled={busy} onChange={(patch) => run(() => changeDummy(index, patch))} />
      {busy && <span className="faint small">Building…</span>}
      {d.built
        ? <span className="small muted">From your own game files: in your own exports only. Share links, the Showcase and the hub show a plain stand-in figure.</span>
        : (
          <div className="stack">
            <span className="small muted">Drawn as the stand-in figure (it exports like this too).</span>
            <div><button className="sm" disabled={busy} onClick={() => run(async () => { const n = await buildDummies(true); toast(n ? `Built ${n === 1 ? '1 dummy' : `${n} dummies`} from your game.` : 'Nothing to build.', 'ok') })}>Build from my game</button></div>
          </div>
        )}
      <span className="faint small">Only its body boxes are solid; the rest is look only.{statusSentence('decoy_dummies')}</span>
    </div>
  )
}
