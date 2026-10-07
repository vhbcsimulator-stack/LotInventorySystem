import { Box, Flex, Icon, Image, Text } from '@chakra-ui/react'
import bhriLogo from '@/assets/BHRI OFFICIAL LOGO TRANSPARENT.png'
import { COLORS } from '@/theme/colors'
import {
  LuBuilding2,
  LuLayoutDashboard,
  LuLogOut,
  LuMegaphone,
  LuBriefcaseBusiness,
  LuContactRound,
  LuUsers,
} from 'react-icons/lu'

const DEFAULT_NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LuLayoutDashboard },
  { key: 'projects', label: 'Projects & Lots', icon: LuBuilding2 },
  { key: 'clients', label: 'Clients', icon: LuUsers },
  { key: 'brokers', label: 'Brokers', icon: LuContactRound },
  { key: 'salesAgents', label: 'Sales Agents', icon: LuBriefcaseBusiness },
  { key: 'announcements', label: 'Announcements', icon: LuMegaphone },
]

const DEFAULT_FOOTER_ITEMS = [
  { key: 'logout', label: 'Logout', icon: LuLogOut, tone: 'danger' },
]

const DEFAULT_BRAND = {
  name: 'BHRI Portal',
  tagline: 'Buy Smart. Sell Wise.',
  logo: bhriLogo,
}

function NavLink({ item, isActive, onSelect }) {
  const isDanger = item.tone === 'danger'
  const fg = isActive ? COLORS.activeFg : isDanger ? COLORS.danger : COLORS.muted

  return (
    <Flex
      as={item.href ? 'a' : 'button'}
      href={item.href}
      type={item.href ? undefined : 'button'}
      onClick={() => onSelect?.(item)}
      aria-current={isActive ? 'page' : undefined}
      w="full"
      align="center"
      gap="8px"
      p="8px"
      borderRadius="8px"
      textAlign="left"
      cursor="pointer"
      bg={isActive ? COLORS.activeBg : 'transparent'}
      color={fg}
      boxShadow={isActive ? '0px 1px 2px rgba(0, 0, 0, 0.05)' : undefined}
      transition="background-color 120ms ease, color 120ms ease"
      _hover={{ bg: isActive ? COLORS.activeBg : COLORS.hoverBg }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
    >
      {item.icon ? <Icon as={item.icon} boxSize="16px" color={fg} flexShrink={0} /> : null}
      <Text
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="600"
        fontSize="14px"
        lineHeight="20px"
      >
        {item.label}
      </Text>
    </Flex>
  )
}

/**
 * Reusable app sidebar. Drop it in anywhere:
 *
 *   <Sidebar activeKey="dashboard" onNavigate={(item) => go(item.key)} />
 *
 * Every block is overridable: `brand`, `navLabel`, `navItems`, `footerItems`,
 * `status` (pass null to hide). Extra props (position, height, ...) are spread
 * onto the root <aside>.
 */
export default function Sidebar({
  brand = DEFAULT_BRAND,
  navLabel = 'Navigation',
  navItems = DEFAULT_NAV_ITEMS,
  footerItems = DEFAULT_FOOTER_ITEMS,
  // status = DEFAULT_STATUS,
  activeKey = navItems[0]?.key,
  onNavigate,
  ...rest
}) {
  return (
    <Flex
      as="aside"
      direction="column"
      justify="space-between"
      align="stretch"
      w="260px"
      flexShrink={0}
      h="100%"
      minH="100vh"
      bg={COLORS.surface}
      boxShadow="0px 1px 8px rgba(0, 0, 0, 0.04)"
      {...rest}
    >
      <Box>
        {/* Brand */}
        {/*
         * Stacked, not side-by-side: at 260px wide the rail cannot fit a legible
         * logo and the tagline on one row without the tagline breaking to one
         * word per line.
         */}
        <Flex direction="column" align="center" gap="10px" px="24px" pt="24px" pb="8px">
          {/*
           * `logo` wins over `icon`. The BHRI artwork sits in a band across the
           * middle of a square transparent canvas, so the box is wide and short
           * and `cover` crops away the empty top and bottom — the mark shows
           * about 60px tall instead of a third of that.
           */}
          {brand?.logo ? (
            <Image
              src={brand.logo}
              alt={brand.name ? `${brand.name} logo` : 'Logo'}
              w="160px"
              h="68px"
              maxW="100%"
              objectFit="cover"
            />
          ) : brand?.icon ? (
            <Flex
              align="center"
              justify="center"
              boxSize="36px"
              flexShrink={0}
              bg={COLORS.brandGreen}
              borderRadius="8px"
            >
              <Icon as={brand.icon} boxSize="15px" color="#FFFFFF" />
            </Flex>
          ) : null}
          <Box minW={0} w="full" textAlign="center">
            <Text
              fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
              fontWeight="600"
              fontSize="18px"
              lineHeight="22px"
              letterSpacing="-0.4px"
              color={COLORS.heading}
            >
              {brand?.name}
            </Text>
            {brand?.tagline ? (
              <Text
                mt="4px"
                fontFamily="Inter, system-ui, sans-serif"
                fontWeight="600"
                fontSize="11px"
                lineHeight="15px"
                letterSpacing="0.8px"
                textTransform="uppercase"
                color={COLORS.muted}
              >
                {brand.tagline}
              </Text>
            ) : null}
          </Box>
        </Flex>

        {/* Primary navigation */}
        {navLabel ? (
          <Text
            pt="28px"
            pb="6px"
            px="24px"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="600"
            fontSize="11px"
            lineHeight="14px"
            letterSpacing="0.55px"
            textTransform="uppercase"
            color={COLORS.muted}
          >
            {navLabel}
          </Text>
        ) : null}
        <Flex as="nav" direction="column" gap="4px" pt="4px" px="16px">
          {navItems.map((item) => (
            <NavLink
              key={item.key}
              item={item}
              isActive={item.key === activeKey}
              onSelect={onNavigate}
            />
          ))}
        </Flex>
      </Box>

      {/* Footer: secondary nav + status card */}
      <Box p="16px" bg={COLORS.surface}>
        <Flex as="nav" direction="column" gap="4px">
          {footerItems.map((item) => (
            <NavLink
              key={item.key}
              item={item}
              isActive={item.key === activeKey}
              onSelect={onNavigate}
            />
          ))}
        </Flex>

        {status ? (
          <Flex align="center" gap="8px" mt="8px" p="8px" borderRadius="8px" bg={COLORS.statusBg}>
            {status.icon ? (
              <Icon as={status.icon} boxSize="16px" color={COLORS.brandGreen} flexShrink={0} />
            ) : null}
            <Box flex="1" minW={0}>
              <Text
                fontFamily="Inter, system-ui, sans-serif"
                fontWeight="600"
                fontSize="11px"
                lineHeight="14px"
                letterSpacing="0.44px"
                color={COLORS.heading}
                truncate
              >
                {status.title}
              </Text>
              <Text
                fontFamily="Inter, system-ui, sans-serif"
                fontWeight="600"
                fontSize="11px"
                lineHeight="14px"
                letterSpacing="0.44px"
                color={COLORS.muted}
                truncate
              >
                {status.subtitle}
              </Text>
            </Box>
          </Flex>
        ) : null}
      </Box>
    </Flex>
  )
}
