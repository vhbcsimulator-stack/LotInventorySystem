import { useMemo, useState } from 'react'
import { Box, Flex, Icon, NativeSelect, Text } from '@chakra-ui/react'
import { LuChartPie } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import { COLORS, CHART } from '@/theme/colors'
import { motion, CHART_MOTION } from '@/components/ui-kit/chartMotion'
import { formatNumber, formatPct } from '@/utils/format'

const SIZE = 200
const RADIUS = 78
const THICKNESS = 22
const CENTER = SIZE / 2

/** Polar -> cartesian, starting at 12 o'clock and running clockwise. */
function pointAt(angleDeg, radius) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)]
}

function arcPath(startDeg, endDeg, outer, inner) {
  const largeArc = endDeg - startDeg > 180 ? 1 : 0
  const [x1, y1] = pointAt(startDeg, outer)
  const [x2, y2] = pointAt(endDeg, outer)
  const [x3, y3] = pointAt(endDeg, inner)
  const [x4, y4] = pointAt(startDeg, inner)
  return [
    `M${x1},${y1}`,
    `A${outer},${outer} 0 ${largeArc} 1 ${x2},${y2}`,
    `L${x3},${y3}`,
    `A${inner},${inner} 0 ${largeArc} 0 ${x4},${y4}`,
    'Z',
  ].join(' ')
}

function LegendRow({ color, label, count, share, isActive, onEnter, onLeave }) {
  return (
    <Flex
      align="center"
      justify="space-between"
      gap="12px"
      py="5px"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      opacity={isActive ? 1 : 0.9}
    >
      <Flex align="center" gap="8px" minW={0}>
        <Box boxSize="9px" borderRadius="full" bg={color} flexShrink={0} />
        <Text
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight={isActive ? 600 : 500}
          fontSize="13px"
          lineHeight="18px"
          color={COLORS.heading}
          truncate
        >
          {label}
        </Text>
      </Flex>
      <Text
        flexShrink={0}
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="13px"
        lineHeight="18px"
        color={COLORS.subtle}
      >
        {formatNumber(count)} ({share})
      </Text>
    </Flex>
  )
}

export default function PortfolioDistributionCard({ distribution, distributions = [] }) {
  const [hovered, setHovered] = useState(null)
  /*
   * Which estate is being read. Overall first, then one per project: a
   * distribution summed over estates that sell different things at different
   * stages hides the very thing it is asked about — whether a given estate is
   * moving — so both readings are offered rather than only the total.
   */
  const [view, setView] = useState('overall')
  const options = distributions.length ? distributions : [{ key: 'overall', label: 'Overall', ...distribution }]
  const shown = options.find((option) => option.key === view) ?? options[0]

  const { activeLots, available, sold, reserved, totalAreaSqm } = shown

  const total = available + sold + reserved
  const isEmpty = total === 0

  const segments = useMemo(() => {
    const total = available + sold + reserved
    // Available is the neutral remainder, not a third categorical series.
    const raw = [
      { key: 'available', label: 'Available', value: available, color: CHART.available },
      { key: 'sold', label: 'Sold', value: sold, color: CHART.sold },
      { key: 'reserved', label: 'Reserved', value: reserved, color: CHART.reserved },
    ]

    let cursor = 0
    return raw.map((seg) => {
      const sharePct = total ? (seg.value / total) * 100 : 0
      const sweep = (sharePct / 100) * 360
      const start = cursor
      cursor += sweep
      // Trim the arc end slightly so adjacent fills never touch.
      return { ...seg, start, end: Math.max(start, cursor - 1.5), sharePct }
    })
  }, [available, sold, reserved])

  return (
    <Card display="flex" flexDirection="column">
      <Flex align="flex-start" justify="space-between" gap="12px" mb="8px">
        <Box>
          <Text
            fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
            fontWeight="700"
            fontSize="16px"
            lineHeight="22px"
            letterSpacing="-0.2px"
            color={COLORS.heading}
          >
            Portfolio Distribution
          </Text>
          <Text
            mt="2px"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="13px"
            lineHeight="18px"
            color={COLORS.subtle}
          >
            {shown.key === 'overall' ? 'Every lot, across every project.' : `Lots in ${shown.label}.`}
          </Text>
        </Box>
        <Icon as={LuChartPie} boxSize="17px" color={COLORS.subtle} flexShrink={0} />
      </Flex>

      {/* A plain select rather than tabs: the portfolio can hold more projects
          than a row of buttons would fit on this narrow card. */}
      {options.length > 1 ? (
        <NativeSelect.Root size="sm" mb="4px">
          <NativeSelect.Field
            value={shown.key}
            onChange={(event) => setView(event.target.value)}
            aria-label="Show the distribution for"
            h="32px"
            bg={COLORS.hoverBg}
            border="1px solid transparent"
            borderRadius="8px"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="500"
            fontSize="12.5px"
            color={COLORS.heading}
            _focusVisible={{ borderColor: COLORS.activeBg, outline: 'none' }}
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator color={COLORS.subtle} />
        </NativeSelect.Root>
      ) : null}

      <Flex justify="center" py="8px">
        <Box
          as="svg"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width="200px"
          maxW="100%"
          height="auto"
          role="img"
          aria-label={`Lot distribution: ${available} available, ${sold} sold, ${reserved} reserved`}
        >
          {/* With no lots recorded, draw the bare track so the ring still reads
              as a chart at zero rather than vanishing. */}
          {/* `key` is the project on show, so choosing another redraws the ring. */}
          <g key={shown.key} {...motion(CHART_MOTION.sweep, { duration: 760, origin: 'center' })}>
          {isEmpty ? (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS - THICKNESS / 2}
              fill="none"
              stroke={CHART.available}
              strokeWidth={THICKNESS}
            />
          ) : (
            segments.map((seg) => {
              const isDimmed = hovered && hovered !== seg.key
              return (
                <path
                  key={seg.key}
                  d={arcPath(seg.start, seg.end, RADIUS, RADIUS - THICKNESS)}
                  fill={seg.color}
                  opacity={isDimmed ? 0.35 : 1}
                  onMouseEnter={() => setHovered(seg.key)}
                  onMouseLeave={() => setHovered(null)}
                />
              )
            })
          )}
          </g>

          <text
            x={CENTER}
            y={CENTER - 2}
            textAnchor="middle"
            fontSize="26"
            fontWeight="700"
            fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
            fill={COLORS.heading}
          >
            {formatNumber(activeLots)}
          </text>
          <text
            x={CENTER}
            y={CENTER + 16}
            textAnchor="middle"
            fontSize="11"
            fontFamily="Inter, system-ui, sans-serif"
            fill={COLORS.subtle}
          >
            Active Lots
          </text>
        </Box>
      </Flex>

      {/* Every slice is directly labeled with value and share, so identity never
          depends on color alone. */}
      <Box mt="8px">
        {segments.map((seg) => (
          <LegendRow
            key={seg.key}
            color={seg.color}
            label={seg.label}
            count={seg.value}
            share={formatPct(seg.sharePct)}
            isActive={!hovered || hovered === seg.key}
            onEnter={() => setHovered(seg.key)}
            onLeave={() => setHovered(null)}
          />
        ))}
      </Box>

      <Flex
        align="center"
        justify="space-between"
        gap="12px"
        mt="auto"
        pt="14px"
        borderTop="1px solid"
        borderColor={COLORS.border}
      >
        <Text
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="12px"
          lineHeight="16px"
          color={COLORS.subtle}
        >
          Total Area
        </Text>
        <Text
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight="700"
          fontSize="13px"
          lineHeight="18px"
          color={CHART.sold}
        >
          {formatNumber(totalAreaSqm)} sqm
        </Text>
      </Flex>
    </Card>
  )
}
