import { Box, Flex, SimpleGrid } from '@chakra-ui/react'
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

/** Form-led content manager used while featured/future project records load. */
export function ContentManagerSkeleton({ cards = 2 }) {
  return (
    <SkeletonPage label="Loading project content…">
      <Flex direction="column" gap="16px">
        <Card p={{ base: '16px', md: '20px' }}>
          <Skeleton h="18px" w="190px" rounded="8px" />
          <Skeleton h="12px" w="min(440px, 90%)" mt="8px" />
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px" mt="18px">
            <Box><Skeleton h="12px" w="70px" mb="7px" /><Skeleton h="40px" rounded="8px" /></Box>
            <Box><Skeleton h="12px" w="80px" mb="7px" /><Skeleton h="40px" rounded="8px" /></Box>
          </SimpleGrid>
          <Skeleton h="96px" rounded="10px" mt="14px" />
          <Skeleton h="38px" w="130px" rounded="8px" mt="16px" />
        </Card>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px">
          {Array.from({ length: cards }, (_, index) => (
            <Card key={index} p="0" overflow="hidden">
              <Skeleton h="160px" rounded="0" />
              <Box p="16px"><Skeleton h="16px" w="55%" /><Skeleton h="12px" w="72%" mt="9px" /></Box>
            </Card>
          ))}
        </SimpleGrid>
      </Flex>
    </SkeletonPage>
  )
}

/** Initial annotated-map list, before the database confirms rows or an empty state. */
export function AnnotatedImagesSkeleton({ rows = 3 }) {
  return (
    <SkeletonPage label="Loading annotated images…">
      <Flex direction="column" gap="12px">
        {Array.from({ length: rows }, (_, index) => (
          <Flex key={index} align="center" gap="12px" p="10px" border="1px solid" borderColor="#E4E8EE" borderRadius="10px">
            <Skeleton h="60px" w="88px" rounded="8px" flexShrink={0} />
            <Box flex="1"><Skeleton h="13px" w="38%" /><Skeleton h="11px" w="58%" mt="8px" /></Box>
            <Skeleton h="34px" w="100px" rounded="8px" />
          </Flex>
        ))}
      </Flex>
    </SkeletonPage>
  )
}
