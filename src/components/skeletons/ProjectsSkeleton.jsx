import { Box, Flex, Grid } from '@chakra-ui/react'
import { Card } from '@/components/ui-kit/Card'
import { Skeleton, SkeletonPage } from '@/components/ui-kit/Skeleton'
import { COLORS } from '@/theme/colors'

/** The project identity card: crest, name, meta row, then the controls. */
function ProjectHeaderSkeleton() {
  return (
    <Card p={{ base: '16px', md: '24px' }}>
      <Flex align="center" justify="space-between" gap="20px" flexWrap="wrap">
        <Flex align="center" gap="16px" minW={0} flex="1">
          <Skeleton h="56px" w="56px" rounded="12px" />
          <Flex direction="column" gap="8px" minW={0} flex="1">
            <Skeleton h="22px" w="46%" rounded="8px" />
            <Flex align="center" gap="12px" flexWrap="wrap">
              <Skeleton h="13px" w="120px" />
              <Skeleton h="13px" w="150px" />
              <Skeleton h="13px" w="140px" />
            </Flex>
          </Flex>
        </Flex>
        <Flex align="center" gap="10px" flexWrap="wrap" minW={0}>
          <Skeleton h="36px" w="170px" rounded="8px" />
          <Skeleton h="36px" w="230px" rounded="10px" />
          <Skeleton h="36px" w="150px" rounded="8px" />
        </Flex>
      </Flex>
    </Card>
  )
}

/** One LotStatsRow tile: label, value, then the share bar. */
function StatCardSkeleton({ primary = false }) {
  return (
    <Card p={primary ? { base: '20px', md: '24px' } : '18px'} h="full" display="flex" flexDirection="column" justifyContent={primary ? 'center' : undefined}>
      <Skeleton h="13px" w="52%" />
      <Skeleton h={primary ? '40px' : '24px'} w={primary ? '60%' : '44%'} rounded="8px" mt="12px" />
      <Skeleton h="6px" rounded="full" mt="14px" />
    </Card>
  )
}

/**
 * Mirrors ProjectsPage in its table view: header card, stats row, the filter
 * bar, then the table with its header band, rows, and footer. `rows` matches
 * the page size in view so the table does not resize when the lots arrive.
 */
export default function ProjectsSkeleton({ rows = 10, columns = 9 }) {
  return (
    <SkeletonPage label="Loading lots…">
      <Flex direction="column" gap="16px">
        <ProjectHeaderSkeleton />

        <Grid templateColumns={{ base: '1fr', '2xl': 'repeat(4, 1fr)' }} gap="16px">
          <StatCardSkeleton primary />
          <Grid gridColumn={{ '2xl': 'span 3' }} templateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)', '2xl': 'repeat(6, 1fr)' }} gap="16px">
            {Array.from({ length: 5 }, (_, index) => (
              <Box key={index} gridColumn={{ '2xl': index < 3 ? 'span 2' : 'span 3' }}><StatCardSkeleton /></Box>
            ))}
          </Grid>
        </Grid>

        <Card p="20px">
          <Flex align="center" gap="10px" flexWrap="wrap">
            <Skeleton h="40px" rounded="8px" flex="1" minW={0} />
            <Skeleton h="40px" w="150px" rounded="8px" />
            <Skeleton h="40px" w="150px" rounded="8px" />
            <Skeleton h="40px" w="150px" rounded="8px" />
          </Flex>
        </Card>

        <Card p="0" overflow="hidden">
          {/* Header band, then one placeholder row per row the table will show. */}
          <Flex align="center" gap="16px" px="20px" py="14px" bg={COLORS.hoverBg}>
            {Array.from({ length: columns }, (_, index) => (
              <Skeleton key={index} h="12px" flex={index === 0 ? '0 0 20px' : '1'} />
            ))}
          </Flex>
          {Array.from({ length: rows }, (_, row) => (
            <Flex
              key={row}
              align="center"
              gap="16px"
              px="20px"
              py="16px"
              borderTop="1px solid"
              borderColor={COLORS.border}
            >
              {Array.from({ length: columns }, (_, index) => (
                <Skeleton
                  key={index}
                  h={index === 0 ? '16px' : '12px'}
                  rounded={index === 0 ? '4px' : '6px'}
                  flex={index === 0 ? '0 0 20px' : '1'}
                />
              ))}
            </Flex>
          ))}
          <Flex
            align="center"
            justify="space-between"
            gap="12px"
            px="20px"
            py="14px"
            flexWrap="wrap"
            borderTop="1px solid"
            borderColor={COLORS.border}
          >
            <Flex align="center" gap="20px" flexWrap="wrap">
              <Skeleton h="12px" w="230px" />
              <Skeleton h="24px" w="110px" rounded="6px" />
            </Flex>
            <Flex align="center" gap="6px">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} h="30px" w="30px" rounded="6px" />
              ))}
            </Flex>
          </Flex>
        </Card>

        <Box h="4px" />
      </Flex>
    </SkeletonPage>
  )
}
