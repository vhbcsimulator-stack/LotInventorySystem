import { useState } from 'react'
import { Box, Dialog, Flex, Grid, Icon, Input, Menu, Portal, Spinner, Text } from '@chakra-ui/react'
import {
  LuChevronDown,
  LuClipboardCopy,
  LuEllipsisVertical,
  LuInbox,
  LuMail,
  LuMessageSquareText,
  LuPhone,
  LuRotateCcw,
  LuSearch,
  LuTrash2,
  LuUserX,
} from 'react-icons/lu'
import BrokersSkeleton from '@/components/skeletons/BrokersSkeleton'
import { Reveal } from '@/components/ui-kit/Reveal'
import EmptyState from '@/components/EmptyState'
import { Card } from '@/components/ui-kit/Card'
import RefreshButton from '@/components/ui-kit/RefreshButton'
import SourceNotice from '@/components/SourceNotice'
import IdPicture from '@/components/IdPicture'
import useApiQuery from '@/hooks/useApiQuery'
import { ACCOUNT_KINDS } from '@/data/brokersData'
import {
  ACCOUNT_PAGES,
  applicationForm,
  deleteApplication,
  fetchApplications,
  setApplicationStatus,
} from '@/data/applicationsData'
import { SUPABASE_ENV } from '@/data/supabase'
import { COLORS } from '@/theme/colors'
import { notifyFailed, notifySaved } from '@/lib/notify'

const FONT = 'Inter, system-ui, sans-serif'
const HEADING_FONT = "'Plus Jakarta Sans', Inter, system-ui, sans-serif"
const TINT = '#EEF3FF'

const TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

// The account kinds an application can become, in the order "Copy to form" lists them.
const KINDS = ['broker', 'regular_user', 'sales_agent']

// Category filters by the account type asked for; '' is an application that did not say.
const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'broker', label: 'Brokers' },
  { value: 'sales_agent', label: 'Sales Agents' },
  { value: 'regular_user', label: 'Regular Users' },
  { value: '', label: 'Not Stated' },
]

function CategoryChip({ active, children, onClick }) {
  return (
    <Box
      as="button"
      type="button"
      aria-pressed={active}
      onClick={onClick}
      h="32px"
      px="14px"
      borderRadius="full"
      border="1px solid"
      borderColor={active ? COLORS.activeBg : COLORS.border}
      bg={active ? TINT : COLORS.surface}
      color={active ? COLORS.activeBg : COLORS.heading}
      fontFamily={FONT}
      fontWeight="600"
      fontSize="13px"
      whiteSpace="nowrap"
      cursor="pointer"
      _hover={active ? undefined : { bg: COLORS.hoverBg }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
    >
      {children}
    </Box>
  )
}

// Applicant | Contact | Requested | Submitted | Actions. Narrow screens keep applicant and actions.
const TABLE_COLUMNS = {
  base: 'minmax(0, 1fr) auto',
  lg: 'minmax(0, 1.6fr) minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 0.8fr) 220px',
}

function fullName(application) {
  return `${application.firstName} ${application.lastName}`.trim() || application.email
}

function initials(application) {
  return `${application.firstName[0] ?? ''}${application.lastName[0] ?? ''}`.toUpperCase() || '?'
}

function formatDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function kindTitle(kind) {
  return ACCOUNT_KINDS[kind]?.title ?? 'Not stated'
}

function matchesSearch(application, search) {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [fullName(application), application.email, application.mobileNumber, application.message]
    .some((value) => value.toLowerCase().includes(needle))
}

function KindBadge({ kind }) {
  return (
    <Text
      as="span"
      display="inline-block"
      px="10px"
      py="3px"
      borderRadius="full"
      bg={kind ? TINT : COLORS.hoverBg}
      color={kind ? COLORS.activeBg : COLORS.muted}
      fontFamily={FONT}
      fontWeight="600"
      fontSize="12px"
      whiteSpace="nowrap"
    >
      {kindTitle(kind)}
    </Text>
  )
}

function Tab({ active, children, onClick }) {
  return (
    <Box
      as="button"
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      h="40px"
      px="18px"
      borderRadius="8px"
      bg={active ? COLORS.activeBg : TINT}
      color={active ? '#FFFFFF' : COLORS.heading}
      fontFamily={HEADING_FONT}
      fontWeight="600"
      fontSize="15px"
      whiteSpace="nowrap"
      cursor="pointer"
      transition="background-color 120ms ease"
      _hover={active ? undefined : { bg: COLORS.statusBg }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
    >
      {children}
    </Box>
  )
}

function HeaderCell({ children, ...rest }) {
  return (
    <Text
      role="columnheader"
      fontFamily={FONT}
      fontWeight="600"
      fontSize="12px"
      lineHeight="16px"
      letterSpacing="0.8px"
      textTransform="uppercase"
      color={COLORS.muted}
      {...rest}
    >
      {children}
    </Text>
  )
}

/**
 * "Copy to form": opens the create dialog of the chosen kind with the
 * applicant's details filled in. The kind they asked for is listed first.
 */
function CopyToFormMenu({ application, disabled, onCopy }) {
  const kinds = application.accountType
    ? [application.accountType, ...KINDS.filter((kind) => kind !== application.accountType)]
    : KINDS
  return (
    <Menu.Root onSelect={({ value }) => onCopy(value)}>
      <Menu.Trigger
        disabled={disabled}
        aria-label={`Copy ${fullName(application)}'s details to an account form`}
        display="flex"
        alignItems="center"
        gap="6px"
        h="32px"
        px="12px"
        borderRadius="8px"
        bg={COLORS.brandGreen}
        color="#FFFFFF"
        fontFamily={FONT}
        fontWeight="600"
        fontSize="13px"
        whiteSpace="nowrap"
        cursor="pointer"
        _hover={{ bg: '#00541F' }}
        _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      >
        <Icon as={LuClipboardCopy} boxSize="14px" />
        Copy to form
        <Icon as={LuChevronDown} boxSize="14px" />
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="230px">
            <Menu.ItemGroup>
              <Menu.ItemGroupLabel fontSize="11px" color={COLORS.muted}>
                Create account as
              </Menu.ItemGroupLabel>
              {kinds.map((kind) => (
                <Menu.Item key={kind} value={kind} fontSize="13px" justifyContent="space-between" gap="12px">
                  {ACCOUNT_KINDS[kind].title}
                  {kind === application.accountType ? (
                    <Text as="span" fontSize="11px" color={COLORS.brandGreen} fontWeight="600">
                      Requested
                    </Text>
                  ) : null}
                </Menu.Item>
              ))}
            </Menu.ItemGroup>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

/** Reject, move back to pending, or delete — behind a three-dot button like the other tables. */
function RowActions({ application, onAction }) {
  return (
    <Menu.Root onSelect={({ value }) => onAction(value)}>
      <Menu.Trigger
        aria-label={`More actions for ${fullName(application)}`}
        title="More actions"
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize="32px"
        borderRadius="8px"
        bg="transparent"
        color={COLORS.heading}
        cursor="pointer"
        flexShrink={0}
        _hover={{ bg: COLORS.hoverBg }}
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      >
        <Icon as={LuEllipsisVertical} boxSize="16px" />
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="190px">
            {application.status === 'pending' ? (
              <Menu.Item value="reject" gap="8px" fontSize="13px">
                <Icon as={LuUserX} boxSize="14px" />
                Reject
              </Menu.Item>
            ) : (
              <Menu.Item value="pending" gap="8px" fontSize="13px">
                <Icon as={LuRotateCcw} boxSize="14px" />
                Move back to pending
              </Menu.Item>
            )}
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

function ApplicationRow({ application, connected, onCopy, onAction }) {
  return (
    <Grid
      role="row"
      templateColumns={TABLE_COLUMNS}
      alignItems="center"
      gap="16px"
      px={{ base: '16px', md: '24px' }}
      py="18px"
      borderTop="1px solid"
      borderColor={COLORS.border}
      _first={{ borderTop: 'none' }}
      _hover={{ bg: COLORS.canvas }}
    >
      <Flex role="cell" align="flex-start" gap="12px" minW={0}>
        <Flex
          align="center"
          justify="center"
          boxSize="40px"
          flexShrink={0}
          borderRadius="10px"
          bg={TINT}
          color={COLORS.activeBg}
          fontFamily={HEADING_FONT}
          fontWeight="700"
          fontSize="14px"
        >
          {initials(application)}
        </Flex>
        <Box minW={0}>
          <Text fontFamily={HEADING_FONT} fontWeight="600" fontSize="15px" color={COLORS.heading} overflowWrap="anywhere">
            {fullName(application)}
          </Text>
          {application.message ? (
            <Flex mt="4px" align="flex-start" gap="6px" color={COLORS.muted}>
              <Icon as={LuMessageSquareText} boxSize="13px" mt="3px" flexShrink={0} />
              <Text fontFamily={FONT} fontSize="13px" lineHeight="18px" overflowWrap="anywhere" lineClamp={3}>
                {application.message}
              </Text>
            </Flex>
          ) : null}
          {application.idPicture ? (
            <Box mt="8px" w="160px" maxW="100%">
              <IdPicture value={application.idPicture} name={fullName(application)} h="96px" />
            </Box>
          ) : null}
          {/* Narrow screens drop the other columns, so their details ride here. */}
          <Box display={{ base: 'block', lg: 'none' }} mt="6px">
            <Text fontFamily={FONT} fontSize="13px" color={COLORS.muted} overflowWrap="anywhere">
              {application.email} · {application.mobileNumber || '—'}
            </Text>
            <Flex mt="6px" align="center" gap="8px" flexWrap="wrap">
              <KindBadge kind={application.accountType} />
              <Text fontFamily={FONT} fontSize="12.5px" color={COLORS.subtle}>
                {formatDate(application.createdAt)}
              </Text>
            </Flex>
          </Box>
        </Box>
      </Flex>
      <Box role="cell" minW={0} display={{ base: 'none', lg: 'block' }}>
        <Flex align="center" gap="6px" color={COLORS.heading}>
          <Icon as={LuMail} boxSize="13px" color={COLORS.subtle} flexShrink={0} />
          <Text fontFamily={FONT} fontSize="13.5px" overflowWrap="anywhere">
            {application.email}
          </Text>
        </Flex>
        <Flex mt="4px" align="center" gap="6px" color={COLORS.heading}>
          <Icon as={LuPhone} boxSize="13px" color={COLORS.subtle} flexShrink={0} />
          <Text fontFamily={FONT} fontSize="13.5px">
            {application.mobileNumber || '—'}
          </Text>
        </Flex>
      </Box>
      <Box role="cell" display={{ base: 'none', lg: 'block' }}>
        <KindBadge kind={application.accountType} />
        {application.status === 'approved' && application.approvedAs ? (
          <Text mt="6px" fontFamily={FONT} fontSize="12px" color={COLORS.brandGreen} fontWeight="600">
            Made as {kindTitle(application.approvedAs)}
          </Text>
        ) : null}
      </Box>
      <Text role="cell" display={{ base: 'none', lg: 'block' }} fontFamily={FONT} fontSize="13.5px" color={COLORS.heading}>
        {formatDate(application.createdAt)}
      </Text>
      <Flex role="cell" align="center" justify="flex-end" gap="6px">
        <CopyToFormMenu application={application} disabled={!connected} onCopy={onCopy} />
        {connected ? <RowActions application={application} onAction={onAction} /> : null}
      </Flex>
    </Grid>
  )
}

/** Confirms deleting an application for good. */
function DeleteDialog({ application, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false)

  async function handleDelete() {
    setBusy(true)
    try {
      await deleteApplication(application.id)
      notifySaved('Application deleted', `${fullName(application)}'s application was removed.`)
      onDeleted()
    } catch (err) {
      notifyFailed('Could not delete the application', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      role="alertdialog"
      open={Boolean(application)}
      onOpenChange={({ open }) => {
        if (!open && !busy) onClose()
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
                Delete application?
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Text fontFamily={FONT} fontSize="14px" lineHeight="22px" color={COLORS.muted}>
                The application from {application ? `${fullName(application)} (${application.email})` : ''} will be removed for good.
                Any account already made from it is kept.
              </Text>
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
                onClick={onClose}
              >
                Cancel
              </Box>
              <Flex
                as="button"
                type="button"
                align="center"
                gap="8px"
                h="40px"
                px="16px"
                borderRadius="8px"
                bg="#B91C1C"
                color="#FFFFFF"
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                cursor="pointer"
                disabled={busy}
                _hover={{ bg: '#991B1B' }}
                _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
                onClick={handleDelete}
              >
                {busy ? <Spinner size="sm" /> : null}
                Delete
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

/**
 * Account applications sent from the mobile app. "Copy to form" opens the
 * Brokers, Regular Users, or Sales Agents create dialog with the applicant's
 * details filled in; making the account there marks the application approved.
 */
export default function PendingApplicationsPage({ onNavigate }) {
  const { data, loading, reload, refresh } = useApiQuery(fetchApplications)
  const [tab, setTab] = useState('pending')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState(null)

  if (loading && !data) return <BrokersSkeleton />

  const connected = data?.source === 'database'
  const applications = data?.applications ?? []
  const counts = Object.fromEntries(TABS.map(({ value }) => [value, applications.filter((a) => a.status === value).length]))
  // Category counts are within the status tab being shown.
  const inTab = applications.filter((a) => a.status === tab)
  const categoryCounts = Object.fromEntries(
    CATEGORIES.map(({ value }) => [value, value === 'all' ? inTab.length : inTab.filter((a) => a.accountType === value).length]),
  )
  const inCategory = category === 'all' ? inTab : inTab.filter((a) => a.accountType === category)
  const visible = inCategory.filter((a) => matchesSearch(a, search))

  function copyToForm(application, kind) {
    onNavigate?.(ACCOUNT_PAGES[kind], {
      prefill: applicationForm(application),
      applicationId: application.id,
      idPicture: application.idPicture,
    })
  }

  async function handleAction(application, action) {
    if (action === 'delete') {
      setDeleting(application)
      return
    }
    const status = action === 'reject' ? 'rejected' : 'pending'
    try {
      await setApplicationStatus(application.id, status)
      notifySaved(
        status === 'rejected' ? 'Application rejected' : 'Application moved back to pending',
        `${fullName(application)}'s application is now ${status}.`,
      )
      reload()
    } catch (err) {
      notifyFailed('Could not update the application', err)
    }
  }

  return (
    <Reveal>
      <Flex direction="column" gap="24px">
        <Box maxW="720px">
          <Text
            as="h1"
            fontFamily={HEADING_FONT}
            fontWeight="700"
            fontSize={{ base: '26px', md: '36px' }}
            lineHeight="1.15"
            letterSpacing="-0.8px"
            color={COLORS.heading}
          >
            Pending Account Applications
          </Text>
          <Text mt="6px" maxW="600px" fontFamily={FONT} fontSize="14px" lineHeight="20px" color={COLORS.muted}>
            Sign-up forms sent from the app. Use Copy to form to open a broker, regular user, or sales agent account form with the
            applicant&apos;s details filled in — the application is approved once the account is created.
          </Text>
        </Box>

        {data ? <SourceNotice source={data.source} envVar={SUPABASE_ENV} /> : null}

        <Card as="section" p="0" overflow="hidden" aria-label="Account applications">
          <Flex align="center" justify="space-between" gap="12px" flexWrap="wrap" px={{ base: '16px', md: '18px' }} py="18px">
            <Flex role="tablist" aria-label="Application status" gap="8px" flexWrap="wrap">
              {TABS.map((option) => (
                <Tab key={option.value} active={tab === option.value} onClick={() => setTab(option.value)}>
                  {option.label} ({counts[option.value]})
                </Tab>
              ))}
            </Flex>
            <Flex align="center" gap="10px" flex={{ base: '1 1 100%', lg: '0 1 auto' }}>
              <Flex align="center" gap="10px" flex="1" minW={{ base: 0, lg: '320px' }} h="44px" px="14px" borderRadius="8px" bg={TINT}>
                <Icon as={LuSearch} boxSize="16px" color={COLORS.heading} />
                <Input
                  unstyled
                  flex="1"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, email, or mobile..."
                  aria-label="Search applications"
                  fontFamily={FONT}
                  fontSize="13.5px"
                  color={COLORS.heading}
                  bg={TINT}
                />
              </Flex>
              <RefreshButton onRefresh={refresh} label="Refresh applications" size="44px" />
            </Flex>
          </Flex>

          <Flex role="group" aria-label="Filter by account type" align="center" gap="8px" flexWrap="wrap" px={{ base: '16px', md: '18px' }} pb="16px">
            {CATEGORIES.filter((option) => option.value !== '' || categoryCounts[''] || category === '').map((option) => (
              <CategoryChip key={option.value || 'none'} active={category === option.value} onClick={() => setCategory(option.value)}>
                {option.label} ({categoryCounts[option.value]})
              </CategoryChip>
            ))}
          </Flex>

          <Box role="table" opacity={loading ? 0.6 : 1} transition="opacity 120ms ease">
            <Grid role="row" templateColumns={TABLE_COLUMNS} alignItems="center" gap="16px" px={{ base: '16px', md: '24px' }} py="14px" bg={TINT}>
              <HeaderCell>Applicant</HeaderCell>
              <HeaderCell display={{ base: 'none', lg: 'block' }}>Contact</HeaderCell>
              <HeaderCell display={{ base: 'none', lg: 'block' }}>Requested</HeaderCell>
              <HeaderCell display={{ base: 'none', lg: 'block' }}>Submitted</HeaderCell>
              <HeaderCell textAlign="right">Actions</HeaderCell>
            </Grid>

            {visible.length ? (
              visible.map((application) => (
                <ApplicationRow
                  key={application.id}
                  application={application}
                  connected={connected}
                  onCopy={(kind) => copyToForm(application, kind)}
                  onAction={(action) => handleAction(application, action)}
                />
              ))
            ) : (
              <Box p="16px">
                {search.trim() && inCategory.length ? (
                  <EmptyState icon={LuSearch} title="No matching applications" hint="Try a different name, email, or mobile number." />
                ) : (
                  <EmptyState
                    icon={LuInbox}
                    title={
                      category === 'all'
                        ? `No ${tab} applications`
                        : `No ${tab} ${CATEGORIES.find((option) => option.value === category).label.toLowerCase()} applications`
                    }
                    hint={tab === 'pending' && category === 'all' ? 'Sign-up forms sent from the app will show up here.' : undefined}
                  />
                )}
              </Box>
            )}
          </Box>
        </Card>
      </Flex>

      <DeleteDialog
        application={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null)
          reload()
        }}
      />
    </Reveal>
  )
}
