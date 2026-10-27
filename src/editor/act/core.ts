// Shared by the editor commands: logging, one-step edits, file records.
import { useEditor } from '../store'
import { referencedPaths, type FileRef, type Project } from '../../lib/project'

export const log = (t: string) => useEditor.getState().log(t)
export const update = (...a: Parameters<ReturnType<typeof useEditor.getState>['update']>) => useEditor.getState().update(...a)

export class UserError extends Error {}

export function addFiles(files: Record<string, FileRef>) {
  return (d: { files: Record<string, FileRef> }) => { Object.assign(d.files, files) }
}

/** Drop file records nothing refers to any more (e.g. a shape's previous OBJ). */
export function pruneFiles(d: Project) {
  const live = new Set(referencedPaths(d))
  for (const path of Object.keys(d.files)) if (!live.has(path)) delete d.files[path]
}
