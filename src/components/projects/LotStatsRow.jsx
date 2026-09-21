import { Box, Flex, Icon, SimpleGrid, Text } from '@chakra-ui/react'
import { LuBadgeCheck, LuCalendarClock, LuCircleCheck, LuGrid2X2 } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import { COLORS, LOT_STATUS } from '@/theme/colors'
import { formatNumber, formatPct } from '@/utils/format'
import { DEFAULT_LOT_TERMS } from '@/data/projectsData'

function StatCard({ label, icon, iconColor, value, suffix, suffixColor, barPct, barColor, barLabel }) {
  const width = Math.min(100, Math.max(0, barPct))

  return (
    <Card p="18px">
      <Flex align="flex-start" justify="space-between" gap="12px">
        <Text
          maxW="14ch"
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight="500"
          fontSize="13px"
          lineHeight="18px"
          color={COLORS.subtle}
        >
          {label}
        </Text>
        <Icon as={icon} boxSize="18px" color={iconColor} flexShrink={0} />
      </Flex>

      <Flex mt="12px" align="baseline" gap="8px" flexWrap="wrap">
        <Text
          fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
          fontWeight="700"
          fontSize="26px"
          lineHeight="32px"
          letterSpacing="-0.6px"
          color={COLORS.heading}
        >
          {formatNumber(value)}
        </Text>
        <Text
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight="600"
          fontSize="12px"
          lineHeight="16px"
          color={suffixColor}
        >
          {suffix}
        </Text>
      </Flex>

      <Box
        mt="14px"
        h="5px"
        w="full"
        borderRadius="full"
        bg={COLORS.hoverBg}
        overflow="hidden"
        role="img"
        aria-label={barLabel}
      >
        <Box h="full" w={`${width}%`} borderRadius="full" bg={barColor} transition="width 200ms ease" />
      </Box>
    </Card>
  )
}

const STATUS_CARDS = [
  { key: 'available', label: 'Available Inventory', icon: LuCircleCheck },
  { key: 'reserved', label: 'Active Reservations', icon: LuCalendarClock },
  { key: 'sold', label: 'Closed & Sold', icon: LuBadgeCheck },
]

/**
 * Project-wide inventory counts. Shares are computed here from the counts
 * rather than read from the API, so a percentage can never disagree with the
 * number printed beside it.
 */
export default function LotStatsRow({ stats, terms = DEFAULT_LOT_TERMS }) {
  const { totalLots } = stats
  const noun = `${terms.item.toLowerCase()}s`
  const share = (count) => (totalLots ? (count / totalLots) * 100 : 0)

  return (
    <SimpleGrid columns={{ base: 1, sm: 2, xl: 4 }} gap="16px">
      <StatCard
        label={`Total ${terms.item}s`}
        icon={LuGrid2X2}
        iconColor={COLORS.subtle}
        value={totalLots}
        suffix="Units Master"
        suffixColor={COLORS.subtle}
        barPct={totalLots ? 100 : 0}
        barColor={COLORS.heading}
        barLabel={`${totalLots} ${noun} in total`}
      />
      {STATUS_CARDS.map((card) => {
        const status = LOT_STATUS[card.key]
        const count = stats[card.key]
        const pct = share(count)
        return (
          <StatCard
            key={card.key}
            label={card.label}
            icon={card.icon}
            iconColor={status.fg}
            value={count}
            suffix={formatPct(pct)}
            suffixColor={status.fg}
            barPct={pct}
            barColor={status.dot}
            barLabel={`${count} ${status.label.toLowerCase()} ${noun}, ${formatPct(pct)} of total`}
          />
        )
      })}
    </SimpleGrid>
  )
}
