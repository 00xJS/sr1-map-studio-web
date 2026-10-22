// Picks the account/hub backend from build-time settings:
//   VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY  -> Supabase (production)
//   VITE_BACKEND=local                          -> simulated server (development)
//   neither                                     -> no accounts; local saves only
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { Backend, User } from './types'

const env = import.meta.env
const mode: 'supabase' | 'local' | 'none' =
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY ? 'supabase' : env.VITE_BACKEND === 'local' ? 'local' : 'none'

let instance: Promise<Backend | null> | null = null

/** The configured backend, or null when accounts are turned off. */
export function getBackend(): Promise<Backend | null> {
  instance ??= (async () => {
    if (mode === 'supabase') {
      const { supabaseProjectUrl } = await import('../hubRules')
      return new (await import('./supabase')).SupabaseBackend(supabaseProjectUrl(env.VITE_SUPABASE_URL), env.VITE_SUPABASE_ANON_KEY.trim())
    }
    if (mode === 'local') return new (await import('./local')).LocalBackend()
    return null
  })()
  return instance
}

export const backendMode = mode
export const accountsEnabled = mode !== 'none'

const useAuth = create<{ user: User | null; ready: boolean }>(() => ({ user: null, ready: !accountsEnabled }))

if (accountsEnabled) {
  getBackend().then(async (b) => {
    if (!b) return
    b.onAuthChange((user) => useAuth.setState({ user, ready: true }))
    useAuth.setState({ user: await b.getUser().catch(() => null), ready: true })
  })
}

export const useUser = () => useAuth((s) => s.user)
export const useAuthReady = () => useAuth((s) => s.ready)
export const setUser = (user: User | null) => useAuth.setState({ user })

/** Backend instance for components (null while loading or when disabled). */
export function useBackend(): Backend | null {
  const [b, setB] = useState<Backend | null>(null)
  useEffect(() => { let live = true; getBackend().then((x) => live && setB(x)); return () => { live = false } }, [])
  return b
}

export * from './types'
