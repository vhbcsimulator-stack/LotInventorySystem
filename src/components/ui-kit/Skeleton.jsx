import { Box, Flex } from '@chakra-ui/react'
import { COLORS } from '@/theme/colors'

/*
 * Loading placeholders. Each page's skeleton mirrors the real layout it stands
 * in for — same cards, same grid, same heights — so nothing jumps when the data
 * lands. Placeholders are aria-hidden and sit inside a container that reports
 * "Loading…" once, rather than having every bar announce itself.
 */

const SHIMMER = 'bhri-skeleton-shimmer'

/** One placeholder bar or block. */
export function Skeleton({ h = '12px', w = '100%', rounded = '6px', ...rest }) {
  return (
    <Box
      aria-hidden="true"
      h={h}
      w={w}
      borderRadius={rounded}
      bg={COLORS.hoverBg}
      backgroundImage={`linear-gradient(90deg, ${COLORS.hoverBg} 0%, #E9EDF3 50%, ${COLORS.hoverBg} 100%)`}
      backgroundSize="200% 100%"
      animation={`${SHIMMER} 1.4s ease-in-out infinite`}
      // Still placeholders for anyone who asked the system for less motion.
      css={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}
      {...rest}
    />
  )
}

/** Stacked lines of text; the last one is short, the way a paragraph ends. */
export function SkeletonLines({ lines = 3, h = '11px', gap = '8px', lastW = '60%', ...rest }) {
  return (
    <Flex direction="column" gap={gap} {...rest}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} h={h} w={index === lines - 1 ? lastW : '100%'} />
      ))}
    </Flex>
  )
}

/**
 * Wraps a page's placeholders. Screen readers hear one "Loading…" and the
 * placeholders themselves stay silent.
 */
export function SkeletonPage({ label = 'Loading…', children, ...rest }) {
  return (
    <Box role="status" aria-busy="true" aria-label={label} {...rest}>
      {children}
    </Box>
  )
}

/** The keyframes every bar animates on; mounted once, at the app root. */
export function SkeletonKeyframes() {
  return (
    <style>{`@keyframes ${SHIMMER} { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
  )
}

export default Skeleton
