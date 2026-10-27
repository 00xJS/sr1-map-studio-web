// What kind of pointer the visitor has, asked in one place.

/** The main pointer is a finger (a phone or tablet). */
export const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** Touch should come first: a finger is the main pointer, or the screen takes more than one touch. */
export const touchFirst = () => typeof window !== 'undefined' && (coarsePointer() || navigator.maxTouchPoints > 1)

/** A narrow screen, where the editor and dialogs switch to their phone layout (matches the CSS breakpoint). */
export const narrowScreen = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches
