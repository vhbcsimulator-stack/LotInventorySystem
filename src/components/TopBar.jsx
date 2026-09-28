import { useState } from 'react'
import { Box, Flex, Icon, Text } from '@chakra-ui/react'
import { LuInfo, LuMenu, LuUser } from 'react-icons/lu'
import GlobalSearch from '@/components/GlobalSearch'
import SystemManualDialog from '@/components/SystemManualDialog'
import { COLORS } from '@/theme/colors'

/**
 * App chrome above the page content: current page title, quick access search,
 * help, and the signed-in user.
 */
export default function TopBar({ title, user, onMenuOpen, onRunCommand }) {
  const [manualOpen, setManualOpen] = useState(false)
  return (
    <>
    <Flex
      as="header"
      align="center"
      gap={{ base: '10px', sm: '16px' }}
      h="64px"
      px={{ base: '12px', sm: '16px', lg: '24px' }}
      flexShrink={0}
      bg={COLORS.surface}
      borderBottom="1px solid"
      borderColor={COLORS.border}
    >
      <Flex as="button" type="button" align="center" justify="center" boxSize="36px" flexShrink={0} display={{ base: 'flex', lg: 'none' }} aria-label="Open navigation" onClick={onMenuOpen} color={COLORS.heading} borderRadius="8px" _hover={{ bg: COLORS.hoverBg }} _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}>
        <Icon as={LuMenu} boxSize="20px" />
      </Flex>
      <Text
        fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
        fontWeight="700"
        fontSize="16px"
        lineHeight="22px"
        letterSpacing="-0.2px"
        color={COLORS.heading}
        minW={0}
        truncate
      >
        {title}
      </Text>

      <GlobalSearch onRun={onRunCommand} />

      <Flex align="center" gap={{ base: '6px', sm: '14px' }} ml="auto" flexShrink={0}>
        <Flex as="button" type="button" align="center" justify="center" boxSize="34px" borderRadius="full" border="1px solid" borderColor={COLORS.border} color={COLORS.heading} bg={COLORS.surface} cursor="pointer" title="System Manual" aria-label="Open system manual" onClick={() => setManualOpen(true)} _hover={{ bg: COLORS.hoverBg }} _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}>
          <Icon as={LuInfo} boxSize="18px" />
        </Flex>
        <Flex align="center" gap="8px" title={user?.name}>
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
          <Box minW={0} display={{ base: 'none', sm: 'block' }}>
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
    <SystemManualDialog open={manualOpen} onClose={() => setManualOpen(false)} />
    </>
  )
}
