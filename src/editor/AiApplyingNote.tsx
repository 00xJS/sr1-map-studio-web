// "Making the AI's changes…" with Cancel: where else nothing shows that the AI's edits are still being made (the
// chat closed, or on its key-setup screen).
import { stopMapAiEdits, useAiRunning } from './aiActions'

export function AiApplyingNote({ inline = false }: { inline?: boolean }) {
  const applying = useAiRunning().length > 0
  if (!applying) return null
  return (
    <div className={'ai-applying' + (inline ? ' inline' : '')} role="status">
      <span className="small">Making the AI's changes…</span>
      <button className="sm" onClick={stopMapAiEdits} title="Stop making the AI's changes: the ones made so far stay">Cancel</button>
    </div>
  )
}
