import { Suspense, useEffect, useState } from 'react'
import { Box, CloseButton, Drawer, Flex, Portal } from '@chakra-ui/react'
import AppSkeleton from '@/components/skeletons/AppSkeleton'
import { SkeletonKeyframes } from '@/components/ui-kit/Skeleton'
import { RevealKeyframes } from '@/components/ui-kit/Reveal'
import { ChartKeyframes } from '@/components/ui-kit/ChartKeyframes'
import LogoutDialog from '@/components/LogoutDialog'
import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import useAuth from '@/hooks/useAuth'
import { PAGES, PAGE_FALLBACKS, preloadPages } from '@/pages'
import SignInPage from '@/pages/SignInPage'
import { COLORS } from '@/theme/colors'

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  projects: 'Projects & Lots',
  announcements: 'Announcements',
  brokers: 'Add Brokers',
}

/** Name and role for the top bar, from the Supabase user's metadata when present. */
function displayUser(user) {
  const meta = user.user_metadata ?? {}
  const name = meta.full_name || meta.name
  return {
    name: name || user.email,
    role: meta.role || (name ? user.email : 'Signed in'),
  }
}

function App() {
  const [active, setActive] = useState('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  /* Props the page being opened starts with — e.g. the dashboard's View Map
     opens Projects & Lots already on its map tab. */
  const [pageProps, setPageProps] = useState({})
  const { user, loading, signIn, signOut } = useAuth()
  // Logout asks first; `loggingOut` holds the dialog open until the session has ended.
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)')
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  // Signed in: fetch the other pages' code while the first one loads its data.
  useEffect(() => {
    if (user) preloadPages()
  }, [user])

  if (loading) {
    return (
      <>
        <SkeletonKeyframes />
        <AppSkeleton />
      </>
    )
  }

  if (!user) return <SignInPage onSignIn={signIn} />

  function handleNavigate(item) {
    setMenuOpen(false)
    if (item.key === 'logout') {
      setLogoutOpen(true)
      return
    }
    setPageProps({})
    setActive(item.key)
  }

  /*
   * A quick access result opens its page with the props it carries — which is
   * how "Add lot" arrives with its dialog already open. `commandRun` changes on
   * every pick and feeds the page's `key`, so choosing the same command twice
   * remounts the page and runs it again instead of landing on one that has
   * already handled it.
   */
  async function handleLogout() {
    setLoggingOut(true)
    try {
      await signOut()
      setPageProps({})
      setActive('dashboard')
    } finally {
      setLoggingOut(false)
      setLogoutOpen(false)
    }
  }

  function handleRunCommand(command) {
    setMenuOpen(false)
    setPageProps({ ...(command.props ?? {}), commandRun: Date.now() })
    setActive(command.page)
  }

  const ActivePage = PAGES[active] ?? PAGES.dashboard
  const PageFallback = PAGE_FALLBACKS[active] ?? PAGE_FALLBACKS.dashboard

  return (
    <Flex h="100dvh" bg={COLORS.canvas} overflow="hidden">
      <SkeletonKeyframes />
      <RevealKeyframes />
      <ChartKeyframes />
      <LogoutDialog open={logoutOpen} busy={loggingOut} onCancel={() => setLogoutOpen(false)} onConfirm={handleLogout} />
      <Sidebar activeKey={active} onNavigate={handleNavigate} minH="auto" h="100%" display={{ base: 'none', lg: 'flex' }} />
      <Drawer.Root open={menuOpen} onOpenChange={({ open }) => setMenuOpen(open)} placement="start">
        <Portal>
          <Drawer.Backdrop display={{ base: 'block', lg: 'none' }} />
          <Drawer.Positioner display={{ base: 'flex', lg: 'none' }}>
            <Drawer.Content w="min(300px, 88vw)" maxW="88vw" h="100dvh" bg={COLORS.surface}>
              <Drawer.Title position="absolute" w="1px" h="1px" overflow="hidden">Navigation</Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <CloseButton position="absolute" top="12px" right="12px" zIndex={2} aria-label="Close navigation" />
              </Drawer.CloseTrigger>
              <Sidebar activeKey={active} onNavigate={handleNavigate} minH="auto" h="100%" w="100%" overflowY="auto" />
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
      <Flex direction="column" flex="1" minW={0}>
        <TopBar
          title={PAGE_TITLES[active] ?? ''}
          user={displayUser(user)}
          onMenuOpen={() => setMenuOpen(true)}
          onRunCommand={handleRunCommand}
        />
        <Box as="main" flex="1" minH={0} minW={0} p={{ base: '12px', sm: '16px', lg: '20px' }} overflowY="auto" overflowX="hidden">
          {/* A page can send the reader to another one: the dashboard's cards
              link through to what they summarise. */}
          {/* Each page reveals its own content once loaded — see Reveal. */}
          <Suspense fallback={<PageFallback />}>
            <ActivePage
              key={`${active}:${pageProps.commandRun ?? ''}`}
              {...pageProps}
              onNavigate={(key, props) => {
                setPageProps(props ?? {})
                setActive(key)
              }}
            />
          </Suspense>
        </Box>
      </Flex>
    </Flex>
  )
}

export default App
