import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Flex, Icon, Input, Text } from '@chakra-ui/react'
import { LuClock3, LuCornerDownLeft, LuSearch, LuSparkles, LuTrash2 } from 'react-icons/lu'
import { COMMANDS, SEARCH_SUGGESTIONS, searchCommands } from '@/lib/commands'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'
const HISTORY_KEY = 'bhri-global-search-history'
const HISTORY_LIMIT = 6

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string').slice(0, HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

/**
 * Quick access from the top bar: type what you want and go straight to it —
 * a page, a project view, or a project action such as Add lot, which opens its
 * dialog on arrival rather than only taking you to the page around it.
 *
 * Runs from the keyboard alone: ↑/↓ move, Enter runs, Escape closes.
 */
export default function GlobalSearch({ onRun }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [historyIds, setHistoryIds] = useState(loadHistory)
  const boxRef = useRef(null)
  const inputRef = useRef(null)

  const results = useMemo(() => searchCommands(query), [query])
  const history = useMemo(
    () => historyIds.map((id) => COMMANDS.find((command) => command.id === id)).filter(Boolean),
    [historyIds],
  )

  // Clicking anywhere else puts the dropdown away.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Ctrl/Cmd+K from anywhere puts the cursor in the box.
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function run(command) {
    if (!command) return
    setHistoryIds((current) => {
      const next = [command.id, ...current.filter((id) => id !== command.id)].slice(0, HISTORY_LIMIT)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* Local storage may be unavailable. */ }
      return next
    })
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
    onRun?.(command)
  }

  function clearHistory() {
    setHistoryIds([])
    try { localStorage.removeItem(HISTORY_KEY) } catch { /* Local storage may be unavailable. */ }
  }

  function suggest(value) {
    setQuery(value)
    setHighlight(0)
    setOpen(true)
    inputRef.current?.focus()
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!results.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((prev) => (prev + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setHighlight((prev) => (prev - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(results[highlight])
    }
  }

  const trimmedQuery = query.trim()
  const showing = open

  return (
    <Box ref={boxRef} position="relative" flex="1" maxW="420px" minW="0" display={{ base: 'none', md: 'block' }}>
      <Flex align="center" position="relative">
        <Icon as={LuSearch} boxSize="16px" color={COLORS.subtle} position="absolute" left="12px" pointerEvents="none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search pages, projects, actions…"
          aria-label="Search the portal"
          role="combobox"
          aria-expanded={showing}
          aria-controls="global-search-results"
          autoComplete="off"
          h="38px"
          pl="34px"
          borderRadius="10px"
          bg={COLORS.canvas}
          fontFamily={FONT}
          fontSize="14px"
        />
      </Flex>

      {showing ? (
        <Box
          id="global-search-results"
          role="listbox"
          position="absolute"
          top="44px"
          left="0"
          right="0"
          zIndex={20}
          bg={COLORS.surface}
          border="1px solid"
          borderColor={COLORS.border}
          borderRadius="12px"
          boxShadow="0 12px 32px rgba(15, 23, 42, 0.14)"
          overflow="hidden"
          maxH="min(420px, 60vh)"
          overflowY="auto"
        >
          {!trimmedQuery ? (
            <Box p="8px">
              {history.length ? (
                <Box pb="8px" mb="4px" borderBottom="1px solid" borderColor={COLORS.border}>
                  <Flex align="center" justify="space-between" gap="8px" px="6px" py="5px">
                    <Flex align="center" gap="6px" color={COLORS.subtle}>
                      <Icon as={LuClock3} boxSize="13px" />
                      <Text fontFamily={FONT} fontSize="10px" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase">
                        Recent searches
                      </Text>
                    </Flex>
                    <Flex as="button" type="button" align="center" gap="4px" color={COLORS.subtle} fontFamily={FONT} fontSize="11px" cursor="pointer" _hover={{ color: COLORS.heading }} onClick={clearHistory}>
                      <Icon as={LuTrash2} boxSize="12px" />
                      Clear
                    </Flex>
                  </Flex>
                  {history.map((command) => (
                    <Flex
                      key={command.id}
                      as="button"
                      type="button"
                      w="full"
                      align="center"
                      justify="space-between"
                      gap="12px"
                      px="8px"
                      py="8px"
                      borderRadius="8px"
                      textAlign="left"
                      cursor="pointer"
                      _hover={{ bg: COLORS.hoverBg }}
                      onClick={() => run(command)}
                    >
                      <Flex align="center" gap="8px" minW={0}>
                        <Icon as={LuClock3} boxSize="13px" color={COLORS.subtle} flexShrink={0} />
                        <Text fontFamily={FONT} fontSize="13px" color={COLORS.heading} truncate>{command.label}</Text>
                      </Flex>
                      <Text fontFamily={FONT} fontSize="11px" color={COLORS.subtle} flexShrink={0}>{command.group}</Text>
                    </Flex>
                  ))}
                </Box>
              ) : null}
              <Flex align="center" gap="6px" px="6px" py="5px" color={COLORS.subtle}>
                <Icon as={LuSparkles} boxSize="13px" />
                <Text fontFamily={FONT} fontSize="10px" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase">
                  Suggested searches
                </Text>
              </Flex>
              <Flex gap="7px" p="6px" flexWrap="wrap">
                {SEARCH_SUGGESTIONS.map((suggestion) => (
                  <Flex
                    key={suggestion}
                    as="button"
                    type="button"
                    align="center"
                    gap="6px"
                    px="9px"
                    py="7px"
                    border="1px solid"
                    borderColor={COLORS.border}
                    borderRadius="8px"
                    bg={COLORS.surface}
                    color={COLORS.heading}
                    fontFamily={FONT}
                    fontSize="12px"
                    cursor="pointer"
                    _hover={{ bg: COLORS.hoverBg }}
                    onClick={() => suggest(suggestion)}
                  >
                    <Icon as={LuSearch} boxSize="12px" color={COLORS.subtle} />
                    {suggestion}
                  </Flex>
                ))}
              </Flex>
            </Box>
          ) : results.length ? (
            results.map((command, index) => (
              <Flex
                key={command.id}
                as="button"
                type="button"
                role="option"
                aria-selected={index === highlight}
                w="100%"
                align="center"
                justify="space-between"
                gap="12px"
                px="12px"
                py="10px"
                textAlign="left"
                cursor="pointer"
                bg={index === highlight ? COLORS.hoverBg : 'transparent'}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => run(command)}
              >
                <Text fontFamily={FONT} fontSize="14px" color={COLORS.heading} truncate>
                  {command.label}
                </Text>
                <Flex align="center" gap="8px" flexShrink={0}>
                  <Text fontFamily={FONT} fontSize="11px" color={COLORS.subtle}>
                    {command.group}
                  </Text>
                  {index === highlight ? <Icon as={LuCornerDownLeft} boxSize="13px" color={COLORS.subtle} /> : null}
                </Flex>
              </Flex>
            ))
          ) : (
            <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle} px="12px" py="14px">
              Nothing matches &ldquo;{trimmedQuery}&rdquo;. Try Color Lots, Lot Outlines, or Add Lot.
            </Text>
          )}
        </Box>
      ) : null}
    </Box>
  )
}
