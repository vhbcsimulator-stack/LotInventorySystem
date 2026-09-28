import { useEffect, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Input, NativeSelect, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuTags } from 'react-icons/lu'
import { PRICE_CONFIG, fetchPrices, savePrices } from '@/data/pricesData'
import { fetchProjectMaps } from '@/data/projectMapsData'
import { COLORS } from '@/theme/colors'
import { notifyFailed, notifySaved } from '@/lib/notify'

const FONT = 'Inter, system-ui, sans-serif'

/** The phase a map tab stands for; null for Whole Map and Commercial. */
function tabPhase(tabValue) {
  const match = /^phase-(\d+)/.exec(tabValue ?? '')
  return match ? Number(match[1]) : null
}

/**
 * The scope choices, named after the project's map tabs minus Whole Map
 * (Annotated is not a map tab, so it never appears here). Each choice edits the
 * price row of its phase, which means MVLC's sections — Phase 1A, 1B, 1C, 1East
 * — all read and write the one row Phase 1 has. A tab with no price row behind
 * it, such as MVLC's Commercial, is left out.
 */
function buildScopeOptions(config, tabs) {
  if (!config) return []
  return tabs
    .filter((tab) => tab.value !== 'whole')
    .map((tab) => {
      const scope =
        config.scopes.length === 1
          ? config.scopes[0]
          : config.scopes.find((candidate) => candidate.phase === tabPhase(tab.value))
      return scope ? { value: tab.value, label: tab.label, scope: scope.value } : null
    })
    .filter(Boolean)
}

/**
 * Edit the price per sqm of each lot category for the selected project. Opening
 * it (or switching scope) loads the stored prices into the fields.
 */
export default function CategoryPricesDialog({ open, project, onClose, onSaved }) {
  const config = PRICE_CONFIG[project.code]
  const [options, setOptions] = useState([]) // scope choices, taken from the map tabs
  const [tab, setTab] = useState('') // the chosen map tab
  const [values, setValues] = useState({})
  const [stored, setStored] = useState({}) // prices as loaded; null = category not priced in this scope
  const [loaded, setLoaded] = useState(null) // `${code}:${scope}` of the values on screen
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Until the map tabs arrive the first price scope stands in, so the fields
  // still fill for a project whose maps are missing or slow.
  const scope = options.find((option) => option.value === tab)?.scope ?? config?.scopes[0].value ?? ''
  const loadKey = `${project.code}:${scope}`

  useEffect(() => {
    if (!open || !config) return undefined
    let cancelled = false
    // Never throws: a project without maps simply has no tabs to offer.
    fetchProjectMaps({ projectCode: project.code }).then(({ tabs }) => {
      if (cancelled) return
      const next = buildScopeOptions(config, tabs)
      setOptions(next)
      setTab((prev) => (next.some((option) => option.value === prev) ? prev : next[0]?.value ?? ''))
    })
    return () => {
      cancelled = true
    }
  }, [open, config, project.code])

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
    setTab(options[0]?.value ?? '')
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
      notifySaved('Prices saved', `${project.name ?? project.code} category prices were updated.`)
      setSaving(false)
      handleOpenChange({ open: false })
      onSaved?.(repriced)
    } catch (err) {
      setError(err.message)
      notifyFailed('Could not save the prices', err)
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} placement="center" size="sm" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxH="calc(100dvh - 32px)">
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

                  {config.scopes.length > 1 && options.length > 1 ? (
                    <Flex align="center" gap="10px" flexWrap="wrap">
                      <Text as="label" htmlFor="price-scope" fontFamily={FONT} fontSize="14px" color={COLORS.heading}>
                        Price scope:
                      </Text>
                      <Box flex="1" minW="160px">
                        <NativeSelect.Root size="sm">
                          <NativeSelect.Field
                            id="price-scope"
                            value={tab}
                            disabled={saving}
                            onChange={(event) => setTab(event.target.value)}
                            fontFamily={FONT}
                            fontSize="14px"
                          >
                            {options.map(({ value, label }) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      </Box>
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

            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px" flexWrap="wrap">
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
