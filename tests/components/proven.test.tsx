// @vitest-environment jsdom
/// <reference types="vite/client" />
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import Proven from '../../src/pages/Proven'
import { FEATURES, type FeatureId } from '../../src/lib/featureStatus'
import { TEST_BATCHES } from '../../src/lib/testMaps'

afterEach(cleanup)

const page = () => render(<MemoryRouter><Proven /></MemoryRouter>)
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
})
