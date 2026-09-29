import { Box, Flex, Grid, Text } from '@chakra-ui/react'
import { Card } from '@/components/ui-kit/Card'
import { COLORS } from '@/theme/colors'
import { formatNumber, formatPct } from '@/utils/format'
import { DEFAULT_LOT_TERMS } from '@/data/projectsData'

function StatCard({ label, value, suffix, suffixColor, barPct, barColor, barLabel, primary = false }) {
  const width = Math.min(100, Math.max(0, barPct))

  return (
    <Card
      p={primary ? { base: '20px', md: '24px' } : '18px'}
      h="full"
      minH={primary ? { '2xl': '100%' } : undefined}
      display="flex"
      flexDirection="column"
      justifyContent={primary ? 'center' : undefined}
    >
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

      <Flex mt="12px" align="baseline" gap="8px" flexWrap="wrap">
        <Text
          fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
          fontWeight="700"
          fontSize={primary ? { base: '34px', md: '42px' } : '26px'}
          lineHeight={primary ? { base: '40px', md: '48px' } : '32px'}
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
  { key: 'available', label: 'Available Inventory' },
  { key: 'reserved', label: 'Active Reservations' },
  { key: 'rsv-p', label: 'Pending Reservations' },
  { key: 'hold', label: 'On Hold' },
  { key: 'sold', label: 'Closed & Sold' },
]

/**
 * Project-wide inventory counts. Shares are computed here from the counts
 * rather than read from the API, so a percentage can never disagree with the
 * number printed beside it.
 *
 * `phase` is the lot table's Phase filter, so one dropdown narrows both the
 * table and these cards; empty (or a phase this project lacks) shows every lot.
 */
export default function LotStatsRow({ stats, phase = '', terms = DEFAULT_LOT_TERMS }) {
  const selectedStats = (phase && stats.byPhase?.[phase]) || stats
  const { totalLots, byStatus = {} } = selectedStats
  const noun = `${terms.item.toLowerCase()}s`
  const share = (count) => (totalLots ? (count / totalLots) * 100 : 0)

  return (
    <Box>
      <Grid templateColumns={{ base: '1fr', '2xl': 'repeat(4, 1fr)' }} gap="16px">
      <Box>
        <StatCard
          primary
          label={`Total ${terms.item}s`}
          value={totalLots}
          suffix="Units Master"
          suffixColor={COLORS.subtle}
          barPct={totalLots ? 100 : 0}
          barColor={COLORS.brandGreen}
          barLabel={`${totalLots} ${noun} in total`}
        />
      </Box>
      <Grid
        gridColumn={{ '2xl': 'span 3' }}
        templateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)', '2xl': 'repeat(6, 1fr)' }}
        gap="16px"
      >
        {STATUS_CARDS.map((card, index) => {
          const count = byStatus[card.key] ?? 0
          const pct = share(count)
          return (
            <Box key={card.key} gridColumn={{ '2xl': index < 3 ? 'span 2' : 'span 3' }}>
              <StatCard
                label={card.label}
                value={count}
                suffix={formatPct(pct)}
                suffixColor={COLORS.brandGreen}
                barPct={pct}
                barColor={COLORS.brandGreen}
                barLabel={`${count} ${card.label.toLowerCase()} ${noun}, ${formatPct(pct)} of total`}
              />
            </Box>
          )
        })}
      </Grid>
      </Grid>
    </Box>
  )
}
