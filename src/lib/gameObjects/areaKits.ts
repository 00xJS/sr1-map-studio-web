// What the game puts where, for the map wizard's Game pieces: per setting, the kinds of thing that stand along a
// building's front (the sidewalk), in a narrow gap between buildings (an alley), and out on open ground as cover.
// Measured from every placement in Stilwater's street chunks (which district puts what where, most common first),
// and how much cover the retail multiplayer maps carry. Things are named as identify() names them, so any model the
// player's library has under that name may be picked; the weights are how often the game uses each there.
import type { WizardSetting } from '../mapWizard'

export interface KitItem {
  /** identify()'s name for it (identity.ts). */
  name: string
  /** How often, relative to the rest of the list. */
  w: number
}

export interface AreaKit {
  /** Along building fronts, a step or two out from the wall. */
  sidewalk: KitItem[]
  /** In gaps between buildings a few metres wide. */
  alley: KitItem[]
  /** Out on open ground: things players hide behind. */
  cover: KitItem[]
}

const k = (spec: string): KitItem[] => spec.split(',').map((s) => { const [name, w] = s.split(':'); return { name: name.trim(), w: +(w ?? 1) } })

// Stilwater by district (Downtown/High end/Museum, Factories, Suburbs, Docks, Saint's Row/Projects/Barrio, Airport),
// the sidewalk and alley kits as the game has them; cover from the same places, heavier pieces first.
const DOWNTOWN: AreaKit = {
  sidewalk: k('Parking meter:5, Newspaper box:4, Trash can:4, Bench:4, Mailbox:3, Payphone:2, Bollard:2, Planter:3, Tree guard:2, Fire hydrant:2'),
  alley: k('Dumpster:5, Trash bags:4, Trash can:3, Barrel:2, Crate:2, Pallet:2, Cardboard box:1'),
  cover: k('Concrete barrier:4, Dumpster:3, Planter:3, Wrecked car:2, Shipping container:1, Bus stop:1, Crate:2, Barrier:2'),
}
const RUNDOWN: AreaKit = {
  sidewalk: k('Trash bags:4, Trash can:3, Fire hydrant:2, Newspaper box:2, Mailbox:1, Bollard:2, Pallet:2, Crate:2, Tire:2'),
  alley: k('Dumpster:5, Trash bags:5, Trash:3, Barrel:3, Crate:3, Pallet:3, Tire:2, Couch:1, Mattress:1'),
  cover: k('Dumpster:4, Wrecked car:4, Barrel:3, Crate:3, Concrete barrier:2, Pallet:2, Couch:1, Shipping container:1'),
}
const INDUSTRIAL: AreaKit = {
  sidewalk: k('Trash:3, Barrel:4, Concrete barrier:3, Cable spool:2, Pallet:3, Crate:2'),
  alley: k('Barrel:4, Pallet:4, Crate:3, Trash:3, Dumpster:2, Cable spool:2, Cinder block:2'),
  cover: k('Shipping container:4, Concrete barrier:3, Crate:3, Barrel:3, Cable spool:3, Substation equipment:2, Semi trailer:1, Pallet:2'),
}
const DOCKS: AreaKit = {
  sidewalk: k('Bollard:4, Dock post:3, Crate:3, Barrel:3, Lumber:2, Cinder block:2, Cable spool:2'),
  alley: k('Crate:4, Barrel:4, Pallet:3, Lumber:3, Cinder block:2, Dumpster:2'),
  cover: k('Shipping container:6, Crate:4, Barrel:3, Cable spool:3, Lumber:2, Semi trailer:1, Boxcar:1, Concrete barrier:2'),
}
const SUBURBS: AreaKit = {
  sidewalk: k('Mailbox:5, Fire hydrant:3, Newspaper box:2, Trash can:3, Planter:3, Bush:3, Bench:1'),
  alley: k('Trash can:4, Trash bags:3, Barrel:1, Bush:2, Crate:1'),
  cover: k('Wrecked car:3, Semi trailer:2, Dumpster:2, Bush:2, Planter:2, Picnic table:1, Concrete barrier:2, Crate:1'),
}
const CONSTRUCTION: AreaKit = {
  sidewalk: k('Concrete barrier:3, Barrel:3, Cinder block:3, Pallet:3, Lumber:3, Traffic cone:2'),
  alley: k('Pallet:4, Lumber:4, Cinder block:3, Plywood sheet:2, Barrel:2, Brick:2'),
  cover: k('Concrete barrier:4, Shipping container:3, Cable spool:3, Lumber:3, Pallet:3, Cinder block:2, Crate:2, Barrel:2'),
}
const MILITARY: AreaKit = {
  sidewalk: k('Concrete barrier:4, Barrel:3, Crate:3, Barrier:2'),
  alley: k('Crate:4, Barrel:3, Pallet:2'),
  cover: k('Concrete barrier:5, Crate:4, Shipping container:3, Barrel:2, Barrier:3, Semi trailer:1'),
}
const PAINTBALL: AreaKit = {
  sidewalk: k('Crate:3, Barrel:3, Pallet:3, Tire:3'),
  alley: k('Crate:3, Pallet:3, Tire:3, Barrel:2'),
  cover: k('Crate:4, Cable spool:3, Cardboard box:3, Shipping container:2, Dumpster:2, Barrel:2, Pallet:2, Tire:2, Concrete barrier:2, Semi trailer:1'),
}

export const KITS: Record<WizardSetting, AreaKit> = {
  downtown: DOWNTOWN, rundown: RUNDOWN, industrial: INDUSTRIAL, docks: DOCKS, suburbs: SUBURBS,
  construction: CONSTRUCTION, military: MILITARY, paintball: PAINTBALL, cyber: PAINTBALL,
}

/**
 * Cover pieces per 1000 m² of open floor the wizard aims for, by how busy the map is. The retail maps that play best
 * carry 5 to 13 (Gangsta Brawl's Saint's Row streets 13, under a metre apart); Stilwater's own plazas and crossroads
 * only 2 to 4, which is why a street cut straight from the city plays wide open.
 */
export const COVER_PER_1000 = { open: 4, normal: 8, packed: 13 }

/** Spacing along a building's front between sidewalk things (metres): the city's sidewalks have one every 6 to 10 m. */
export const SIDEWALK_EVERY = 8
