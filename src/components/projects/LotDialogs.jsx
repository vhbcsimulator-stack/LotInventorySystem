import { useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Input, NativeSelect, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuCheck, LuX } from 'react-icons/lu'
import {
  DEFAULT_LOT_TERMS,
  LOT_STATUS_OPTIONS,
  RESERVE_TYPE_OPTIONS,
  categoriesFor,
  createLot,
  deleteLot,
  deleteLots,
  updateLot,
  updateReserveType,
} from '@/data/projectsData'
import { PRICE_CONFIG } from '@/data/pricesData'
import { unitDescription, updateClientForLot } from '@/data/clientsData'
import { SellerPicker } from '@/components/projects/SoldByPicker'
import { sellerFields, sellerOf } from '@/components/projects/seller'
import ClientPicker from '@/components/projects/ClientPicker'
import { COLORS, LOT_STATUS } from '@/theme/colors'
import { formatNumber, formatPeso } from '@/utils/format'
import { notifyFailed, notifySaved, notifyWarning } from '@/lib/notify'

const FONT = 'Inter, system-ui, sans-serif'

const categoryLabel = (category) =>
  String(category ?? '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

function Button({ children, tone = 'neutral', loading, ...rest }) {
  const tones = {
    neutral: { bg: COLORS.hoverBg, color: COLORS.heading },
    primary: { bg: COLORS.activeBg, color: '#FFFFFF' },
    danger: { bg: '#DC2626', color: '#FFFFFF' },
  }
  return (
    <Flex
      as="button"
      type="button"
      align="center"
      gap="8px"
      h="40px"
      px="18px"
      borderRadius="8px"
      fontFamily={FONT}
      fontWeight="600"
      fontSize="14px"
      cursor="pointer"
      _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      {...tones[tone]}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </Flex>
  )
}

/** Shared dialog frame; closing is blocked while `busy`. */
function LotDialog({ open, title, busy, onClose, children, footer }) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next && !busy) onClose()
      }}
      placement="center"
      size="sm"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxH="calc(100dvh - 32px)">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="18px" color={COLORS.heading}>
                {title}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">{children}</Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px" flexWrap="wrap">
              {footer}
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

function ErrorText({ children }) {
  return children ? (
    <Text role="alert" mt="14px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
      {children}
    </Text>
  ) : null
}

/**
 * Point a client's record at the lot they reserved or bought. The lot is saved
 * by then, so a failure here only warns.
 */
async function pointClientAt(clientId, { stage, projectCode, lot, lotNo }) {
  try {
    await updateClientForLot(clientId, { stage, projectCode, lotNo: lotNo ?? lot.identifier, total: lot?.tcp })
  } catch (err) {
    console.error('[projects] client not updated:', err)
    notifyWarning('Client record not updated', err.message)
  }
}

/** A small square icon button: the reserve type's save and discard. */
function IconAction({ icon, label, tone = 'neutral', ...rest }) {
  const tones = {
    neutral: { bg: COLORS.surface, color: COLORS.heading, border: '1px solid', borderColor: COLORS.border, _hover: { bg: COLORS.hoverBg } },
    primary: { bg: COLORS.activeBg, color: '#FFFFFF' },
  }
  return (
    <Flex
      as="button"
      type="button"
      aria-label={label}
      title={label}
      align="center"
      justify="center"
      boxSize="32px"
      borderRadius="8px"
      cursor="pointer"
      flexShrink={0}
      _disabled={{ opacity: 0.45, cursor: 'not-allowed' }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      {...tones[tone]}
      {...rest}
    >
      <Icon as={icon} boxSize="16px" />
    </Flex>
  )
}

/**
 * A reserved lot's reserve type. The lot keeps its reserved status; this only
 * records who it is held for. Every change is a draft until saved with the
 * check icon, or put back with the cross: Company and Default carry no name,
 * and Client Reserved can be saved once who reserved it and the client (an
 * existing client or a new one) are both chosen.
 */
function ReserveTypeSelect({ lot, projectCode, onSaved }) {
  const forClient = lot.reserveType === 'client'
  const savedClient = forClient ? (lot.reservedFor ?? '') : ''
  const noSeller = { kind: '', name: '' }
  const savedSeller = forClient ? sellerOf(lot) : noSeller
  const [value, setValue] = useState(lot.reserveType ?? '')
  const [client, setClient] = useState(savedClient)
  // Set when a client is picked here, so their record is pointed at this lot.
  const [clientId, setClientId] = useState(null)
  // Who reserved it: a broker or a sales agent, then which one.
  const [seller, setSeller] = useState(savedSeller)
  const [saved, setSaved] = useState({ type: lot.reserveType ?? '', client: savedClient, seller: savedSeller })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(type, { name, id, by } = {}) {
    setSaving(true)
    setError('')
    try {
      const forClient = type === 'client'
      await updateReserveType(lot.id, projectCode, type, forClient ? name : undefined, forClient ? sellerFields(by) : undefined)
      if (forClient && id) await pointClientAt(id, { stage: 'reserved', projectCode, lot })
      const label = RESERVE_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type
      notifySaved('Reserve type updated', `${lot.identifier} is now ${label}${forClient ? ` for ${name}` : ''}.`)
      setSaved({ type, client: forClient ? name : '', seller: forClient ? by : noSeller })
      onSaved?.(type, forClient ? name : '')
    } catch (err) {
      console.error('[projects] could not update reserve type:', err)
      notifyFailed('Could not update the reserve type', err)
      setValue(saved.type)
      setClient(saved.client)
      setSeller(saved.seller)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function handleChange(next) {
    setValue(next)
    setError('')
    // A client reservation asks for who reserved it and its client; keep what it had if it was one.
    const keep = next === 'client' && saved.type === 'client'
    setClient(keep ? saved.client : '')
    setSeller(keep ? saved.seller : noSeller)
    setClientId(null)
  }

  function handleClient(name, id) {
    setClient(name)
    setClientId(id ?? null)
    setError('')
  }

  function handleSeller(next) {
    setSeller(next)
    setError('')
  }

  const isClient = value === 'client'
  const dirty =
    value !== saved.type ||
    (isClient && (client !== saved.client || seller.kind !== saved.seller.kind || seller.name !== saved.seller.name))
  // A client reservation needs who reserved it and its client before it can be saved.
  const complete = !isClient || (Boolean(client.trim()) && Boolean(seller.name.trim()))

  function commit() {
    if (!dirty || !complete || saving) return
    if (isClient) save('client', { name: client.trim(), id: clientId, by: { ...seller, name: seller.name.trim() } })
    else save(value)
  }

  function discard() {
    setValue(saved.type)
    setClient(saved.client)
    setSeller(saved.seller)
    setClientId(null)
    setError('')
  }

  return (
    <Flex direction="column" align="flex-end" gap="4px">
      <Flex align="center" gap="8px">
        {saving ? <Spinner size="xs" /> : null}
        <NativeSelect.Root size="sm" width="170px" disabled={saving}>
          <NativeSelect.Field
            aria-label="Reserve type"
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            fontFamily={FONT}
            fontSize="14px"
            fontWeight="600"
            color={COLORS.heading}
          >
            {RESERVE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Flex>
      {isClient ? (
        <Flex direction="column" gap="6px" w="240px">
          <SellerPicker
            value={seller}
            onChange={handleSeller}
            disabled={saving}
            fieldProps={{ h: '32px', fontFamily: FONT, fontSize: '13px', borderRadius: '8px' }}
          />
          <ClientPicker
            value={client}
            onChange={handleClient}
            disabled={saving}
            fieldProps={{ h: '32px', fontFamily: FONT, fontSize: '13px', borderRadius: '8px' }}
            defaults={{
              projectCode,
              unitDescription: unitDescription(projectCode, lot.identifier, 'Reserved'),
              tcpFormatted: lot.tcp ? formatPeso(lot.tcp) : '',
              stage: 'reserved',
              // A new client's broker is whoever reserved the lot.
              brokerName: seller.name,
            }}
          />
          {dirty && !complete ? (
            <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle} textAlign="end">
              Choose who reserved it and the client to save.
            </Text>
          ) : null}
        </Flex>
      ) : null}
      {dirty ? (
        <Flex gap="6px" mt="2px">
          <IconAction icon={LuX} label="Discard changes" onClick={discard} disabled={saving} />
          <IconAction
            icon={LuCheck}
            label="Save reserve type"
            tone="primary"
            onClick={commit}
            disabled={saving || !complete}
          />
        </Flex>
      ) : null}
      {error ? (
        <Text role="alert" fontFamily={FONT} fontSize="12px" color="#B91C1C" textAlign="end">
          {error}
        </Text>
      ) : null}
    </Flex>
  )
}

/** View of one lot; a reserved lot's reserve type can be changed here. */
export function LotDetailsDialog({ lot, projectName, projectCode, terms = DEFAULT_LOT_TERMS, onClose, onReserveTypeSaved }) {
  const statusLabel = LOT_STATUS_OPTIONS.find((option) => option.value === lot?.rawStatus)?.label ?? (lot?.rawStatus || '—')
  const reserved = lot?.status === 'reserved'
  const rows = lot
    ? [
        ['Project', projectName || '—'],
        [terms.identifier, lot.identifier],
        ...(terms.group ? [[terms.group, lot.phase]] : []),
        ['Category', lot.category],
        ...(terms.unitFields ?? []).map((field) => [field.label, lot[field.key] || '—']),
        [terms.area, `${formatNumber(lot.areaSqm)} sqm`],
        ...(terms.pricing === false
          ? []
          : [
              ['Price / sqm', formatPeso(lot.pricePerSqm)],
              ['TCP', formatPeso(lot.tcp)],
            ]),
        ['Status', statusLabel],
        // A client reservation's client is picked under Reserve Type; an imported company hold keeps its label (MSD).
        ...(reserved && lot.reserveType === 'company' && lot.reservedFor ? [['Reserved For', lot.reservedFor]] : []),
      ]
    : []
  return (
    <LotDialog
      open={Boolean(lot)}
      title={lot ? `${terms.item} ${lot.identifier}` : ''}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <Flex direction="column">
        {rows.map(([label, value]) => (
          <Flex key={label} justify="space-between" gap="16px" py="9px" borderBottom="1px solid" borderColor={COLORS.border}>
            <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>
              {label}
            </Text>
            <Text
              fontFamily={FONT}
              fontSize="14px"
              fontWeight="600"
              textAlign="end"
              color={label === 'Status' ? (LOT_STATUS[lot.status]?.fg ?? COLORS.heading) : COLORS.heading}
            >
              {value}
            </Text>
          </Flex>
        ))}
        {reserved ? (
          <Flex justify="space-between" align="center" gap="16px" py="9px" borderBottom="1px solid" borderColor={COLORS.border}>
            <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>
              Reserve Type
            </Text>
            <ReserveTypeSelect key={lot.id} lot={lot} projectCode={projectCode} onSaved={onReserveTypeSaved} />
          </Flex>
        ) : null}
      </Flex>
    </LotDialog>
  )
}

function FormRow({ id, label, children }) {
  return (
    <Box>
      <Text as="label" htmlFor={id} display="block" mb="6px" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>
        {label}
      </Text>
      {children}
    </Box>
  )
}

const fieldProps = { h: '42px', borderRadius: '8px', fontFamily: FONT, fontSize: '14px' }

/**
 * Add a lot (no `lot`) or edit one: identifier, phase (only when the project uses
 * phases), category, and area; a new lot also picks its status. Mount it with a
 * `key` per lot so the form starts from that lot.
 */
export function LotEditDialog({ open, lot = null, projectCode, phases, terms = DEFAULT_LOT_TERMS, onClose, onSaved }) {
  /*
   * Ungrouped projects (ERHD) never ask for a phase; projects with their own
   * grouping (MSCC towers) always do. Otherwise a phase is asked for once the
   * project has phased lots or a phased price table.
   */
  const hasPhases =
    Boolean(terms.group) &&
    (terms.group !== DEFAULT_LOT_TERMS.group ||
      phases.length > 0 ||
      Boolean(PRICE_CONFIG[projectCode]?.scopes.some((scope) => scope.phase !== undefined)))
  // Land projects share one set of categories; MSCC grades units by bedrooms. An
  // existing lot keeps an unusual category of its own either way.
  const categoryOptions = [...new Set([...categoriesFor(projectCode), lot?.rawCategory].filter(Boolean))]

  const [lotNo, setLotNo] = useState(lot?.identifier === '—' ? '' : (lot?.identifier ?? ''))
  const [phase, setPhase] = useState(lot?.phaseNo ? String(lot.phaseNo) : '')
  const [category, setCategory] = useState(lot?.rawCategory ?? '')
  const [area, setArea] = useState(lot ? String(lot.areaSqm) : '')
  /*
   * Condominium projects (MSCC) also record unit type, floor level, view, and
   * whether it is an end unit. All four are optional: units added before the
   * columns existed have none, and the form should not force a guess.
   */
  const unitFields = terms.unitFields ?? []
  const [unit, setUnit] = useState(() => Object.fromEntries(unitFields.map((field) => [field.key, lot?.[field.key] ?? ''])))
  const isNew = !lot
  // Existing lots change status through the table's status picker; only a new lot picks one here.
  const [status, setStatus] = useState('available')
  const showSoldBy = isNew ? status === 'sold' : lot.rawStatus === 'sold'
  // Who sold it: a broker or a sales agent, then which one.
  const [seller, setSeller] = useState(() => sellerOf(lot))
  // A sold lot's buyer, kept in reserved_for.
  const [client, setClient] = useState(lot?.rawStatus === 'sold' ? (lot?.reservedFor ?? '') : '')
  // Set when a client is picked here, so their record is pointed at this lot.
  const [clientId, setClientId] = useState(null)
  // New lots can carry a source date. Editing other fields keeps the stored date.
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      const fields = {
        lotNo,
        phase: hasPhases && phase !== '' ? Number(phase) : hasPhases ? NaN : null,
        category,
        areaSqm: Number(area),
        ...(isNew ? { lastUpdated } : {}),
        ...(unitFields.length ? { unit } : {}),
      }
      if (isNew) await createLot(projectCode, { ...fields, status, ...sellerFields(seller), client })
      else await updateLot(lot.id, projectCode, { ...fields, ...(showSoldBy ? { ...sellerFields(seller), client } : {}) })
      if (showSoldBy && client && clientId) {
        await pointClientAt(clientId, { stage: 'closed', projectCode, lot, lotNo: lotNo.trim() })
      }
      setSaving(false)
      notifySaved(`${terms.item} ${isNew ? 'added' : 'updated'}`, `${terms.item} ${lotNo.trim()} was ${isNew ? 'added' : 'saved'}.`)
      onSaved(`${terms.item} ${lotNo.trim()} ${isNew ? 'added' : 'updated'}.`)
    } catch (err) {
      setError(err.message)
      notifyFailed(`Could not ${isNew ? 'add' : 'update'} the ${terms.item.toLowerCase()}`, err)
      setSaving(false)
    }
  }

  return (
    <LotDialog
      open={open}
      title={isNew ? `Add ${terms.item}` : `Update ${terms.item} ${lot.identifier}`}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button tone="primary" onClick={handleSave} disabled={saving} loading={saving}>
            {saving ? 'Saving…' : isNew ? `Add ${terms.item.toLowerCase()}` : 'Save'}
          </Button>
        </>
      }
    >
      <Flex direction="column" gap="14px">
        <FormRow id="lot-no" label={terms.identifier}>
          <Input id="lot-no" value={lotNo} onChange={(event) => setLotNo(event.target.value)} placeholder={terms.placeholder} {...fieldProps} />
        </FormRow>

        {hasPhases ? (
          <FormRow id="lot-phase" label={terms.group}>
            <Input
              id="lot-phase"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={phase}
              onChange={(event) => setPhase(event.target.value)}
              {...fieldProps}
            />
          </FormRow>
        ) : null}

        <FormRow id="lot-category" label="Category">
          <NativeSelect.Root>
            <NativeSelect.Field id="lot-category" value={category} onChange={(event) => setCategory(event.target.value)} {...fieldProps}>
              <option value="" disabled>
                Choose a category
              </option>
              {categoryOptions.map((key) => (
                <option key={key} value={key}>
                  {categoryLabel(key)}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormRow>

        <FormRow id="lot-area" label={`${terms.area} (sqm)`}>
          <Input
            id="lot-area"
            type="number"
            inputMode="decimal"
            min="0"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            {...fieldProps}
          />
        </FormRow>

        {unitFields.map((field) => (
          <FormRow key={field.key} id={`lot-${field.key}`} label={field.label}>
            <NativeSelect.Root>
              <NativeSelect.Field
                id={`lot-${field.key}`}
                value={unit[field.key]}
                onChange={(event) => setUnit((prev) => ({ ...prev, [field.key]: event.target.value }))}
                {...fieldProps}
              >
                <option value="">Not set</option>
                {/* An existing unit keeps a value that is no longer offered. */}
                {unit[field.key] && !field.options.includes(unit[field.key]) ? (
                  <option value={unit[field.key]}>{unit[field.key]}</option>
                ) : null}
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormRow>
        ))}

        {isNew ? (
          <FormRow id="lot-status" label="Status">
            <NativeSelect.Root>
              <NativeSelect.Field id="lot-status" value={status} onChange={(event) => setStatus(event.target.value)} {...fieldProps}>
                {LOT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormRow>
        ) : null}

        {isNew ? (
          <FormRow id="lot-last-updated" label="Last Updated">
            <Input
              id="lot-last-updated"
              type="date"
              value={lastUpdated}
              onChange={(event) => setLastUpdated(event.target.value)}
              {...fieldProps}
            />
          </FormRow>
        ) : null}

        {showSoldBy ? (
          <FormRow id="lot-sold-by" label="Sold By">
            <SellerPicker id="lot-sold-by" value={seller} onChange={setSeller} disabled={saving} fieldProps={fieldProps} />
          </FormRow>
        ) : null}

        {showSoldBy ? (
          <FormRow id="lot-client" label="Client">
            <ClientPicker
              id="lot-client"
              value={client}
              onChange={(name, id) => {
                setClient(name)
                setClientId(id ?? null)
              }}
              disabled={saving}
              fieldProps={fieldProps}
              defaults={{
                brokerName: seller.name,
                projectCode,
                unitDescription: unitDescription(projectCode, lotNo.trim(), 'Sold'),
                tcpFormatted: lot?.tcp ? formatPeso(lot.tcp) : '',
              }}
            />
          </FormRow>
        ) : null}

      </Flex>
      <ErrorText>{error}</ErrorText>
    </LotDialog>
  )
}

/**
 * Confirm, then permanently delete every selected lot. The count is stated in the
 * button itself so the number being destroyed is visible at the moment of clicking.
 */
export function LotsBulkDeleteDialog({ ids, projectCode, terms = DEFAULT_LOT_TERMS, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const count = ids.length
  const noun = `${terms.item.toLowerCase()}${count === 1 ? '' : 's'}`

  async function handleDelete() {
    setError('')
    setDeleting(true)
    try {
      const removed = await deleteLots(ids, projectCode)
      setDeleting(false)
      const message = `${formatNumber(removed)} ${removed === 1 ? terms.item.toLowerCase() : `${terms.item.toLowerCase()}s`} deleted.`
      notifySaved(message)
      onDeleted(message)
    } catch (err) {
      setError(err.message)
      notifyFailed(`Could not delete the ${noun}`, err)
      setDeleting(false)
    }
  }

  return (
    <LotDialog
      open={count > 0}
      title={`Delete ${formatNumber(count)} ${noun}?`}
      busy={deleting}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button tone="danger" onClick={handleDelete} disabled={deleting} loading={deleting}>
            {deleting ? 'Deleting…' : `Delete ${formatNumber(count)} ${noun}`}
          </Button>
        </>
      }
    >
      <Text fontFamily={FONT} fontSize="14px" lineHeight="21px" color={COLORS.heading}>
        <b>
          {formatNumber(count)} {noun}
        </b>{' '}
        will be permanently removed, along with their prices and status history. This cannot be undone.
      </Text>
      <ErrorText>{error}</ErrorText>
    </LotDialog>
  )
}

/** Confirm, then permanently delete a lot. */
export function LotDeleteDialog({ lot, projectCode, terms = DEFAULT_LOT_TERMS, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    setError('')
    setDeleting(true)
    try {
      await deleteLot(lot.id, projectCode)
      setDeleting(false)
      notifySaved(`${terms.item} ${lot.identifier} deleted`)
      onDeleted(`${terms.item} ${lot.identifier} deleted.`)
    } catch (err) {
      setError(err.message)
      notifyFailed(`Could not delete ${terms.item.toLowerCase()} ${lot.identifier}`, err)
      setDeleting(false)
    }
  }

  return (
    <LotDialog
      open={Boolean(lot)}
      title={`Delete ${terms.item.toLowerCase()}?`}
      busy={deleting}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button tone="danger" onClick={handleDelete} disabled={deleting} loading={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <Text fontFamily={FONT} fontSize="14px" lineHeight="21px" color={COLORS.heading}>
        {terms.item} <b>{lot?.identifier}</b> ({[terms.group ? lot?.phase : null, lot?.category].filter(Boolean).join(', ')}) will be
        permanently removed. This cannot be undone.
      </Text>
      <ErrorText>{error}</ErrorText>
    </LotDialog>
  )
}
