import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURES, statusParen, statusSentence, statusTag, type FeatureId } from '../src/lib/featureStatus'

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
})

describe('feature status', () => {
  it('is the only place the site says a feature is untested', () => {
    const offenders: string[] = []
    for (const f of files('src')) {
      if (f.endsWith('featureStatus.ts')) continue
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '') // comments may say it
        if (/not yet tried in game|new, untested|\(experimental\)|chip">new</i.test(code) && !code.includes('PIMP_EXIT =')) offenders.push(`${f}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('words a feature by its state', () => {
    const proven = Object.keys(FEATURES).find((k) => FEATURES[k as FeatureId].state === 'proven') as FeatureId
    const untested = Object.keys(FEATURES).find((k) => FEATURES[k as FeatureId].state !== 'proven') as FeatureId
    expect([statusTag(proven), statusSentence(proven), statusParen(proven)]).toEqual(['', '', ''])
    expect(statusTag(untested)).toBe('not yet tried in game')
    expect(statusSentence(untested)).toBe(' Not yet tried in game.')
  })

  it('lists what every export ships first, for the in-game test', () => {
    const defaults = Object.entries(FEATURES).filter(([, f]) => 'byDefault' in f && f.byDefault).map(([k]) => k)
    expect(defaults).toEqual(expect.arrayContaining(['game_sky', 'loading_screen', 'logo_walls']))
    for (const f of Object.values(FEATURES)) if (f.state === 'proven') expect('tested' in f && f.tested).toBeTruthy()
  })
})
