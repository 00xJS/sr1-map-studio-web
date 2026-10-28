// @vitest-environment jsdom
/// <reference types="vite/client" />
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEATURES, type FeatureId } from '../../src/lib/featureStatus'
import { NO_GAME_NAMES, NO_SURFACE_PACK, TEST_BATCHES } from '../../src/lib/testMaps'
import { newProject } from '../../src/lib/project'

// Building and saving are stand-ins here: the build itself is tested in tests/testMaps.test.ts.
const m = vi.hoisted(() => ({ build: vi.fn(), saved: [] as string[], surface: true }))
vi.mock('../../src/lib/testMaps', async (orig) => ({ ...(await orig<typeof import('../../src/lib/testMaps')>()), buildTestMap: m.build }))
vi.mock('../../src/lib/db', async (orig) => ({ ...(await orig<typeof import('../../src/lib/db')>()), db: { putProject: async (r: { id: string }) => { m.saved.push(r.id) } }, requestPersistence: async () => true }))
vi.mock('../../src/lib/datapack', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/datapack')>()),
  dataPackStatus: async () => ({ ready: true, groups: new Proxy({}, { get: (_, g) => ({ have: g === 'surface' && !m.surface ? 0 : 1, total: 1 }) }) }),
}))

const Proven = (await import('../../src/pages/Proven')).default

afterEach(() => { cleanup(); m.build.mockReset(); m.saved.length = 0; m.surface = true })

function Editor() { return <p>editor {useParams().id}</p> }
const page = () => render(
  <MemoryRouter initialEntries={['/proven']}>
    <Routes><Route path="/proven" element={<Proven />} /><Route path="/editor/:id" element={<Editor />} /></Routes>
  </MemoryRouter>,
)
const section = (title: string) => screen.getByRole('heading', { name: new RegExp('^' + title) }).closest('section')!

describe('/proven', () => {
  it('lists every feature under its state, what every map gets first', () => {
    page()
    const groups = { proven: 'Tried in game', exports: 'Exports checked, not tried in game', untested: 'Not tried yet' } as const
    for (const [id, f] of Object.entries(FEATURES) as [FeatureId, (typeof FEATURES)[FeatureId]][]) {
      expect(within(section(groups[f.state])).getAllByText(f.label, { selector: 'b' }).length, id).toBeGreaterThan(0)
    }
    const untested = within(section('Not tried yet')).getAllByRole('listitem').map((li) => li.textContent ?? '')
    const firstOther = untested.findIndex((t) => !t.includes('In every map'))
    expect(untested.slice(firstOther).some((t) => t.includes('In every map'))).toBe(false)
    expect(within(section('Tried in game')).getAllByText(/^Tried 20/).length).toBeGreaterThan(0)
  })

  it('shows each test map with its checklist and a button to make it', () => {
    page()
    for (const b of TEST_BATCHES) {
      const card = within(section(b.title))
      for (const id of b.features) expect(card.getByText(FEATURES[id].label, { selector: 'b' })).toBeTruthy()
      expect(card.getByRole('button', { name: 'Make this test map' })).toBeTruthy()
      expect(card.getByRole('button', { name: 'Print checklist' })).toBeTruthy()
    }
  })

  it('makes a test map, saves it and opens it in the editor', async () => {
    const p = newProject('Test 1 Defaults')
    m.build.mockResolvedValue({ project: p, leftOut: [] })
    page()
    fireEvent.click(within(section(TEST_BATCHES[0].title)).getByRole('button', { name: 'Make this test map' }))
    expect(await screen.findByText(`editor ${p.id}`)).toBeTruthy()
    expect(m.build.mock.calls[0][0]).toBe(1)
    expect(m.saved).toEqual([p.id])
  })

  it('stays on the card to say what a test map left out, then opens it', async () => {
    const p = newProject('Test 3 Opt-ins')
    m.build.mockResolvedValue({ project: p, leftOut: [NO_GAME_NAMES] })
    page()
    const card = within(section(TEST_BATCHES[2].title))
    fireEvent.click(card.getByRole('button', { name: 'Make this test map' }))
    expect(await card.findByText(NO_GAME_NAMES)).toBeTruthy()
    expect(m.saved).toEqual([p.id])
    fireEvent.click(card.getByRole('button', { name: 'Open the test map' }))
    expect(await screen.findByText(`editor ${p.id}`)).toBeTruthy()
  })

  it('says before building when the data pack cannot take early surface registration', async () => {
    m.surface = false
    page()
    expect(await within(section(TEST_BATCHES[2].title)).findByText(NO_SURFACE_PACK)).toBeTruthy()
    expect(within(section(TEST_BATCHES[0].title)).queryByText(NO_SURFACE_PACK)).toBeNull()
  })
})
