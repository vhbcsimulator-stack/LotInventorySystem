import { CHART_MOTION, STILL_CLASS } from './chartMotion'

/** The keyframes every chart animates on; mounted once, at the app root. */
export function ChartKeyframes() {
  return (
    <style>{`
      @keyframes ${CHART_MOTION.draw} { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
      @keyframes ${CHART_MOTION.fade} { from { opacity: 0 } to { opacity: 1 } }
      @keyframes ${CHART_MOTION.pop} {
        from { opacity: 0; transform: scale(0.4) }
        to { opacity: 1; transform: none }
      }
      @keyframes ${CHART_MOTION.grow} { from { transform: scaleX(0) } to { transform: scaleX(1) } }
      @keyframes ${CHART_MOTION.sweep} {
        from { opacity: 0; transform: rotate(-10deg) scale(0.94) }
        to { opacity: 1; transform: none }
      }

      @media (prefers-reduced-motion: reduce) {
        .${STILL_CLASS} { animation: none !important; opacity: 1 !important; transform: none !important }
        .${STILL_CLASS}-draw { stroke-dasharray: none !important; stroke-dashoffset: 0 !important }
      }
    `}</style>
  )
}
