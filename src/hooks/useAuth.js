import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/data/supabase'

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

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) console.error('[auth] sign out failed:', error)
  }, [])

  return { session, user: session?.user ?? null, loading, signIn, signOut }
}
