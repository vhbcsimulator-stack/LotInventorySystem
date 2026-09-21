import { useMemo, useState } from 'react'
import { Box, Flex, Text } from '@chakra-ui/react'
import { Card, CardHeading } from '@/components/ui-kit/Card'
import SegmentedControl from '@/components/ui-kit/SegmentedControl'
import { motion, CHART_MOTION } from '@/components/ui-kit/chartMotion'
import { COLORS, CHART } from '@/theme/colors'
import { formatNumber, formatPct } from '@/utils/format'

/** The view showing one bar per project rather than one per phase. */
const ESTATES = 'estates'

function Stat({ label, value, color = COLORS.heading }) {
  return (
    <Box minW="112px">
      <Text fontFamily="Inter, system-ui, sans-serif" fontSize="12px" lineHeight="16px" color={COLORS.subtle}>
        {label}
      </Text>
      <Text
        mt="2px"
        fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
        fontWeight="700"
        fontSize="16px"
        lineHeight="22px"
        letterSpacing="-0.2px"
        color={color}
      >
        {value}
      </Text>
    </Box>
  )
}

function LegendItem({ color, label }) {
  return (
    <Flex align="center" gap="5px">
      <Box boxSize="8px" borderRadius="full" bg={color} />
      <Text fontFamily="Inter, system-ui, sans-serif" fontSize="11px" lineHeight="15px" color={COLORS.subtle}>
        {label}
      </Text>
    </Flex>
  )
}

/**
 * One bar: sold and reserved fill from the left, and what is left of the track
 * is open inventory — so the bar's filled share is how far the phase has sold
 * through. The figure beside it is the share sold, which is the one number the
 * card exists to give.
 */
function Bar({ row, index, indented = false }) {
  const { label, sold, reserved, open, total, soldPct } = row
  const pct = (n) => (total ? (n / total) * 100 : 0)

  return (
    <Box pl={indented ? '12px' : 0}>
      <Flex align="baseline" justify="space-between" gap="12px">
        <Text
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight={indented ? '500' : '600'}
          fontSize="13px"
          lineHeight="18px"
          color={indented ? COLORS.subtle : COLORS.heading}
          truncate
        >
          {label}
        </Text>
        <Flex flexShrink={0} align="baseline" gap="8px">
          <Text fontFamily="Inter, system-ui, sans-serif" fontSize="12px" lineHeight="16px" color={COLORS.subtle}>
            {formatNumber(open)} open / {formatNumber(total)} total
          </Text>
          <Text
            fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
            fontWeight="700"
            fontSize="13px"
            lineHeight="18px"
            color={CHART.sold}
          >
            {formatPct(soldPct)}
          </Text>
        </Flex>
      </Flex>

      <Flex
        mt="6px"
        h="8px"
        w="full"
        borderRadius="full"
        overflow="hidden"
        bg={CHART.available}
        gap="2px"
        role="img"
        aria-label={`${label}: ${sold} sold, ${reserved} reserved, ${open} open of ${total} lots`}
      >
        {/* Staggered per row, so the card fills in the order it is read. */}
        <Box
          w={`${pct(sold)}%`}
          bg={CHART.sold}
          transformOrigin="left center"
          {...motion(CHART_MOTION.grow, { duration: 780, delay: 120 + index * 40 })}
        />
        <Box
          w={`${pct(reserved)}%`}
          bg={CHART.reserved}
          transformOrigin="left center"
          {...motion(CHART_MOTION.grow, { duration: 780, delay: 220 + index * 40 })}
        />
      </Flex>
    </Box>
  )
}

/**
 * How far the portfolio has sold through, by estate or phase by phase.
 *
 * This is the movement figure the lot tables can actually support. The only
 * date they hold says when a row was last written, not when a lot was sold, and
 * most rows have none at all — so "lots sold in March" was never a fact the
 * records held, while "Phase 2 is 64% sold" is one every row agrees on.
 */
export default function SellThroughCard({ sellThrough = [] }) {
  const [view, setView] = useState(ESTATES)

  /*
   * Estates first, then every project that has lots — including one that keeps
   * them in a single group, like ERHD, which groups none at all. Listing only
   * the projects with several phases left the switch reading "By estate | MVLC",
   * which looks like the other estates are missing rather than undivided.
   */
  const options = useMemo(
    () => [
      { value: ESTATES, label: 'By estate' },
      ...sellThrough.filter((project) => project.total).map((project) => ({ value: project.key, label: project.key })),
    ],
    [sellThrough],
  )

  // A project filtered out of scope leaves its view selected; fall back to estates.
  const active = sellThrough.find((project) => project.key === view) ?? null
  const rows = active ? active.phases : sellThrough

  const totals = rows.reduce(
    (sum, row) => ({
      sold: sum.sold + row.sold,
      reserved: sum.reserved + row.reserved,
      open: sum.open + row.open,
      total: sum.total + row.total,
    }),
    { sold: 0, reserved: 0, open: 0, total: 0 },
  )

  const soldPct = totals.total ? (totals.sold / totals.total) * 100 : 0
  const takenPct = totals.total ? ((totals.sold + totals.reserved) / totals.total) * 100 : 0

  return (
    <Card display="flex" flexDirection="column">
      <CardHeading
        title="Sell-Through by Phase"
        description={
          active
            ? `How much of each ${active.unit ? active.unit.toLowerCase() : 'phase'} of ${active.label} has moved.`
            : 'How much of each estate has moved, out of everything it holds.'
        }
        actions={
          options.length > 1 ? <SegmentedControl options={options} value={view} onChange={setView} size="sm" /> : null
        }
      />

      <Flex gap="24px" mb="14px" flexWrap="wrap">
        <Stat label="Sold" value={formatPct(soldPct)} color={CHART.sold} />
        <Stat label="Sold or reserved" value={formatPct(takenPct)} color={CHART.reserved} />
        <Stat label="Open" value={`${formatNumber(totals.open)} lots`} />
      </Flex>

      <Flex direction="column" gap="14px" flex="1">
        {rows.length === 0 ? (
          <Flex
            align="center"
            justify="center"
            minH="200px"
            borderRadius="10px"
            bg={COLORS.canvas}
            border="1px dashed"
            borderColor={COLORS.border}
          >
            <Text fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.subtle}>
              No lots to measure yet.
            </Text>
          </Flex>
        ) : (
          rows.map((row, index) => <Bar key={row.key} row={row} index={index} indented={Boolean(active)} />)
        )}
      </Flex>

      <Flex align="center" gap="12px" mt="16px" pt="14px" borderTop="1px solid" borderColor={COLORS.border}>
        <LegendItem color={CHART.sold} label="Sold" />
        <LegendItem color={CHART.reserved} label="Reserved" />
        <LegendItem color={CHART.available} label="Open" />
        <Text
          ml="auto"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="12px"
          lineHeight="16px"
          color={COLORS.subtle}
        >
          {formatNumber(totals.total)} lots counted
        </Text>
      </Flex>
    </Card>
  )
}
