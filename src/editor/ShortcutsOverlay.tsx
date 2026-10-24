// The "?" sheet: every keyboard, mouse and touch control in the editor.
import { Modal } from '../ui'
import { toggleOverlay } from './overlays'

const GROUPS: [string, [string, string][]][] = [
  ['Camera', [
    ['Left-drag', 'Spin around'], ['Right-drag', 'Slide'], ['Scroll', 'Zoom'], ['F', 'Zoom to selection'],
    ['W A S D', 'Fly'], ['Q / E', 'Down / up'], ['Shift', 'Fly faster'],
  ]],
  ['Tools', [
    ['V', 'Select and move'], ['2', 'Turn'], ['3', 'Size'], ['H', 'Shape'], ['B', 'Paint bucket'], ['I', 'Eyedropper'],
    ['P', 'Spawns & markers'], ['K', 'Weapon'], ['L', 'Light'], ['X', 'Eraser'], ['Esc', 'Back to Move'], ['G', 'Snap on / off'],
  ]],
  ['Editing', [
    ['Shift+click', 'Add to selection'], ['Ctrl+A', 'Select everything'], ['Ctrl+D', 'Duplicate'], ['Ctrl+C / Ctrl+V', 'Copy / paste (works across maps)'],
    ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'], ['Delete', 'Delete selection'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'],
  ]],
  ['Map', [
    ['Ctrl+S', 'Save now'], ['Ctrl+Shift+S', 'Saved versions'], ['?', 'This sheet'],
  ]],
  ['Touch (tablet)', [
    ['Tap', 'Select, or use the current tool'], ['One-finger drag', 'Spin around'], ['Pinch', 'Zoom'], ['Two-finger drag', 'Slide'],
    ['Camera buttons', 'Circle, zoom, see the whole map'],
  ]],
]

const Keys = ({ k }: { k: string }) => <span className="keys">{k.split(' / ').map((part, i) => <span key={i}>{i > 0 && ' / '}<kbd>{part}</kbd></span>)}</span>

export function ShortcutsOverlay() {
  const close = () => toggleOverlay('keys', false)
  return (
    <Modal title="Keyboard, mouse & touch" wide onClose={close} footer={<button className="primary" onClick={close}>Got it</button>}>
      <div className="shortcut-grid">
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <span className="section-title">{title}</span>
            <dl>{rows.map(([k, what]) => <div key={k}><dt><Keys k={k} /></dt><dd>{what}</dd></div>)}</dl>
          </section>
        ))}
      </div>
      <p className="faint small">Free camera (View menu): hold the right mouse button to look around, WASD to fly, mouse wheel sets the speed. Walking: WASD run, Shift sprint, Space jump, C crouch, V third person.</p>
    </Modal>
  )
}
