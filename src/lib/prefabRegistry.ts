// Every prefab the editor offers, by category.
import { PREFABS, type PrefabDef } from './prefabs'
import { MORE_PREFABS } from './prefabsMore'
import { INTERIOR_PREFABS } from './prefabsInterior'
import { PHYSICS_PREFABS } from './prefabsPhysics'
import { NATURE_PREFABS } from './prefabsNature'
import { VEHICLE_PREFABS } from './prefabsVehicles'
import { INDUSTRIAL_PREFABS } from './prefabsIndustrial'
import { INTERIOR2_PREFABS } from './prefabsInteriors2'
import { GAMEPLAY_PREFABS } from './prefabsGameplay'
import { ROAD_PREFABS } from './roads'
import { BUILDING_PREFABS } from './prefabsBuildings'

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
  ...INTERIOR_PREFABS,
  ...INTERIOR2_PREFABS,
  ...GAMEPLAY_PREFABS,
  ...PHYSICS_PREFABS,
  ...NATURE_PREFABS,
  ...VEHICLE_PREFABS,
  ...INDUSTRIAL_PREFABS,
  ...ROAD_PREFABS,
  ...BUILDING_PREFABS,
}

export const PREFAB_CATEGORIES = ['Buildings', 'Rooms', 'Furniture', 'Street', 'Vehicles', 'Nature', 'Paintball', 'Cyber', 'Fun & games', 'Military', 'Industrial', 'Construction', 'Sports', 'Physics']
export const PREFAB_CATEGORIES = ['Buildings', 'Rooms', 'Furniture', 'Venues', 'Street', 'Vehicles', 'Nature', 'Paintball', 'Cover', 'Cyber', 'Fun & games', 'Obstacles', 'Military', 'Industrial', 'Sports', 'Physics']
export const PREFAB_CATEGORIES = ['Buildings', 'Shops', 'Neighbourhood', 'Rooms', 'Furniture', 'Street', 'Vehicles', 'Nature', 'Paintball', 'Cyber', 'Fun & games', 'Military', 'Industrial', 'Sports', 'Physics']
