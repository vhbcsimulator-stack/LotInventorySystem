import { useEffect, useRef, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Image, Input, NativeSelect, Portal, SimpleGrid, Spinner, Text, Textarea } from '@chakra-ui/react'
import { LuBuilding2, LuImagePlus, LuMapPin, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import RefreshButton from '@/components/ui-kit/RefreshButton'
import { ContentManagerSkeleton } from '@/components/skeletons/ProjectViewSkeletons'
import EmptyState from '@/components/EmptyState'
import useApiQuery from '@/hooks/useApiQuery'
import { SOURCE } from '@/data/api'
import { deleteFutureProject, fetchFutureProjects, saveFutureProject } from '@/data/futureProjectsData'
import { notifyFailed, notifySaved } from '@/lib/notify'
import { acceptFor, describeUpload, uploadProblem } from '@/lib/uploadRules'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'
const CUSTOM_PROJECT = '__custom__'
const EMPTY_FORM = { projectCode: '', customName: '', location: '', description: '' }

const customCode = (name) =>
  `future-${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'}`

function Button({ children, icon, loading, primary, ...rest }) {
  return (
    <Flex as="button" type="button" align="center" justify="center" gap="7px" h="38px" px="14px" borderRadius="8px" border="1px solid" borderColor={primary ? COLORS.brandGreen : COLORS.border} bg={primary ? COLORS.brandGreen : COLORS.surface} color={primary ? '#FFFFFF' : COLORS.heading} fontFamily={FONT} fontSize="13px" fontWeight="600" cursor="pointer" _disabled={{ opacity: 0.55, cursor: 'not-allowed' }} _hover={{ opacity: 0.88 }} {...rest}>
      {loading ? <Spinner size="xs" /> : icon ? <Icon as={icon} boxSize="15px" /> : null}
      {children}
    </Flex>
  )
}

export default function FutureProjectsDialog({ open, onClose, projects: existingProjects = [] }) {
  const { data, loading, reload, refresh } = useApiQuery(fetchFutureProjects)
  const projects = data?.projects ?? []
  const canEdit = data?.source === SOURCE.DATABASE
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef(null)
  const formRef = useRef(null)
  const previewRef = useRef('')

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])

  function setImage(nextFile) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    const url = nextFile ? URL.createObjectURL(nextFile) : ''
    previewRef.current = url
    setFile(nextFile)
    setPreview(url)
  }

  function resetForm() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setImage(null)
    setError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  function edit(project) {
    const existing = existingProjects.some((option) => option.code === project.projectCode)
    setEditing(project)
    setForm({
      projectCode: existing ? project.projectCode : CUSTOM_PROJECT,
      customName: existing ? '' : project.name,
      location: project.location,
      description: project.description,
    })
    setImage(null)
    setError('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function save() {
    setBusy('save')
    setError('')
    try {
      const selectedProject = existingProjects.find((project) => project.code === form.projectCode)
      const isCustom = form.projectCode === CUSTOM_PROJECT
      await saveFutureProject({
        id: editing?.id,
        ...form,
        projectCode: isCustom ? editing?.projectCode || customCode(form.customName) : form.projectCode,
        name: isCustom ? form.customName : selectedProject?.name || form.projectCode,
        file,
        existing: editing,
      })
      notifySaved(editing ? 'Future project updated' : 'Future project added')
      resetForm()
      reload()
    } catch (err) {
      setError(err.message)
      notifyFailed('Could not save future project', err)
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    setBusy('delete')
    try {
      await deleteFutureProject(removing)
      notifySaved('Future project removed')
      if (editing?.id === removing.id) resetForm()
      setRemoving(null)
      reload()
    } catch (err) {
      setRemoving(null)
      setError(err.message)
      notifyFailed('Could not remove future project', err)
    } finally {
      setBusy('')
    }
  }

  const image = preview || editing?.imageUrl
  const valid = form.projectCode && (form.projectCode !== CUSTOM_PROJECT || form.customName.trim()) && form.location.trim() && (editing || file)

  return (
    <Dialog.Root open={open} onOpenChange={({ open: next }) => { if (!next && !busy) onClose?.() }} placement="center" size="xl">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner p={{ base: '12px', md: '24px' }}>
          <Dialog.Content maxH="calc(100dvh - 48px)" borderRadius="16px" overflow="hidden">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} pr="56px" display="flex" alignItems="center" justifyContent="space-between" gap="12px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="19px">Future Projects</Dialog.Title>
              <RefreshButton onRefresh={refresh} label="Refresh future projects" size="32px" />
            </Dialog.Header>
            <Dialog.Body p={{ base: '14px', md: '20px' }} overflowY="auto">
              {loading && !data ? <ContentManagerSkeleton /> : (
                <Flex direction="column" gap="18px">
                  <Card ref={formRef} p={{ base: '16px', md: '20px' }}>
                    <Text fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontWeight="700" fontSize="17px" color={COLORS.heading}>{editing ? 'Edit future project' : 'Add future project'}</Text>
                    <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px" mt="16px">
                      <Box>
                        <Text as="label" htmlFor="future-project" display="block" mb="6px" fontFamily={FONT} fontSize="13px" fontWeight="600">Project</Text>
                        <NativeSelect.Root>
                          <NativeSelect.Field id="future-project" value={form.projectCode} onChange={(e) => setForm((prev) => ({ ...prev, projectCode: e.target.value }))} disabled={!canEdit || Boolean(busy)}>
                            <option value="">Select a project</option>
                            {existingProjects.map((project) => <option key={project.code} value={project.code}>{project.name === project.code ? project.code : `${project.code} — ${project.name}`}</option>)}
                            <option value={CUSTOM_PROJECT}>Other / New future project</option>
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                        {form.projectCode === CUSTOM_PROJECT ? (
                          <Box mt="10px">
                            <Text as="label" htmlFor="future-custom-name" display="block" mb="6px" fontFamily={FONT} fontSize="13px" fontWeight="600">Project name</Text>
                            <Input id="future-custom-name" value={form.customName} onChange={(e) => setForm((prev) => ({ ...prev, customName: e.target.value }))} placeholder="Enter the future project name" maxLength={160} disabled={!canEdit || Boolean(busy)} />
                          </Box>
                        ) : null}
                      </Box>
                      <Box>
                        <Text as="label" htmlFor="future-location" display="block" mb="6px" fontFamily={FONT} fontSize="13px" fontWeight="600">Location</Text>
                        <Input id="future-location" value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} maxLength={200} disabled={!canEdit || Boolean(busy)} />
                      </Box>
                    </SimpleGrid>
                    <Box mt="14px">
                      <Text as="label" htmlFor="future-description" display="block" mb="6px" fontFamily={FONT} fontSize="13px" fontWeight="600">Description <Text as="span" color={COLORS.subtle} fontWeight="400">(optional)</Text></Text>
                      <Textarea id="future-description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} maxLength={1000} minH="90px" resize="vertical" disabled={!canEdit || Boolean(busy)} />
                    </Box>
                    <Box mt="14px">
                      <Text as="label" htmlFor="future-image" display="block" mb="6px" fontFamily={FONT} fontSize="13px" fontWeight="600">Image {editing ? <Text as="span" color={COLORS.subtle} fontWeight="400">(optional to replace)</Text> : null}</Text>
                      <Flex as="button" type="button" w="full" minH="120px" direction="column" align="center" justify="center" gap="6px" border="2px dashed" borderColor={COLORS.border} borderRadius="10px" bg={COLORS.canvas} disabled={!canEdit || Boolean(busy)} cursor={canEdit ? 'pointer' : 'not-allowed'} onClick={() => fileInput.current?.click()}>
                        {image ? <Image src={image} alt="Future project preview" maxH="210px" maxW="full" objectFit="contain" /> : <><Icon as={LuImagePlus} boxSize="26px" color={COLORS.brandGreen} /><Text fontFamily={FONT} fontSize="13px" fontWeight="600">Choose an image</Text></>}
                      </Flex>
                      <input ref={fileInput} id="future-image" hidden type="file" accept={acceptFor('photo')} onChange={(e) => { const next = e.target.files?.[0]; const problem = next ? uploadProblem('photo', next) : ''; if (problem) setError(problem); else if (next) { setError(''); setImage(next) } e.target.value = '' }} />
                      <Text mt="6px" fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>{describeUpload('photo')}</Text>
                    </Box>
                    {error ? <Text role="alert" mt="10px" fontFamily={FONT} fontSize="13px" color="#B91C1C">{error}</Text> : null}
                    <Flex gap="8px" mt="16px" wrap="wrap">
                      <Button primary icon={editing ? LuPencil : LuPlus} loading={busy === 'save'} disabled={!canEdit || Boolean(busy) || !valid} onClick={save}>{editing ? 'Save changes' : 'Add project'}</Button>
                      {editing ? <Button disabled={Boolean(busy)} onClick={resetForm}>Cancel</Button> : null}
                    </Flex>
                  </Card>

                  {data?.source !== SOURCE.DATABASE ? <Text role="alert" fontFamily={FONT} fontSize="13px" color="#B45309">{data?.source === SOURCE.NOT_CONFIGURED ? 'Connect the database to manage future projects.' : `Future Projects is unavailable. Run the latest migration and try again${data?.message ? `: ${data.message}` : '.'}`}</Text> : null}
                  {projects.length ? (
                    <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px">
                      {projects.map((project) => (
                        <Card key={project.id} p="0" overflow="hidden">
                          <Image src={project.imageUrl} alt={project.name} w="full" h="180px" objectFit="cover" />
                          <Box p="16px">
                            <Text fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="16px" fontWeight="700" color={COLORS.heading}>{project.name}</Text>
                            <Flex align="center" gap="6px" mt="5px" color={COLORS.muted}><Icon as={LuMapPin} boxSize="14px" /><Text fontFamily={FONT} fontSize="13px">{project.location}</Text></Flex>
                            {project.description ? <Text mt="9px" fontFamily={FONT} fontSize="13px" color={COLORS.muted} whiteSpace="pre-wrap">{project.description}</Text> : null}
                            <Flex mt="14px" gap="8px"><Button icon={LuPencil} disabled={Boolean(busy)} onClick={() => edit(project)}>Edit</Button><Button icon={LuTrash2} disabled={Boolean(busy)} onClick={() => setRemoving(project)}>Remove</Button></Flex>
                          </Box>
                        </Card>
                      ))}
                    </SimpleGrid>
                  ) : <EmptyState icon={LuBuilding2} title="No future projects yet" hint="Select an existing project or enter a new one, then add its location and image." />}
                </Flex>
              )}
            </Dialog.Body>
            <Dialog.CloseTrigger asChild top="12px" right="12px"><CloseButton size="sm" disabled={Boolean(busy)} /></Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>

      <Dialog.Root open={Boolean(removing)} onOpenChange={({ open: next }) => { if (!next && !busy) setRemoving(null) }} placement="center" size="sm">
        <Portal><Dialog.Backdrop /><Dialog.Positioner px="16px"><Dialog.Content borderRadius="16px"><Dialog.Header><Dialog.Title>Remove future project?</Dialog.Title></Dialog.Header><Dialog.Body><Text fontFamily={FONT} fontSize="14px">Remove {removing?.name} and its image?</Text></Dialog.Body><Dialog.Footer gap="8px"><Button disabled={Boolean(busy)} onClick={() => setRemoving(null)}>Cancel</Button><Button icon={LuTrash2} loading={busy === 'delete'} disabled={Boolean(busy)} onClick={remove}>Remove</Button></Dialog.Footer></Dialog.Content></Dialog.Positioner></Portal>
      </Dialog.Root>
    </Dialog.Root>
  )
}
