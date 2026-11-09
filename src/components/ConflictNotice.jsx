import { Box, Flex, Icon, Text } from '@chakra-ui/react'
import { LuTriangleAlert } from 'react-icons/lu'

const FONT = 'Inter, system-ui, sans-serif'

function Action({ children, primary, ...rest }) {
  return (
    <Box
      as="button"
      type="button"
      h="32px"
      px="12px"
      borderRadius="8px"
      fontFamily={FONT}
      fontWeight="600"
      fontSize="13px"
      cursor="pointer"
      bg={primary ? '#B45309' : '#FFFFFF'}
      color={primary ? '#FFFFFF' : '#92400E'}
      border="1px solid"
      borderColor={primary ? '#B45309' : '#F5C77E'}
      _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
      _focusVisible={{ outline: '2px solid', outlineColor: '#B45309', outlineOffset: '2px' }}
      {...rest}
    >
      {children}
    </Box>
  )
}

/**
 * Someone else changed (or deleted) the record being edited. `message` says
 * so; `onDiscard` drops this user's edits for the latest version, and
 * `onOverwrite` — left out when the record is gone — saves theirs over it.
 * `detail` replaces the second line.
 */
export default function ConflictNotice({ message, detail, onDiscard, onOverwrite, discardLabel = 'Discard mine', busy = false }) {
  const note = detail ?? (onOverwrite ? 'Saving yours will replace their changes.' : '')
  return (
    <Box role="alert" mt="14px" p="12px" borderRadius="10px" bg="#FEF3E2" border="1px solid" borderColor="#F5C77E">
      <Flex gap="8px" align="flex-start">
        <Icon as={LuTriangleAlert} boxSize="16px" color="#B45309" mt="2px" flexShrink={0} />
        <Box>
          <Text fontFamily={FONT} fontSize="13px" fontWeight="600" color="#92400E">
            {message}
          </Text>
          {note ? (
            <Text fontFamily={FONT} fontSize="12px" color="#92400E" mt="2px">
              {note}
            </Text>
          ) : null}
        </Box>
      </Flex>
      <Flex gap="8px" mt="10px" justify="flex-end" wrap="wrap">
        {onDiscard ? (
          <Action onClick={onDiscard} disabled={busy}>
            {discardLabel}
          </Action>
        ) : null}
        {onOverwrite ? (
          <Action primary onClick={onOverwrite} disabled={busy}>
            Save mine anyway
          </Action>
        ) : null}
      </Flex>
    </Box>
  )
}
