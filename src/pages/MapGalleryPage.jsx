import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, CloseButton, Dialog, Flex, Icon, Image, Input, Portal, Spinner, Text } from '@chakra-ui/react'
import { LuDownload, LuLock, LuMap, LuSearch } from 'react-icons/lu'
import logo from '@/assets/BHRI OFFICIAL LOGO TRANSPARENT.png'
import SegmentedControl from '@/components/ui-kit/SegmentedControl'
import { WrongPasswordError, fetchGalleryMaps } from '@/data/mapGalleryData'
import { COMPRESSION, MIN_READABLE_SIDE, fileNameOf, mapPng, saveBlob } from '@/lib/mapDownload'
import { notifyFailed } from '@/lib/notify'
import { COLORS } from '@/theme/colors'

/*
 * The public map gallery at /maps/: everyone holding the gallery password sees
 * every current project map and can download each as an HD PNG, optionally
 * compressed. Nothing else of the portal is here — no sign-in, no editing.
 */

const FONT = 'Inter, system-ui, sans-serif'
const HEADING_FONT = '"Plus Jakarta Sans", Inter, system-ui, sans-serif'
// The tab keeps the password, so a refresh does not ask again; closing the tab forgets it.
const PASSWORD_KEY = 'bhri.mapGallery.password'

const QUALITY_HELP = {
  hd: 'Lossless PNG at full resolution — the sharpest file, and the largest.',
  balanced: 'Same full resolution with a 256-colour palette — usually several times smaller, with every lot number just as readable.',
  smallest: `256 colours and scaled down a little, but never below ${MIN_READABLE_SIDE} px on the long side, so labels stay legible.`,
}

const storage = {
  get: () => { try { return sessionStorage.getItem(PASSWORD_KEY) ?? '' } catch { return '' } },
  set: (value) => { try { sessionStorage.setItem(PASSWORD_KEY, value) } catch { /* private mode: ask again next time */ } },
  clear: () => { try { sessionStorage.removeItem(PASSWORD_KEY) } catch { /* nothing kept */ } },
}

const megabytes = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

const greenButton = { bg: COLORS.brandGreen, color: '#FFFFFF', _hover: { bg: '#00541F' }, fontFamily: FONT, fontWeight: '600' }

export default function MapGalleryPage() {
  const [maps, setMaps] = useState(null)
  // A password kept from earlier in this tab is tried once, before asking.
  const [resuming, setResuming] = useState(() => Boolean(storage.get()))
  const tried = useRef(false)

  useEffect(() => {
    if (!resuming || tried.current) return
    tried.current = true
    fetchGalleryMaps(storage.get())
      .then(setMaps, () => storage.clear())
      .finally(() => setResuming(false))
  }, [resuming])

  if (resuming) {
    return (
      <Flex minH="100dvh" align="center" justify="center" bg={COLORS.canvas}>
        <Spinner size="lg" color={COLORS.brandGreen} />
      </Flex>
    )
  }
  if (!maps) return <LockScreen onUnlock={setMaps} />
  return (
    <Gallery
      maps={maps}
      onLock={() => {
        storage.clear()
        setMaps(null)
      }}
    />
  )
}

function LockScreen({ onUnlock }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function unlock() {
    setBusy(true)
    setError('')
    try {
      const maps = await fetchGalleryMaps(password)
      storage.set(password)
      onUnlock(maps)
    } catch (err) {
      setError(err instanceof WrongPasswordError ? 'That password is not right. Check it and try again.' : err.message)
      setBusy(false)
    }
  }

  return (
    <Flex minH="100dvh" align="center" justify="center" bg={COLORS.canvas} px="16px" py="32px">
      <Box
        as="form"
        w="100%"
        maxW="400px"
        bg={COLORS.surface}
        border="1px solid"
        borderColor={COLORS.border}
        borderRadius="16px"
        p={{ base: '24px', sm: '32px' }}
        boxShadow="0 8px 24px rgba(11, 28, 48, 0.06)"
        onSubmit={(event) => {
          event.preventDefault()
          if (password && !busy) unlock()
        }}
      >
        <Image src={logo} alt="BHRI" h="56px" mx="auto" mb="20px" />
        <Text as="h1" fontFamily={HEADING_FONT} fontWeight="700" fontSize="22px" color={COLORS.heading} textAlign="center">
          Site Maps
        </Text>
        <Text fontFamily={FONT} fontSize="14px" color={COLORS.subtle} textAlign="center" mt="6px" mb="24px">
          Enter the password you were given to view and download the project maps.
        </Text>
        <Text as="label" htmlFor="gallery-password" display="block" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading} mb="6px">
          Password
        </Text>
        <Input
          id="gallery-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'gallery-error' : undefined}
          fontFamily={FONT}
          h="44px"
        />
        {error ? (
          <Text id="gallery-error" role="alert" fontFamily={FONT} fontSize="13px" color={COLORS.danger} mt="8px">
            {error}
          </Text>
        ) : null}
        <Button type="submit" w="100%" h="44px" mt="16px" {...greenButton} loading={busy} disabled={!password}>
          <LuLock /> View maps
        </Button>
      </Box>
    </Flex>
  )
}

function Gallery({ maps, onLock }) {
  const [quality, setQuality] = useState('hd')
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState(null)
  const [downloading, setDownloading] = useState(() => new Set())
  // The size each map last downloaded at, so people see what compression saved.
  const [sizes, setSizes] = useState({})

  const projects = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const groups = new Map()
    for (const map of maps) {
      const haystack = `${map.projectName} ${map.projectCode} ${map.label}`.toLowerCase()
      if (!words.every((word) => haystack.includes(word))) continue
      if (!groups.has(map.projectCode)) groups.set(map.projectCode, { code: map.projectCode, name: map.projectName, maps: [] })
      groups.get(map.projectCode).maps.push(map)
    }
    return [...groups.values()]
  }, [maps, search])

  async function download(map) {
    setDownloading((current) => new Set(current).add(map.id))
    try {
      const png = await mapPng(map.url, quality)
      saveBlob(png, `${fileNameOf(`${map.projectCode} ${map.label}`)}-${quality}.png`)
      setSizes((current) => ({ ...current, [map.id]: { quality, bytes: png.size } }))
    } catch (err) {
      notifyFailed(`${map.projectCode} ${map.label} not downloaded`, err)
    } finally {
      setDownloading((current) => {
        const next = new Set(current)
        next.delete(map.id)
        return next
      })
    }
  }

  return (
    <Box minH="100dvh" bg={COLORS.canvas}>
      <Box as="header" bg={COLORS.surface} borderBottom="1px solid" borderColor={COLORS.border} position="sticky" top="0" zIndex="10">
        <Flex maxW="1200px" mx="auto" px={{ base: '16px', md: '24px' }} h="64px" align="center" gap="12px">
          <Image src={logo} alt="BHRI" h="36px" />
          <Text as="h1" fontFamily={HEADING_FONT} fontWeight="700" fontSize="18px" color={COLORS.heading} flex="1" minW={0} truncate>
            Site Maps
          </Text>
          <Button variant="outline" size="sm" fontFamily={FONT} onClick={onLock}>
            <LuLock /> Lock
          </Button>
        </Flex>
      </Box>

      <Box as="main" maxW="1200px" mx="auto" px={{ base: '16px', md: '24px' }} py="24px">
        <Flex
          direction={{ base: 'column', md: 'row' }}
          gap="16px"
          align={{ base: 'stretch', md: 'flex-start' }}
          justify="space-between"
          bg={COLORS.surface}
          border="1px solid"
          borderColor={COLORS.border}
          borderRadius="12px"
          p="16px"
          mb="24px"
        >
          <Box flex="1" maxW={{ md: '360px' }}>
            <Text as="label" htmlFor="gallery-search" display="block" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading} mb="6px">
              Find a map
            </Text>
            <Box position="relative">
              <Icon as={LuSearch} position="absolute" left="12px" top="50%" transform="translateY(-50%)" color={COLORS.subtle} boxSize="16px" zIndex="1" />
              <Input
                id="gallery-search"
                type="search"
                placeholder="Project or phase"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                ps="36px"
                fontFamily={FONT}
              />
            </Box>
          </Box>
          <Box minW={0}>
            <Text fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading} mb="6px">
              Download quality
            </Text>
            <Box overflowX="auto">
              <SegmentedControl
                value={quality}
                onChange={setQuality}
                activeColor={COLORS.brandGreen}
                options={Object.entries(COMPRESSION).map(([value, { label }]) => ({ value, label }))}
              />
            </Box>
            <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle} mt="6px" maxW="420px">
              {QUALITY_HELP[quality]}
            </Text>
          </Box>
        </Flex>

        {projects.length === 0 ? (
          <Flex direction="column" align="center" py="64px" gap="8px" color={COLORS.subtle}>
            <Icon as={LuMap} boxSize="32px" />
            <Text fontFamily={FONT} fontSize="14px">{maps.length ? 'No maps match your search.' : 'There are no maps to show yet.'}</Text>
          </Flex>
        ) : (
          projects.map((project) => (
            <Box as="section" key={project.code} mb="32px" aria-labelledby={`project-${project.code}`}>
              <Flex align="baseline" gap="8px" mb="12px" wrap="wrap">
                <Text as="h2" id={`project-${project.code}`} fontFamily={HEADING_FONT} fontWeight="700" fontSize="17px" color={COLORS.heading}>
                  {project.name}
                </Text>
                <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>
                  {project.code !== project.name ? `${project.code} · ` : ''}{project.maps.length} {project.maps.length === 1 ? 'map' : 'maps'}
                </Text>
              </Flex>
              <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(min(100%, 260px), 1fr))" gap="16px">
                {project.maps.map((map) => (
                  <MapCard
                    key={map.id}
                    map={map}
                    busy={downloading.has(map.id)}
                    saved={sizes[map.id]}
                    onPreview={() => setPreview(map)}
                    onDownload={() => download(map)}
                  />
                ))}
              </Box>
            </Box>
          ))
        )}
      </Box>

      <Dialog.Root open={Boolean(preview)} onOpenChange={({ open }) => { if (!open) setPreview(null) }} size="cover">
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title fontFamily={HEADING_FONT}>{preview ? `${preview.projectName} — ${preview.label}` : ''}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body display="flex" alignItems="center" justifyContent="center" minH={0} overflow="auto" bg={COLORS.canvas}>
                {preview ? (
                  <Image src={preview.url} alt={`${preview.projectName} ${preview.label} map`} maxW="100%" maxH="100%" objectFit="contain" />
                ) : null}
              </Dialog.Body>
              <Dialog.Footer>
                {preview ? (
                  <Button {...greenButton} loading={downloading.has(preview.id)} onClick={() => download(preview)}>
                    <LuDownload /> Download PNG · {COMPRESSION[quality].label}
                  </Button>
                ) : null}
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Box>
  )
}

function MapCard({ map, busy, saved, onPreview, onDownload }) {
  return (
    <Flex direction="column" bg={COLORS.surface} border="1px solid" borderColor={COLORS.border} borderRadius="12px" overflow="hidden">
      <Box
        as="button"
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${map.projectName} ${map.label}`}
        aspectRatio="4 / 3"
        bg={COLORS.canvas}
        borderBottom="1px solid"
        borderColor={COLORS.border}
        cursor="zoom-in"
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '-2px' }}
      >
        <Image src={map.url} alt="" loading="lazy" decoding="async" w="100%" h="100%" objectFit="contain" p="8px" />
      </Box>
      <Flex direction="column" gap="10px" p="12px" flex="1">
        <Box>
          <Text fontFamily={FONT} fontWeight="600" fontSize="14px" color={COLORS.heading}>{map.label}</Text>
          {map.updatedAt ? (
            <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
              Updated {new Date(map.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
            </Text>
          ) : null}
        </Box>
        <Button mt="auto" size="sm" {...greenButton} loading={busy} loadingText="Preparing…" onClick={onDownload}>
          <LuDownload /> Download PNG
        </Button>
        {saved ? (
          <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle} role="status">
            Saved · {COMPRESSION[saved.quality].label} · {megabytes(saved.bytes)}
          </Text>
        ) : null}
      </Flex>
    </Flex>
  )
}
