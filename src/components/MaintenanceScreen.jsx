import { Box, Flex, Icon, Image, Text } from '@chakra-ui/react'
import { LuLogOut, LuWrench } from 'react-icons/lu'
import bhriLogo from '@/assets/BHRI OFFICIAL LOGO TRANSPARENT.png'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'

/**
 * What everyone but a developer sees in place of something under maintenance.
 * `fullScreen` is the whole-portal version, with the logo and a way to sign out;
 * without it, it fills a page's content area.
 */
export default function MaintenanceScreen({
  title = 'Under maintenance',
  message = '',
  fullScreen = false,
  onLogout,
}) {
  return (
    <Flex
      role="status"
      direction="column"
      align="center"
      justify="center"
      gap="12px"
      textAlign="center"
      px="16px"
      py={fullScreen ? '24px' : '64px'}
      minH={fullScreen ? '100dvh' : '60vh'}
      bg={fullScreen ? COLORS.canvas : undefined}
    >
      {fullScreen ? <Image src={bhriLogo} alt="BHRI logo" w="160px" h="68px" objectFit="cover" mb="8px" /> : null}
      <Flex align="center" justify="center" boxSize="56px" borderRadius="16px" bg="#FEF3E2">
        <Icon as={LuWrench} boxSize="26px" color="#000" />
      </Flex>
      <Text
        as="h1"
        fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
        fontWeight="700"
        fontSize={fullScreen ? '24px' : '20px'}
        lineHeight="30px"
        color={COLORS.heading}
      >
        {title}
      </Text>
      <Box maxW="46ch">
        <Text fontFamily={FONT} fontSize="14px" lineHeight="21px" color={COLORS.subtle} whiteSpace="pre-line">
          {message || "We're making some improvements. Please check back shortly."}
        </Text>
      </Box>
      {onLogout ? (
        <Flex
          as="button"
          type="button"
          onClick={onLogout}
          mt="8px"
          align="center"
          gap="8px"
          h="36px"
          px="14px"
          borderRadius="8px"
          border="1px solid"
          borderColor={COLORS.border}
          bg={COLORS.surface}
          color={COLORS.muted}
          cursor="pointer"
          _hover={{ bg: COLORS.hoverBg }}
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
        >
          <Icon as={LuLogOut} boxSize="15px" />
          <Text fontFamily={FONT} fontWeight="600" fontSize="13px">Sign out</Text>
        </Flex>
      ) : null}
    </Flex>
  )
}
