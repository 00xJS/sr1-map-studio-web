// Map health checks: the public API (also for the AI assistant).
//   analyzeMap(input, options)          collision + markers in, a HealthReport out (pure, synchronous)
//   collisionFromProject(project, fn)   the input from a project and its parsed models
//   sampleInput(sample)                 the input from a sample map's parts (no files needed)
// In the editor, src/lib/analysis/client.ts runs the same thing in a worker.
export { analyzeMap, mirrorCheck, BOTS } from './analyze'
export { collisionFromProject, analysisKey } from './collision'
export { sampleInput } from './sampleInput'
export * from './types'
