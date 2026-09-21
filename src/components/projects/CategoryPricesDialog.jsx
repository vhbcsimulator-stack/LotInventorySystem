import { useEffect, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Input, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuTags } from 'react-icons/lu'
import SegmentedControl from '@/components/ui-kit/SegmentedControl'
import { PRICE_CONFIG, fetchPrices, savePrices } from '@/data/pricesData'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'

/**
 * Edit the price per sqm of each lot category for the selected project. Opening
 * it (or switching scope) loads the stored prices into the fields.
 */
export default function CategoryPricesDialog({ open, project, onClose, onSaved }) {
  const config = PRICE_CONFIG[project.code]
  const [scope, setScope] = useState(config?.scopes[0].value ?? '')
  const [values, setValues] = useState({})
  const [stored, setStored] = useState({}) // prices as loaded; null = category not priced in this scope
  const [loaded, setLoaded] = useState(null) // `${code}:${scope}` of the values on screen
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadKey = `${project.code}:${scope}`

  useEffect(() => {
    if (!open || !config) return undefined
    let cancelled = false
    fetchPrices(project.code, scope)
      .then((prices) => {
        if (cancelled) return
        setStored(prices)
        setValues(Object.fromEntries(Object.entries(prices).map(([key, price]) => [key, price ?? ''])))
        setError('')
        setLoaded(loadKey)
      })
      .catch((err) => {
        if (cancelled) return
        setError(`Could not load prices: ${err.message}`)
        setLoaded(loadKey)
      })
    return () => {
      cancelled = true
    }
  }, [open, config, project.code, scope, loadKey])

  const loading = Boolean(config) && loaded !== loadKey

  function handleOpenChange({ open: next }) {
    if (next || saving) return
    setScope(config?.scopes[0].value ?? '')
    setLoaded(null)
    setError('')
    onClose()
  }

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      const numbers = Object.fromEntries(
        Object.entries(values)
          .filter(([, value]) => String(value).trim() !== '')
          .map(([key, value]) => [key, Number(value)]),
      )
      const invalid = Object.entries(numbers).find(([, value]) => !Number.isFinite(value) || value < 0)
      if (invalid) throw new Error('Prices must be positive numbers.')

      const { repriced } = await savePrices(project.code, scope, numbers)
      setSaving(false)
      handleOpenChange({ open: false })
      onSaved?.(repriced)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} placement="center" size="sm">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px">
              <Flex align="center" gap="10px">
                <Icon as={LuTags} boxSize="18px" color={COLORS.heading} />
                <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="18px" color={COLORS.heading}>
                  Update Category Prices
                </Dialog.Title>
              </Flex>
            </Dialog.Header>

            <Dialog.Body py="18px">
              {!config ? (
                <Text fontFamily={FONT} fontSize="14px" color={COLORS.subtle}>
                  No price table is set up for {project.name || 'this project'} yet.
                </Text>
              ) : (
                <Flex direction="column" gap="16px">

                  {config.scopes.length > 1 ? (
                    <Flex align="center" gap="10px" flexWrap="wrap">
                      <Text fontFamily={FONT} fontSize="14px" color={COLORS.heading}>
                        Price scope:
                      </Text>
                      <SegmentedControl
                        options={config.scopes.map(({ value, label }) => ({ value, label }))}
                        value={scope}
                        onChange={setScope}
                      />
                    </Flex>
                  ) : null}

                  {loading ? (
                    <Flex justify="center" py="24px">
                      <Spinner color={COLORS.brandGreen} />
                    </Flex>
                  ) : (
                    /*
                     * A project priced per phase (MVLC) prices a different set of
                     * categories in each one, so only those already priced in this
                     * scope are shown. A project with a single scope shows all of its
                     * categories, so one that has never been priced can still be given
                     * a first price. Clearing a field keeps it visible either way.
                     */
                    config.categories
                      .filter(({ key }) => config.scopes.length === 1 || (stored[key] !== null && stored[key] !== undefined))
                      .map(({ key, label }) => (
                      <Flex key={key} align="center" justify="space-between" gap="16px">
                        <Text as="label" htmlFor={`price-${key}`} fontFamily={FONT} fontSize="14px" color={COLORS.heading}>
                          {label}
                        </Text>
                        <Input
                          id={`price-${key}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={values[key] ?? ''}
                          onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))}
                          placeholder="—"
                          w="48%"
                          h="44px"
                          borderRadius="10px"
                          fontFamily={FONT}
                          fontSize="14px"
                        />
                      </Flex>
                    ))
                  )}

                  {error ? (
                    <Text role="alert" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                      {error}
                    </Text>
                  ) : null}
                </Flex>
              )}
            </Dialog.Body>

            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px">
              <Box
                as="button"
                type="button"
                onClick={() => handleOpenChange({ open: false })}
                disabled={saving}
                h="40px"
                px="18px"
                borderRadius="8px"
                bg={COLORS.hoverBg}
                fontFamily={FONT}
                fontWeight="500"
                fontSize="14px"
                color={COLORS.heading}
                cursor="pointer"
                _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
              >
                Cancel
              </Box>
              <Flex
                as="button"
                type="button"
                onClick={handleSave}
                disabled={!config || loading || saving}
                align="center"
                gap="8px"
                h="40px"
                px="18px"
                borderRadius="8px"
                bg={COLORS.activeBg}
                color="#FFFFFF"
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                cursor="pointer"
                _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
              >
                {saving ? <Spinner size="sm" /> : null}
                {saving ? 'Saving…' : 'Save & Apply'}
              </Flex>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" disabled={saving} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
