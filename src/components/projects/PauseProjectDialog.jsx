import { useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuCirclePause, LuCirclePlay, LuTriangleAlert } from 'react-icons/lu'
import { setProjectPaused } from '@/data/projectsData'
import { notifyFailed, notifySaved } from '@/lib/notify'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'
const HEADING_FONT = "'Plus Jakarta Sans', Inter, system-ui, sans-serif"

/**
 * Confirm pausing or resuming the project shown. Pausing only sets a flag — a
 * Paused badge here and in the project switcher — so the lots stay editable.
 */
export default function PauseProjectDialog({ open, project, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pausing = !project.paused
  const name = project.name || project.code

  function close() {
    if (saving) return
    setError('')
    onClose()
  }

  async function confirm() {
    setSaving(true)
    setError('')
    try {
      await setProjectPaused(project.code, pausing)
      notifySaved(pausing ? 'Project paused' : 'Project resumed', `${name} is ${pausing ? 'now paused' : 'active again'}.`)
      setSaving(false)
      onSaved()
    } catch (err) {
      setError(err.message)
      notifyFailed(pausing ? 'Could not pause the project' : 'Could not resume the project', err)
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={({ open: next }) => !next && close()} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxW="440px">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px" display="block">
              <Flex align="center" gap="10px">
                <Icon as={pausing ? LuCirclePause : LuCirclePlay} boxSize="20px" color={pausing ? '#B45309' : COLORS.brandGreen} />
                <Dialog.Title fontFamily={HEADING_FONT} fontSize="18px" color={COLORS.heading}>
                  {pausing ? `Pause ${name}?` : `Resume ${name}?`}
                </Dialog.Title>
              </Flex>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" disabled={saving} />
            </Dialog.CloseTrigger>
            <Dialog.Body py="18px">
              <Text fontFamily={FONT} fontSize="14px" lineHeight="22px" color={COLORS.muted}>
                {pausing
                  ? `${name} will be marked Paused here and in the project list. Its lots stay as they are and can still be edited; resume it any time from Project Actions.`
                  : `${name} will no longer be marked Paused.`}
              </Text>
              {error ? (
                <Flex mt="14px" gap="8px" p="12px" borderRadius="10px" bg="#FDECEC" align="flex-start">
                  <Icon as={LuTriangleAlert} color="#B91C1C" mt="2px" flexShrink={0} />
                  <Text fontFamily={FONT} fontSize="13px" color="#7F1D1D">
                    {error}
                  </Text>
                </Flex>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px">
              <Box
                as="button"
                type="button"
                onClick={close}
                disabled={saving}
                h="38px"
                px="16px"
                borderRadius="8px"
                border="1px solid"
                borderColor={COLORS.border}
                bg={COLORS.surface}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                color={COLORS.heading}
                cursor="pointer"
                _hover={{ bg: COLORS.hoverBg }}
                _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
              >
                Cancel
              </Box>
              <Flex
                as="button"
                type="button"
                onClick={confirm}
                disabled={saving}
                align="center"
                gap="6px"
                h="38px"
                px="16px"
                borderRadius="8px"
                bg={pausing ? '#B45309' : COLORS.brandGreen}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                color="#FFFFFF"
                cursor="pointer"
                _hover={{ bg: pausing ? '#92400E' : '#00541F' }}
                _disabled={{ opacity: 0.6, cursor: 'not-allowed' }}
              >
                {saving ? <Spinner size="xs" /> : <Icon as={pausing ? LuCirclePause : LuCirclePlay} boxSize="15px" />}
                {pausing ? 'Pause project' : 'Resume project'}
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
