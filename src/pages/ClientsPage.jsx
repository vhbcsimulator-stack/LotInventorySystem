import { useState } from 'react'
import { Box, CloseButton, Dialog, Drawer, Flex, Grid, Icon, Image, Input, Menu, Portal, Spinner, Text } from '@chakra-ui/react'
import {
  LuArrowDown,
  LuArrowUp,
  LuDownload,
  LuEllipsisVertical,
  LuPencil,
  LuSearch,
  LuStar,
  LuTrash2,
  LuTriangleAlert,
  LuUsers,
} from 'react-icons/lu'
import { ClientFormDialog } from '@/components/projects/ClientPicker'
import ClientsSkeleton from '@/components/skeletons/ClientsSkeleton'
import { Reveal } from '@/components/ui-kit/Reveal'
import EmptyState from '@/components/EmptyState'
import { Card } from '@/components/ui-kit/Card'
import Pagination from '@/components/ui-kit/Pagination'
import RefreshButton from '@/components/ui-kit/RefreshButton'
import ToolbarButton from '@/components/ui-kit/ToolbarButton'
import SourceNotice from '@/components/SourceNotice'
import useApiQuery from '@/hooks/useApiQuery'
import { CLIENTS_TABLE, deleteClient, fetchClients } from '@/data/clientsData'
import { notifyFailed, notifySaved } from '@/lib/notify'
import { contractTypeFromCsv, paymentTypeFromCsv } from '@/data/lotImportData'
import { SUPABASE_ENV } from '@/data/supabase'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'
const HEADING_FONT = "'Plus Jakarta Sans', Inter, system-ui, sans-serif"
const TINT = '#EEF3FF'
const PAGE_SIZE = 10
const TABLE_HIDDEN_COLUMNS = new Set(['project_code', 'status_note', 'last_activity_text', 'created_at'])

/*
 * What kind of value a column holds, from its name. The table's columns are
 * not fixed (see clientsData), so recognisable ones get a friendlier display
 * and anything else is shown as stored.
 */
const isNameColumn = (key) => /^(full_?name|client_?name|name|buyer_?name|customer_?name)$/i.test(key)
// A status or stage column groups the clients into tabs (e.g. the client_stage enum).
// A status *note* is free text, so it is shown plainly rather than as a coloured tag.
const isStatusColumn = (key) => /status|stage/i.test(key) && !/note|remark|comment/i.test(key)
const isPaymentColumn = (key) => /payment_?(type|terms|mode|scheme)|^payment$|mode_of_payment/i.test(key)
const isContractColumn = (key) => /cts|doas|contract_?type/i.test(key)
const isMoneyColumn = (key) => /price|tcp|amount|total|balance|down_?payment|^dp$|monthly/i.test(key)
const isDateColumn = (key) => /(_at|_date|^date)$/i.test(key)
const isEmailColumn = (key) => /^e?_?mail$|email/i.test(key)
const isPhoneColumn = (key) => /phone|mobile|contact_?(no|number)|cell/i.test(key)
// Shown inside the name cell rather than as columns of their own.
const isSubtitleColumn = (key) => /^(subtitle|tagline|headline)$/i.test(key)
const isAvatarColumn = (key) => /avatar|photo|picture|image_?url/i.test(key)
const isVipFlagColumn = (key) => /^is_?vip$/i.test(key)
const isVipTagColumn = (key) => /^vip_?(tag|label)$/i.test(key)

const TAG = {
  cash: { label: 'Cash', fg: '#166534', bg: '#E7F6EC' },
  installment: { label: 'Installment', fg: COLORS.activeBg, bg: TINT },
  cts: { label: 'CTS', fg: '#92400E', bg: '#FEF3E2', title: 'Contract to Sell' },
  doas: { label: 'DOAS', fg: '#166534', bg: '#E7F6EC', title: 'Deed of Absolute Sale' },
  unknown: { label: 'Unknown', fg: COLORS.subtle, bg: COLORS.hoverBg },
}

const VIP_TAG = { fg: '#92400E', bg: '#FEF3E2' }

/*
 * Stage/status colours by what the word means, checked in order, so a free-text
 * stage still reads at a glance. Anything unrecognised stays neutral.
 */
// const TONES = [
//   [/unreach|lost|cancel|drop|declin|lapse|inactive|backout|forfeit/i, { fg: '#B91C1C', bg: '#FDECEC', dot: '#DC2626' }],
//   [/closed|won|paid|complete|account|active|convert|booked/i, { fg: '#166534', bg: '#E7F6EC', dot: '#16A34A' }],
//   [/hot|warm|follow|negotiat|pending|nurtur|contacted|visit/i, { fg: '#92400E', bg: '#FEF3E2', dot: '#F59E0B' }],
//   [/cold|new|lead|prospect|inquir|open/i, { fg: '#1E40AF', bg: TINT, dot: '#3B82F6' }],
// ]

// function toneOf(value) {
//   const lot = LOT_STATUS[uiStatus(value)]
//   if (lot) return lot
//   return TONES.find(([pattern]) => pattern.test(String(value)))?.[1] ?? NEUTRAL_TAG
// }

/** "closed" -> "Closed", "for_reservation" -> "For Reservation". */
const titleCase = (value) => String(value).replace(/_/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase())

const blank = (value) => value === null || value === undefined || String(value).trim() === ''

const truthy = (value) => value === true || /^(true|yes|y|1)$/i.test(String(value ?? '').trim())

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** A cell's plain text: what search matches and the CSV holds. */
function plainValue(value) {
  if (blank(value)) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function initials(name) {
  const words = String(name ?? '').split(/[\s,]+/).filter(Boolean)
  return `${words[0]?.[0] ?? ''}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase()
}

function Tag({ style, children }) {
  return (
    <Text
      as="span"
      display="inline-flex"
      alignItems="center"
      gap="6px"
      px="9px"
      py="3px"
      borderRadius="full"
      bg={style.bg}
      color={style.fg}
      fontFamily={FONT}
      fontWeight="600"
      fontSize="12px"
      lineHeight="16px"
      whiteSpace="nowrap"
      title={style.title}
    >
      {style.dot ? <Box as="span" boxSize="6px" borderRadius="full" bg={style.dot} flexShrink={0} /> : null}
      {children ?? style.label}
    </Text>
  )
}

function VipTag({ label }) {
  return (
    <Tag style={VIP_TAG}>
      <Icon as={LuStar} boxSize="11px" />
      {label || 'VIP'}
    </Tag>
  )
}

/** One cell, displayed by what its column holds. `full` lets long text wrap (the details panel). */
function CellValue({ column, value, full = false }) {
  const { key } = column
  // A blank payment or CTS/DOAS reads as Unknown; a value not recognised is shown as stored.
  if (isPaymentColumn(key)) {
    const type = blank(value) ? 'unknown' : paymentTypeFromCsv(value)
    return type ? <Tag style={TAG[type]} /> : <Text as="span">{String(value)}</Text>
  }
  if (isContractColumn(key)) {
    const type = blank(value) ? 'unknown' : contractTypeFromCsv(value)
    return type ? <Tag style={TAG[type]} /> : <Text as="span">{String(value)}</Text>
  }
  if (blank(value)) return <Text as="span" color={COLORS.subtle}>—</Text>
  // if (isStatusColumn(key)) {
  //   const tone = toneOf(value)
  //   return <Tag style={tone}>{tone.label ?? titleCase(value)}</Tag>
  // }
  if (typeof value === 'boolean' || isVipFlagColumn(key)) {
    return truthy(value) ? <Tag style={TAG.cash}>Yes</Tag> : <Text as="span" color={COLORS.subtle}>No</Text>
  }
  if (typeof value === 'number' && isMoneyColumn(key)) {
    return (
      <Text as="span" fontVariantNumeric="tabular-nums">
        ₱{value.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
      </Text>
    )
  }
  if (typeof value === 'number') return <Text as="span" fontVariantNumeric="tabular-nums">{value.toLocaleString('en-PH')}</Text>
  if (isDateColumn(key)) return <Text as="span" whiteSpace="nowrap">{formatDate(value)}</Text>
  const text = plainValue(value)
  if (isPhoneColumn(key)) return <Text as="span" whiteSpace="nowrap" fontVariantNumeric="tabular-nums">{text}</Text>
  if (full) return <Text as="span" whiteSpace="pre-wrap" wordBreak="break-word">{text}</Text>
  // Long text stays on one line in the table; the full value is in the tooltip and the details panel.
  return (
    <Text as="span" display="block" maxW="260px" truncate title={text}>
      {text}
    </Text>
  )
}

/** Quote a CSV cell when it holds a comma, quote, or line break. */
function csvCell(value) {
  const str = String(value ?? '')
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function downloadClientsCsv(clients, columns, tab) {
  const rows = [
    columns.map((column) => column.key),
    ...clients.map((client) => columns.map((column) => plainValue(client[column.key]))),
  ]
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  // The byte-order mark makes Excel read accented names as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `clients-${tab}-${new Date().toISOString().slice(0, 10)}.csv`
  link.rel = 'noopener'
  // Firefox and Safari only follow the click for a link that is in the document.
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Blanks last, numbers by value, text naturally ("Lot 2" before "Lot 10"). */
function compareValues(a, b) {
  if (blank(a) && blank(b)) return 0
  if (blank(a)) return 1
  if (blank(b)) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function Pill({ active, dot, count, children, onClick }) {
  return (
    <Flex
      as="button"
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      align="center"
      gap="8px"
      h="36px"
      pl={dot ? '12px' : '14px'}
      pr="6px"
      borderRadius="8px"
      bg={active ? COLORS.activeBg : TINT}
      color={active ? '#FFFFFF' : COLORS.heading}
      fontFamily={HEADING_FONT}
      fontWeight="600"
      fontSize="14px"
      whiteSpace="nowrap"
      cursor="pointer"
      transition="background-color 120ms ease"
      _hover={active ? undefined : { bg: COLORS.statusBg }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
    >
      {dot ? <Box as="span" boxSize="8px" borderRadius="full" bg={dot} boxShadow={active ? '0 0 0 2px #FFFFFF' : undefined} /> : null}
      {children} ({count})
    </Flex>
  )
}

/** The client's photo when the row has a working one, their initials otherwise. */
function Avatar({ name, src, size = '38px', fontSize = '13px' }) {
  const [broken, setBroken] = useState(false)
  const url = !blank(src) && !broken ? String(src) : null
  return (
    <Flex
      align="center"
      justify="center"
      boxSize={size}
      flexShrink={0}
      borderRadius="full"
      overflow="hidden"
      bg={TINT}
      color={COLORS.activeBg}
      fontFamily={HEADING_FONT}
      fontWeight="700"
      fontSize={fontSize}
    >
      {url ? <Image src={url} alt="" boxSize="100%" objectFit="cover" onError={() => setBroken(true)} /> : initials(name) || '?'}
    </Flex>
  )
}

/** The name, with the avatar, VIP badge, and subtitle (or email) folded in. */
function NameCell({ client, parts }) {
  const name = plainValue(client[parts.name]) || '—'
  const secondary = [parts.subtitle, parts.email].map((key) => key && plainValue(client[key])).find(Boolean)
  const vip = parts.vipFlag && truthy(client[parts.vipFlag])
  return (
    <Flex align="center" gap="12px" minW="220px" maxW="320px">
      <Avatar name={name} src={parts.avatar && client[parts.avatar]} />
      <Box minW={0}>
        <Flex align="center" gap="6px">
          <Text fontFamily={HEADING_FONT} fontWeight="600" color={COLORS.heading} truncate title={name}>
            {name}
          </Text>
          {vip ? <VipTag label={parts.vipTag && plainValue(client[parts.vipTag])} /> : null}
        </Flex>
        {secondary ? (
          <Text mt="1px" fontSize="12.5px" color={COLORS.subtle} truncate title={secondary}>
            {secondary}
          </Text>
        ) : null}
      </Box>
    </Flex>
  )
}

function LinkValue({ href, external, children }) {
  return (
    <Box
      as="a"
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      color={COLORS.activeBg}
      wordBreak="break-all"
      _hover={{ textDecoration: 'underline' }}
    >
      {children}
    </Box>
  )
}

/** A detail row's value; emails, phones and links are clickable. */
function DetailValue({ column, value }) {
  const text = plainValue(value)
  if (text && isEmailColumn(column.key)) return <LinkValue href={`mailto:${text}`}>{text}</LinkValue>
  if (text && isPhoneColumn(column.key)) return <LinkValue href={`tel:${text.replace(/[^\d+]/g, '')}`}>{text}</LinkValue>
  if (text && /^https?:\/\//i.test(text)) return <LinkValue href={text} external>{text}</LinkValue>
  return <CellValue column={column} value={value} full />
}

/** Every column of one client, blanks included, in a side panel. */
function ClientDrawer({ client, columns, parts, onClose }) {
  const name = client ? plainValue(client[parts.name]) || 'Client' : ''
  const subtitle = client && parts.subtitle ? plainValue(client[parts.subtitle]) : ''
  const status = client && parts.status ? client[parts.status] : null
  const vip = client && parts.vipFlag && truthy(client[parts.vipFlag])
  return (
    <Drawer.Root open={Boolean(client)} onOpenChange={({ open }) => !open && onClose()} placement="end" size="md">
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content bg={COLORS.surface}>
            {client ? (
              <>
                <Drawer.Header borderBottom="1px solid" borderColor={COLORS.border} py="20px" display="block">
                  <Flex align="center" gap="14px" pr="32px">
                    <Avatar name={name} src={parts.avatar && client[parts.avatar]} size="52px" fontSize="17px" />
                    <Box minW={0}>
                      <Drawer.Title fontFamily={HEADING_FONT} fontSize="19px" lineHeight="1.3" color={COLORS.heading}>
                        {name}
                      </Drawer.Title>
                      {subtitle ? (
                        <Drawer.Description mt="2px" fontFamily={FONT} fontSize="13px" color={COLORS.muted}>
                          {subtitle}
                        </Drawer.Description>
                      ) : null}
                      {!blank(status) || vip ? (
                        <Flex mt="8px" gap="6px" flexWrap="wrap">
                          {!blank(status) ? <CellValue column={{ key: parts.status }} value={status} /> : null}
                          {vip ? <VipTag label={parts.vipTag && plainValue(client[parts.vipTag])} /> : null}
                        </Flex>
                      ) : null}
                    </Box>
                  </Flex>
                </Drawer.Header>
                <Drawer.CloseTrigger asChild top="16px" right="16px">
                  <CloseButton size="sm" />
                </Drawer.CloseTrigger>
                <Drawer.Body py="4px" fontFamily={FONT} fontSize="14px">
                  {columns.map((column) => (
                    <Grid
                      key={column.key}
                      templateColumns={{ base: '1fr', sm: '140px 1fr' }}
                      gap={{ base: '2px', sm: '16px' }}
                      py="12px"
                      borderBottom="1px solid"
                      borderColor={COLORS.border}
                      _last={{ borderBottom: 'none' }}
                    >
                      <Text pt="2px" fontSize="11.5px" fontWeight="600" letterSpacing="0.5px" textTransform="uppercase" color={COLORS.subtle}>
                        {column.label}
                      </Text>
                      <Box minW={0} color={COLORS.heading}>
                        <DetailValue column={column} value={client[column.key]} />
                      </Box>
                    </Grid>
                  ))}
                </Drawer.Body>
              </>
            ) : null}
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  )
}

/** Row actions behind a three-dot button, like the brokers' and lots' menus. */
function ClientActions({ name, onEdit, onDelete }) {
  return (
    <Menu.Root onSelect={({ value }) => (value === 'edit' ? onEdit() : value === 'delete' ? onDelete() : null)}>
      <Menu.Trigger
        aria-label={`More actions for ${name || 'client'}`}
        title="More actions"
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize="32px"
        borderRadius="8px"
        bg="transparent"
        color={COLORS.heading}
        cursor="pointer"
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

/** Confirms, then permanently deletes one client. */
function DeleteClientDialog({ client, name, onClose, onDeleted }) {
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
      await deleteClient(client.id)
      notifySaved('Client deleted', `${name || 'The client'} was removed from Clients.`)
      onDeleted()
    } catch (err) {
      setError(err.message)
      notifyFailed('Could not delete the client', err)
    } finally {
      setBusy(false)
    }
  }

  const button = { h: '40px', px: '18px', borderRadius: '8px', fontFamily: FONT, fontWeight: '600', fontSize: '14px', cursor: 'pointer' }
  return (
    <Dialog.Root role="alertdialog" open={Boolean(client)} onOpenChange={({ open }) => !open && !busy && close()} placement="center" size="sm">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px">
              <Dialog.Title fontFamily={HEADING_FONT} fontSize="18px" color={COLORS.heading}>
                Delete client?
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Text fontFamily={FONT} fontSize="14px" lineHeight="22px" color={COLORS.muted}>
                {name || 'This client'} will be removed from Clients, and from their broker&apos;s app. This cannot be
                undone. Lots reserved for or sold to them keep the client&apos;s name.
              </Text>
              {error ? (
                <Text role="alert" mt="12px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                  {error}
                </Text>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px">
              <Box as="button" type="button" {...button} bg={COLORS.hoverBg} color={COLORS.heading} disabled={busy} onClick={close}>
                Cancel
              </Box>
              <Flex
                as="button"
                type="button"
                align="center"
                gap="8px"
                {...button}
                bg="#DC2626"
                color="#FFFFFF"
                _hover={{ bg: '#B91C1C' }}
                cursor={busy ? 'progress' : 'pointer'}
                onClick={busy ? undefined : handleDelete}
              >
                {busy ? <Spinner size="xs" /> : <Icon as={LuTrash2} boxSize="14px" />}
                {busy ? 'Deleting…' : 'Delete client'}
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

export default function ClientsPage() {
  const { data, loading, refresh, reload } = useApiQuery(fetchClients)
  // The client being edited or deleted from its row's menu.
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState(null)
  const [page, setPage] = useState(1)
  const [openKey, setOpenKey] = useState(null)

  if (loading && !data) return <ClientsSkeleton />

  const clients = data?.clients ?? []
  const columns = data?.columns ?? []
  const findKey = (test) => columns.find((column) => test(column.key))?.key
  const nameKey = findKey(isNameColumn)
  const statusKey = findKey(isStatusColumn)
  const parts = {
    name: nameKey,
    status: statusKey,
    subtitle: findKey(isSubtitleColumn),
    email: findKey(isEmailColumn),
    avatar: findKey(isAvatarColumn),
    vipFlag: findKey(isVipFlagColumn),
    vipTag: findKey(isVipTagColumn),
  }
  /*
   * The table leads with the name, folds the subtitle/email/avatar/VIP columns
   * into it, and leaves out columns no client has filled in (a VIP flag that is
   * never true counts as empty). Project Code, Status Note, Last Activity Text,
   * and Date Added stay in the details panel and CSV but not the table.
   */
  const folded = nameKey ? [parts.subtitle, parts.email, parts.avatar, parts.vipFlag, parts.vipTag].filter(Boolean) : []
  const filled = (key) => clients.some((client) => (isVipFlagColumn(key) ? truthy(client[key]) : !blank(client[key])))
  const tableColumns = [
    ...columns.filter((column) => column.key === nameKey),
    ...columns.filter(
      (column) =>
        column.key !== nameKey &&
        !folded.includes(column.key) &&
        !TABLE_HIDDEN_COLUMNS.has(column.key.toLowerCase()) &&
        (!clients.length || filled(column.key)),
    ),
  ]
  const openClient = openKey ? clients.find((client) => client._key === openKey) ?? null : null

  const kindOf = (client) => (statusKey ? plainValue(client[statusKey]).toLowerCase() : '')
  // One tab per status/stage value the rows hold, in the order they first appear.
  const tabs = statusKey
    ? [
        { value: 'all', label: 'All Clients' },
        ...[...new Set(clients.map(kindOf).filter(Boolean))].map((value) => ({ value, label: titleCase(value) })),
      ]
    : []
  const hasTabs = tabs.length > 1
  const activeTab = hasTabs && tabs.some((option) => option.value === tab) ? tab : 'all'
  const countOf = (value) => (value === 'all' ? clients.length : clients.filter((client) => kindOf(client) === value).length)

  const needle = search.trim().toLowerCase()
  const matching = clients
    .filter((client) => activeTab === 'all' || kindOf(client) === activeTab)
    .filter((client) => !needle || columns.some((column) => plainValue(client[column.key]).toLowerCase().includes(needle)))
  if (sort) matching.sort((a, b) => compareValues(a[sort.key], b[sort.key]) * (sort.dir === 'asc' ? 1 : -1))
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  // A search, tab switch, or refresh can shrink the list below the page being shown.
  const currentPage = Math.min(page, pageCount)
  const visible = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  /** Header click: ascending, then descending, then back to the table's own order. */
  function toggleSort(key) {
    setSort((prev) => (prev?.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : null))
    setPage(1)
  }

  // The name column stays in view while the rest of the table scrolls sideways.
  const cellProps = (key) =>
    key === nameKey
      ? { position: 'sticky', left: 0, zIndex: 1, bg: 'inherit', boxShadow: `inset -1px 0 0 ${COLORS.border}`, pl: { base: '16px', md: '24px' } }
      : {}

  return (
    <Reveal>
      <Flex direction="column" gap="20px">
        <Box maxW="640px">
          <Text
            as="h1"
            fontFamily={HEADING_FONT}
            fontWeight="700"
            fontSize={{ base: '26px', md: '32px' }}
            lineHeight="1.2"
            letterSpacing="-0.6px"
            color={COLORS.heading}
          >
            Clients
          </Text>
          <Text mt="8px" fontFamily={FONT} fontSize="14px" lineHeight="22px" color={COLORS.muted}>
            Every client in the {CLIENTS_TABLE} table. Select a client to see all of their details.
          </Text>
        </Box>

        {data ? <SourceNotice source={data.source} envVar={SUPABASE_ENV} /> : null}
        {data?.error ? (
          <Flex gap="8px" p="12px" borderRadius="10px" bg="#FDECEC" align="flex-start">
            <Icon as={LuTriangleAlert} color="#B91C1C" mt="2px" flexShrink={0} />
            <Text fontFamily={FONT} fontSize="13px" color="#7F1D1D">
              The {CLIENTS_TABLE} table could not be read: {data.error}
            </Text>
          </Flex>
        ) : null}

        <Flex gap="12px" justify="space-between" align="center" flexWrap="wrap">
          <Flex
            align="center"
            gap="10px"
            flex="1"
            minW="220px"
            maxW="480px"
            h="40px"
            px="14px"
            bg={COLORS.surface}
            border="1px solid"
            borderColor={COLORS.border}
            borderRadius="8px"
            transition="border-color 120ms ease, box-shadow 120ms ease"
            _focusWithin={{ borderColor: COLORS.activeBg, boxShadow: `0 0 0 3px ${TINT}` }}
          >
            <Icon as={LuSearch} boxSize="16px" color={COLORS.subtle} />
            <Input
              unstyled
              flex="1"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="Search by name, phone, project, broker..."
              aria-label="Search clients"
              fontFamily={FONT}
              fontSize="13px"
              color={COLORS.heading}
            />
          </Flex>
          <ToolbarButton
            icon={LuDownload}
            onClick={() => downloadClientsCsv(matching, columns, activeTab)}
            disabled={!matching.length}
            _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
          >
            Export CSV
          </ToolbarButton>
        </Flex>

        <Card as="section" p="0" overflow="hidden" aria-label="Clients">
          <Flex align="center" justify="space-between" gap="12px" flexWrap="wrap" px={{ base: '16px', md: '24px' }} py="16px">
            {hasTabs ? (
              <Flex role="tablist" aria-label="Client status" gap="8px" flexWrap="wrap">
                {tabs.map((option) => (
                  <Pill
                    key={option.value}
                    active={option.value === activeTab}
                    dot={option.dot}
                    count={countOf(option.value)}
                    onClick={() => {
                      setTab(option.value)
                      setPage(1)
                    }}
                  >
                    {option.label}
                  </Pill>
                ))}
              </Flex>
            ) : (
              <Text as="h2" fontFamily={HEADING_FONT} fontWeight="700" fontSize="17px" color={COLORS.heading}>
                All Clients ({clients.length})
              </Text>
            )}
            <RefreshButton onRefresh={refresh} label="Refresh clients" size="32px" />
          </Flex>

          {visible.length ? (
            <Box overflowX="auto" opacity={loading ? 0.6 : 1} transition="opacity 120ms ease">
              <Box as="table" w="100%" fontFamily={FONT} fontSize="13.5px" style={{ borderCollapse: 'collapse' }}>
                <Box as="thead" bg={TINT}>
                  <tr>
                    {tableColumns.map((column) => {
                      const sorted = sort?.key === column.key ? sort.dir : null
                      return (
                        <Box
                          as="th"
                          key={column.key}
                          aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                          textAlign="left"
                          px="16px"
                          py="11px"
                          whiteSpace="nowrap"
                          {...cellProps(column.key)}
                        >
                          <Flex
                            as="button"
                            type="button"
                            align="center"
                            gap="4px"
                            onClick={() => toggleSort(column.key)}
                            fontWeight="600"
                            fontSize="11.5px"
                            letterSpacing="0.6px"
                            textTransform="uppercase"
                            color={sorted ? COLORS.activeBg : COLORS.subtle}
                            cursor="pointer"
                            _hover={{ color: COLORS.heading }}
                            _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
                          >
                            {column.key === nameKey ? 'Client' : column.label}
                            {sorted ? <Icon as={sorted === 'asc' ? LuArrowUp : LuArrowDown} boxSize="12px" /> : null}
                          </Flex>
                        </Box>
                      )
                    })}
                    <Box as="th" w="48px" px="8px">
                      <Box as="span" srOnly>
                        Actions
                      </Box>
                    </Box>
                  </tr>
                </Box>
                <tbody>
                  {visible.map((client) => (
                    <Box
                      as="tr"
                      key={client._key}
                      tabIndex={0}
                      aria-label={`View ${plainValue(client[nameKey]) || 'client'}`}
                      onClick={() => setOpenKey(client._key)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setOpenKey(client._key)
                        }
                      }}
                      bg={COLORS.surface}
                      borderTop="1px solid"
                      borderColor={COLORS.border}
                      cursor="pointer"
                      transition="background-color 100ms ease"
                      _hover={{ bg: COLORS.canvas }}
                      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '-2px' }}
                    >
                      {tableColumns.map((column) => (
                        <Box
                          as="td"
                          key={column.key}
                          px="16px"
                          py="12px"
                          color={COLORS.heading}
                          verticalAlign="middle"
                          whiteSpace="nowrap"
                          {...cellProps(column.key)}
                        >
                          {column.key === nameKey ? (
                            <NameCell client={client} parts={parts} />
                          ) : (
                            <CellValue column={column} value={client[column.key]} />
                          )}
                        </Box>
                      ))}
                      {/* The menu acts on the row without also opening its details. */}
                      <Box
                        as="td"
                        px="8px"
                        py="8px"
                        verticalAlign="middle"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <ClientActions
                          name={plainValue(client[nameKey])}
                          onEdit={() => setEditing(client)}
                          onDelete={() => setDeleting(client)}
                        />
                      </Box>
                    </Box>
                  ))}
                </tbody>
              </Box>
            </Box>
          ) : (
            <Box p="16px">
              {clients.length ? (
                <EmptyState icon={LuSearch} title="No matching clients" hint="Try a different search or tab." />
              ) : (
                <EmptyState
                  icon={LuUsers}
                  title="No clients yet"
                  hint={`Rows added to the ${CLIENTS_TABLE} table in Supabase show up here. If the table has rows but none appear, its row-level security may not let signed-in users read it.`}
                />
              )}
            </Box>
          )}

          {matching.length ? (
            <Flex
              align="center"
              justify="space-between"
              gap="12px"
              flexWrap="wrap"
              px={{ base: '16px', md: '24px' }}
              py="14px"
              borderTop="1px solid"
              borderColor={COLORS.border}
            >
              <Text fontFamily={FONT} fontSize="13px" color={COLORS.muted}>
                Showing {visible.length} of {matching.length} {matching.length === 1 ? 'client' : 'clients'}
              </Text>
              <Pagination page={currentPage} pageCount={pageCount} onChange={setPage} />
            </Flex>
          ) : null}
        </Card>
      </Flex>

      <ClientDrawer client={openClient} columns={columns} parts={parts} onClose={() => setOpenKey(null)} />
      {editing ? (
        <ClientFormDialog
          key={editing._key}
          open
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      ) : null}
      <DeleteClientDialog
        client={deleting}
        name={deleting ? plainValue(deleting[nameKey]) : ''}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          if (deleting?._key === openKey) setOpenKey(null)
          setDeleting(null)
          reload()
        }}
      />
    </Reveal>
  )
}
