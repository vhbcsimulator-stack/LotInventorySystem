import { Suspense, useEffect, useState } from 'react'
import { Box, CloseButton, Drawer, Flex, Portal } from '@chakra-ui/react'
import AppSkeleton from '@/components/skeletons/AppSkeleton'
import { SkeletonKeyframes } from '@/components/ui-kit/Skeleton'
import { RevealKeyframes } from '@/components/ui-kit/Reveal'
import { ChartKeyframes } from '@/components/ui-kit/ChartKeyframes'
import LogoutDialog from '@/components/LogoutDialog'
import MaintenanceScreen from '@/components/MaintenanceScreen'
import PortalControlsProvider from '@/components/PortalControlsProvider'
import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import useAuth from '@/hooks/useAuth'
import usePortalControls from '@/hooks/usePortalControls'
import {
  CONTROL_STATE,
  PAGE_CONTROLS,
  PORTAL_CONTROL,
  controlMessage,
  controlState,
  pageControl,
} from '@/lib/portalControls'
import { PAGES, PAGE_FALLBACKS, preloadPages } from '@/pages'
import SignInPage from '@/pages/SignInPage'
import { COLORS } from '@/theme/colors'

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  projects: 'Projects & Lots',
  announcements: 'Announcements',
  brokers: 'Add Brokers',
  salesAgents: 'Add Sales Agents',
  regularUsers: 'Add Regular Users',
  applications: 'Pending Applications',
  clients: 'Clients',
  devControls: 'Developer Controls',
}

const PAGE_ORDER = PAGE_CONTROLS.map((item) => item.page)

/** A thin strip telling a developer what everyone else is not seeing. */
function DevNotice({ children }) {
  return (
    <Box
      role="status"
      mb="12px"
      px="12px"
      py="8px"
      borderRadius="8px"
      bg="#FEF3E2"
      color="#92400E"
      fontFamily="Inter, system-ui, sans-serif"
      fontSize="13px"
      fontWeight="600"
    >
      {children}
    </Box>
  )
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
  const auth = useAuth()
  // The controls load before sign-in too, so the sign-in page can say the portal is down.
  return (
    <PortalControlsProvider user={auth.user}>
      <PortalShell auth={auth} />
    </PortalControlsProvider>
  )
}

function PortalShell({ auth }) {
  const [active, setActive] = useState('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  /* Props the page being opened starts with — e.g. the dashboard's View Map
     opens Projects & Lots already on its map tab. */
  const [pageProps, setPageProps] = useState({})
  const { user, loading, signIn, signOut } = auth
  const { controls, developer } = usePortalControls()
  const portalState = controlState(controls, PORTAL_CONTROL)
  const portalMessage = controlMessage(controls, PORTAL_CONTROL)
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

  if (!user) {
    return (
      <SignInPage
        onSignIn={signIn}
        maintenance={portalState === CONTROL_STATE.MAINTENANCE ? { message: portalMessage } : null}
      />
    )
  }

  // Whole portal under maintenance: everyone but a developer stops here.
  if (portalState === CONTROL_STATE.MAINTENANCE && !developer) {
    return (
      <>
        <LogoutDialog open={logoutOpen} busy={loggingOut} onCancel={() => setLogoutOpen(false)} onConfirm={handleLogout} />
        <MaintenanceScreen
          fullScreen
          title="The portal is under maintenance"
          message={portalMessage}
          onLogout={() => setLogoutOpen(true)}
        />
      </>
    )
  }

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

  /*
   * A hidden page cannot be opened — from the menu, a dashboard card, or quick
   * access — except by a developer; landing on one shows the first page that is
   * still visible instead. Developer Controls is for developers only.
   */
  const pageState = (key) => controlState(controls, pageControl(key))
  const canOpen = (key) =>
    key === 'devControls' ? developer : Boolean(PAGES[key]) && (developer || pageState(key) !== CONTROL_STATE.HIDDEN)
  const shown = canOpen(active) ? active : PAGE_ORDER.find(canOpen)
  const shownState = shown && shown !== 'devControls' ? pageState(shown) : CONTROL_STATE.VISIBLE

  const ActivePage = PAGES[shown] ?? PAGES.dashboard
  const PageFallback = PAGE_FALLBACKS[shown] ?? PAGE_FALLBACKS.dashboard

  let content
  if (!shown) {
    content = <MaintenanceScreen title="Nothing to show right now" message="Every page is switched off for the moment. Please check back shortly." />
  } else if (shownState === CONTROL_STATE.MAINTENANCE && !developer) {
    content = (
      <MaintenanceScreen
        title={`${PAGE_TITLES[shown] ?? 'This page'} is under maintenance`}
        message={controlMessage(controls, pageControl(shown))}
      />
    )
  } else {
    content = (
      <>
        {developer && portalState === CONTROL_STATE.MAINTENANCE ? (
          <DevNotice>The whole portal is under maintenance</DevNotice>
        ) : null}
        {developer && shownState !== CONTROL_STATE.VISIBLE ? (
          <DevNotice>
            This page is {shownState === CONTROL_STATE.HIDDEN ? 'hidden from' : 'under maintenance for'} everyone but developers.
          </DevNotice>
        ) : null}
        <Suspense fallback={<PageFallback />}>
          <ActivePage
            key={`${shown}:${pageProps.commandRun ?? ''}`}
            {...pageProps}
            onNavigate={(key, props) => {
              setPageProps(props ?? {})
              setActive(key)
            }}
          />
        </Suspense>
      </>
    )
  }

  return (
    <Flex h="100dvh" bg={COLORS.canvas} overflow="hidden">
      <SkeletonKeyframes />
      <RevealKeyframes />
      <ChartKeyframes />
      <LogoutDialog open={logoutOpen} busy={loggingOut} onCancel={() => setLogoutOpen(false)} onConfirm={handleLogout} />
      <Sidebar activeKey={shown} onNavigate={handleNavigate} minH="auto" h="100%" display={{ base: 'none', lg: 'flex' }} />
      <Drawer.Root open={menuOpen} onOpenChange={({ open }) => setMenuOpen(open)} placement="start">
        <Portal>
          <Drawer.Backdrop display={{ base: 'block', lg: 'none' }} />
          <Drawer.Positioner display={{ base: 'flex', lg: 'none' }}>
            <Drawer.Content w="min(300px, 88vw)" maxW="88vw" h="100dvh" bg={COLORS.surface}>
              <Drawer.Title position="absolute" w="1px" h="1px" overflow="hidden">Navigation</Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <CloseButton position="absolute" top="12px" right="12px" zIndex={2} aria-label="Close navigation" />
              </Drawer.CloseTrigger>
              <Sidebar activeKey={shown} onNavigate={handleNavigate} minH="auto" h="100%" w="100%" overflowY="auto" />
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
      <Flex direction="column" flex="1" minW={0}>
        <TopBar
          title={PAGE_TITLES[shown] ?? ''}
          user={displayUser(user)}
          onMenuOpen={() => setMenuOpen(true)}
          onRunCommand={handleRunCommand}
        />
        <Box as="main" flex="1" minH={0} minW={0} p={{ base: '12px', sm: '16px', lg: '20px' }} overflowY="auto" overflowX="hidden">
          {/* A page can send the reader to another one: the dashboard's cards
              link through to what they summarise. */}
          {/* Each page reveals its own content once loaded — see Reveal. */}
          {content}
        </Box>
      </Flex>
    </Flex>
  )
}

export default App
