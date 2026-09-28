import { useState } from 'react'
import { Flex, Icon } from '@chakra-ui/react'
import { LuRefreshCw } from 'react-icons/lu'
import { Tooltip } from '@/components/ui/tooltip'
import { toaster } from '@/components/ui/toaster'
import { COLORS } from '@/theme/colors'

/**
 * Icon button that re-checks a section against Supabase. `onRefresh` is a
 * useApiQuery `refresh`: it resolves to whether anything was refetched, and a
 * section whose tables did not change keeps its cached rows.
 */
export default function RefreshButton({ onRefresh, label = 'Refresh', size = '36px' }) {
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      const changed = await onRefresh()
      toaster.create({
        type: changed ? 'success' : 'info',
        title: changed ? 'Refreshed' : 'Already up to date',
        duration: 2500,
      })
    } catch (err) {
      toaster.create({ type: 'error', title: 'Could not refresh', description: err?.message ?? String(err ?? ''), duration: 7000, closable: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip content={label} openDelay={300}>
      <Flex
        as="button"
        type="button"
        aria-label={label}
        aria-busy={busy}
        onClick={handleClick}
        align="center"
        justify="center"
        boxSize={size}
        flexShrink={0}
        borderRadius="8px"
        border="1px solid"
        borderColor={COLORS.border}
        bg={COLORS.surface}
        color={COLORS.muted}
        cursor={busy ? 'progress' : 'pointer'}
        transition="background-color 120ms ease"
        _hover={{ bg: COLORS.hoverBg }}
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      >
        <Icon
          as={LuRefreshCw}
          boxSize="15px"
          css={busy ? { animation: 'refreshSpin 0.8s linear infinite', '@keyframes refreshSpin': { to: { transform: 'rotate(360deg)' } } } : undefined}
        />
      </Flex>
    </Tooltip>
  )
}
