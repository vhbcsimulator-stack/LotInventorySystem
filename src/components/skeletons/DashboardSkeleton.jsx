import { Flex, Grid, SimpleGrid } from '@chakra-ui/react'
import { Card } from '@/components/ui-kit/Card'
import { Skeleton, SkeletonPage } from '@/components/ui-kit/Skeleton'
import { COLORS } from '@/theme/colors'

/** One KPI tile: label + icon on top, big value and caption below (KpiRow). */
function KpiCardSkeleton() {
  return (
    <Card p="16px" display="flex" flexDirection="column" justifyContent="space-between" minH="132px">
      <Flex align="flex-start" justify="space-between" gap="12px">
        <Skeleton h="13px" w="58%" />
        <Skeleton h="30px" w="30px" rounded="8px" />
      </Flex>
      <Flex direction="column" gap="8px" mt="10px">
        <Skeleton h="24px" w="64%" rounded="8px" />
        <Skeleton h="12px" w="80%" />
      </Flex>
    </Card>
  )
}

/** A chart or list card: heading, description, then the plot area. */
function ChartCardSkeleton({ bodyH = '220px' }) {
  return (
    <Card>
      <Flex align="flex-start" justify="space-between" gap="16px" mb="16px" flexWrap="wrap">
        <Flex direction="column" gap="6px" minW={0} flex="1">
          <Skeleton h="16px" w="42%" rounded="8px" />
          <Skeleton h="12px" w="66%" />
        </Flex>
        <Skeleton h="32px" w="120px" rounded="8px" />
      </Flex>
      <Skeleton h={bodyH} rounded="10px" />
    </Card>
  )
}

/** Mirrors DashboardPage: hero, KPI row, then the two card grids. */
export default function DashboardSkeleton() {
  return (
    <SkeletonPage label="Loading portfolio data…">
      <Flex direction="column" gap="16px">
        <Card p="24px">
          <Flex align="flex-start" justify="space-between" gap="20px" flexWrap="wrap">
            <Flex direction="column" gap="8px" minW={0} flex="1">
              <Skeleton h="22px" w="62%" rounded="8px" />
              <Skeleton h="13px" w="86%" />
              <Skeleton h="13px" w="48%" />
            </Flex>
            <Flex align="center" gap="10px" flexWrap="wrap">
              <Skeleton h="36px" w="180px" rounded="10px" />
              <Skeleton h="36px" w="96px" rounded="8px" />
              <Skeleton h="36px" w="96px" rounded="8px" bg={COLORS.border} />
            </Flex>
          </Flex>
        </Card>

        <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap="16px">
          {Array.from({ length: 4 }, (_, index) => (
            <KpiCardSkeleton key={index} />
          ))}
        </SimpleGrid>

        <Grid gap="16px" templateColumns={{ base: '1fr', xl: 'minmax(0, 1.55fr) minmax(0, 1fr)' }}>
          <ChartCardSkeleton bodyH="260px" />
          <ChartCardSkeleton bodyH="260px" />
        </Grid>

        <Grid gap="16px" templateColumns={{ base: '1fr', xl: 'minmax(0, 1fr) minmax(0, 2fr)' }}>
          <ChartCardSkeleton bodyH="240px" />
          <ChartCardSkeleton bodyH="240px" />
        </Grid>
      </Flex>
    </SkeletonPage>
  )
}
