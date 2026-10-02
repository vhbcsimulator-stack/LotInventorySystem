import { useId, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Input, NativeSelect, Portal, Spinner, Text, Textarea } from '@chakra-ui/react'
import SoldByPicker from '@/components/projects/SoldByPicker'
import useApiQuery from '@/hooks/useApiQuery'
import { fetchBrokerNames, salesKey } from '@/data/brokersData'
import { findAccount } from '@/components/projects/seller'
import { NEW_CLIENT_FIELDS, createClient, fetchClientChoices, updateClient, validateClient } from '@/data/clientsData'
import { COLORS } from '@/theme/colors'
import { notifyFailed, notifySaved } from '@/lib/notify'

const FONT = 'Inter, system-ui, sans-serif'
const NEW = '__new__'

/**
 * Who bought a sold lot: one of the existing clients, or "New client…", which
 * opens a form for the client's details and adds them to the `clients` table.
 * `value` is the client's name as stored on the lot (`reserved_for`);
 * `onChange(name, id)` also gives the client's `clients` row id, so their
 * record can be pointed at the lot.
 *
 * For a sale, a new client's broker is whoever the sale names in "Sold by", so
 * "New client…" waits until that is chosen. Without a sale (a client
 * reservation, `defaults.brokerName` left undefined) the form asks for the broker.
 *
 * `defaults` prefill the new-client form: { brokerName, projectCode,
 * unitDescription, tcpFormatted, stage }.
 */
export default function ClientPicker({ id, value, onChange, disabled, fieldProps, defaults = {} }) {
  const { data, loading, reload } = useApiQuery(fetchClientChoices)
  const clients = data?.clients ?? []
  const [adding, setAdding] = useState(false)
  const known = clients.some((client) => client.name === value)
  const waitsForSoldBy = defaults.brokerName !== undefined && !defaults.brokerName.trim()

  function pick(choice) {
    if (choice === NEW) setAdding(true)
    else onChange(choice, clients.find((client) => client.name === choice)?.id)
  }

  return (
    <>
      <NativeSelect.Root disabled={disabled}>
        <NativeSelect.Field
          id={id}
          aria-label="Client"
          value={value || ''}
          onChange={(event) => pick(event.target.value)}
          color={value ? COLORS.heading : COLORS.subtle}
          {...fieldProps}
        >
          <option value="" disabled>
            {loading && !clients.length ? 'Loading clients…' : 'Choose a client'}
          </option>
          {/* A name the lot already carries (e.g. from an imported sheet) stays selectable. */}
          {value && !known ? <option value={value}>{value}</option> : null}
          {clients.map((client) => (
            <option key={client.id ?? client.name} value={client.name}>
              {client.name}
              {client.projectCode ? ` · ${client.projectCode}` : ''}
              {client.phone ? ` · ${client.phone}` : ''}
            </option>
          ))}
          <option value={NEW} disabled={waitsForSoldBy}>
            {waitsForSoldBy ? 'New client… (choose the broker or sales agent first)' : 'New client…'}
          </option>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <ClientFormDialog
        open={adding}
        defaults={defaults}
        onClose={() => setAdding(false)}
        onSaved={(client) => {
          setAdding(false)
          onChange(client.name, client.id)
          reload()
        }}
      />
    </>
  )
}

/** The form's starting values: an existing client's own, or a new one's prefill. */
function initialForm(defaults, client) {
  if (client) {
    return {
      ...Object.fromEntries(
        NEW_CLIENT_FIELDS.map((field) => [
          field.key,
          field.checkbox ? client[field.key] === true || /^(true|yes|1)$/i.test(String(client[field.key] ?? '')) : String(client[field.key] ?? ''),
        ]),
      ),
    }
  }
  return {
    ...Object.fromEntries(NEW_CLIENT_FIELDS.map((field) => [field.key, field.checkbox ? false : ''])),
    // A sale's seller as the lot stores it — an account's email, or an "Other" name.
    broker_name: defaults.brokerName ?? '',
    project_code: defaults.projectCode ?? '',
    unit_description: defaults.unitDescription ?? '',
    tcp_formatted: defaults.tcpFormatted ?? '',
    stage: defaults.stage ?? '',
  }
}

/**
 * A client's details, as the client card shows them (all but the avatar and
 * what the app writes itself). Adds a client, or with `client` (a `clients`
 * row) edits that one; `onSaved` receives the saved row.
 */
export function ClientFormDialog({ open, client = null, defaults = {}, onClose, onSaved }) {
  const editing = Boolean(client)
  const { data: brokerData } = useApiQuery(fetchBrokerNames)
  const listId = useId()
  const [form, setForm] = useState(() => initialForm(defaults, client))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Each opening starts from the sale it was opened for.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setForm(initialForm(defaults, client))
      setErrors({})
      setError('')
    }
  }

  /*
   * The broker account the form names. `broker_name` holds a picked broker's
   * email (or a sale's, as the lot stores it); a client saved earlier holds a
   * name, which means the broker the client is linked to (broker_id is their
   * login), else the only broker with that name. Shared names are never guessed.
   */
  const brokerAccount = (values) => {
    const brokers = brokerData?.brokers ?? []
    const linked = client?.broker_id ? brokers.find((entry) => entry.authUserId === client.broker_id) : undefined
    if (linked && salesKey(linked.name) === salesKey(values.broker_name)) return linked
    return findAccount(brokers, values.broker_name)
  }
  // What the client card shows as Broker Name: the account's name, not its email.
  const brokerLabel = (values) => brokerAccount(values)?.name ?? values.broker_name

  const set = (key, next) => {
    setForm((current) => ({ ...current, [key]: next }))
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))
  }

  async function save() {
    const problems = validateClient(form)
    setErrors(problems)
    if (Object.keys(problems).length) return
    setSaving(true)
    setError('')
    try {
      // A broker account owns the client, so it shows in their app; another agent leaves it unowned.
      const broker = brokerAccount(form)
      // clients.broker_id is the broker's app login (auth.users), not their brokers row — that is
      // what the app matches against the signed-in broker.
      const fields = { ...form, broker_name: brokerLabel(form), broker_id: broker?.authUserId ?? null }
      const saved = editing ? await updateClient(client.id, fields) : await createClient(fields)
      notifySaved(editing ? 'Client updated' : 'Client added', `${saved.name} was ${editing ? 'saved' : 'added to Clients'}.`)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
      notifyFailed(editing ? 'Could not save the client' : 'Could not add the client', err)
    } finally {
      setSaving(false)
    }
  }

  const field = { h: '38px', borderRadius: '8px', fontFamily: FONT, fontSize: '14px' }
  const label = { fontFamily: FONT, fontSize: '11.5px', fontWeight: '700', letterSpacing: '0.04em', textTransform: 'uppercase', color: COLORS.subtle }

  return (
    <Dialog.Root open={open} onOpenChange={({ open: next }) => (next || saving ? null : onClose())} placement="center" size="md">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content bg={COLORS.surface} borderRadius="16px" maxH="90dvh" overflow="hidden">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="14px" pr="56px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="16px" color={COLORS.heading}>
                {editing ? `Edit ${client.name || 'client'}` : 'New client'}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild top="10px" right="12px">
              <CloseButton size="sm" disabled={saving} />
            </Dialog.CloseTrigger>
            <Dialog.Body py="14px" overflowY="auto">
              <Flex direction="column" gap="12px">
                {NEW_CLIENT_FIELDS.map((entry) => {
                  // The VIP tag only means something for a VIP.
                  if (entry.key === 'vip_tag' && !form.is_vip) return null
                  const inputId = `${listId}-${entry.key}`
                  if (entry.checkbox) {
                    return (
                      <Flex key={entry.key} as="label" htmlFor={inputId} align="center" gap="8px" cursor="pointer">
                        <input id={inputId} type="checkbox" checked={form[entry.key]} onChange={(event) => set(entry.key, event.target.checked)} disabled={saving} />
                        <Text {...label}>{entry.label}</Text>
                      </Flex>
                    )
                  }
                  const Control = entry.multiline ? Textarea : Input
                  const invalid = { 'aria-invalid': errors[entry.key] ? true : undefined, borderColor: errors[entry.key] ? '#DC2626' : undefined }
                  return (
                    <Box key={entry.key}>
                      <Text as="label" htmlFor={inputId} display="block" mb="4px" {...label}>
                        {entry.label}
                        {entry.required ? <Box as="span" color="#B91C1C"> *</Box> : null}
                      </Text>
                      {/* A sale's broker comes from its "Sold by" (change it there); otherwise it is picked here. */}
                      {entry.key === 'broker_name' && !editing && defaults.brokerName !== undefined ? (
                        <Input id={inputId} value={brokerLabel(form)} readOnly title="From Sold by" bg={COLORS.canvas} {...invalid} {...field} />
                      ) : entry.key === 'broker_name' ? (
                        <SoldByPicker
                          id={inputId}
                          value={brokerAccount(form)?.email ?? form.broker_name}
                          onChange={(name) => set('broker_name', name)}
                          disabled={saving}
                          fieldProps={{ ...field, ...invalid }}
                        />
                      ) : entry.options ? (
                        <NativeSelect.Root disabled={saving}>
                          <NativeSelect.Field
                            id={inputId}
                            value={form[entry.key]}
                            onChange={(event) => set(entry.key, event.target.value)}
                            color={form[entry.key] ? COLORS.heading : COLORS.subtle}
                            {...invalid}
                            {...field}
                          >
                            <option value="" disabled>
                              Choose a {entry.label.toLowerCase()}
                            </option>
                            {entry.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      ) : (
                        <Control
                          id={inputId}
                          type={entry.type}
                          value={form[entry.key]}
                          onChange={(event) => set(entry.key, event.target.value)}
                          placeholder={entry.placeholder}
                          disabled={saving}
                          {...invalid}
                          {...field}
                          {...(entry.multiline ? { h: 'auto', rows: 3 } : {})}
                        />
                      )}
                      {errors[entry.key] ? (
                        <Text fontFamily={FONT} fontSize="12px" color="#B91C1C" mt="4px">
                          {errors[entry.key]}
                        </Text>
                      ) : null}
                    </Box>
                  )
                })}
              </Flex>
              {error ? (
                <Text role="alert" fontFamily={FONT} fontSize="13px" color="#B91C1C" mt="12px">
                  {error}
                </Text>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="12px" gap="8px">
              <Box
                as="button"
                type="button"
                onClick={saving ? undefined : onClose}
                h="36px"
                px="14px"
                borderRadius="8px"
                border="1px solid"
                borderColor={COLORS.border}
                bg={COLORS.surface}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="13px"
                color={COLORS.heading}
                cursor="pointer"
                _hover={{ bg: COLORS.hoverBg }}
              >
                Cancel
              </Box>
              <Flex
                as="button"
                type="button"
                onClick={saving ? undefined : save}
                align="center"
                gap="6px"
                h="36px"
                px="14px"
                borderRadius="8px"
                bg={COLORS.brandGreen}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="13px"
                color="#FFFFFF"
                cursor={saving ? 'progress' : 'pointer'}
                _hover={{ bg: '#00541F' }}
              >
                {saving ? <Spinner size="xs" /> : null}
                {saving ? (editing ? 'Saving…' : 'Adding…') : editing ? 'Save changes' : 'Add client'}
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
