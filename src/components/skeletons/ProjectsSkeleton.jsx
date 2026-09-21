import { Box, Flex, SimpleGrid } from '@chakra-ui/react'
import { Card } from '@/components/ui-kit/Card'
import { Skeleton, SkeletonPage } from '@/components/ui-kit/Skeleton'
import { COLORS } from '@/theme/colors'

/** The project identity card: crest, name, meta row, then the controls. */
function ProjectHeaderSkeleton() {
  return (
    <Card p="24px">
      <Flex align="center" justify="space-between" gap="20px" flexWrap="wrap">
        <Flex align="center" gap="16px" minW="280px" flex="1">
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
        <Flex align="center" gap="10px" flexWrap="wrap">
          <Skeleton h="36px" w="170px" rounded="8px" />
          <Skeleton h="36px" w="230px" rounded="10px" />
          <Skeleton h="36px" w="150px" rounded="8px" />
        </Flex>
      </Flex>
    </Card>
  )
}

/** One LotStatsRow tile: label + icon, value, then the share bar. */
function StatCardSkeleton() {
  return (
    <Card p="18px">
      <Flex align="flex-start" justify="space-between" gap="12px">
        <Skeleton h="13px" w="52%" />
        <Skeleton h="28px" w="28px" rounded="8px" />
      </Flex>
      <Skeleton h="24px" w="44%" rounded="8px" mt="12px" />
      <Skeleton h="6px" rounded="full" mt="14px" />
      <Skeleton h="11px" w="64%" mt="10px" />
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

        <SimpleGrid columns={{ base: 1, sm: 2, xl: 4 }} gap="16px">
          {Array.from({ length: 4 }, (_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </SimpleGrid>

        <Card p="20px">
          <Flex align="center" gap="10px" flexWrap="wrap">
            <Skeleton h="40px" rounded="8px" flex="1" minW="240px" />
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
