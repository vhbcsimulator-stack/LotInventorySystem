import { useState } from 'react'
import { Flex, Input, NativeSelect } from '@chakra-ui/react'
import useApiQuery from '@/hooks/useApiQuery'
import { fetchBrokerNames, salesKey } from '@/data/brokersData'
import { COLORS } from '@/theme/colors'
import { SELLER_KINDS, findAccount } from '@/components/projects/seller'

const OTHER = '__other__'

/**
 * Who sold a lot: one of the brokers (`kind` 'broker', stored in `sold_by`) or
 * one of the sales agents ('sales_agent', stored in `sales_agent`), or "Other…"
 * and a name typed in.
 *
 * An account is stored by its email — no two share one, so two brokers with the
 * same name are still credited apart. The choices show names; the email is the
 * tooltip. `value` is what is stored, and `onChange` gives the new value.
 */
export default function SoldByPicker({ id, value, onChange, disabled, fieldProps, kind = 'broker' }) {
  const { data, loading } = useApiQuery(fetchBrokerNames)
  // A lot's broker and its sales agent are picked separately, each from its own directory.
  const agents = kind === 'sales_agent'
  const accounts = (agents ? data?.salesAgents : data?.brokers) ?? []
  const picked = findAccount(accounts, value)
  // A name saved before emails were, shared by several accounts: the right one must be chosen.
  const shared = !picked && value ? accounts.filter((account) => salesKey(account.name) === salesKey(value)).length > 1 : false
  // "Other…" picked with nothing typed yet, which `value` alone cannot show.
  const [choseOther, setChoseOther] = useState(false)
  const other = choseOther || (Boolean(value) && !picked && !shared && !loading)

  function pick(choice) {
    setChoseOther(choice === OTHER)
    if (choice === OTHER) onChange(picked ? '' : value)
    else onChange(choice)
  }

  const placeholder =
    loading && !accounts.length
      ? agents ? 'Loading sales agents…' : 'Loading brokers…'
      : shared
        ? `Which ${value}?`
        : agents ? 'Choose a sales agent' : 'Choose a broker'

  return (
    <Flex direction="column" gap="6px" w="full">
      <NativeSelect.Root disabled={disabled}>
        <NativeSelect.Field
          id={id}
          aria-label={agents ? 'Sales agent' : 'Sold by'}
          title={picked?.email}
          value={picked?.email ?? (other ? OTHER : '')}
          onChange={(event) => pick(event.target.value)}
          color={picked || other ? COLORS.heading : COLORS.subtle}
          {...fieldProps}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.email} title={account.email}>
              {account.name}
            </option>
          ))}
          <option value={OTHER}>Other…</option>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {other ? (
        <Input
          aria-label={agents ? 'Sales agent (other)' : 'Sold by (other)'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Agent or realty name"
          disabled={disabled}
          autoFocus={choseOther}
          {...fieldProps}
        />
      ) : null}
    </Flex>
  )
}

/**
 * Who sold a lot, asked in two steps: first a broker or a sales agent, then
 * which one (from that directory, or "Other…" and a name). `value` is
 * { kind, name }; changing the kind starts the name over.
 */
export function SellerPicker({ id, value, onChange, disabled, fieldProps }) {
  const kind = value?.kind ?? ''
  return (
    <Flex direction="column" gap="6px" w="full">
      <NativeSelect.Root disabled={disabled}>
        <NativeSelect.Field
          id={id}
          aria-label="Sold by a broker or a sales agent"
          value={kind}
          onChange={(event) => onChange({ kind: event.target.value, name: '' })}
          color={kind ? COLORS.heading : COLORS.subtle}
          {...fieldProps}
        >
          <option value="" disabled>
            Broker or sales agent?
          </option>
          {SELLER_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {kind ? (
        <SoldByPicker
          key={kind}
          kind={kind}
          value={value?.name ?? ''}
          onChange={(name) => onChange({ kind, name })}
          disabled={disabled}
          fieldProps={fieldProps}
        />
      ) : null}
    </Flex>
  )
}
