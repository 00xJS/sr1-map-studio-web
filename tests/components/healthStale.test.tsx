// @vitest-environment jsdom
/// <reference types="vite/client" />
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useEditor } from '../../src/editor/store'
import { healthKey, useHealth, useHealthStale } from '../../src/editor/health'
import { newMarker, newProject } from '../../src/lib/project'
import type { HealthReport } from '../../src/lib/analysis/types'

const st = () => useEditor.getState()
afterEach(() => { st().set({ mirror: false }); st().close(); useHealth.setState({ report: null, key: '' }) })

describe('the health report', () => {
  it('goes stale when mirror mode, and so the middle its fairness pairs about, changes', () => {
    const p = newProject('Stale')
    p.markers = [newMarker('Red team spawn', [10, 0, -20]), newMarker('Blue team spawn', [30, 0, 40])]
    st().open(p)
    useHealth.setState({ report: {} as HealthReport, key: healthKey(p) })
    const { result } = renderHook(() => useHealthStale())
    expect(result.current).toBe(false)
    act(() => st().set({ mirror: true }))
    expect(result.current).toBe(true)
    // Checked again with mirror mode on: fresh until mirror mode goes off.
    act(() => useHealth.setState({ key: healthKey(st().project!) }))
    expect(result.current).toBe(false)
    act(() => st().set({ mirror: false }))
    expect(result.current).toBe(true)
  })
})
