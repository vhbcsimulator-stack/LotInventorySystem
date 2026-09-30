import { Box, Flex } from '@chakra-ui/react'
import { Skeleton, SkeletonPage } from '@/components/ui-kit/Skeleton'
import { COLORS } from '@/theme/colors'

/** Mirrors the Clients page: heading, search + actions toolbar, and the client table. */
export default function ClientsSkeleton() {
  return (
    <SkeletonPage label="Loading clients…">
      <Skeleton h="30px" w="160px" rounded="8px" />
      <Skeleton mt="10px" h="13px" w="min(380px, 80%)" />
      <Flex mt="24px" gap="12px" justify="space-between" align="center" flexWrap="wrap">
        <Skeleton h="40px" flex="1" minW="220px" maxW="480px" rounded="8px" />
        <Flex gap="8px">
          <Skeleton h="36px" w="170px" rounded="8px" />
          <Skeleton h="36px" w="120px" rounded="8px" />
        </Flex>
      </Flex>
      <Box mt="20px" bg={COLORS.surface} border="1px solid" borderColor={COLORS.border} borderRadius="12px" overflow="hidden">
        <Box px="24px" py="18px">
          <Skeleton h="18px" w="140px" />
        </Box>
        <Box h="38px" bg="#EEF3FF" />
        {Array.from({ length: 6 }, (_, index) => (
          <Flex key={index} px="24px" py="16px" gap="16px" align="center" borderTop={index ? '1px solid' : 'none'} borderColor={COLORS.border}>
            <Skeleton h="40px" w="40px" rounded="10px" />
            <Box flex="1.4">
              <Skeleton h="13px" w="60%" />
              <Skeleton mt="6px" h="11px" w="30%" />
            </Box>
            <Skeleton flex="1.6" h="22px" rounded="6px" />
            <Skeleton flex="1.1" h="12px" display={{ base: 'none', md: 'block' }} />
            <Skeleton flex="0.9" h="20px" rounded="full" display={{ base: 'none', md: 'block' }} />
            <Skeleton flex="0.8" h="20px" rounded="full" display={{ base: 'none', md: 'block' }} />
            <Skeleton flex="0.8" h="12px" display={{ base: 'none', md: 'block' }} />
            <Skeleton flex="1" h="12px" display={{ base: 'none', md: 'block' }} />
          </Flex>
        ))}
      </Box>
    </SkeletonPage>
  )
}
