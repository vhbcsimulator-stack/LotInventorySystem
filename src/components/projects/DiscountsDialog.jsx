import { useEffect, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Grid, Icon, Input, NativeSelect, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuPercent } from 'react-icons/lu'
import { PAYMENT_OPTIONS, fetchDiscounts, fetchSeparateProjects, saveDiscounts } from '@/data/discountsData'
import { COLORS } from '@/theme/colors'
import { notifyFailed, notifySaved } from '@/lib/notify'

const FONT = 'Inter, system-ui, sans-serif'
const FIELDS = ['discount', 'interest']

/** Stored rates to the strings the fields hold. */
const toFields = (rates) =>
  Object.fromEntries(
    Object.entries(rates).map(([option, { discount, interest }]) => [
      option,
      { discount: String(discount), interest: String(interest) },
    ]),
  )

/**
 * Edit the discount and interest rate of each payment option.
 *
 * The rates are shared: one set covers every project. A project that prices
 * differently can be switched to its own set, which then covers that project
 * alone and no longer follows the shared one. Switching it back puts it on the
 * shared set again and drops the rates it kept.
 */
export default function DiscountsDialog({ open, project, onClose, onSaved }) {
  // Both sets are held at once, so switching between them keeps what was typed.
  const [sharedValues, setSharedValues] = useState({}) // { [option]: { discount, interest } } as typed
  const [ownValues, setOwnValues] = useState({})
  const [separate, setSeparate] = useState(false) // is this project on its own set?
  const [wasSeparate, setWasSeparate] = useState(false) // ...as it was stored
  const [separateProjects, setSeparateProjects] = useState([])
  const [loaded, setLoaded] = useState(null) // the project code of the rates on screen
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    Promise.all([fetchDiscounts(project.code), fetchSeparateProjects()])
      .then(([{ shared, own, hasShared }, codes]) => {
        if (cancelled) return
        /*
         * With no shared set saved yet, this project's own rates stand in for it.
         * That covers the rows saved before the shared set existed: switching to
         * "All projects" then offers those rates rather than a row of zeroes.
         */
        setSharedValues(toFields(hasShared ? shared : (own ?? shared)))
        // A project not on its own set yet starts from the shared rates, so
        // separating it is a change from what it charges today, not from zero.
        setOwnValues(toFields(own ?? shared))
        setSeparate(Boolean(own))
        setWasSeparate(Boolean(own))
        setSeparateProjects(codes)
        setError('')
        setLoaded(project.code)
      })
      .catch((err) => {
        if (cancelled) return
        setError(`Could not load the discounts: ${err.message}`)
        setLoaded(project.code)
      })
    return () => {
      cancelled = true
    }
  }, [open, project.code])

  const loading = loaded !== project.code
  const values = separate ? ownValues : sharedValues
  const setValues = separate ? setOwnValues : setSharedValues
  // Other projects on their own rates, which editing the shared set leaves alone.
  const othersSeparate = separateProjects.filter((code) => code !== project.code)

  function handleOpenChange({ open: next }) {
    if (next || saving) return
    setLoaded(null)
    setError('')
    onClose()
  }

  function setRate(option, field, value) {
    setValues((prev) => ({ ...prev, [option]: { ...prev[option], [field]: value } }))
  }

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      // A field left blank means no rate, which is the same as zero.
      const numbers = Object.fromEntries(
        PAYMENT_OPTIONS.map(({ value }) => {
          const typed = values[value] ?? {}
          return [value, { discount: Number(typed.discount || 0), interest: Number(typed.interest || 0) }]
        }),
      )
      await saveDiscounts(project.code, numbers, { separate })
      const name = project.name ?? project.code
      notifySaved(
        'Discounts saved',
        separate
          ? `${name} now has its own payment option rates.`
          : `The shared payment option rates were updated${
              wasSeparate ? `, and ${name} follows them again.` : '.'
            }`,
      )
      setSaving(false)
      handleOpenChange({ open: false })
      onSaved?.({ separate })
    } catch (err) {
      setError(err.message)
      notifyFailed('Could not save the discounts', err)
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} placement="center" size="lg" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxH="calc(100dvh - 32px)">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px">
              <Flex align="center" gap="10px">
                <Icon as={LuPercent} boxSize="18px" color={COLORS.heading} />
                <Dialog.Title
                  fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
                  fontSize="18px"
                  color={COLORS.heading}
                >
                  Update Discount
                </Dialog.Title>
              </Flex>
            </Dialog.Header>

            <Dialog.Body py="18px">
              {loading ? (
                <Flex justify="center" py="24px">
                  <Spinner color={COLORS.brandGreen} />
                </Flex>
              ) : (
                <Flex direction="column" gap="12px">
                  <Box bg={COLORS.hoverBg} borderRadius="12px" p="12px">
                    <Flex align="center" gap="10px" flexWrap="wrap">
                      <Text as="label" htmlFor="rate-scope" fontFamily={FONT} fontSize="14px" color={COLORS.heading}>
                        These rates apply to:
                      </Text>
                      <Box flex="1" minW="200px">
                        <NativeSelect.Root size="sm">
                          <NativeSelect.Field
                            id="rate-scope"
                            value={separate ? 'separate' : 'all'}
                            disabled={saving}
                            onChange={(event) => setSeparate(event.target.value === 'separate')}
                            fontFamily={FONT}
                            fontSize="14px"
                          >
                            <option value="all">All projects</option>
                            <option value="separate">{project.name ?? project.code} only</option>
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      </Box>
                    </Flex>
                    <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle} mt="8px">
                      {!separate && othersSeparate.length
                        ? ` ${othersSeparate.join(', ')} ${othersSeparate.length === 1 ? 'keeps its' : 'keep their'} own rates and ${
                            othersSeparate.length === 1 ? 'is' : 'are'
                          } not affected.`
                        : ''}
                    </Text>
                  </Box>

                  <Grid templateColumns="1fr 1fr 1fr" gap="10px" alignItems="center">
                    <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle}>
                      Payment option
                    </Text>
                    <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle}>
                      Discount %
                    </Text>
                    <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle}>
                      Interest %
                    </Text>

                    {PAYMENT_OPTIONS.map(({ value, label }) => (
                      <Box key={value} display="contents">
                        <Text fontFamily={FONT} fontSize="14px" color={COLORS.heading}>
                          {label}
                        </Text>
                        {FIELDS.map((field) => (
                          <Input
                            key={field}
                            aria-label={`${label} ${field}`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="100"
                            value={values[value]?.[field] ?? ''}
                            onChange={(event) => setRate(value, field, event.target.value)}
                            disabled={saving}
                            placeholder="0"
                            h="42px"
                            borderRadius="10px"
                            fontFamily={FONT}
                            fontSize="14px"
                          />
                        ))}
                      </Box>
                    ))}
                  </Grid>

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
                disabled={loading || saving}
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
                {saving ? 'Saving…' : 'Save'}
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
