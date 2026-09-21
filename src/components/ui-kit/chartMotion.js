/*
 * Chart motion. A chart that draws itself once says which mark is which — the
 * line sweeps left to right along the axis it is read on, bars grow from their
 * baseline, the ring fills from its start. The data never moves after it lands,
 * so nothing here loops: each animation runs once, when the chart arrives or
 * when the reader asks for a different series.
 *
 * `motion(...)` returns props for any SVG or Box element. Reduced motion is
 * honoured throughout: the mark is drawn in its finished state instead.
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** Marked on every animated mark, so one media query can still them all. */
const STILL = 'vhbc-chart-motion'

export const CHART_MOTION = {
  /* Draws a stroked path from its start. The path must carry pathLength="1". */
  draw: 'vhbc-chart-draw',
  fade: 'vhbc-chart-fade',
  /* A marker arriving on a line that has already been drawn. */
  pop: 'vhbc-chart-pop',
  /* A bar filling from its left edge. */
  grow: 'vhbc-chart-grow',
  /* A ring or pie settling into place. */
  sweep: 'vhbc-chart-sweep',
}

/**
 * Animation props for one mark: `{...motion('draw', { duration: 900 })}`. Marks
 * are plain SVG elements, not Chakra ones, so this carries a class rather than a
 * `css` prop — the reduced-motion rules live in the stylesheet below.
 */
export function motion(name, { duration = 620, delay = 0, origin } = {}) {
  const drawing = name === CHART_MOTION.draw
  return {
    className: drawing ? `${STILL} ${STILL}-draw` : STILL,
    ...(drawing ? { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 } : null),
    style: {
      animation: `${name} ${duration}ms ${EASE} ${delay}ms both`,
      // A transformed SVG element turns about the viewBox unless told otherwise.
      ...(origin ? { transformBox: 'fill-box', transformOrigin: origin } : null),
    },
  }
}

export const STILL_CLASS = STILL
