import { Box } from '@chakra-ui/react'

/*
 * A page or tab arriving. Switching views in this app swaps the whole panel at
 * once, which reads as a flicker; a fade and rise says the content is new rather
 * than repainted. Mount it with a `key` for the page or tab so React remounts —
 * and so the animation replays — on every switch.
 *
 * Reveal what the reader will actually read: a page waiting on its data shows a
 * skeleton first, so the reveal belongs on the loaded content, not on the
 * placeholders. `animate={false}` renders the same box with no animation, for a
 * panel whose arrival is already being revealed by something around it.
 */

const REVEAL = 'vhbc-reveal'

export function Reveal({ children, duration = '620ms', delay = '0ms', animate = true, ...rest }) {
  return (
    <Box
      animation={animate ? `${REVEAL} ${duration} cubic-bezier(0.22, 1, 0.36, 1) ${delay} both` : undefined}
      // Nothing moves for anyone who asked the system for less motion.
      css={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}
      {...rest}
    >
      {children}
    </Box>
  )
}

/** The keyframes every reveal animates on; mounted once, at the app root. */
export function RevealKeyframes() {
  return (
    <style>{`@keyframes ${REVEAL} { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }`}</style>
  )
}

export default Reveal
