import { Box, Flex, Icon, SimpleGrid, Text } from '@chakra-ui/react'
import { LuBuilding2, LuCircleCheck, LuFileClock, LuTrendingUp, LuWallet } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import { COLORS, CHART } from '@/theme/colors'
import { formatNumber, formatPct } from '@/utils/format'

function Shell({ label, icon, children }) {
  return (
    <Card p="16px" display="flex" flexDirection="column" justifyContent="space-between" minH="132px">
      <Flex align="flex-start" justify="space-between" gap="12px">
        <Text
          maxW="16ch"
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight="500"
          fontSize="13px"
          lineHeight="18px"
          color={COLORS.subtle}
        >
          {label}
        </Text>
        <Flex
          align="center"
          justify="center"
          boxSize="30px"
          borderRadius="8px"
          bg={COLORS.hoverBg}
          flexShrink={0}
        >
          <Icon as={icon} boxSize="15px" color={COLORS.brandGreen} />
        </Flex>
      </Flex>
      <Box mt="10px">{children}</Box>
    </Card>
  )
}

function Value({ children, unit }) {
  return (
    <Flex align="baseline" gap="6px" flexWrap="wrap">
      <Text
        fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
        fontWeight="700"
        fontSize="24px"
        lineHeight="30px"
        letterSpacing="-0.6px"
        color={COLORS.heading}
      >
        {children}
      </Text>
      {unit ? (
        <Text
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="12px"
          lineHeight="16px"
          color={COLORS.subtle}
        >
          {unit}
        </Text>
      ) : null}
    </Flex>
  )
}

function Caption({ children, color = COLORS.subtle }) {
  return (
    <Text fontFamily="Inter, system-ui, sans-serif" fontSize="12px" lineHeight="16px" color={color}>
      {children}
    </Text>
  )
}

export default function KpiRow({ headline, onViewMap }) {
  /*
   * Counts and square metres only. A lot's value is its size times the current
   * price per sqm, and that price comes from a table that is repriced — so a peso
   * headline would move on its own, without a lot being sold.
   *
   * Every tile is the total on the books. There is no date window to qualify
   * them with: the lot tables never recorded when a lot moved.
   */
  const {
    soldLots,
    soldAreaSqm,
    soldSharePct,
    totalLots,
    reservedLots,
    reservedAreaSqm,
    reservedClearanceDays,
    availableLots,
    availableAreaSqm,
    portfolioSharePct,
  } = headline

  const soldPct = totalLots ? Math.round((soldLots / totalLots) * 100) : 0

  return (
    <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap="16px">
      <Shell label="Sold Area" icon={LuWallet}>
        <Value unit="sqm">{formatNumber(soldAreaSqm)}</Value>
        <Flex align="center" gap="4px" mt="6px">
          <Caption color={CHART.sold}>{formatPct(soldSharePct)} of all lots sold</Caption>
        </Flex>
      </Shell>

      <Shell label="Total Sold Lots" icon={LuCircleCheck}>
        <Value unit="units">{formatNumber(soldLots)}</Value>
        <Flex align="center" justify="space-between" gap="8px" mt="8px">
          <Caption>Out of {formatNumber(totalLots)} lots in all projects</Caption>
          <Caption color={COLORS.heading}>{soldPct}%</Caption>
        </Flex>
        {/* Sold against every lot on the books: the filled portion is the series
            color, the rest is a neutral track — not a second category. */}
        <Box
          mt="6px"
          h="6px"
          w="full"
          borderRadius="full"
          bg={CHART.available}
          overflow="hidden"
          role="img"
          aria-label={`${soldLots} of ${totalLots} lots sold, ${soldPct} percent`}
        >
          <Box h="full" w={`${Math.min(soldPct, 100)}%`} borderRadius="full" bg={CHART.sold} />
        </Box>
      </Shell>

      <Shell label="Reserved Lots in Escrow" icon={LuFileClock}>
        <Value unit="in escrow">{formatNumber(reservedLots)}</Value>
        <Flex align="center" justify="space-between" gap="8px" mt="8px">
          <Caption color={COLORS.heading}>{formatNumber(reservedAreaSqm)} sqm</Caption>
          <Caption>{reservedClearanceDays}-day clearance</Caption>
        </Flex>
      </Shell>

      <Shell label="Available Inventory" icon={LuBuilding2}>
        <Value unit="open lots">{formatNumber(availableLots)}</Value>
        <Flex align="center" justify="space-between" gap="8px" mt="8px">
          <Caption>
            {formatPct(portfolioSharePct)} share · {formatNumber(availableAreaSqm)} sqm
          </Caption>
          <Text
            as="button"
            type="button"
            onClick={onViewMap}
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="600"
            fontSize="12px"
            lineHeight="16px"
            color={COLORS.activeBg}
            cursor="pointer"
            _hover={{ textDecoration: 'underline' }}
          >
            View Map
          </Text>
        </Flex>
      </Shell>
    </SimpleGrid>
  )
}
