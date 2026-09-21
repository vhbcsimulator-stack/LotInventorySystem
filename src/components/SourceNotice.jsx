import { Flex, Icon, Text } from '@chakra-ui/react'
import { LuDatabase } from 'react-icons/lu'
import { SOURCE } from '@/data/api'
import { COLORS } from '@/theme/colors'

/**
 * Explains why a page reads zero. Without it, "no database yet" and "the
 * database says zero" look identical — and misreading the first as the second
 * is the dangerous direction. Renders nothing when data came from the database.
 *
 * `envVar` names the setting that connects this page, e.g. VITE_PROJECTS_API.
 */
export default function SourceNotice({ source, envVar }) {
  let message = null
  if (source === SOURCE.NOT_CONFIGURED) {
    message = `No database connected yet — every figure below is zero. Set ${envVar} to start reading live data.`
  } else if (source === SOURCE.UNAVAILABLE) {
    message =
      'The data service could not be reached, so figures are showing as zero rather than stale or estimated values.'
  }

  if (!message) return null

  return (
    <Flex
      role="status"
      align="flex-start"
      gap="10px"
      p="12px 14px"
      borderRadius="10px"
      bg={COLORS.statusBg}
      border="1px solid"
      borderColor="#C7D8F7"
    >
      <Icon as={LuDatabase} boxSize="15px" color={COLORS.activeBg} mt="1px" flexShrink={0} />
      <Text
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="12.5px"
        lineHeight="18px"
        color={COLORS.heading}
      >
        {message}
      </Text>
    </Flex>
  )
}
