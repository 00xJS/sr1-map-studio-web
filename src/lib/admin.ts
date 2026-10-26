// The developer's own pages (the data labelling desk): shown only to the signed-in account whose email matches. The
// emails are kept here as SHA-256 hashes, so the public code never holds an address; the check runs in this browser.
// It only decides what the page shows: the labels it edits are this browser's own (game data never leaves it).
import { useEffect, useState } from 'react'
import { useUser, type User } from './backend'

/** SHA-256 of each developer's email, trimmed and lower-cased. */
const ADMIN_EMAIL_HASHES = new Set(['001be947a90d4aa2f61d1b097173a22b81bf47c5dfaae47861208bd0b184354a'])

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Whether this account is a developer's. */
export async function isAdmin(user: Pick<User, 'email'> | null): Promise<boolean> {
  if (!user?.email) return false
  return ADMIN_EMAIL_HASHES.has(await sha256(user.email.trim().toLowerCase()))
}

/** The signed-in account is a developer's: null while it's being checked. */
export function useIsAdmin(): boolean | null {
  const user = useUser()
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    setOk(null)
    void isAdmin(user).then((v) => { if (live) setOk(v) })
    return () => { live = false }
  }, [user?.email])
  return ok
}
