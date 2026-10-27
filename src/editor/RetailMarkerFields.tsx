// Settings of the Blinged Out Ride and sound zone markers (see lib/retailModes.ts), shown in both the simple
// inspector, and the button that lets the editor read the player's own game files.
import { useEffect, useState } from 'react'
import { useEditor } from './store'
import { Check, Field, FileButton, NumberInput, useBusy } from '../ui'
import { statusSentence } from '../lib/featureStatus'
import type { Marker, Vec3 } from '../lib/project'
import {
  BOR_BOXES, BOR_CARS, BOR_CAR_BLUE, BOR_CAR_RED, BOR_DEFAULT_CAR, SOUND_DEFAULT_BOX, SOUND_DEFAULT_RADIUS, SOUND_DEFAULT_VOLUME, SOUND_ZONE, REGION_BOXES, RAIN_BLOCKER, INDOOR_ROOM, REGION_DEFAULT_AMBIENT,
} from '../lib/retailModes'
import { GameItemFields } from './GameItemFields'
import { ITEM_PROP } from '../lib/gameObjects/items'
import { canPickFolder, gamePack, loadSoundNames, soundLabel, soundNamesLoaded, addPickedFiles, CITY_PACK, FOLEY_PACK } from '../lib/gameFiles'

type Set = (label: string, fn: (d: Marker) => void, merge?: string) => void

export function RetailMarkerFields({ m, index, set }: { m: Marker; index: number; set: Set }) {
  if (m.type in BOR_BOXES) return <BoxSize m={m} set={set} fallback={BOR_BOXES[m.type]} hint="The trigger box, in metres. It starts at the marker and turns with it." />
  if (m.type === BOR_CAR_RED || m.type === BOR_CAR_BLUE) return <TeamCar m={m} index={index} set={set} />
  if (m.type === SOUND_ZONE) return <SoundZone m={m} set={set} />
  if (m.type === ITEM_PROP) return <GameItemFields m={m} set={set} />
  if (m.type in REGION_BOXES) return (
    <>
      <BoxSize m={m} set={set} fallback={REGION_BOXES[m.type]} hint={m.type === RAIN_BLOCKER
        ? 'No rain inside this box. The game checks the camera, which sits behind the player: make it a few metres bigger than the room, and higher than heads. Rain only falls on maps whose weather changes each match.'
        : 'Inside, it never rains and the room gets its own even light, with no sky and no sun shadows, like the interiors in the game. Make it a few metres bigger than the room (the game checks the camera).'} />
      {m.type === INDOOR_ROOM && (
        <Field label="Light inside" hint="How bright the room's even light is (the game's rooms use about 0.3 to 0.5).">
          <NumberInput value={m.ambient ?? REGION_DEFAULT_AMBIENT} step={0.05} digits={2} min={0} max={1} onChange={(v) => set('Room light', (d) => { d.ambient = v })} />
        </Field>
      )}
    </>
  )
  return null
}

function BoxSize({ m, set, fallback, hint }: { m: Marker; set: Set; fallback: Vec3; hint: string }) {
  const size = m.size ?? fallback
  const dim = (i: number, label: string) => (
    <Field label={label}><NumberInput value={size[i]} step={0.5} digits={2} min={i === 1 ? 0.5 : 1} max={i === 1 ? 200 : 2000} suffix="m" onChange={(v) => set('Zone size', (d) => {
      const s = [...(d.size ?? fallback)] as Vec3
      s[i] = v
      d.size = s
    })} /></Field>
  )
  return (
    <>
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>{dim(0, 'Width')}{dim(1, 'Height')}{dim(2, 'Depth')}</div>
      <span className="faint small">{hint}</span>
    </>
  )
}

function TeamCar({ m, index, set }: { m: Marker; index: number; set: Set }) {
  const first = useEditor((s) => s.project!.markers.findIndex((x) => x.type === m.type)) === index
  if (first) return <span className="faint small">This team's ride: the car the team blings up. The game picks its model.</span>
  const known = BOR_CARS.some(([id]) => id === m.vehicle)
  return (
    <Field label="Extra car" hint="Further team cars appear here; these are the models the mode has settings for.">
      <select value={known ? m.vehicle : BOR_DEFAULT_CAR} onChange={(e) => set('Extra car', (d) => { d.vehicle = e.target.value })}>
        {BOR_CARS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </Field>
  )
}

function SoundZone({ m, set }: { m: Marker; set: Set }) {
  const [names, setNames] = useState<string[] | null>(null)
  useEffect(() => { soundNamesLoaded()?.then(setNames, () => {}) ?? loadSoundNames(false).then(setNames, () => {}) }, [])
  const box = m.shape === 'box'
  const random = !!m.sound_random
  return (
    <>
      <div className="row">
        <span className="small muted">Shape</span>
        <button className={'sm' + (!box ? ' on' : '')} onClick={() => set('Sound zone shape', (d) => { d.shape = 'sphere' })}>Sphere</button>
        <button className={'sm' + (box ? ' on' : '')} onClick={() => set('Sound zone shape', (d) => { d.shape = 'box' })}>Box</button>
      </div>
      {box
        ? <BoxSize m={m} set={set} fallback={SOUND_DEFAULT_BOX} hint="Full volume inside, fading out over the last metres to its edge." />
        : <Field label="Radius" hint="Full volume inside, fading out over the last metres to its edge.">
            <NumberInput value={m.radius || SOUND_DEFAULT_RADIUS} step={1} digits={1} min={1} max={2000} suffix="m" onChange={(v) => set('Sound zone radius', (d) => { d.radius = v })} />
          </Field>}
      <Field label="Sound" hint={names ? `${names.length} sounds from your game. Only the name goes into the map.` : 'The names come from your own game files.'}>
        <input list="game-sounds" value={m.sound ?? ''} placeholder={names ? 'Type part of a name to search' : 'Read the names from your game first'}
          onChange={(e) => set('Sound', (d) => { d.sound = e.target.value.trim().toUpperCase() }, 'sound')} />
        {names && <datalist id="game-sounds">{names.map((n) => <option key={n} value={n}>{soundLabel(n)}</option>)}</datalist>}
      </Field>
      {!names && <GameFilesButton pack={FOLEY_PACK} what="sound names" onReady={() => loadSoundNames(false).then(setNames)} />}
      <Field label={`Volume ${Math.round((m.volume ?? SOUND_DEFAULT_VOLUME) * 100)}%`}>
        <input type="range" min={5} max={100} value={Math.round((m.volume ?? SOUND_DEFAULT_VOLUME) * 100)}
          onChange={(e) => set('Volume', (d) => { d.volume = +e.target.value / 100 }, 'volume')} />
      </Field>
      <Check checked={random} onChange={(v) => set('Sound timing', (d) => { d.sound_random = v })}>Now and then, not in a loop</Check>
      {random && (
        <div className="form-grid">
          <Field label="Pause at least"><NumberInput value={m.delay_min_s ?? 5} step={1} digits={0} min={0} max={600} suffix="s" onChange={(v) => set('Pause', (d) => { d.delay_min_s = v })} /></Field>
          <Field label="Pause at most"><NumberInput value={m.delay_max_s ?? 20} step={1} digits={0} min={0} max={600} suffix="s" onChange={(v) => set('Pause', (d) => { d.delay_max_s = v })} /></Field>
        </div>
      )}
      <span className="faint small">The sound plays from the player's own game.{statusSentence('sound_zones')}</span>
    </>
  )
}

/** Lets the editor read a packfile from the player's game: their Saints Reborn folder, or the file itself. */
export function GameFilesButton({ pack, what, onReady }: { pack: string; what: string; onReady: () => void | Promise<unknown> }) {
  const [run, busy] = useBusy()
  const done = async (ok: boolean) => {
    if (!ok) throw new Error(`${pack} wasn't found. Choose the Saints Reborn folder, or dist\\game\\packfiles inside it.`)
    await onReady()
  }
  if (canPickFolder()) return (
    <button className="sm" disabled={busy} title={`Reads the ${what} from ${pack} in your game, in this browser only`}
      onClick={() => run(async () => done(!!(await gamePack(pack, true))))}>
      Read {what} from my game…
    </button>
  )
  return (
    <FileButton className="sm" accept=".vpp_xbox2" multiple disabled={busy} title={`Choose ${pack} from your game's packfiles folder`}
      onFiles={(f) => run(async () => { addPickedFiles(f); await done(!!(await gamePack(pack, false))) })}>
      Choose {pack}…
    </FileButton>
  )
}

/** Under the "How it breaks" preset of a smashing crate: whether its debris can be read from the player's game. */
export function CrateDebrisNote() {
  const [ready, setReady] = useState<boolean | null>(null)
  const check = () => gamePack(CITY_PACK, false).then((f) => setReady(!!f), () => setReady(false))
  useEffect(() => { check() }, [])
  if (ready === null) return null
  return ready
    ? <span className="faint small">Smashes into boards and dust: the debris comes from your game files ({CITY_PACK}) at export. Bullets don't break it.{statusSentence('crate_debris')}</span>
    : (
      <>
        <span className="faint small">The debris comes from your own game files at export. Without them it breaks without debris, like the other presets.</span>
        <GameFilesButton pack={CITY_PACK} what="crate debris" onReady={check} />
      </>
    )
}
