import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  PORTAL_CONTROLS_KEY,
  fetchPortalControls,
  reloadPortalControls,
  subscribePortalControls,
} from '@/data/portalControlsData'
import { PortalControlsContext } from '@/hooks/usePortalControls'
import { isDeveloper } from '@/lib/portalControls'

/**
 * Loads the portal controls for whoever is signed in (or nobody, on the sign-in
 * page) and keeps them current: realtime pushes a developer's change to every
 * open portal, and a slow poll covers a database without realtime set up.
 */
export default function PortalControlsProvider({ user, children }) {
  const { data: controls = {} } = useQuery({
    queryKey: [...PORTAL_CONTROLS_KEY, user?.id ?? 'anon'],
    queryFn: fetchPortalControls,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => subscribePortalControls(() => reloadPortalControls()), [user?.id])

  const value = useMemo(() => ({ controls, developer: isDeveloper(user), user }), [controls, user])
  return <PortalControlsContext.Provider value={value}>{children}</PortalControlsContext.Provider>
}
