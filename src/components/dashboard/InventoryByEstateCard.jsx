import { Box, Flex, Icon, Text } from '@chakra-ui/react'
import { LuArrowRight } from 'react-icons/lu'
import { Card, CardHeading } from '@/components/ui-kit/Card'
import { COLORS, CHART } from '@/theme/colors'
import { motion, CHART_MOTION } from '@/components/ui-kit/chartMotion'
import { formatNumber } from '@/utils/format'

function LegendItem({ color, label }) {
  return (
    <Flex align="center" gap="5px">
      <Box boxSize="8px" borderRadius="full" bg={color} />
      <Text
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="11px"
        lineHeight="15px"
        color={COLORS.subtle}
      >
        {label}
      </Text>
    </Flex>
  )
}

/**
 * Stacked composition bar per estate. Sold and Reserved are the two series;
 * the remaining track is open inventory, so the bar reads as "how much of this
 * estate has moved". A 2px surface gap separates adjacent segments.
 */
function EstateRow({ estate }) {
  const { name, sold, reserved, open, total } = estate
  const pct = (n) => (total ? (n / total) * 100 : 0)

  return (
    <Box>
      <Flex align="baseline" justify="space-between" gap="12px">
        <Text
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight="600"
          fontSize="13px"
          lineHeight="18px"
          color={COLORS.heading}
          truncate
        >
          {name}
        </Text>
        <Text
          flexShrink={0}
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="12px"
          lineHeight="16px"
          color={COLORS.subtle}
        >
          {formatNumber(open)} open / {formatNumber(total)} total
        </Text>
      </Flex>

      <Flex
        mt="6px"
        h="8px"
        w="full"
        borderRadius="full"
        overflow="hidden"
        bg={CHART.available}
        gap="2px"
        role="img"
        aria-label={`${name}: ${sold} sold, ${reserved} reserved, ${open} open of ${total} lots`}
      >
        {/* Each band fills from the left, in the order they are read. */}
        <Box
          w={`${pct(sold)}%`}
          bg={CHART.sold}
          transformOrigin="left center"
          {...motion(CHART_MOTION.grow, { duration: 780, delay: 120 })}
        />
        <Box
          w={`${pct(reserved)}%`}
          bg={CHART.reserved}
          transformOrigin="left center"
          {...motion(CHART_MOTION.grow, { duration: 780, delay: 260 })}
        />
      </Flex>
    </Box>
  )
}

export default function InventoryByEstateCard({ estates, totalUnits, onExplore }) {
  return (
    <Card display="flex" flexDirection="column">
      <CardHeading
        title="Inventory by Estate"
        description="Lot distribution across registered communities."
        actions={
          <Flex align="center" gap="10px" flexWrap="wrap">
            <LegendItem color={CHART.sold} label="Sold" />
            <LegendItem color={CHART.reserved} label="Res." />
            <LegendItem color={CHART.available} label="Open" />
          </Flex>
        }
      />

      <Flex direction="column" gap="14px" flex="1">
        {estates.length === 0 ? (
          <Flex align="center" justify="center" minH="180px">
            <Text fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.subtle}>
              No estates registered yet.
            </Text>
          </Flex>
        ) : (
          estates.map((estate) => <EstateRow key={estate.id} estate={estate} />)
        )}
      </Flex>

      <Flex
        align="center"
        justify="space-between"
        gap="12px"
        mt="16px"
        pt="14px"
        borderTop="1px solid"
        borderColor={COLORS.border}
      >
        <Text
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="12px"
          lineHeight="16px"
          color={COLORS.subtle}
        >
          Portfolio: {formatNumber(totalUnits)} Units
        </Text>
        <Flex
          as="button"
          type="button"
          onClick={onExplore}
          align="center"
          gap="4px"
          cursor="pointer"
          color={COLORS.activeBg}
          _hover={{ textDecoration: 'underline' }}
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
        >
          <Text
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="600"
            fontSize="12px"
            lineHeight="16px"
          >
            Explore All Projects
          </Text>
          <Icon as={LuArrowRight} boxSize="13px" />
        </Flex>
      </Flex>
    </Card>
  )
}
