import { useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Input, NativeSelect, Portal, Spinner, Text, Textarea } from '@chakra-ui/react'
import { LuFolderPlus, LuTriangleAlert } from 'react-icons/lu'
import { GROUP_OPTIONS, createProject, updateProject } from '@/data/projectsData'
import { notifyFailed, notifySaved, notifyWarning } from '@/lib/notify'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'
const HEADING_FONT = "'Plus Jakarta Sans', Inter, system-ui, sans-serif"
const OTHER = '__other__'

function Field({ id, label, hint, children }) {
  return (
    <Box>
      <Text as="label" htmlFor={id} display="block" mb="6px" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>
        {label}
      </Text>
      {children}
      {hint ? (
        <Text mt="4px" fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
          {hint}
        </Text>
      ) : null}
    </Box>
  )
}

const fieldProps = { h: '42px', borderRadius: '8px', fontFamily: FONT, fontSize: '14px' }

/**
 * Add a project: a row in the `projects` table, then its own lot table, price
 * table and map bucket (see createProject). Mount it only while open, so each
 * opening starts from an empty form.
 *
 * `onSaved(code)` runs once the project exists, even when setting up its tables
 * needs the migration first — that is reported as a warning, not a failure.
 *
 * With `project`, edits that project instead: its name and description, and —
 * for a project added from the portal — its grouping. The code stays fixed.
 */
export default function AddProjectDialog({ project = null, onClose, onSaved }) {
  const editing = Boolean(project)
  const storedGroup = project ? project.groupLabel ?? '' : 'Phase'
  const knownGroup = GROUP_OPTIONS.includes(storedGroup)
  const [code, setCode] = useState(project?.code ?? '')
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [group, setGroup] = useState(knownGroup ? storedGroup : OTHER)
  const [customGroup, setCustomGroup] = useState(knownGroup ? '' : storedGroup)
  // Built-in projects keep the grouping the portal gives them.
  const groupEditable = !editing || project.custom
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const groupLabel = group === OTHER ? customGroup.trim() : group
  const canSave = !saving && code.trim() && name.trim() && (group !== OTHER || groupLabel)

  function close() {
    if (!saving) onClose()
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await updateProject(project.code, { name, description, ...(groupEditable ? { groupLabel } : {}) })
        notifySaved('Project updated', `${name.trim()} (${project.code}) was saved.`)
        setSaving(false)
        onSaved(project.code)
        return
      }
      const { code: saved, warning } = await createProject({ code, name, description, groupLabel })
      if (warning) notifyWarning(`${saved} was added, but is not set up yet`, warning)
      else notifySaved('Project added', `${name.trim()} (${saved}) is ready for lots, prices and maps.`)
      setSaving(false)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
      notifyFailed(editing ? 'Could not update the project' : 'Could not add the project', err)
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={({ open: next }) => !next && close()} placement="center" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxW="460px" maxH="calc(100dvh - 32px)">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px" display="block">
              <Flex align="center" gap="10px">
                <Icon as={LuFolderPlus} boxSize="20px" color={COLORS.brandGreen} />
                <Dialog.Title fontFamily={HEADING_FONT} fontSize="18px" color={COLORS.heading}>
                  {editing ? `Edit ${project.code}` : 'Add project'}
                </Dialog.Title>
              </Flex>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" disabled={saving} />
            </Dialog.CloseTrigger>
            <Dialog.Body py="18px">
              <Flex direction="column" gap="14px">
                <Field id="project-code" label="Project code" hint="2–12 letters or digits, e.g. RHS2. It names the project's lot table and map folder, so it cannot be changed later.">
                  <Input
                    id="project-code"
                    value={code}
                    maxLength={12}
                    disabled={editing}
                    onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="e.g. RHS2"
                    {...fieldProps}
                  />
                </Field>
                <Field id="project-name" label="Project name">
                  <Input id="project-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="e.g. Rolling Hills South 2" {...fieldProps} />
                </Field>
                <Field id="project-description" label="Description (optional)">
                  <Textarea
                    id="project-description"
                    value={description}
                    maxLength={500}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    borderRadius="8px"
                    fontFamily={FONT}
                    fontSize="14px"
                  />
                </Field>
                {groupEditable ? (
                <>
                <Field id="project-group" label="Lots are grouped by" hint="What the project's phases are called on the Map tab and in the lot table.">
                  <NativeSelect.Root>
                    <NativeSelect.Field id="project-group" value={group} onChange={(event) => setGroup(event.target.value)} {...fieldProps}>
                      {GROUP_OPTIONS.map((option) => (
                        <option key={option || 'none'} value={option}>
                          {option || 'No grouping (one phase)'}
                        </option>
                      ))}
                      <option value={OTHER}>Other…</option>
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field>
                {group === OTHER ? (
                  <Field id="project-group-other" label="Grouping name">
                    <Input
                      id="project-group-other"
                      value={customGroup}
                      maxLength={20}
                      onChange={(event) => setCustomGroup(event.target.value)}
                      placeholder="e.g. Village"
                      {...fieldProps}
                    />
                  </Field>
                ) : null}
                </>
                ) : null}
                {error ? (
                  <Flex gap="8px" p="12px" borderRadius="10px" bg="#FDECEC" align="flex-start" role="alert">
                    <Icon as={LuTriangleAlert} color="#B91C1C" mt="2px" flexShrink={0} />
                    <Text fontFamily={FONT} fontSize="13px" color="#7F1D1D">
                      {error}
                    </Text>
                  </Flex>
                ) : null}
              </Flex>
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
                onClick={save}
                disabled={!canSave}
                align="center"
                gap="6px"
                h="38px"
                px="16px"
                borderRadius="8px"
                bg={COLORS.brandGreen}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                color="#FFFFFF"
                cursor="pointer"
                _hover={{ bg: '#00541F' }}
                _disabled={{ opacity: 0.6, cursor: 'not-allowed' }}
              >
                {saving ? <Spinner size="xs" /> : <Icon as={LuFolderPlus} boxSize="15px" />}
                {editing ? 'Save' : 'Add project'}
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
