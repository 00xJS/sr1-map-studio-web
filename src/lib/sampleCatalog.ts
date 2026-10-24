// What the home page shows of each sample map (name, picture, theme, description), without loading the maps
// themselves: they need every prefab, and the home page shouldn't. Kept in step with SAMPLES by
// tests/sampleStats.test.ts (UPDATE_STATS=1 rewrites sampleCatalog.json).
import data from './sampleCatalog.json'

export interface SampleCard { id: string; name: string; icon: string; theme: string; description: string; added?: string }

export const SAMPLE_CARDS: SampleCard[] = data
