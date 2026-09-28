import { useMemo, useState } from 'react'
import {
  Box,
  CloseButton,
  Dialog,
  Flex,
  Icon,
  Input,
  Menu,
  NativeSelect,
  Portal,
  Spinner,
  Text,
  Textarea,
} from '@chakra-ui/react'
import {
  LuEllipsisVertical,
  LuListFilter,
  LuMegaphone,
  LuPencil,
  LuPlus,
  LuSearch,
  LuTrash2,
} from 'react-icons/lu'
import AnnouncementsSkeleton from '@/components/skeletons/AnnouncementsSkeleton'
import { Reveal } from '@/components/ui-kit/Reveal'
import EmptyState from '@/components/EmptyState'
import { Card } from '@/components/ui-kit/Card'
import RefreshButton from '@/components/ui-kit/RefreshButton'
import SourceNotice from '@/components/SourceNotice'
import useApiQuery from '@/hooks/useApiQuery'
import useAuth from '@/hooks/useAuth'
import useDebouncedValue from '@/hooks/useDebouncedValue'
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  updateAnnouncement,
} from '@/data/announcementsData'
import { SUPABASE_ENV } from '@/data/supabase'
import { COLORS } from '@/theme/colors'
import { notifyFailed, notifySaved } from '@/lib/notify'

const FONT = 'Inter, system-ui, sans-serif'
const HEADING_FONT = "'Plus Jakarta Sans', Inter, system-ui, sans-serif"

// Bodies longer than this get clamped with a "See more…" toggle.
const PREVIEW_CHARS = 320

// An announcement posted within this many days is marked New.
const NEW_DAYS = 7

/** Someone's initials for the avatar, or nothing when nobody is named. */
function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

/**
 * How long ago, in the words a reader would use. The exact date is still shown
 * beside it: "3 days ago" answers how fresh, the date answers which one.
 */
function relativeTime(iso) {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days < 0) return 'scheduled'
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`
  return `${Math.floor(days / 365)} year${days < 730 ? '' : 's'} ago`
}

const isNew = (iso) => {
  const then = new Date(iso)
  return !Number.isNaN(then.getTime()) && Date.now() - then.getTime() < NEW_DAYS * 86400000
}

function formatShortDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}

function PrimaryButton({ children, loading, ...rest }) {
  return (
    <Flex
      as="button"
      type="button"
      align="center"
      justify="center"
      gap="8px"
      h="40px"
      px="16px"
      borderRadius="8px"
      bg={COLORS.brandGreen}
      color="#FFFFFF"
      fontFamily={FONT}
      fontWeight="600"
      fontSize="14px"
      cursor="pointer"
      flexShrink={0}
      _hover={{ bg: '#00541F' }}
      _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </Flex>
  )
}

/**
 * Edit and delete for one announcement, behind a three-dot button — the same
 * pattern the lots table uses for its row actions, so an editor meets one kind of
 * menu across the portal and a reader still sees nothing at all.
 */
function ItemActions({ title, onEdit, onDelete }) {
  return (
    <Menu.Root
      onSelect={({ value }) => {
        if (value === 'edit') onEdit()
        else if (value === 'delete') onDelete()
      }}
    >
      <Menu.Trigger
        aria-label={`Actions for "${title}"`}
        title="More actions"
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize="32px"
        borderRadius="8px"
        bg="transparent"
        color={COLORS.muted}
        cursor="pointer"
        flexShrink={0}
        _hover={{ bg: COLORS.hoverBg }}
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      >
        <Icon as={LuEllipsisVertical} boxSize="16px" />
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="150px">
            <Menu.Item value="edit" gap="8px" fontSize="13px">
              <Icon as={LuPencil} boxSize="14px" />
              Edit
            </Menu.Item>
            <Menu.Item value="delete" gap="8px" fontSize="13px" color="#DC2626" _hover={{ bg: '#FDECEC', color: '#B91C1C' }}>
              <Icon as={LuTrash2} boxSize="14px" />
              Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

/**
 * One announcement, as a card.
 *
 * The old row put the date in a narrow column and the body in 12.5px grey, which
 * read as a log rather than as something written for someone. Here the notice
 * carries the card: who posted it and how long ago at the top, the title at
 * reading size, the body in the same measure as prose, and the actions tucked to
 * one side until the card is approached.
 */
function AnnouncementItem({ item, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const long = item.body.length > PREVIEW_CHARS
  const body = long && !expanded ? `${item.body.slice(0, PREVIEW_CHARS).trimEnd()}…` : item.body
  const badge = isNew(item.createdAt)

  return (
    <Card
      as="article"
      p={{ base: '18px', md: '22px' }}
      transition="box-shadow 140ms ease"
      _hover={{ boxShadow: '0 4px 16px rgba(15, 23, 42, 0.07)' }}
    >
      <Flex align="flex-start" gap="14px">
        {/* Initials rather than a stock avatar: the portal knows the name and
            nothing else about the person. */}
        <Flex
          align="center"
          justify="center"
          boxSize="38px"
          flexShrink={0}
          borderRadius="full"
          bg={COLORS.statusBg}
          color={COLORS.activeBg}
          fontFamily={HEADING_FONT}
          fontWeight="700"
          fontSize="13px"
        >
          {initials(item.author) || <Icon as={LuMegaphone} boxSize="16px" />}
        </Flex>

        <Box minW={0} flex="1">
          <Flex align="center" gap="8px" flexWrap="wrap">
            <Text fontFamily={FONT} fontWeight="600" fontSize="12.5px" color={COLORS.heading}>
              {item.author || 'VHBC'}
            </Text>
            <Text as="time" dateTime={item.createdAt} fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
              {relativeTime(item.createdAt)} · {formatShortDate(item.createdAt)}
            </Text>
            {badge ? (
              <Text
                px="7px"
                py="1px"
                borderRadius="full"
                bg={COLORS.statusBg}
                color={COLORS.activeBg}
                fontFamily={FONT}
                fontWeight="700"
                fontSize="10px"
                letterSpacing="0.4px"
                textTransform="uppercase"
              >
                New
              </Text>
            ) : null}
          </Flex>

          <Text
            as="h2"
            mt="6px"
            fontFamily={HEADING_FONT}
            fontWeight="700"
            fontSize={{ base: '17px', md: '19px' }}
            lineHeight="1.35"
            letterSpacing="-0.2px"
            color={COLORS.heading}
          >
            {item.title}
          </Text>

          {/* About 68 characters a line, which is where prose stops being a wall. */}
          <Text
            mt="8px"
            maxW="68ch"
            fontFamily={FONT}
            fontSize="14px"
            lineHeight="23px"
            color={COLORS.muted}
            whiteSpace="pre-line"
          >
            {body}
          </Text>
          {long ? (
            <Box
              as="button"
              type="button"
              mt="8px"
              fontFamily={FONT}
              fontWeight="600"
              fontSize="12.5px"
              color={COLORS.activeBg}
              cursor="pointer"
              _hover={{ textDecoration: 'underline' }}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? 'Show less' : 'Read more'}
            </Box>
          ) : null}
        </Box>

        {onEdit ? <ItemActions title={item.title} onEdit={onEdit} onDelete={onDelete} /> : null}
      </Flex>
    </Card>
  )
}

/** Posts a new announcement, or edits `announcement` when one is given. */
function PostAnnouncementDialog({ open, announcement, userId, onClose, onPosted }) {
  const [form, setForm] = useState({ title: announcement?.title ?? '', body: announcement?.body ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const canSubmit = form.title.trim() && form.body.trim() && !busy

  async function handleSubmit() {
    setBusy(true)
    setError('')
    try {
      if (announcement) await updateAnnouncement(announcement.id, form)
      else await createAnnouncement({ ...form, userId })
      setForm({ title: '', body: '' })
      notifySaved(announcement ? 'Announcement updated' : 'Announcement posted')
      onPosted()
    } catch (err) {
      setError(err.message)
      notifyFailed(announcement ? 'Could not update the announcement' : 'Could not post the announcement', err)
    } finally {
      setBusy(false)
    }
  }

  const label = (children) => (
    <Text mb="6px" fontFamily={FONT} fontWeight="500" fontSize="13px" color={COLORS.heading}>
      {children}
    </Text>
  )

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next && !busy) onClose()
      }}
      placement="center"
      size="md"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxH="calc(100dvh - 32px)">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px">
              <Dialog.Title fontFamily={HEADING_FONT} fontSize="18px" color={COLORS.heading}>
                {announcement ? 'Edit Announcement' : 'Post New Announcement'}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Flex direction="column" gap="14px">
                <Box>
                  {label('Title')}
                  <Input value={form.title} onChange={set('title')} placeholder="e.g. Q4 commission incentives" />
                </Box>
                <Box>
                  {label('Message')}
                  <Textarea value={form.body} onChange={set('body')} rows={7} placeholder="Write the memo…" />
                </Box>
                {error ? (
                  <Text role="alert" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                    {error}
                  </Text>
                ) : null}
              </Flex>
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px" flexWrap="wrap">
              <Box
                as="button"
                type="button"
                h="40px"
                px="18px"
                borderRadius="8px"
                bg={COLORS.hoverBg}
                color={COLORS.heading}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                cursor="pointer"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Box>
              <PrimaryButton onClick={handleSubmit} disabled={!canSubmit} loading={busy}>
                {announcement ? 'Save' : 'Post'}
              </PrimaryButton>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" disabled={busy} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

function DeleteAnnouncementDialog({ announcement, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function close() {
    setError('')
    onClose()
  }

  async function handleDelete() {
    setBusy(true)
    setError('')
    try {
      await deleteAnnouncement(announcement.id)
      notifySaved('Announcement deleted')
      onDeleted()
    } catch (err) {
      setError(err.message)
      notifyFailed('Could not delete the announcement', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      role="alertdialog"
      open={Boolean(announcement)}
      onOpenChange={({ open: next }) => {
        if (!next && !busy) close()
      }}
      placement="center"
      size="sm"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px">
              <Dialog.Title fontFamily={HEADING_FONT} fontSize="18px" color={COLORS.heading}>
                Delete announcement?
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Text fontFamily={FONT} fontSize="14px" lineHeight="22px" color={COLORS.muted}>
                “{announcement?.title}” will be permanently deleted. This cannot be undone.
              </Text>
              {error ? (
                <Text role="alert" mt="12px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                  {error}
                </Text>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px">
              <Box
                as="button"
                type="button"
                h="40px"
                px="18px"
                borderRadius="8px"
                bg={COLORS.hoverBg}
                color={COLORS.heading}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                cursor="pointer"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </Box>
              <PrimaryButton onClick={handleDelete} disabled={busy} loading={busy} bg="#B91C1C" _hover={{ bg: '#991B1B' }}>
                Delete
              </PrimaryButton>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

export default function AnnouncementsPage() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('newest')
  const [posting, setPosting] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const query = useMemo(() => ({ search: debouncedSearch, sort }), [debouncedSearch, sort])
  const { data, loading, reload, refresh } = useApiQuery(fetchAnnouncements, query)

  const announcements = data?.announcements ?? []
  const filtered = Boolean(debouncedSearch)

  return (
    <Flex direction="column" gap="20px">
      <Flex
        align={{ base: 'flex-start', md: 'flex-end' }}
        justify="space-between"
        gap="16px"
        direction={{ base: 'column', md: 'row' }}
      >
        <Box maxW="600px">
          <Text
            as="h1"
            fontFamily={HEADING_FONT}
            fontWeight="700"
            fontSize={{ base: '26px', md: '32px' }}
            lineHeight="1.2"
            letterSpacing="-0.6px"
            color={COLORS.heading}
          >
            Announcements &amp; Memo Hub
          </Text>
          <Text mt="8px" fontFamily={FONT} fontSize="14px" lineHeight="22px" color={COLORS.muted}>
            Company bulletins, policy updates, project launches, and commission incentives for brokers and sales
            partners.
          </Text>
          {/* How many and how fresh, so the page says something before it is read. */}
          {announcements.length ? (
            <Text mt="10px" fontFamily={FONT} fontSize="12.5px" color={COLORS.subtle}>
              {announcements.length} posted{filtered ? ' matching this search' : ''}
              {sort === 'newest' ? ` · latest ${relativeTime(announcements[0].createdAt)}` : ''}
            </Text>
          ) : null}
        </Box>
        <PrimaryButton onClick={() => setPosting(true)} disabled={data?.source !== 'database'}>
          <Icon as={LuPlus} boxSize="16px" />
          Post New Announcement
        </PrimaryButton>
      </Flex>

      {data ? <SourceNotice source={data.source} envVar={SUPABASE_ENV} /> : null}

      <Flex gap="12px" justify="space-between" align="center" flexWrap="wrap">
        <Flex
          align="center"
          gap="10px"
          flex="1"
          minW="220px"
          maxW="600px"
          h="40px"
          px="14px"
          bg={COLORS.surface}
          borderRadius="8px"
          boxShadow="0px 1px 2px rgba(0,0,0,0.05)"
        >
          <Icon as={LuSearch} boxSize="16px" color={COLORS.subtle} />
          <Input
            unstyled
            flex="1"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search memos, project advisories, policy updates..."
            aria-label="Search announcements"
            fontFamily={FONT}
            fontSize="13px"
            color={COLORS.heading}
          />
        </Flex>
        <Flex align="center" gap="8px">
        <Flex
          align="center"
          gap="6px"
          h="40px"
          px="12px"
          bg={COLORS.surface}
          borderRadius="8px"
          boxShadow="0px 1px 2px rgba(0,0,0,0.05)"
        >
          <Icon as={LuListFilter} boxSize="14px" color={COLORS.heading} />
          <NativeSelect.Root size="xs" variant="plain" width="auto">
            <NativeSelect.Field
              aria-label="Sort announcements"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              fontFamily={FONT}
              fontSize="12.5px"
              color={COLORS.heading}
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Flex>
        <RefreshButton onRefresh={refresh} label="Refresh announcements" size="40px" />
        </Flex>
      </Flex>


      {loading && !data ? (
        <AnnouncementsSkeleton />
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={LuMegaphone}
          title={filtered ? 'No matching announcements' : 'No announcements posted'}
          hint={filtered ? 'Try a different search.' : 'Published announcements will show up here, newest first.'}
        />
      ) : (
        /* Only once the skeleton has gone: the board itself arriving. */
        <Reveal>
          <Flex direction="column" gap="14px" opacity={loading ? 0.6 : 1} transition="opacity 120ms ease">
            {announcements.map((item) => (
              <AnnouncementItem
                key={item.id}
                item={item}
                onEdit={data?.source === 'database' ? () => setEditing(item) : undefined}
                onDelete={() => setDeleting(item)}
              />
            ))}
          </Flex>
        </Reveal>
      )}

      <PostAnnouncementDialog
        // Remount per announcement so the form starts from that row's values.
        key={editing?.id ?? 'new'}
        open={posting || Boolean(editing)}
        announcement={editing}
        userId={user?.id}
        onClose={() => {
          setPosting(false)
          setEditing(null)
        }}
        onPosted={() => {
          setPosting(false)
          setEditing(null)
          reload()
        }}
      />
      <DeleteAnnouncementDialog
        announcement={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null)
          reload()
        }}
      />
    </Flex>
  )
}
