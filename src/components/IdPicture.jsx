import { useEffect, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Image, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuIdCard, LuImageOff, LuRotateCcw, LuRotateCw } from 'react-icons/lu'
import { idPictureUrl } from '@/data/idPictures'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'

/** The browser URL for a stored ID picture: { url, loading }. */
function useIdPictureUrl(value) {
  const [state, setState] = useState({ value: null, url: null })

  useEffect(() => {
    if (!value) return undefined
    let cancelled = false
    idPictureUrl(value).then(
      (url) => !cancelled && setState({ value, url }),
      () => !cancelled && setState({ value, url: null }),
    )
    return () => {
      cancelled = true
    }
  }, [value])

  if (!value) return { url: null, loading: false }
  // No answer yet for this picture (or only for an earlier one): still loading.
  if (state.value !== value) return { url: null, loading: true }
  return { url: state.url, loading: false }
}

function RotateButton({ icon, label, onClick }) {
  return (
    <Box
      as="button"
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      display="flex"
      alignItems="center"
      justifyContent="center"
      boxSize="32px"
      borderRadius="8px"
      bg={COLORS.hoverBg}
      color={COLORS.heading}
      cursor="pointer"
      _hover={{ bg: COLORS.statusBg }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
    >
      <Icon as={icon} boxSize="16px" />
    </Box>
  )
}

/**
 * A stored ID picture (`value`, see data/idPictures.js) as a thumbnail that
 * opens full size, where it can be turned in quarter steps (IDs are often
 * photographed sideways). Shows "No ID picture" when there is none, and says so when
 * the picture cannot be loaded.
 */
export default function IdPicture({ value, name, h = '160px' }) {
  const { url, loading } = useIdPictureUrl(value)
  const [open, setOpen] = useState(false)
  // Quarter turns clockwise in the full-size view; a fresh opening starts upright.
  const [turns, setTurns] = useState(0)
  const sideways = turns % 2 !== 0
  const [brokenUrl, setBrokenUrl] = useState(null)
  const label = name ? `ID picture of ${name}` : 'ID picture'

  if (!value || (!loading && !url) || (url && url === brokenUrl)) {
    return (
      <Flex align="center" justify="center" gap="8px" h="56px" borderRadius="10px" border="1px dashed" borderColor={COLORS.border} color={COLORS.muted}>
        <Icon as={value ? LuImageOff : LuIdCard} boxSize="16px" />
        <Text fontFamily={FONT} fontSize="13px">
          {value ? 'The ID picture could not be loaded' : 'No ID picture'}
        </Text>
      </Flex>
    )
  }

  return (
    <>
      <Box
        as="button"
        type="button"
        onClick={() => {
          if (!url) return
          setTurns(0)
          setOpen(true)
        }}
        aria-label={`Open ${label}`}
        display="block"
        w="full"
        h={h}
        borderRadius="10px"
        overflow="hidden"
        bg={COLORS.canvas}
        border="1px solid"
        borderColor={COLORS.border}
        cursor={url ? 'zoom-in' : 'default'}
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      >
        {url ? (
          <Image src={url} alt={label} w="full" h="full" objectFit="contain" onError={() => setBrokenUrl(url)} />
        ) : (
          <Flex h="full" align="center" justify="center">
            <Spinner size="sm" color={COLORS.muted} />
          </Flex>
        )}
      </Box>

      <Dialog.Root open={open} onOpenChange={({ open: next }) => setOpen(next)} placement="center" size="xl">
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner px="16px">
            <Dialog.Content borderRadius="16px" overflow="hidden">
              <Dialog.Header py="14px" pr="56px" borderBottom="1px solid" borderColor={COLORS.border}>
                <Flex align="center" justify="space-between" gap="12px" w="full">
                  <Dialog.Title fontFamily={FONT} fontSize="15px" color={COLORS.heading} truncate>
                    {label}
                  </Dialog.Title>
                  <Flex gap="6px" flexShrink={0}>
                    <RotateButton icon={LuRotateCcw} label="Rotate left" onClick={() => setTurns((n) => n - 1)} />
                    <RotateButton icon={LuRotateCw} label="Rotate right" onClick={() => setTurns((n) => n + 1)} />
                  </Flex>
                </Flex>
              </Dialog.Header>
              <Dialog.CloseTrigger asChild top="10px" right="10px">
                <CloseButton size="sm" aria-label="Close" />
              </Dialog.CloseTrigger>
              <Dialog.Body p="12px" bg={COLORS.canvas}>
                {/*
                 * A size container, so a sideways image can be fitted with its width
                 * against the box's height (cqh) and its height against the width (cqw).
                 */}
                <Flex h="75vh" align="center" justify="center" overflow="hidden" style={{ containerType: 'size' }}>
                  {url ? (
                    <Image
                      src={url}
                      alt={label}
                      maxW={sideways ? '100cqh' : '100cqw'}
                      maxH={sideways ? '100cqw' : '100cqh'}
                      objectFit="contain"
                      transform={`rotate(${turns * 90}deg)`}
                      transition="transform 200ms ease"
                    />
                  ) : null}
                </Flex>
              </Dialog.Body>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  )
}
