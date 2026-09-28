import { Box, Flex } from '@chakra-ui/react'
import { Skeleton, SkeletonPage } from '@/components/ui-kit/Skeleton'
import { COLORS } from '@/theme/colors'

/** Mirrors the Add Brokers page: heading, the form card, and the broker list beside it. */
export default function BrokersSkeleton() {
  const panel = { bg: COLORS.surface, border: '1px solid', borderColor: COLORS.border, borderRadius: '12px', p: '22px' }
  return (
    <SkeletonPage label="Loading brokers…">
      <Skeleton h="30px" w="220px" rounded="8px" />
      <Skeleton mt="10px" h="13px" w="min(420px, 80%)" />
      <Flex mt="24px" gap="20px" direction={{ base: 'column', xl: 'row' }} align="flex-start">
        <Box {...panel} w={{ base: 'full', xl: '460px' }} flexShrink={0}>
          <Skeleton h="18px" w="140px" />
          {Array.from({ length: 4 }, (_, index) => (
            <Box key={index} mt="18px">
              <Skeleton h="12px" w="90px" />
              <Skeleton mt="8px" h="40px" rounded="8px" />
            </Box>
          ))}
          <Skeleton mt="22px" h="40px" w="160px" rounded="8px" />
        </Box>
        <Box {...panel} flex="1" w="full">
          <Skeleton h="18px" w="160px" />
          {Array.from({ length: 5 }, (_, index) => (
            <Flex key={index} mt="18px" gap="12px" align="center">
              <Skeleton h="36px" w="36px" rounded="full" />
              <Box flex="1">
                <Skeleton h="13px" w="40%" />
                <Skeleton mt="6px" h="11px" w="65%" />
              </Box>
            </Flex>
          ))}
        </Box>
      </Flex>
    </SkeletonPage>
  )
}
