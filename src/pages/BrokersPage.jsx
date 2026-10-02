import { useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Grid, Icon, Input, Menu, NativeSelect, Portal, Spinner, Text } from '@chakra-ui/react'
import {
  LuAward,
  LuCheck,
  LuCopy,
  LuDownload,
  LuEllipsisVertical,
  LuKeyRound,
  LuMail,
  LuPhone,
  LuSearch,
  LuSlidersHorizontal,
  LuUserMinus,
  LuUserPlus,
  LuUsers,
} from 'react-icons/lu'
import BrokersSkeleton from '@/components/skeletons/BrokersSkeleton'
import { Reveal } from '@/components/ui-kit/Reveal'
import EmptyState from '@/components/EmptyState'
import { Card } from '@/components/ui-kit/Card'
import RefreshButton from '@/components/ui-kit/RefreshButton'
import ToolbarButton from '@/components/ui-kit/ToolbarButton'
import SourceNotice from '@/components/SourceNotice'
import useApiQuery from '@/hooks/useApiQuery'
import { ACCOUNT_KINDS, createAccount, deleteAccount, fetchAccounts, validateBroker } from '@/data/brokersData'
import { SUPABASE_ENV } from '@/data/supabase'
import { COLORS } from '@/theme/colors'
import { notifyFailed, notifySaved } from '@/lib/notify'

const FONT = 'Inter, system-ui, sans-serif'
const HEADING_FONT = "'Plus Jakarta Sans', Inter, system-ui, sans-serif"
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

const PAGE_SIZE = 10
const TOP_PERFORMERS = 10
const TINT = '#EEF3FF'

// Profile | Lots sold | Total TCP | Actions. Narrow screens keep profile and actions.
const TABLE_COLUMNS = { base: 'minmax(0, 1fr) auto', md: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.2fr) 150px' }

// Spotlight styling by rank: #1 green, #2 blue, #3 slate.
const RANKS = [
  { accent: COLORS.brandGreen, figure: COLORS.brandGreen },
  { accent: COLORS.activeBg, figure: COLORS.activeBg },
  { accent: '#475569', figure: COLORS.heading },
]

const SORTS = [
  { value: 'tcp', label: 'Highest TCP (Total Volume)', compare: (a, b) => b.totalTcp - a.totalTcp || b.lotsSold - a.lotsSold },
  { value: 'lots', label: 'Most Lots Sold', compare: (a, b) => b.lotsSold - a.lotsSold || b.totalTcp - a.totalTcp },
  { value: 'name', label: 'Name (A–Z)', compare: (a, b) => fullName(a).localeCompare(fullName(b)) },
  { value: 'newest', label: 'Newest Accounts', compare: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) },
]

const EMPTY_FORM = { firstName: '', lastName: '', mobileNumber: '', email: '' }

// autoComplete is off: these fields describe the broker, not the admin filling
// the form in, so the browser should not offer the admin's own details.
const FIELDS = [
  { key: 'firstName', label: 'First Name', placeholder: 'e.g. Juan' },
  { key: 'lastName', label: 'Last Name', placeholder: 'e.g. Dela Cruz' },
  { key: 'mobileNumber', label: 'Mobile Number', placeholder: 'e.g. 0917 123 4567', type: 'tel', inputMode: 'tel' },
  { key: 'email', label: 'Email Address', placeholder: 'e.g. juan@example.com', type: 'email' },
]

function fullName(broker) {
  return `${broker.firstName} ${broker.lastName}`.trim()
}

function initials(broker) {
  return `${broker.firstName[0] ?? ''}${broker.lastName[0] ?? ''}`.toUpperCase()
}

function formatShortDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}

function formatPeso(value) {
  return `₱${Math.round(value).toLocaleString('en-PH')}`
}

/** ₱32.85M / ₱850K for the spotlight's large figures. */
function formatPesoShort(value) {
  if (value >= 1e6) return `₱${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `₱${(value / 1e3).toFixed(0)}K`
  return formatPeso(value)
}

function lotsLabel(count) {
  return `${count} ${count === 1 ? 'lot' : 'lots'}`
}

function matchesSearch(broker, search) {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [fullName(broker), broker.email, broker.mobileNumber].some((value) => value.toLowerCase().includes(needle))
}

/** Brokers with at least one sale, best TCP first. */
function rankProducers(brokers) {
  return brokers.filter((broker) => broker.lotsSold > 0).sort(SORTS[0].compare)
}

/** Page numbers with 'gap' markers, e.g. page 5 of 20 -> [1, 'gap', 4, 5, 6, 'gap', 20]. */
function pageItems(page, count) {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1)
  const start = Math.max(2, Math.min(page - 1, count - 4))
  const end = Math.min(count - 1, Math.max(page + 1, 4))
  const items = [1]
  if (start > 2) items.push('gap')
  for (let n = start; n <= end; n += 1) items.push(n)
  if (end < count - 1) items.push('gap')
  items.push(count)
  return items
}

/** Quote a CSV cell when it holds a comma, quote, or line break. */
function csvCell(value) {
  const str = String(value ?? '')
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function downloadBrokersCsv(brokers, copy) {
  const rows = [
    ['first_name', 'last_name', 'email', 'mobile_number', 'lots_sold', 'total_tcp', 'created_at'],
    ...brokers.map((b) => [b.firstName, b.lastName, b.email, b.mobileNumber, b.lotsSold, Math.round(b.totalTcp), b.createdAt]),
  ]
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  // The byte-order mark makes Excel read accented names as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${copy.plural.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
  link.rel = 'noopener'
  // Firefox and Safari only follow the click for a link that is in the document.
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Avatar({ broker, size = '44px', fontSize = '14px', accent, ...rest }) {
  return (
    <Flex
      align="center"
      justify="center"
      boxSize={size}
      flexShrink={0}
      borderRadius="10px"
      bg={TINT}
      color={accent ?? COLORS.activeBg}
      border={accent ? '2px solid' : undefined}
      borderColor={accent}
      fontFamily={HEADING_FONT}
      fontWeight="700"
      fontSize={fontSize}
      {...rest}
    >
      {initials(broker)}
    </Flex>
  )
}

function Field({ field, value, error, onChange, disabled }) {
  const id = `broker-${field.key}`
  return (
    <Box flex="1" minW={0}>
      <Text as="label" htmlFor={id} display="block" mb="6px" fontFamily={FONT} fontWeight="500" fontSize="13px" color={COLORS.heading}>
        {field.label}
      </Text>
      <Input
        id={id}
        type={field.type ?? 'text'}
        inputMode={field.inputMode}
        autoComplete="off"
        placeholder={field.placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        borderColor={error ? '#DC2626' : undefined}
      />
      {error ? (
        <Text id={`${id}-error`} mt="4px" fontFamily={FONT} fontSize="12px" color="#B91C1C">
          {error}
        </Text>
      ) : null}
    </Box>
  )
}

/** A value shown for copying: label, monospace value, and a Copy button that confirms. */
function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      notifyFailed('Could not copy', new Error('Select the text and copy it instead.'))
    }
  }

  return (
    <Box>
      <Text fontFamily={FONT} fontWeight="500" fontSize="12px" color={COLORS.muted}>
        {label}
      </Text>
      <Flex mt="4px" align="center" gap="8px" h="40px" pl="12px" pr="4px" bg={COLORS.surface} border="1px solid" borderColor={COLORS.border} borderRadius="8px">
        <Text flex="1" minW={0} fontFamily={MONO_FONT} fontSize="14px" color={COLORS.heading} truncate userSelect="all">
          {value}
        </Text>
        <Flex
          as="button"
          type="button"
          align="center"
          gap="6px"
          h="32px"
          px="10px"
          flexShrink={0}
          borderRadius="6px"
          fontFamily={FONT}
          fontWeight="600"
          fontSize="12.5px"
          color={copied ? COLORS.activeBg : COLORS.heading}
          cursor="pointer"
          _hover={{ bg: COLORS.hoverBg }}
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={copy}
        >
          <Icon as={copied ? LuCheck : LuCopy} boxSize="14px" />
          {copied ? 'Copied' : 'Copy'}
        </Flex>
      </Flex>
    </Box>
  )
}

/**
 * The sign-in details of the account just created. The password is generated by
 * the server and exists nowhere else the portal can read, so this is the only
 * time it is shown.
 */
function CreatedCredentials({ account, copy, onDone }) {
  return (
    <Box role="status" p="16px" borderRadius="10px" bg={COLORS.statusBg} border="1px solid" borderColor={COLORS.border}>
      <Flex align="center" gap="8px">
        <Icon as={LuKeyRound} boxSize="16px" color={COLORS.activeBg} />
        <Text fontFamily={HEADING_FONT} fontWeight="700" fontSize="15px" color={COLORS.heading}>
          Account created for {account.name}
        </Text>
      </Flex>
      <Text mt="6px" fontFamily={FONT} fontSize="13px" lineHeight="20px" color={COLORS.muted}>
        The sign-in details were emailed to {account.email}, asking the {copy.singular} to change the temporary password after
        signing in. If the email does not arrive, give them the password below. It is shown only once.
      </Text>
      <Flex mt="12px" direction="column" gap="10px">
        <CopyRow label="Email" value={account.email} />
        <CopyRow label="Temporary Password" value={account.password} />
      </Flex>
      <Box
        as="button"
        type="button"
        mt="14px"
        h="36px"
        px="16px"
        borderRadius="8px"
        bg={COLORS.surface}
        border="1px solid"
        borderColor={COLORS.border}
        color={COLORS.heading}
        fontFamily={FONT}
        fontWeight="600"
        fontSize="13px"
        cursor="pointer"
        _hover={{ bg: COLORS.hoverBg }}
        onClick={onDone}
      >
        Done
      </Box>
    </Box>
  )
}

/**
 * The account form in a modal. Errors show per field once someone has tried to
 * submit. After a create it swaps to the one-time credentials until Done.
 */
function AddBrokerDialog({ copy, open, disabled, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)

  const errors = submitted ? validateBroker(form) : {}
  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const field = (spec) => (
    <Field key={spec.key} field={spec} value={form[spec.key]} error={errors[spec.key]} onChange={set(spec.key)} disabled={busy} />
  )

  function close() {
    if (busy) return
    setForm(EMPTY_FORM)
    setSubmitted(false)
    setError('')
    setCreated(null)
    onClose()
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitted(true)
    setError('')
    if (Object.keys(validateBroker(form)).length) return

    setBusy(true)
    try {
      const account = await createAccount(copy.kind, form)
      const name = `${form.firstName.trim()} ${form.lastName.trim()}`
      setForm(EMPTY_FORM)
      setSubmitted(false)
      onCreated()
      if (!copy.hasLogin) {
        // A sales agent has no login, so there is nothing to show once they are saved.
        notifySaved(`${copy.title} added`, `${name} was added to ${copy.titlePlural}.`)
        onClose()
        return
      }
      setCreated({ name, email: account.email, password: account.password })
      notifySaved(`${copy.title} account created`, `The sign-in details were emailed to ${account.email}.`)
    } catch (err) {
      setError(err.message)
      notifyFailed(copy.hasLogin ? `Could not create the ${copy.singular} account` : `Could not add the ${copy.singular}`, err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next) close()
      }}
      placement="center"
      size="md"
      // The credentials are shown only once, so a stray click outside must not lose them.
      closeOnInteractOutside={!created}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px" display="block">
              <Dialog.Title fontFamily={HEADING_FONT} fontSize="18px" color={COLORS.heading}>
                {copy.hasLogin ? `New ${copy.title} Account` : `New ${copy.title}`}
              </Dialog.Title>
              <Dialog.Description mt="4px" fontFamily={FONT} fontSize="13px" color={COLORS.muted}>
                {copy.hasLogin
                  ? `All fields are required. A temporary password is generated and emailed to the ${copy.singular}, who is asked to change it after signing in.`
                  : `All fields are required. The ${copy.singular} is added to the directory; no app login is created.`}
              </Dialog.Description>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" disabled={busy} aria-label="Close" />
            </Dialog.CloseTrigger>

            {created ? (
              <Dialog.Body py="18px">
                <CreatedCredentials account={created} copy={copy} onDone={close} />
              </Dialog.Body>
            ) : (
              <form noValidate onSubmit={handleSubmit}>
                <Dialog.Body py="18px">
                  <Flex direction="column" gap="14px">
                    <Flex gap="14px" direction={{ base: 'column', sm: 'row' }}>
                      {FIELDS.slice(0, 2).map(field)}
                    </Flex>
                    {FIELDS.slice(2).map(field)}

                    {error ? (
                      <Text role="alert" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                        {error}
                      </Text>
                    ) : null}
                  </Flex>
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
                  <Flex
                    as="button"
                    type="submit"
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
                    disabled={disabled || busy}
                    _hover={{ bg: '#00541F' }}
                    _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
                    _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
                  >
                    {busy ? <Spinner size="sm" /> : <Icon as={LuUserPlus} boxSize="16px" />}
                    {copy.hasLogin ? `Create ${copy.title} Account` : `Add ${copy.title}`}
                  </Flex>
                </Dialog.Footer>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

/** A broker's contact details and sales, opened from the row's Profile button. */
function BrokerProfileDialog({ broker, copy, onClose }) {
  const details = broker
    ? [
        { icon: LuMail, label: 'Email', value: broker.email },
        { icon: LuPhone, label: 'Mobile Number', value: broker.mobileNumber },
        { icon: LuUserPlus, label: 'Account Created', value: formatShortDate(broker.createdAt) },
      ]
    : []

  return (
    <Dialog.Root open={Boolean(broker)} onOpenChange={({ open }) => !open && onClose()} placement="center" size="sm">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px">
            {broker ? (
              <>
                <Dialog.Header py="20px" borderBottom="1px solid" borderColor={COLORS.border}>
                  <Flex align="center" gap="14px" minW={0}>
                    <Avatar broker={broker} size="52px" fontSize="16px" />
                    <Box minW={0}>
                      <Dialog.Title fontFamily={HEADING_FONT} fontSize="18px" color={COLORS.heading} truncate>
                        {fullName(broker)}
                      </Dialog.Title>
                      <Text fontFamily={FONT} fontSize="13px" color={COLORS.muted}>
                        {copy.title}
                      </Text>
                    </Box>
                  </Flex>
                </Dialog.Header>
                <Dialog.CloseTrigger asChild top="14px" right="14px">
                  <CloseButton size="sm" aria-label="Close profile" />
                </Dialog.CloseTrigger>
                <Dialog.Body py="18px">
                  <Flex justify="space-between" gap="12px" p="14px" borderRadius="10px" bg={TINT}>
                    <StatBlock label="Total TCP" value={formatPeso(broker.totalTcp)} color={COLORS.brandGreen} />
                    <StatBlock label="Lots Closed" value={broker.lotsSold} suffix={broker.lotsSold === 1 ? 'lot' : 'lots'} align="right" />
                  </Flex>
                  <Flex mt="16px" direction="column" gap="12px">
                    {details.map((detail) => (
                      <Flex key={detail.label} align="center" gap="10px">
                        <Icon as={detail.icon} boxSize="15px" color={COLORS.subtle} flexShrink={0} />
                        <Box minW={0}>
                          <Text fontFamily={FONT} fontSize="11.5px" color={COLORS.subtle}>
                            {detail.label}
                          </Text>
                          <Text fontFamily={FONT} fontWeight="500" fontSize="14px" color={COLORS.heading} overflowWrap="anywhere">
                            {detail.value || '—'}
                          </Text>
                        </Box>
                      </Flex>
                    ))}
                  </Flex>
                </Dialog.Body>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

/** Row actions behind a three-dot button, the same menu the announcements and lots use. */
function BrokerActions({ broker, onRemove }) {
  return (
    <Menu.Root onSelect={({ value }) => value === 'remove' && onRemove()}>
      <Menu.Trigger
        aria-label={`More actions for ${fullName(broker)}`}
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
          <Menu.Content minW="170px">
            <Menu.Item value="remove" gap="8px" fontSize="13px" color="#DC2626" _hover={{ bg: '#FDECEC', color: '#B91C1C' }}>
              <Icon as={LuUserMinus} boxSize="14px" />
              Remove
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

/** Confirms, then removes the broker's app login and their row. */
function RemoveBrokerDialog({ broker, copy, onClose, onRemoved }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function close() {
    setError('')
    onClose()
  }

  async function handleRemove() {
    setBusy(true)
    setError('')
    try {
      await deleteAccount(copy.kind, broker.id)
      notifySaved(
        copy.hasLogin ? `${copy.title} account removed` : `${copy.title} removed`,
        copy.hasLogin ? `${fullName(broker)} can no longer sign in to the app.` : `${fullName(broker)} was removed from ${copy.titlePlural}.`,
      )
      setError('')
      onRemoved()
    } catch (err) {
      setError(err.message)
      notifyFailed(`Could not remove the ${copy.singular}${copy.hasLogin ? ' account' : ''}`, err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      role="alertdialog"
      open={Boolean(broker)}
      onOpenChange={({ open }) => {
        if (!open && !busy) close()
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
                {copy.hasLogin ? `Remove ${copy.singular} account?` : `Remove ${copy.singular}?`}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Text fontFamily={FONT} fontSize="14px" lineHeight="22px" color={COLORS.muted}>
                {broker ? fullName(broker) : ''} ({broker?.email}){' '}
                {copy.hasLogin
                  ? 'will be signed out of the app and their login deleted. This cannot be undone. To give them access again, create a new account.'
                  : `will be removed from ${copy.titlePlural}. This cannot be undone. Lots they sold keep their Sold By name.`}
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
                onClick={handleRemove}
              >
                {busy ? <Spinner size="sm" /> : null}
                {copy.hasLogin ? 'Remove account' : 'Remove'}
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

function StatBlock({ label, value, suffix, color = COLORS.heading, align = 'left', size = '22px' }) {
  return (
    <Box textAlign={align} minW={0}>
      <Text fontFamily={FONT} fontWeight="600" fontSize="11px" letterSpacing="0.6px" textTransform="uppercase" color={COLORS.muted}>
        {label}
      </Text>
      <Text mt="2px" fontFamily={HEADING_FONT} fontWeight="700" fontSize={size} lineHeight="1.2" color={color} whiteSpace="nowrap">
        {value}
        {suffix ? (
          <Text as="span" ml="4px" fontFamily={FONT} fontWeight="400" fontSize="13px" color={COLORS.muted}>
            {suffix}
          </Text>
        ) : null}
      </Text>
    </Box>
  )
}

function SpotlightCard({ broker, rank }) {
  const style = RANKS[rank]
  return (
    <Card p="22px">
      <Box position="relative" w="fit-content">
        <Avatar broker={broker} size="76px" fontSize="22px" accent={style.accent} />
        <Text
          position="absolute"
          right="-6px"
          bottom="-8px"
          px="8px"
          py="1px"
          borderRadius="full"
          bg={style.accent}
          color="#FFFFFF"
          fontFamily={FONT}
          fontWeight="700"
          fontSize="11px"
          border="2px solid #FFFFFF"
        >
          #{rank + 1}
        </Text>
      </Box>
      <Text mt="18px" fontFamily={HEADING_FONT} fontWeight="600" fontSize="17px" color={COLORS.heading} truncate>
        {fullName(broker)}
      </Text>
      <Flex mt="16px" justify="space-between" align="flex-end" gap="12px" px="12px" py="10px" borderRadius="8px" bg={TINT}>
        <StatBlock label="Total TCP" value={formatPesoShort(broker.totalTcp)} color={style.figure} size="24px" />
        <StatBlock label="Lots Closed" value={broker.lotsSold} suffix={broker.lotsSold === 1 ? 'lot' : 'lots'} align="right" size="20px" />
      </Flex>
    </Card>
  )
}

function Spotlight({ producers, copy }) {
  return (
    <Box as="section" aria-labelledby="spotlight-heading">
      <Flex align="center" gap="8px" mb="16px">
        <Icon as={LuAward} boxSize="22px" color={COLORS.activeBg} />
        <Text id="spotlight-heading" as="h2" fontFamily={HEADING_FONT} fontWeight="600" fontSize="22px" letterSpacing="-0.3px" color={COLORS.heading}>
          Top Producers Spotlight
        </Text>
      </Flex>
      {producers.length ? (
        <Grid templateColumns={{ base: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap="20px">
          {producers.map((broker, index) => (
            <SpotlightCard key={broker.id} broker={broker} rank={index} />
          ))}
        </Grid>
      ) : (
        <Card p="22px">
          <Text fontFamily={FONT} fontSize="14px" color={COLORS.muted}>
            No sales credited to a {copy.singular} yet. A sold lot counts toward a {copy.singular} when its Sold By name
            matches the {copy.singular}&apos;s first and last name.
          </Text>
        </Card>
      )}
    </Box>
  )
}

function Pill({ active, children, onClick }) {
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

function BrokerRow({ broker, onProfile, onRemove }) {
  return (
    <Grid
      role="row"
      templateColumns={TABLE_COLUMNS}
      alignItems="center"
      gap="16px"
      px={{ base: '16px', md: '24px' }}
      py="22px"
      borderTop="1px solid"
      borderColor={COLORS.border}
      _first={{ borderTop: 'none' }}
      _hover={{ bg: COLORS.canvas }}
    >
      <Flex role="cell" align="center" gap="12px" minW={0} pl={{ base: 0, lg: '56px' }}>
        <Avatar broker={broker} />
        <Box minW={0}>
          <Text fontFamily={HEADING_FONT} fontWeight="600" fontSize="15px" color={COLORS.heading} overflowWrap="anywhere">
            {fullName(broker)}
          </Text>
          <Text mt="2px" fontFamily={FONT} fontSize="13.5px" color={COLORS.muted} overflowWrap="anywhere">
            {broker.email}
          </Text>
          {/* Narrow screens drop the figure columns, so they ride under the email. */}
          <Text mt="4px" fontFamily={FONT} fontSize="12.5px" color={COLORS.heading} display={{ base: 'block', md: 'none' }}>
            {lotsLabel(broker.lotsSold)} · {formatPeso(broker.totalTcp)}
          </Text>
        </Box>
      </Flex>
      <Text role="cell" fontFamily={FONT} fontWeight="500" fontSize="14.5px" color={COLORS.heading} display={{ base: 'none', md: 'block' }} pl="12px">
        {lotsLabel(broker.lotsSold)}
      </Text>
      <Text role="cell" fontFamily={FONT} fontWeight="600" fontSize="16px" color={COLORS.heading} display={{ base: 'none', md: 'block' }} textAlign="right" pr={{ md: '8px', lg: '40px' }}>
        {formatPeso(broker.totalTcp)}
      </Text>
      <Flex role="cell" align="center" justify="center" gap="6px">
        <Box
          as="button"
          type="button"
          onClick={onProfile}
          aria-label={`Profile of ${fullName(broker)}`}
          h="30px"
          px="14px"
          borderRadius="6px"
          bg={TINT}
          color={COLORS.activeBg}
          fontFamily={FONT}
          fontWeight="600"
          fontSize="13px"
          cursor="pointer"
          _hover={{ bg: COLORS.statusBg }}
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
        >
          Profile
        </Box>
        {onRemove ? <BrokerActions broker={broker} onRemove={onRemove} /> : null}
      </Flex>
    </Grid>
  )
}

function PagerButton({ children, active, disabled, onClick, label }) {
  return (
    <Box
      as="button"
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      minW="36px"
      h="36px"
      px="12px"
      borderRadius="8px"
      bg={active ? COLORS.activeBg : TINT}
      color={active ? '#FFFFFF' : COLORS.heading}
      opacity={disabled ? 0.5 : 1}
      fontFamily={FONT}
      fontWeight="600"
      fontSize="13px"
      cursor={disabled ? 'default' : 'pointer'}
      _hover={disabled || active ? undefined : { bg: COLORS.statusBg }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '1px' }}
    >
      {children}
    </Box>
  )
}

function Pager({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null
  return (
    <Flex as="nav" aria-label="Pagination" align="center" gap="6px" flexWrap="wrap">
      <PagerButton disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </PagerButton>
      {pageItems(page, pageCount).map((item, index) =>
        item === 'gap' ? (
          <Text key={`gap-${index}`} aria-hidden="true" px="2px" color={COLORS.subtle}>
            …
          </Text>
        ) : (
          <PagerButton key={item} active={item === page} label={`Page ${item}`} onClick={() => onChange(item)}>
            {item}
          </PagerButton>
        ),
      )}
      <PagerButton disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        Next
      </PagerButton>
    </Flex>
  )
}

/**
 * The directory of one kind of app account — brokers or sales agents (`kind`,
 * see ACCOUNT_KINDS): their logins, lots closed, and TCP credited to them.
 */
export function AccountsPage({ kind = 'broker' }) {
  const copy = ACCOUNT_KINDS[kind]
  const { data, loading, reload, refresh } = useApiQuery(fetchAccounts, { kind })
  const [removing, setRemoving] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [segment, setSegment] = useState('all')
  const [sort, setSort] = useState('tcp')
  const [reversed, setReversed] = useState(false)
  const [page, setPage] = useState(1)

  if (loading && !data) return <BrokersSkeleton />

  const connected = data?.source === 'database'
  const brokers = data?.accounts ?? []
  const producers = rankProducers(brokers)
  const topIds = new Set(producers.slice(0, TOP_PERFORMERS).map((broker) => broker.id))
  const segments = [
    { value: 'all', label: `All ${copy.titlePlural}`, count: brokers.length },
    { value: 'top', label: 'Top Performers', count: topIds.size },
  ]

  const compare = SORTS.find((option) => option.value === sort)?.compare ?? SORTS[0].compare
  const matching = brokers
    .filter((broker) => (segment === 'top' ? topIds.has(broker.id) : true))
    .filter((broker) => matchesSearch(broker, search))
    .sort(reversed ? (a, b) => compare(b, a) : compare)
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  // A search, tab switch, or removal can shrink the list below the page being shown.
  const currentPage = Math.min(page, pageCount)
  const visible = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

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
            {copy.titlePlural} &amp; Performance Directory
          </Text>
          <Text mt="6px" maxW="560px" fontFamily={FONT} fontSize="14px" lineHeight="20px" color={COLORS.muted}>
            {copy.title} accounts, lots closed, and gross contract volumes (TCP) credited from the project lot tables.
          </Text>
        </Box>

        {data ? <SourceNotice source={data.source} envVar={SUPABASE_ENV} /> : null}

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
            borderRadius="8px"
            boxShadow="0px 1px 2px rgba(0,0,0,0.05)"
          >
            <Icon as={LuSearch} boxSize="16px" color={COLORS.heading} />
            <Input
              unstyled
              flex="1"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder={`Search ${copy.plural} by name, email, or mobile...`}
              aria-label={`Search ${copy.plural}`}
              fontFamily={FONT}
              fontSize="13.5px"
              color={COLORS.heading}
            />
          </Flex>
          <Flex align="center" gap="8px">
            <ToolbarButton
              variant="primary"
              icon={LuUserPlus}
              onClick={() => setAdding(true)}
              disabled={!connected}
              _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
            >
              Add {copy.titlePlural}
            </ToolbarButton>
            <ToolbarButton
              icon={LuDownload}
              onClick={() => downloadBrokersCsv(matching, copy)}
              disabled={!matching.length}
              _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
            >
              Export CSV
            </ToolbarButton>
          </Flex>
        </Flex>

        <Spotlight producers={producers.slice(0, 3)} copy={copy} />

        <Card as="section" p="0" overflow="hidden" aria-label={`${copy.title} directory`}>
          <Flex align="center" justify="space-between" gap="12px" flexWrap="wrap" px={{ base: '16px', md: '18px' }} py="18px">
            <Flex role="tablist" aria-label={`${copy.title} groups`} gap="8px" flexWrap="wrap">
              {segments.map((option) => (
                <Pill
                  key={option.value}
                  active={segment === option.value}
                  onClick={() => {
                    setSegment(option.value)
                    setPage(1)
                  }}
                >
                  {option.label} ({option.count})
                </Pill>
              ))}
            </Flex>
            <Flex align="center" gap="10px" flex={{ base: '1 1 100%', lg: '0 1 auto' }}>
              <Flex align="center" gap="6px" h="44px" pl="14px" pr="6px" flex="1" minW={{ base: 0, lg: '340px' }} borderRadius="8px" bg={TINT}>
                <Text as="label" htmlFor="broker-sort" fontFamily={FONT} fontSize="13px" color={COLORS.muted} whiteSpace="nowrap">
                  Sort by:
                </Text>
                <NativeSelect.Root size="sm" variant="plain" flex="1">
                  <NativeSelect.Field
                    id="broker-sort"
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value)
                      setPage(1)
                    }}
                    fontFamily={FONT}
                    fontWeight="600"
                    fontSize="13px"
                    color={COLORS.heading}
                  >
                    {SORTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Flex>
              <Flex
                as="button"
                type="button"
                align="center"
                justify="center"
                boxSize="44px"
                flexShrink={0}
                borderRadius="8px"
                bg={reversed ? COLORS.activeBg : TINT}
                color={reversed ? '#FFFFFF' : COLORS.heading}
                cursor="pointer"
                aria-pressed={reversed}
                aria-label="Reverse sort order"
                title="Reverse sort order"
                onClick={() => setReversed((value) => !value)}
                _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
              >
                <Icon as={LuSlidersHorizontal} boxSize="18px" />
              </Flex>
              <RefreshButton onRefresh={refresh} label={`Refresh ${copy.plural}`} size="44px" />
            </Flex>
          </Flex>

          <Box role="table" opacity={loading ? 0.6 : 1} transition="opacity 120ms ease">
            <Grid role="row" templateColumns={TABLE_COLUMNS} alignItems="center" gap="16px" px={{ base: '16px', md: '24px' }} py="14px" bg={TINT}>
              <HeaderCell textAlign={{ base: 'left', lg: 'center' }}>{copy.title} Profile</HeaderCell>
              <HeaderCell display={{ base: 'none', md: 'block' }}>Lots Sold</HeaderCell>
              <HeaderCell display={{ base: 'none', md: 'block' }} textAlign="center">
                Total TCP
                <br />
                Generated
              </HeaderCell>
              <HeaderCell textAlign="center">Actions</HeaderCell>
            </Grid>

            {visible.length ? (
              visible.map((broker) => (
                <BrokerRow
                  key={broker.id}
                  broker={broker}
                  onProfile={() => setViewing(broker)}
                  onRemove={connected ? () => setRemoving(broker) : undefined}
                />
              ))
            ) : (
              <Box p="16px">
                {brokers.length ? (
                  <EmptyState icon={LuSearch} title={`No matching ${copy.plural}`} hint="Try a different name, email, or mobile number." />
                ) : (
                  <EmptyState icon={LuUsers} title={`No ${copy.plural} yet`} hint={`Use Add ${copy.titlePlural} to create the first account.`} />
                )}
              </Box>
            )}
          </Box>

          {matching.length ? (
            <Flex align="center" justify="space-between" gap="12px" flexWrap="wrap" px={{ base: '16px', md: '18px' }} py="18px">
              <Text fontFamily={FONT} fontSize="14px" color={COLORS.muted}>
                Showing {visible.length} of {matching.length} {matching.length === 1 ? copy.singular : copy.plural}
              </Text>
              <Pager page={currentPage} pageCount={pageCount} onChange={setPage} />
            </Flex>
          ) : null}
        </Card>
      </Flex>

      <AddBrokerDialog copy={copy} open={adding} disabled={!connected} onClose={() => setAdding(false)} onCreated={reload} />

      <BrokerProfileDialog broker={viewing} copy={copy} onClose={() => setViewing(null)} />

      <RemoveBrokerDialog
        broker={removing}
        copy={copy}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null)
          reload()
        }}
      />
    </Reveal>
  )
}

export default function BrokersPage() {
  return <AccountsPage kind="broker" />
}
