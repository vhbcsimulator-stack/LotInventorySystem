import { Box, Flex } from '@chakra-ui/react'
import { Skeleton, SkeletonLines, SkeletonPage } from '@/components/ui-kit/Skeleton'
import { COLORS } from '@/theme/colors'

/**
 * Mirrors the announcement list: a date column on the left, then the rule and
 * the title + body beside it (AnnouncementItem).
 */
export default function AnnouncementsSkeleton({ items = 4 }) {
  return (
    <SkeletonPage label="Loading announcements…">
      <Flex direction="column" gap="28px" pt="8px">
        {Array.from({ length: items }, (_, index) => (
          <Flex key={index} gap="12px" direction={{ base: 'column', sm: 'row' }}>
            <Box w={{ sm: '72px' }} flexShrink={0} pt="4px">
              <Skeleton h="12px" w="56px" ml={{ sm: 'auto' }} />
            </Box>
            <Box borderLeft="2px solid" borderColor={COLORS.muted} pl="20px" minW={0} flex="1" maxW="800px">
              <Skeleton h="22px" w="52%" rounded="8px" />
              {/* Alternating length keeps the column from looking like a grid. */}
              <SkeletonLines mt="10px" lines={index % 2 ? 2 : 3} h="12px" lastW="45%" />
            </Box>
          </Flex>
        ))}
      </Flex>
    </SkeletonPage>
  )
}
