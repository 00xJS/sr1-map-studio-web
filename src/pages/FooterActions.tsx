// A way to start's Reroll and Create, in the Start a map dialog's footer (SamplePicker.tsx): one pair for the dialog.
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function FooterActions({ footer, children }: { footer: HTMLElement | null; children: ReactNode }) {
  return footer ? createPortal(children, footer) : null
}
