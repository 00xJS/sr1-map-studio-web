// Every prefab the editor offers, by category.
import { PREFABS, type PrefabDef } from './prefabs'
import { MORE_PREFABS } from './prefabsMore'

export type CategorizedPrefab = PrefabDef & { category: string }

const BASE_CATEGORY: Record<string, string> = {
  shop: 'Buildings', apartments: 'Buildings', office: 'Buildings', warehouse: 'Buildings',
  car: 'Street', lamp: 'Street', bench: 'Street', dumpster: 'Street', cones: 'Street', busstop: 'Street', phone: 'Street', picnic: 'Street', fountain: 'Street',
  tree: 'Nature', pine: 'Nature', stall: 'Street', gas: 'Buildings', playground: 'Fun & games', scaffold: 'Industrial', tower: 'Military',
  containers: 'Industrial', foodtruck: 'Street', bunkers: 'Paintball',
}

export const ALL_PREFABS: Record<string, CategorizedPrefab> = {
  ...Object.fromEntries(Object.entries(PREFABS).map(([k, p]) => [k, { ...p, category: BASE_CATEGORY[k] ?? 'Street' }])),
  ...MORE_PREFABS,
}

export const PREFAB_CATEGORIES = ['Buildings', 'Street', 'Nature', 'Paintball', 'Cyber', 'Fun & games', 'Military', 'Industrial', 'Sports']
