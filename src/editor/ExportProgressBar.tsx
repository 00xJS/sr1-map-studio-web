// The export's current step, a progress bar and the time estimate.
import { formatElapsed, formatRemaining, type ProgressView } from '../lib/exportProgress'

export function ExportProgressBar({ progress, fallback }: { progress: ProgressView | null; fallback?: string }) {
  if (!progress) return <div className="col"><div className="progress"><div /></div>{fallback && <span className="small muted ellipsis">{fallback}</span>}</div>
  const p = progress
  return (
    <div className="col" role="status" aria-live="polite">
      <div className="progress determinate" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.fraction * 100)}>
        <div style={{ width: `${Math.max(2, p.fraction * 100)}%` }} />
      </div>
      <div className="row">
        <span className="small ellipsis grow">Step {p.step} of {p.steps}: {p.label}{p.detail && ` (${p.detail})`}</span>
        <span className="small muted mono">{formatElapsed(p.elapsed)}{p.remaining !== null && ` · ${formatRemaining(p.remaining)}`}</span>
      </div>
    </div>
  )
}
