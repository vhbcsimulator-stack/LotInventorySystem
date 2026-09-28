import { Box, Flex, Text } from '@chakra-ui/react'
import { COLORS } from '@/theme/colors'

/**
 * Title block shared by every page, so headings stay consistent as pages grow.
 * `actions` renders on the right (buttons, filters, etc.).
 */
export default function PageHeader({ title, description, actions }) {
  return (
    <Flex align="flex-start" justify="space-between" gap="16px" mb="24px" flexWrap="wrap">
      <Box minW={0}>
        <Text
          as="h1"
          fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
          fontWeight="700"
          fontSize="24px"
          lineHeight="30px"
          letterSpacing="-0.4px"
          color={COLORS.heading}
        >
          {title}
        </Text>
        {description ? (
          <Text
            mt="4px"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="14px"
            lineHeight="20px"
            color={COLORS.subtle}
          >
            {description}
          </Text>
        ) : null}
      </Box>
      {actions ? <Box maxW="100%">{actions}</Box> : null}
    </Flex>
  )
}
