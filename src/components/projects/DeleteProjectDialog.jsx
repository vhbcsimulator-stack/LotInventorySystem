import { useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Input, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuTrash2, LuTriangleAlert } from 'react-icons/lu'
import { deleteProject } from '@/data/projectsData'
import { notifyFailed, notifySaved } from '@/lib/notify'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'
const HEADING_FONT = "'Plus Jakarta Sans', Inter, system-ui, sans-serif"

/**
 * Confirm deleting a project added from the portal. The code must be typed to
 * confirm, since its tables, maps and outlines go for good. A project that still
 * has lots is refused (by deleteProject), so no sales record is lost.
 */
export default function DeleteProjectDialog({ project, onClose, onDeleted }) {
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const name = project.name || project.code
  const confirmed = typed.trim().toUpperCase() === project.code.toUpperCase()

  function close() {
    if (!saving) onClose()
  }

  async function confirm() {
    setSaving(true)
    setError('')
    try {
      await deleteProject(project.code)
      notifySaved('Project deleted', `${name} (${project.code}) was deleted.`)
      setSaving(false)
      onDeleted()
    } catch (err) {
      setError(err.message)
      notifyFailed('Could not delete the project', err)
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={({ open: next }) => !next && close()} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxW="440px">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px" display="block">
              <Flex align="center" gap="10px">
                <Icon as={LuTrash2} boxSize="20px" color="#DC2626" />
                <Dialog.Title fontFamily={HEADING_FONT} fontSize="18px" color={COLORS.heading}>
                  Delete {name}?
                </Dialog.Title>
              </Flex>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" disabled={saving} />
            </Dialog.CloseTrigger>
            <Dialog.Body py="18px">
              <Text fontFamily={FONT} fontSize="14px" lineHeight="22px" color={COLORS.muted}>
                {name} will be removed from the projects table, with its phases, maps, lot outlines, map colours, prices and lot
                table. This cannot be undone. A project that still has lots cannot be deleted — delete its lots first, or pause
                the project instead.
              </Text>
              <Text as="label" htmlFor="delete-project-code" display="block" mt="14px" mb="6px" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>
                Type {project.code} to confirm
              </Text>
              <Input
                id="delete-project-code"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                h="42px"
                borderRadius="8px"
                fontFamily={FONT}
                fontSize="14px"
              />
              {error ? (
                <Flex mt="14px" gap="8px" p="12px" borderRadius="10px" bg="#FDECEC" align="flex-start" role="alert">
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
                disabled={saving || !confirmed}
                align="center"
                gap="6px"
                h="38px"
                px="16px"
                borderRadius="8px"
                bg="#DC2626"
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                color="#FFFFFF"
                cursor="pointer"
                _hover={{ bg: '#B91C1C' }}
                _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
              >
                {saving ? <Spinner size="xs" /> : <Icon as={LuTrash2} boxSize="15px" />}
                Delete project
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
