import { useEffect, useRef, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Image, Input, NativeSelect, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuImagePlus, LuMapPin, LuPencil, LuStar, LuTrash2 } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import RefreshButton from '@/components/ui-kit/RefreshButton'
import { ContentManagerSkeleton } from '@/components/skeletons/ProjectViewSkeletons'
import EmptyState from '@/components/EmptyState'
import useApiQuery from '@/hooks/useApiQuery'
import { SOURCE } from '@/data/api'
import { deleteFeaturedProject, fetchFeaturedProjects, saveFeaturedProject } from '@/data/featuredProjectsData'
import { notifyFailed, notifySaved } from '@/lib/notify'
import { acceptFor, describeUpload, uploadProblem } from '@/lib/uploadRules'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'

export function FeaturedProjectsDialog({ open, onClose, projects = [], initialProjectCode = '' }) {
  return (
    <Dialog.Root open={open} onOpenChange={({ open: nextOpen }) => { if (!nextOpen) onClose?.() }} placement="center" size="xl">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner p={{ base: '12px', md: '24px' }}>
          <Dialog.Content maxH="calc(100dvh - 48px)" borderRadius="16px" overflow="hidden">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border}>
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="19px">
                Featured project
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body p={{ base: '14px', md: '20px' }} overflowY="auto">
              {open ? <FeaturedProjectsView projects={projects} initialProjectCode={initialProjectCode} /> : null}
            </Dialog.Body>
            <Dialog.CloseTrigger asChild top="12px" right="12px">
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

function Button({ children, icon, loading, tone = 'neutral', ...rest }) {
  const primary = tone === 'primary'
  return (
    <Flex as="button" type="button" align="center" justify="center" gap="7px" h="38px" px="14px" borderRadius="8px" border="1px solid" borderColor={primary ? COLORS.brandGreen : COLORS.border} bg={primary ? COLORS.brandGreen : COLORS.surface} color={primary ? '#FFFFFF' : COLORS.heading} fontFamily={FONT} fontSize="13px" fontWeight="600" cursor="pointer" _disabled={{ opacity: 0.55, cursor: 'not-allowed' }} _hover={{ opacity: 0.88 }} _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }} {...rest}>
      {loading ? <Spinner size="xs" /> : icon ? <Icon as={icon} boxSize="15px" /> : null}
      {children}
    </Flex>
  )
}

export default function FeaturedProjectsView({ projects = [], initialProjectCode = '' }) {
  const { data, loading, reload, refresh } = useApiQuery(fetchFeaturedProjects)
  const feature = data?.feature ?? null
  const [projectChoice, setProjectChoice] = useState(null)
  const projectCode = projectChoice ?? feature?.projectCode ?? initialProjectCode ?? projects[0]?.code ?? ''
  const [draftLocation, setDraftLocation] = useState(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [draggingImage, setDraggingImage] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(null)
  const formRef = useRef(null)
  const fileInput = useRef(null)
  const previewRef = useRef('')
  const selected = feature?.projectCode === projectCode ? feature : null
  const location = draftLocation?.projectCode === projectCode ? draftLocation.value : selected?.location ?? ''
  const canEdit = data?.source === 'database'
  const nameOf = (code) => projects.find((project) => project.code === code)?.name || code

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])

  function chooseFile(nextFile) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    const url = nextFile ? URL.createObjectURL(nextFile) : ''
    previewRef.current = url
    setFile(nextFile)
    setPreview(url)
  }

  function acceptFile(nextFile) {
    if (!nextFile) return
    const problem = uploadProblem('photo', nextFile)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    chooseFile(nextFile)
  }

  function dropImage(event) {
    event.preventDefault()
    setDraggingImage(false)
    if (busy || !canEdit) return
    if (event.dataTransfer.files.length !== 1) {
      setError('Drop one image at a time.')
      return
    }
    acceptFile(event.dataTransfer.files[0])
  }

  function chooseProject(code) {
    setProjectChoice(code)
    setDraftLocation(null)
    chooseFile(null)
    setDraggingImage(false)
    setError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  async function save() {
    setBusy('save')
    setError('')
    try {
      await saveFeaturedProject({ projectCode, location, file, existing: feature })
      chooseFile(null)
      setDraftLocation({ projectCode, value: location })
      if (fileInput.current) fileInput.current.value = ''
      const message = `${nameOf(projectCode)} featured project saved.`
      notifySaved(message)
      reload()
    } catch (err) {
      setError(err.message)
      notifyFailed('Could not save featured project', err)
      reload()
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!removing) return
    setBusy('delete')
    setError('')
    try {
      await deleteFeaturedProject(removing)
      chooseFile(null)
      setDraftLocation(null)
      const message = `${nameOf(removing.projectCode)} removed from featured projects.`
      notifySaved(message)
      setRemoving(null)
      reload()
    } catch (err) {
      setRemoving(null)
      setError(err.message)
      notifyFailed('Could not remove featured project', err)
      reload()
    } finally {
      setBusy('')
    }
  }

  if (loading && !data) return <ContentManagerSkeleton cards={1} />

  return (
    <Flex direction="column" gap="16px">
      <Card ref={formRef} p={{ base: '16px', md: '20px' }}>
        <Flex align="center" justify="space-between" gap="12px">
          <Text as="h3" fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontWeight="700" fontSize="18px" color={COLORS.heading}>
            {selected ? 'Update featured project' : feature ? 'Replace featured project' : 'Feature a project'}
          </Text>
          <RefreshButton onRefresh={refresh} label="Refresh featured project" size="34px" />
        </Flex>
        <Text mt="4px" fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>
          One project can be featured at a time. Saving a different project replaces the current feature.
        </Text>

        <Flex mt="18px" gap="16px" direction={{ base: 'column', lg: 'row' }} align="stretch">
          <Flex direction="column" gap="14px" flex="1" minW={0}>
            <Box>
              <Text as="label" htmlFor="featured-project" mb="6px" display="block" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>Project</Text>
              <NativeSelect.Root>
                <NativeSelect.Field id="featured-project" value={projectCode} onChange={(event) => chooseProject(event.target.value)} disabled={Boolean(busy)}>
                  {projects.length === 0 ? <option value="">No projects available</option> : null}
                  {projects.map((project) => <option key={project.code} value={project.code}>{project.name === project.code ? project.code : `${project.code} — ${project.name}`}</option>)}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Box>
            <Box>
              <Text as="label" htmlFor="featured-location" mb="6px" display="block" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>Location</Text>
              <Input id="featured-location" value={location} onChange={(event) => setDraftLocation({ projectCode, value: event.target.value })} placeholder="e.g. Tagaytay City, Cavite" maxLength={160} disabled={Boolean(busy) || !canEdit} />
            </Box>
            <Box>
              <Text as="label" htmlFor="featured-image" mb="6px" display="block" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>Featured image {selected ? '(optional to replace)' : ''}</Text>
              <Flex
                as="button"
                type="button"
                direction="column"
                align="center"
                justify="center"
                gap="5px"
                w="full"
                minH="126px"
                px="16px"
                py="14px"
                border="2px dashed"
                borderColor={draggingImage ? COLORS.brandGreen : COLORS.border}
                borderRadius="10px"
                bg={draggingImage ? COLORS.statusBg : COLORS.canvas}
                color={COLORS.heading}
                cursor={canEdit && !busy ? 'pointer' : 'not-allowed'}
                disabled={!canEdit || Boolean(busy)}
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => { event.preventDefault(); if (canEdit && !busy) setDraggingImage(true) }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDraggingImage(false) }}
                onDrop={dropImage}
                _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
              >
                <Icon as={LuImagePlus} boxSize="25px" color={COLORS.brandGreen} />
                <Text fontFamily={FONT} fontWeight="600" fontSize="13px" textAlign="center" overflowWrap="anywhere">
                  {file ? file.name : 'Drag and drop one image here'}
                </Text>
                <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle} textAlign="center">
                  {file ? 'Click or drop another image to replace this selection' : 'or click to browse'}
                </Text>
                <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle} textAlign="center">
                  {describeUpload('photo')}
                </Text>
              </Flex>
              <input ref={fileInput} id="featured-image" type="file" accept={acceptFor('photo')} hidden onChange={(event) => { acceptFile(event.target.files?.[0]); event.target.value = '' }} disabled={Boolean(busy) || !canEdit} />
            </Box>
            {error ? <Text role="alert" fontFamily={FONT} fontSize="13px" color="#B91C1C">{error}</Text> : null}
            <Flex>
              <Button tone="primary" icon={LuStar} loading={busy === 'save'} disabled={!canEdit || Boolean(busy) || !projectCode || !location.trim() || (!selected && !file)} onClick={save}>
                {selected ? 'Save changes' : feature ? 'Replace featured project' : 'Feature project'}
              </Button>
            </Flex>
          </Flex>
          <Flex align="center" justify="center" alignSelf="flex-start" w={{ base: 'full', lg: '42%' }} minH={preview || selected?.imageUrl ? undefined : '190px'} border="1px dashed" borderColor={COLORS.border} borderRadius="10px" bg={COLORS.canvas} overflow="hidden">
            {preview || selected?.imageUrl ? (
              <Image src={preview || selected.imageUrl} alt={`${nameOf(projectCode)} featured preview`} display="block" maxW="100%" maxH="min(65dvh, 520px)" objectFit="contain" />
            ) : (
              <Flex direction="column" align="center" gap="8px" color={COLORS.subtle}>
                <Icon as={LuImagePlus} boxSize="28px" />
                <Text fontFamily={FONT} fontSize="13px">Image preview</Text>
              </Flex>
            )}
          </Flex>
        </Flex>
      </Card>

      {data?.source !== SOURCE.DATABASE ? (
        <Text role="status" fontFamily={FONT} fontSize="13px" color={COLORS.muted}>
          {data?.source === SOURCE.NOT_CONFIGURED ? 'Connect the database to manage featured projects.' : 'Featured projects could not be loaded. Check the database connection.'}
        </Text>
      ) : null}

      <Text as="h3" fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="17px" fontWeight="700" color={COLORS.heading}>
        Current featured project
      </Text>
      {feature ? (
        <Card maxW="440px" p="0" overflow="hidden">
          <Image src={feature.imageUrl} alt={`${nameOf(feature.projectCode)} featured image`} w="full" h="180px" objectFit="cover" />
          <Box p="16px">
            <Text fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontWeight="700" fontSize="16px" color={COLORS.heading}>{nameOf(feature.projectCode)}</Text>
            <Flex align="flex-start" gap="6px" mt="5px" color={COLORS.muted}>
              <Icon as={LuMapPin} boxSize="15px" flexShrink={0} mt="2px" />
              <Text fontFamily={FONT} fontSize="13px" overflowWrap="anywhere">{feature.location}</Text>
            </Flex>
            <Flex mt="14px" gap="8px" flexWrap="wrap">
              <Button icon={LuPencil} disabled={Boolean(busy)} onClick={() => { chooseProject(feature.projectCode); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>Edit</Button>
              <Button icon={LuTrash2} disabled={Boolean(busy)} onClick={() => setRemoving(feature)}>Remove</Button>
            </Flex>
          </Box>
        </Card>
      ) : (
        <EmptyState
          icon={LuStar}
          title={canEdit ? 'No featured project yet' : 'Featured project unavailable'}
          hint={canEdit ? 'Choose a project, enter its location, and upload one image to feature it.' : 'The feature will appear when the database is available.'}
        />
      )}

      <Dialog.Root open={Boolean(removing)} onOpenChange={({ open }) => { if (!open && !busy) setRemoving(null) }} placement="center" size="sm">
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner px="16px">
            <Dialog.Content borderRadius="16px">
              <Dialog.Header><Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="18px">Remove featured project?</Dialog.Title></Dialog.Header>
              <Dialog.Body><Text fontFamily={FONT} fontSize="14px" color={COLORS.muted}>Remove {nameOf(removing?.projectCode)} and its featured image?</Text></Dialog.Body>
              <Dialog.Footer gap="8px" flexWrap="wrap">
                <Button disabled={Boolean(busy)} onClick={() => setRemoving(null)}>Cancel</Button>
                <Button icon={LuTrash2} loading={busy === 'delete'} disabled={Boolean(busy)} onClick={remove}>Remove</Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild top="12px" right="12px"><CloseButton size="sm" disabled={Boolean(busy)} /></Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Flex>
  )
}
