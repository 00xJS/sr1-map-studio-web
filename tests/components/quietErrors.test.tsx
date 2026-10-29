// @vitest-environment jsdom
// Work for a map no longer open says nothing: MapChanged is quiet.
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Toasts, toastError } from '../../src/ui'
import { MapChanged } from '../../src/editor/store'

describe('Quiet errors', () => {
  it("shows no toast for a map change, and does for anything else", () => {
    render(<Toasts />)
    act(() => { toastError(new MapChanged()); toastError(new Error('Something broke')) })
    expect(screen.queryByText(/map changed/)).toBeNull()
    expect(screen.getByText('Something broke')).toBeTruthy()
  })
})
