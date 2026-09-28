import { Dialog, Flex, Icon, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuLogOut } from 'react-icons/lu'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'

function Button({ children, icon, loading, tone = 'neutral', ...rest }) {
  const danger = tone === 'danger'
  return (
    <Flex
      as="button"
      type="button"
      align="center"
      justify="center"
      gap="7px"
      h="36px"
      px="14px"
      borderRadius="8px"
      border="1px solid"
      borderColor={danger ? COLORS.danger : COLORS.border}
      bg={danger ? COLORS.danger : COLORS.surface}
      color={danger ? '#FFFFFF' : COLORS.heading}
      fontFamily={FONT}
      fontSize="13px"
      fontWeight="600"
      cursor="pointer"
      _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
      _hover={{ opacity: 0.88 }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      {...rest}
    >
      {loading ? <Spinner size="xs" /> : icon ? <Icon as={icon} boxSize="15px" /> : null}
      {children}
    </Flex>
  )
}

/** Asks before signing out, so a stray click on Logout does not end the session. */
export default function LogoutDialog({ open, busy = false, onCancel, onConfirm }) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next && !busy) onCancel()
      }}
      placement="center"
      size="sm"
      role="alertdialog"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px">
            <Dialog.Header py="16px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="17px" color={COLORS.heading}>
                Log out?
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pb="8px">
              <Text fontFamily={FONT} fontSize="13px" color={COLORS.muted}>
                Are you sure you want to log out?
              </Text>
            </Dialog.Body>
            <Dialog.Footer py="14px" gap="10px">
              <Button onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button tone="danger" icon={LuLogOut} loading={busy} disabled={busy} onClick={onConfirm}>
                {busy ? 'Logging out…' : 'Log out'}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
