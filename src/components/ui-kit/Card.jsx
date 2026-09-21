import { Box, Flex, Text } from '@chakra-ui/react'
import { COLORS } from '@/theme/colors'

/** White panel used for every dashboard block. */
export function Card({ children, p = '20px', ...rest }) {
  return (
    <Box
      bg={COLORS.surface}
      border="1px solid"
      borderColor={COLORS.border}
      borderRadius="12px"
      p={p}
      {...rest}
    >
      {children}
    </Box>
  )
}

/** Title + optional description on the left, controls on the right. */
export function CardHeading({ title, description, actions, mb = '16px' }) {
  return (
    <Flex align="flex-start" justify="space-between" gap="16px" mb={mb} flexWrap="wrap">
      <Box minW={0}>
        <Text
          fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
          fontWeight="700"
          fontSize="16px"
          lineHeight="22px"
          letterSpacing="-0.2px"
          color={COLORS.heading}
        >
          {title}
        </Text>
        {description ? (
          <Text
            mt="2px"
            maxW="42ch"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="13px"
            lineHeight="18px"
            color={COLORS.subtle}
          >
            {description}
          </Text>
        ) : null}
      </Box>
      {actions ? <Box flexShrink={0}>{actions}</Box> : null}
    </Flex>
  )
}

export default Card
