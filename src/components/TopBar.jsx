import { Box, Flex, Icon, Input, Text } from '@chakra-ui/react'
import { LuBell, LuSearch, LuUser } from 'react-icons/lu'
import { COLORS } from '@/theme/colors'

/**
 * App chrome above the page content: current page title, global search, alerts,
 * and the signed-in user. `user` and `hasAlerts` come from the caller so this
 * stays presentational.
 */
export default function TopBar({ title, user, hasAlerts = false, onSearch }) {
  return (
    <Flex
      as="header"
      align="center"
      gap="16px"
      h="64px"
      px="24px"
      flexShrink={0}
      bg={COLORS.surface}
      borderBottom="1px solid"
      borderColor={COLORS.border}
    >
      <Text
        fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
        fontWeight="700"
        fontSize="16px"
        lineHeight="22px"
        letterSpacing="-0.2px"
        color={COLORS.heading}
        flexShrink={0}
      >
        {title}
      </Text>

      <Flex align="center" gap="14px" ml="auto" flexShrink={0}>

        <Flex align="center" gap="8px">
          <Flex
            align="center"
            justify="center"
            boxSize="32px"
            borderRadius="full"
            bg={COLORS.brandGreen}
            flexShrink={0}
          >
            <Icon as={LuUser} boxSize="15px" color="#FFFFFF" />
          </Flex>
          <Box minW={0}>
            <Text
              fontFamily="Inter, system-ui, sans-serif"
              fontWeight="600"
              fontSize="13px"
              lineHeight="17px"
              color={COLORS.heading}
              truncate
            >
              {user?.name}
            </Text>
            <Text
              fontFamily="Inter, system-ui, sans-serif"
              fontSize="11px"
              lineHeight="15px"
              color={COLORS.subtle}
              truncate
            >
              {user?.role}
            </Text>
          </Box>
        </Flex>
      </Flex>
    </Flex>
  )
}
