import { Box, Flex, Grid } from '@chakra-ui/react'
import { Skeleton, SkeletonPage } from '@/components/ui-kit/Skeleton'
import { COLORS } from '@/theme/colors'

/** Mirrors the Brokers Directory: heading, search + actions toolbar, and the broker table. */
export default function BrokersSkeleton() {
  return (
    <SkeletonPage label="Loading brokers…">
      <Skeleton h="30px" w="260px" rounded="8px" />
      <Skeleton mt="10px" h="13px" w="min(420px, 80%)" />
      <Flex mt="24px" gap="12px" justify="space-between" align="center" flexWrap="wrap">
        <Skeleton h="40px" flex="1" minW="220px" maxW="480px" rounded="8px" />
        <Flex gap="8px">
          <Skeleton h="36px" w="130px" rounded="8px" />
          <Skeleton h="36px" w="120px" rounded="8px" />
        </Flex>
      </Flex>
      <Skeleton mt="32px" h="22px" w="240px" />
      <Grid mt="16px" templateColumns={{ base: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap="20px">
        {Array.from({ length: 3 }, (_, index) => (
          <Box key={index} bg={COLORS.surface} border="1px solid" borderColor={COLORS.border} borderRadius="12px" p="22px">
            <Skeleton h="76px" w="76px" rounded="10px" />
            <Skeleton mt="18px" h="16px" w="60%" />
            <Skeleton mt="16px" h="62px" rounded="8px" />
          </Box>
        ))}
      </Grid>
      <Box mt="20px" bg={COLORS.surface} border="1px solid" borderColor={COLORS.border} borderRadius="12px" overflow="hidden">
        <Box px="24px" py="18px">
          <Skeleton h="18px" w="150px" />
        </Box>
        <Box h="38px" bg={COLORS.statusBg} />
        {Array.from({ length: 6 }, (_, index) => (
          <Flex key={index} px="24px" py="16px" gap="12px" align="center" borderTop={index ? '1px solid' : 'none'} borderColor={COLORS.border}>
            <Skeleton h="40px" w="40px" rounded="10px" />
            <Box flex="2">
              <Skeleton h="13px" w="45%" />
              <Skeleton mt="6px" h="11px" w="65%" />
            </Box>
            <Skeleton flex="1" h="12px" display={{ base: 'none', md: 'block' }} />
            <Skeleton flex="1" h="12px" display={{ base: 'none', md: 'block' }} />
          </Flex>
        ))}
      </Box>
    </SkeletonPage>
  )
}
