import { useState } from 'react'
import { Box, Flex } from '@chakra-ui/react'
import AppSkeleton from '@/components/skeletons/AppSkeleton'
import { SkeletonKeyframes } from '@/components/ui-kit/Skeleton'
import { RevealKeyframes } from '@/components/ui-kit/Reveal'
import { ChartKeyframes } from '@/components/ui-kit/ChartKeyframes'
import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import useAuth from '@/hooks/useAuth'
import { PAGES } from '@/pages'
import SignInPage from '@/pages/SignInPage'
import { COLORS } from '@/theme/colors'

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  projects: 'Projects & Lots',
  announcements: 'Announcements',
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
  /* Props the page being opened starts with — e.g. the dashboard's View Map
     opens Projects & Lots already on its map tab. */
  const [pageProps, setPageProps] = useState({})
  const { user, loading, signIn, signOut } = useAuth()

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
    if (item.key === 'logout') {
      signOut()
      setPageProps({})
      setActive('dashboard')
      return
    }
    setPageProps({})
    setActive(item.key)
  }

  const ActivePage = PAGES[active] ?? PAGES.dashboard

  return (
    <Flex h="100vh" bg={COLORS.canvas} overflow="hidden">
      <SkeletonKeyframes />
      <RevealKeyframes />
      <ChartKeyframes />
      <Sidebar activeKey={active} onNavigate={handleNavigate} minH="auto" h="100vh" />
      <Flex direction="column" flex="1" minW={0}>
        <TopBar title={PAGE_TITLES[active] ?? ''} user={displayUser(user)} hasAlerts />
        <Box as="main" flex="1" minH={0} p="20px" overflowY="auto">
          {/* A page can send the reader to another one: the dashboard's cards
              link through to what they summarise. */}
          {/* Each page reveals its own content once loaded — see Reveal. */}
          <ActivePage
            key={active}
            {...pageProps}
            onNavigate={(key, props) => {
              setPageProps(props ?? {})
              setActive(key)
            }}
          />
        </Box>
      </Flex>
    </Flex>
  )
}

export default App
