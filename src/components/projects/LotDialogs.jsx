import { useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Input, NativeSelect, Portal, Spinner, Text } from '@chakra-ui/react'
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
import { COLORS, LOT_STATUS } from '@/theme/colors'
import { formatNumber, formatPeso } from '@/utils/format'
import { notifyFailed, notifySaved } from '@/lib/notify'

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
 * A reserved lot's reserve type, saved as soon as it is picked. The lot keeps
 * its reserved status; this only records who it is held for.
 */
function ReserveTypeSelect({ lot, projectCode, onSaved }) {
  const [value, setValue] = useState(lot.reserveType ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleChange(next) {
    const previous = value
    setValue(next)
    setSaving(true)
    setError('')
    try {
      await updateReserveType(lot.id, projectCode, next)
      notifySaved('Reserve type updated', `${lot.identifier} is now ${RESERVE_TYPE_OPTIONS.find((option) => option.value === next)?.label ?? next}.`)
      onSaved?.(next)
    } catch (err) {
      console.error('[projects] could not update reserve type:', err)
      notifyFailed('Could not update the reserve type', err)
      setValue(previous)
      setError(err.message)
    } finally {
      setSaving(false)
    }
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
        ...(reserved && lot.reserveType && lot.reservedFor ? [['Reserved For', lot.reservedFor]] : []),
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
  // Land projects share one set of categories; MSCC grades units by fit-out. An
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
  const [soldBy, setSoldBy] = useState(lot?.soldBy ?? '')
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
      if (isNew) await createLot(projectCode, { ...fields, status, soldBy })
      else await updateLot(lot.id, projectCode, { ...fields, ...(showSoldBy ? { soldBy } : {}) })
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
            <Input
              id="lot-sold-by"
              value={soldBy}
              onChange={(event) => setSoldBy(event.target.value)}
              placeholder="Sales agent's name"
              {...fieldProps}
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
