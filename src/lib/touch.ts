// What kind of pointer the visitor has, asked in one place.
import { useEffect, useState } from 'react'

/** The main pointer is a finger (a phone or tablet). */
export const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** Touch should come first: a finger is the main pointer, or the screen takes more than one touch. */
export const touchFirst = () => typeof window !== 'undefined' && (coarsePointer() || navigator.maxTouchPoints > 1)

/** A narrow screen, where the editor and dialogs switch to their phone layout (matches the CSS breakpoint). */
export const narrowScreen = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches

/** narrowScreen() that follows the window as it is resized or turned (the editor's phone layout). */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(narrowScreen)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const q = matchMedia('(max-width: 700px)')
    const on = () => setNarrow(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return narrow
}
