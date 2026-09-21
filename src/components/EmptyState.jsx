import { Flex, Icon, Text } from '@chakra-ui/react'
import { COLORS } from '@/theme/colors'

/**
 * Placeholder card used by pages that have no data wired up yet. Swap it for
 * the real table/list as each page is built out.
 */
export default function EmptyState({ icon, title, hint, children }) {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="8px"
      minH="360px"
      px="24px"
      textAlign="center"
      bg={COLORS.surface}
      border="1px solid"
      borderColor={COLORS.border}
      borderRadius="12px"
    >
      {icon ? <Icon as={icon} boxSize="28px" color={COLORS.brandGreen} /> : null}
      <Text
        fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
        fontWeight="600"
        fontSize="16px"
        lineHeight="22px"
        color={COLORS.heading}
      >
        {title}
      </Text>
      {hint ? (
        <Text
          maxW="420px"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="14px"
          lineHeight="20px"
          color={COLORS.subtle}
        >
          {hint}
        </Text>
      ) : null}
      {/* An action the empty state offers — e.g. the button that fills it. */}
      {children}
    </Flex>
  )
}
