import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/data/supabase'
import { queryClient } from '@/data/queryClient'

/**
 * The Supabase Auth session. supabase-js keeps it in localStorage and refreshes
 * the token, so a signed-in user stays signed in across reloads.
 * Returns { session, user, loading, signIn, signOut }.
 */
export default function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) return undefined
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  /** Throws with Supabase's message (e.g. "Invalid login credentials") on failure. */
  const signIn = useCallback(async (email, password) => {
    if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  /**
   * Always ends the session on this device. When the server cannot revoke it
   * (expired token, offline), supabase-js keeps the local session on error, so
   * a local-only sign-out follows. The data cache goes too, so the next person
   * to sign in never sees this session's rows.
   */
  const signOut = useCallback(async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('[auth] server sign out failed, signing out on this device only:', error)
        await supabase.auth.signOut({ scope: 'local' })
      }
    }
    setSession(null)
    queryClient.clear()
  }, [])

  return { session, user: session?.user ?? null, loading, signIn, signOut }
}
