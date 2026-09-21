import { useMemo, useRef, useState } from 'react'
import { Box, Flex, Text } from '@chakra-ui/react'
import { Card, CardHeading } from '@/components/ui-kit/Card'
import SegmentedControl from '@/components/ui-kit/SegmentedControl'
import { motion, CHART_MOTION } from '@/components/ui-kit/chartMotion'
import { COLORS, CHART } from '@/theme/colors'
import { formatNumber, formatPct } from '@/utils/format'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The view showing one point per year rather than one per month. */
const OVERALL = 'overall'

/** How many sold lots a tooltip names before it just counts the rest. */
const TOOLTIP_LOTS = 8

// viewBox geometry — the SVG scales to its container, so these are fixed units.
const W = 720
const H = 280
// The right pad also holds the last month's label, which is centred on its point.
const PAD = { top: 16, right: 30, bottom: 34, left: 58 }
const PLOT_W = W - PAD.left - PAD.right
/*
 * The narrowest a month label may sit from its neighbour, in viewBox units.
 * "Sep 25" at 11px runs about 40 units wide, so 54 leaves a clear gap at every
 * card width — the drawing scales as a whole, so the ratio holds.
 */
const LABEL_GAP = 54
const PLOT_H = H - PAD.top - PAD.bottom

function Stat({ label, value, color = COLORS.heading }) {
  return (
    <Box minW="112px">
      <Text
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="12px"
        lineHeight="16px"
        color={COLORS.subtle}
      >
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

function LegendItem({ color, label, dashed = false }) {
  return (
    <Flex align="center" gap="6px">
      {dashed ? (
        <Box w="14px" h="0" borderTop="2px dashed" borderColor={color} />
      ) : (
        <Box boxSize="8px" borderRadius="full" bg={color} />
      )}
      <Text
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="12px"
        lineHeight="16px"
        color={COLORS.subtle}
      >
        {label}
      </Text>
    </Flex>
  )
}

export default function SalesVelocityCard({ velocity }) {
  const years = velocity.years ?? []
  /*
   * One year at a time, January to December, with Overall standing for the
   * year-by-year totals. The newest year opens, since that is the one anybody
   * asks about first.
   */
  const [view, setView] = useState('')
  const [hoverIndex, setHoverIndex] = useState(null)
  const svgRef = useRef(null)
  const peakPop = motion(CHART_MOTION.pop, { duration: 420, delay: 900, origin: 'center' })

  const options = useMemo(
    () => [...years.map((year) => ({ value: String(year), label: String(year) })), { value: OVERALL, label: 'Overall' }],
    [years],
  )
  // The chosen view, or the newest year — a year can disappear as data changes.
  const span = options.some((option) => option.value === view) ? view : String(years[years.length - 1] ?? OVERALL)

  const points = useMemo(() => {
    if (span === OVERALL) {
      return (velocity.yearly ?? []).map((point) => ({
        month: point.label,
        actual: point.actual,
        items: point.items ?? [],
        target: 0,
      }))
    }
    const months = velocity.byYear?.[span] ?? []
    // All twelve, so a quiet month is a gap in the line rather than a missing step.
    return MONTH_NAMES.map((name, index) => {
      const items = months[index] ?? []
      return { month: name, actual: items.length, items, target: 0 }
    })
  }, [velocity, span])

  // Stats follow whatever is on screen, not the whole history behind it.
  const summary = useMemo(() => {
    if (!points.length) return { peakLabel: 'Peak', peakValue: 0, average: 0 }
    const peak = points.reduce((best, point) => (point.actual > best.actual ? point : best))
    const total = points.reduce((sum, point) => sum + point.actual, 0)
    return { peakLabel: `Peak (${peak.month})`, peakValue: peak.actual, average: total / points.length }
  }, [points])

  const isEmpty = points.length === 0

  const geom = useMemo(() => {
    if (points.length === 0) return null
    const maxValue = Math.max(...points.flatMap((p) => [p.actual, p.target]))
    /*
     * A "nice" step of about five ticks, but whole numbers only: the series counts
     * lots sold, and an axis reading 2.5 lots is a measurement nobody can make.
     */
    const raw = Math.max(maxValue, 1) / 5
    const mag = 10 ** Math.floor(Math.log10(raw))
    const step = Math.max(1, Math.round([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)))
    const yMax = Math.ceil(Math.max(maxValue, 1) / step) * step

    const x = (i) =>
      PAD.left + (points.length === 1 ? PLOT_W / 2 : (i * PLOT_W) / (points.length - 1))
    const y = (v) => PAD.top + PLOT_H - (v / yMax) * PLOT_H

    const actualLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.actual)}`).join(' ')
    const areaPath = `${actualLine} L${x(points.length - 1)},${PAD.top + PLOT_H} L${x(0)},${
      PAD.top + PLOT_H
    } Z`
    const targetLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.target)}`).join(' ')

    const ticks = []
    for (let v = 0; v <= yMax; v += step) ticks.push(v)

    return { x, y, yMax, actualLine, areaPath, targetLine, ticks }
  }, [points])

  /*
   * No target is stored anywhere yet, so the target series is a flat line of
   * zeros: drawn, it reads as a dashed rule along the axis, and its legend entry
   * promises a plan that does not exist. It appears once targets do.
   */
  const hasTargets = points.some((point) => point.target > 0)

  /*
   * Which months get a label, as a set of indices.
   *
   * Thinning by a fixed stride cannot promise anything: whatever the stride, the
   * kept labels still land wherever the spacing puts them, and the two at the end
   * ran together. So the labels are chosen by distance instead — walking back
   * from the last month and keeping one only when it clears the previous by
   * LABEL_GAP viewBox units, which no arrangement of points can violate. The
   * first month is kept last, and only if it too clears its neighbour.
   */
  const labelled = useMemo(() => {
    const keep = new Set()
    if (!geom || points.length === 0) return keep
    let previous = Infinity
    // The last month is always kept: it is the first one this loop sees.
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (previous - geom.x(i) >= LABEL_GAP) {
        keep.add(i)
        previous = geom.x(i)
      }
    }
    return keep
  }, [geom, points])

  const peakIndex = useMemo(() => {
    if (points.length === 0) return -1
    let best = 0
    points.forEach((p, i) => {
      if (p.actual > points[best].actual) best = i
    })
    return best
  }, [points])

  function handleMove(event) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || points.length === 0) return
    // Map pointer position into viewBox units, then snap to the nearest month.
    const vbX = ((event.clientX - rect.left) / rect.width) * W
    const ratio = (vbX - PAD.left) / PLOT_W
    const index = Math.round(ratio * (points.length - 1))
    setHoverIndex(Math.max(0, Math.min(points.length - 1, index)))
  }

  const active = hoverIndex == null ? null : points[hoverIndex]

  return (
    <Card>
      <CardHeading
        title="Monthly Sales Velocity"
        description={
          span === OVERALL
            ? 'Lots sold per year, across every project.'
            : `Lots sold each month of ${span}, across every project.`
        }
        actions={<SegmentedControl options={options} value={span} onChange={setView} size="sm" />}
      />

      <Flex gap="24px" mb="12px" flexWrap="wrap">
        <Stat label={summary.peakLabel} value={`${formatNumber(summary.peakValue)} lots`} />
        <Stat
          label={span === OVERALL ? 'Yearly Average' : 'Monthly Average'}
          value={`${formatNumber(Math.round(summary.average))} lots/${span === OVERALL ? 'yr' : 'mo'}`}
        />
        {/* Meaningless until targets are stored: it can only ever read 0%. */}
        {hasTargets ? <Stat label="Target Met" value={formatPct(velocity.targetMetPct)} color={CHART.sold} /> : null}
        {/*
          * Sold lots the sheets never dated belong to no month, so they are in no
          * point on this line. Saying how many keeps the chart's total honest
          * against the "Total Sold Lots" figure above it.
          */}
        {velocity.undated ? (
          <Stat label="No date recorded" value={`${formatNumber(velocity.undated)} lots`} color={COLORS.subtle} />
        ) : null}
      </Flex>

      {isEmpty ? (
        <Flex
          align="center"
          justify="center"
          minH="240px"
          borderRadius="10px"
          bg={COLORS.canvas}
          border="1px dashed"
          borderColor={COLORS.border}
        >
          <Text fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.subtle}>
            No booking history for this period.
          </Text>
        </Flex>
      ) : (
      <Box position="relative">
        <Box
          as="svg"
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height="auto"
          role="img"
          aria-label={`Lots sold ${span === OVERALL ? 'per year' : `each month of ${span}`}, from ${
            points[0]?.month
          } to ${points[points.length - 1]?.month}, peaking at ${formatNumber(summary.peakValue)} lots`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
          display="block"
        >
          <defs>
            <linearGradient id="velocity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.areaFrom} />
              <stop offset="100%" stopColor={CHART.areaTo} />
            </linearGradient>
          </defs>

          {/* Recessive gridlines + y ticks */}
          {geom.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={geom.y(tick)}
                y2={geom.y(tick)}
                stroke={CHART.grid}
                strokeWidth="1"
              />
              <text
                x={PAD.left - 10}
                y={geom.y(tick) + 4}
                textAnchor="end"
                fontSize="11"
                fontFamily="Inter, system-ui, sans-serif"
                fill={CHART.axis}
              >
                {formatNumber(Math.round(tick))}
              </text>
            </g>
          ))}

          {/*
            * `key` is the series, so picking a different year draws the new line
            * rather than swapping it in. The line sweeps along the axis it is read
            * on; the fill beneath follows it, and the target is a reference mark,
            * so it only fades up.
            */}
          <g key={span}>
            <path d={geom.areaPath} fill="url(#velocity-fill)" {...motion(CHART_MOTION.fade, { duration: 900, delay: 220 })} />
            {hasTargets ? (
              <path
                d={geom.targetLine}
                fill="none"
                stroke={CHART.target}
                strokeWidth="2"
                strokeDasharray="5 5"
                {...motion(CHART_MOTION.fade, { duration: 700, delay: 320 })}
              />
            ) : null}
            <path
              d={geom.actualLine}
              fill="none"
              stroke={CHART.sold}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              {...motion(CHART_MOTION.draw, { duration: 1100 })}
            />
          </g>

          {/* x labels */}
          {points.map((p, i) => {
            /*
             * Chosen above by distance, and every label is centred on its point
             * (see textAnchor below). Anchoring the first at its left edge and the
             * last at its right made those two grow sideways into their
             * neighbours — a collision no spacing rule could see coming, since the
             * points were far enough apart and only the text started elsewhere.
             */
            if (!labelled.has(i)) return null
            return (
            <text
              key={p.month}
              x={geom.x(i)}
              y={H - 12}
              textAnchor="middle"
              fontSize="11"
              fontFamily="Inter, system-ui, sans-serif"
              fontWeight={i === peakIndex ? 600 : 400}
              fill={i === peakIndex ? COLORS.heading : CHART.axis}
            >
              {p.month}
            </text>
            )
          })}

          {/* Selective direct marker: the peak only, never every point. It lands
              once the line has been drawn past it. */}
          <circle
            key={`peak-${span}`}
            cx={geom.x(peakIndex)}
            cy={geom.y(points[peakIndex].actual)}
            r="5"
            fill={CHART.sold}
            stroke={COLORS.surface}
            strokeWidth="2"
            {...peakPop}
          />

          {/* Hover crosshair + marker */}
          {active ? (
            <g pointerEvents="none">
              <line
                x1={geom.x(hoverIndex)}
                x2={geom.x(hoverIndex)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke={CHART.axis}
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <circle
                cx={geom.x(hoverIndex)}
                cy={geom.y(active.actual)}
                r="6"
                fill={CHART.sold}
                stroke={COLORS.surface}
                strokeWidth="2"
              />
            </g>
          ) : null}
        </Box>

        {active ? (
          <Box
            position="absolute"
            top="6px"
            // Clamped so the tooltip stays inside the plot instead of escaping
            // over the stats row above or off the card edge.
            left={`${Math.min(84, Math.max(16, (geom.x(hoverIndex) / W) * 100))}%`}
            transform="translate(-50%, 0)"
            pointerEvents="none"
            bg={COLORS.heading}
            borderRadius="8px"
            px="10px"
            py="8px"
            minW="150px"
          >
            <Text
              fontFamily="Inter, system-ui, sans-serif"
              fontWeight="600"
              fontSize="11px"
              lineHeight="15px"
              color="rgba(255,255,255,0.72)"
            >
              {active.month}
            </Text>
            <Flex align="center" justify="space-between" gap="10px" mt="3px">
              <Text
                fontFamily="Inter, system-ui, sans-serif"
                fontSize="11px"
                color="rgba(255,255,255,0.72)"
              >
                Sold
              </Text>
              <Text
                fontFamily="Inter, system-ui, sans-serif"
                fontWeight="600"
                fontSize="12px"
                color="#FFFFFF"
              >
                {`${formatNumber(active.actual)} lots`}
              </Text>
            </Flex>

            {/*
              * Which lots they were, as project, phase and lot number. A count
              * alone leaves the obvious question unanswered, and the answer is
              * already loaded. The list is capped so a heavy month cannot grow a
              * tooltip taller than the chart; the rest are counted off.
              */}
            {active.items?.length ? (
              <Box mt="6px" pt="6px" borderTop="1px solid" borderColor="rgba(255,255,255,0.18)">
                {active.items.slice(0, TOOLTIP_LOTS).map((item) => (
                  <Text
                    key={item}
                    fontFamily="Inter, system-ui, sans-serif"
                    fontSize="11px"
                    lineHeight="16px"
                    color="rgba(255,255,255,0.9)"
                    whiteSpace="nowrap"
                  >
                    {item}
                  </Text>
                ))}
                {active.items.length > TOOLTIP_LOTS ? (
                  <Text
                    fontFamily="Inter, system-ui, sans-serif"
                    fontSize="11px"
                    lineHeight="16px"
                    color="rgba(255,255,255,0.6)"
                  >
                    +{active.items.length - TOOLTIP_LOTS} more
                  </Text>
                ) : null}
              </Box>
            ) : null}
            {/* Only where a target exists; otherwise the tooltip claims a target
                of zero lots for every month. */}
            {hasTargets ? (
              <Flex align="center" justify="space-between" gap="10px">
                <Text fontFamily="Inter, system-ui, sans-serif" fontSize="11px" color="rgba(255,255,255,0.72)">
                  Target
                </Text>
                <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="12px" color="#FFFFFF">
                  {`${formatNumber(active.target)} lots`}
                </Text>
              </Flex>
            ) : null}
          </Box>
        ) : null}
      </Box>
      )}

      <Flex align="center" justify="space-between" gap="12px" mt="10px" flexWrap="wrap">
        <Flex align="center" gap="16px">
          <LegendItem color={CHART.sold} label="Lots sold" />
          {hasTargets ? <LegendItem color={CHART.target} label="Target Plan" dashed /> : null}
        </Flex>
        {/* Nothing defines a baseline yet, and "0% above baseline" reads as a
            measured result rather than an absent one. */}
        {velocity.aboveBaselinePct ? (
          <Text
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="600"
            fontSize="12px"
            lineHeight="16px"
            color={CHART.sold}
          >
            {formatPct(velocity.aboveBaselinePct, { signed: true })} above baseline
          </Text>
        ) : null}
      </Flex>
    </Card>
  )
}
