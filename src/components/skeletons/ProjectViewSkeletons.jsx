import { Flex, SimpleGrid } from '@chakra-ui/react'
import { Card } from '@/components/ui-kit/Card'
import { Skeleton, SkeletonPage } from '@/components/ui-kit/Skeleton'

/** Mirrors ProjectMapView: the tab strip, the caption row, then the map frame. */
export function MapViewSkeleton() {
  return (
    <Card>
      <SkeletonPage label="Loading maps…">
        <Flex align="center" justify="space-between" gap="12px" flexWrap="wrap" mb="14px">
          <Skeleton h="34px" w="280px" rounded="10px" />
          <Skeleton h="34px" w="120px" rounded="8px" />
        </Flex>
        <Flex align="center" justify="space-between" gap="12px" mb="8px" flexWrap="wrap">
          <Skeleton h="13px" w="34%" />
          <Flex gap="8px">
            <Skeleton h="34px" w="130px" rounded="8px" />
            <Skeleton h="34px" w="130px" rounded="8px" />
          </Flex>
        </Flex>
        <Skeleton h={{ base: '320px', md: '480px' }} rounded="10px" />
      </SkeletonPage>
    </Card>
  )
}

/** Mirrors DevGalleryView: the toolbar, then the image grid at its real columns. */
export function GallerySkeleton({ tiles = 8 }) {
  return (
    <Card>
      <SkeletonPage label="Loading images…">
        <Flex align="center" justify="space-between" gap="12px" flexWrap="wrap" mb="14px">
          <Skeleton h="16px" w="180px" rounded="8px" />
          <Flex gap="8px" flexWrap="wrap">
            <Skeleton h="34px" w="120px" rounded="8px" />
            <Skeleton h="34px" w="120px" rounded="8px" />
          </Flex>
        </Flex>
        <SimpleGrid columns={{ base: 2, md: 3, xl: 4 }} gap="12px">
          {Array.from({ length: tiles }, (_, index) => (
            <Skeleton key={index} h="150px" rounded="10px" />
          ))}
        </SimpleGrid>
      </SkeletonPage>
    </Card>
  )
}
