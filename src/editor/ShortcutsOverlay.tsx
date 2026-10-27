// The "?" sheet: every keyboard, mouse and touch control in the editor, read from shortcuts.ts.
import { Modal } from '../ui'
import { toggleOverlay } from './overlays'
import { shortcutGroups } from './shortcuts'

const Keys = ({ k }: { k: string }) => <span className="keys">{k.split(' / ').map((part, i) => <span key={i}>{i > 0 && ' / '}<kbd>{part}</kbd></span>)}</span>

export function ShortcutsOverlay() {
  const close = () => toggleOverlay('keys', false)
  return (
    <Modal title="Keyboard, mouse & touch" wide onClose={close} footer={<button className="primary" onClick={close}>Got it</button>}>
      <div className="shortcut-grid">
        {shortcutGroups().map(([title, rows]) => (
          <section key={title}>
            <span className="section-title">{title}</span>
            <dl>{rows.map((s) => <div key={s.keys + s.what}><dt><Keys k={s.keys} /></dt><dd>{s.what}</dd></div>)}</dl>
          </section>
        ))}
      </div>
      <p className="faint small">Free camera (View menu): hold the right mouse button to look around, WASD to fly, mouse wheel sets the speed.</p>
    </Modal>
  )
}
