import { Box, Flex } from '@chakra-ui/react'
import { Skeleton, SkeletonPage } from '@/components/ui-kit/Skeleton'
import DashboardSkeleton from '@/components/skeletons/DashboardSkeleton'
import { COLORS } from '@/theme/colors'

/**
 * The whole app shell while the session is still resolving: the 260px sidebar,
 * the 64px top bar, and the dashboard skeleton in the content area — so signing
 * in lands on the same frame rather than swapping a centred spinner for a page.
 */
export default function AppSkeleton() {
  return (
    <SkeletonPage label="Loading…" h="100dvh">
      <Flex h="100dvh" bg={COLORS.canvas} overflow="hidden">
        <Flex
          direction="column"
          w="260px"
          h="100%"
          flexShrink={0}
          bg={COLORS.surface}
          borderRight="1px solid"
          borderColor={COLORS.border}
          display={{ base: 'none', lg: 'flex' }}
        >
          <Flex direction="column" align="center" gap="10px" px="24px" pt="24px" pb="8px">
            <Skeleton h="56px" w="56px" rounded="14px" />
            <Skeleton h="14px" w="70%" />
            <Skeleton h="11px" w="50%" />
          </Flex>
          <Flex direction="column" gap="4px" pt="12px" px="16px">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} h="40px" rounded="10px" />
            ))}
          </Flex>
        </Flex>

        <Flex direction="column" flex="1" minW={0}>
          <Flex
            align="center"
            justify="space-between"
            h="64px"
            px={{ base: '12px', sm: '16px', lg: '24px' }}
            flexShrink={0}
            bg={COLORS.surface}
            borderBottom="1px solid"
            borderColor={COLORS.border}
          >
            <Skeleton h="18px" w={{ base: '110px', sm: '180px' }} rounded="8px" />
            <Flex align="center" gap="12px">
              <Skeleton h="20px" w="20px" rounded="6px" />
              <Skeleton h="32px" w="32px" rounded="full" />
              <Skeleton h="12px" w="110px" display={{ base: 'none', sm: 'block' }} />
            </Flex>
          </Flex>

          <Box flex="1" minH={0} p={{ base: '12px', sm: '16px', lg: '20px' }} overflow="hidden">
            <DashboardSkeleton />
          </Box>
        </Flex>
      </Flex>
    </SkeletonPage>
  )
}
