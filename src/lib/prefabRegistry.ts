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
import { CYBER_LIFE_PREFABS } from './prefabsCyberLife'
import { LIFE_PREFABS } from './prefabsPaintballLife'

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
  ...CYBER_LIFE_PREFABS,
  ...LIFE_PREFABS,
}
export const PREFAB_CATEGORIES = ['Buildings', 'Shops', 'Neighbourhood', 'Venues', 'Rooms', 'Furniture', 'Street', 'Vehicles', 'Nature', 'Industrial', 'Construction', 'Military', 'Paintball', 'Cover', 'Obstacles', 'Cyber', 'Fun & games', 'Sports', 'Physics']
