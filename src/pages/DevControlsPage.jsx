import { useState } from 'react'
import { Box, Flex, Icon, Input, Text } from '@chakra-ui/react'
import { LuEye, LuEyeOff, LuGlobe, LuSearch, LuShieldCheck, LuWrench } from 'react-icons/lu'
import PageHeader from '@/components/PageHeader'
import { Card, CardHeading } from '@/components/ui-kit/Card'
import SegmentedControl from '@/components/ui-kit/SegmentedControl'
import ToolbarButton from '@/components/ui-kit/ToolbarButton'
import { reloadPortalControls, savePortalControl } from '@/data/portalControlsData'
import usePortalControls from '@/hooks/usePortalControls'
import { notifyFailed, notifySaved } from '@/lib/notify'
import {
  BUTTON_CONTROLS,
  CONTROL_STATE,
  PAGE_CONTROLS,
  PORTAL_CONTROL,
  controlMessage,
  controlState,
} from '@/lib/portalControls'
import { COLORS } from '@/theme/colors'

const FONT = 'Inter, system-ui, sans-serif'

const STATE_OPTIONS = [
  { value: CONTROL_STATE.VISIBLE, label: 'Visible', icon: LuEye },
  { value: CONTROL_STATE.HIDDEN, label: 'Hidden', icon: LuEyeOff },
  { value: CONTROL_STATE.MAINTENANCE, label: 'Maintenance', icon: LuWrench },
]

const PORTAL_OPTIONS = [
  { value: CONTROL_STATE.VISIBLE, label: 'Live', icon: LuGlobe },
  { value: CONTROL_STATE.MAINTENANCE, label: 'Maintenance', icon: LuWrench },
]

const STATE_COLOR = {
  [CONTROL_STATE.VISIBLE]: COLORS.activeBg,
  [CONTROL_STATE.HIDDEN]: '#4B5563',
  [CONTROL_STATE.MAINTENANCE]: '#B45309',
}

const STATE_NOTE = {
  [CONTROL_STATE.VISIBLE]: 'Visible to everyone.',
  [CONTROL_STATE.HIDDEN]: 'Hidden from everyone but developers.',
  [CONTROL_STATE.MAINTENANCE]: 'Under maintenance for everyone but developers.',
}

function updatedNote(row) {
  if (!row?.updated_at) return ''
  const when = new Date(row.updated_at).toLocaleString()
  return row.updated_by ? `Changed ${when} by ${row.updated_by}` : `Changed ${when}`
}

/**
 * One switchable thing: its state saves as soon as it is picked; under
 * maintenance it also takes the message people will see.
 */
function ControlRow({ id, label, options = STATE_OPTIONS, multiline = false }) {
  const { controls, user } = usePortalControls()
  const state = controlState(controls, id)
  const saved = controlMessage(controls, id)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const message = draft ?? saved

  async function save(nextState, nextMessage) {
    setBusy(true)
    try {
      await savePortalControl(id, { state: nextState, message: nextMessage }, user)
      await reloadPortalControls()
      setDraft(null)
      return true
    } catch (err) {
      notifyFailed(`Could not update ${label}`, err)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function changeState(next) {
    if (next === state || busy) return
    if (await save(next, message)) notifySaved(label, STATE_NOTE[next])
  }

  async function saveMessage() {
    if (await save(state, message)) notifySaved(label, 'Maintenance message saved.')
  }

  return (
    <Box py="12px" borderTop="1px solid" borderColor={COLORS.border} _first={{ borderTop: 'none' }}>
      <Flex align="center" justify="space-between" gap="12px" flexWrap="wrap">
        <Box minW={0}>
          <Text fontFamily={FONT} fontWeight="600" fontSize="14px" color={COLORS.heading}>{label}</Text>
          <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>{updatedNote(controls[id]) || id}</Text>
        </Box>
        <Box opacity={busy ? 0.6 : 1} pointerEvents={busy ? 'none' : undefined} maxW="100%" overflowX="auto">
          <SegmentedControl size="sm" options={options} value={state} onChange={changeState} activeColor={STATE_COLOR[state]} />
        </Box>
      </Flex>
      {state === CONTROL_STATE.MAINTENANCE ? (
        <Flex mt="10px" gap="8px" align={multiline ? 'flex-end' : 'center'} flexWrap="wrap">
          <Input
            as={multiline ? 'textarea' : 'input'}
            flex="1"
            minW="200px"
            minH={multiline ? '72px' : undefined}
            py={multiline ? '8px' : undefined}
            size="sm"
            value={message}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (!multiline && event.key === 'Enter') saveMessage()
            }}
            placeholder="Message"
            aria-label={`Maintenance message for ${label}`}
            fontFamily={FONT}
            fontSize="13px"
          />
          <ToolbarButton onClick={saveMessage} disabled={busy || message.trim() === saved} _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}>
            Save message
          </ToolbarButton>
        </Flex>
      ) : null}
    </Box>
  )
}

/**
 * Developer accounts only (App.jsx never routes anyone else here, and
 * portal_controls refuses their writes): show, hide, or put under maintenance
 * the whole portal, each page, and each listed button.
 */
export default function DevControlsPage() {
  const { controls } = usePortalControls()
  const [filter, setFilter] = useState('')
  const portalDown = controlState(controls, PORTAL_CONTROL) === CONTROL_STATE.MAINTENANCE
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (button) => {
    const text = `${button.label} ${button.section} ${button.page} ${button.id}`.toLowerCase()
    return words.every((word) => text.includes(word))
  }
  const buttons = BUTTON_CONTROLS.filter(matches)
  const pagesWithButtons = PAGE_CONTROLS.filter((page) => buttons.some((button) => button.page === page.page))

  return (
    <Flex direction="column" gap="16px" maxW="960px">
      <PageHeader
        title="Developer Controls"
        description="Show, hide, or put under maintenance the whole portal, its pages, and their buttons."
      />

      <Card>
        <CardHeading
          title="Whole portal"
          description={portalDown ? 'Everyone except developers sees the maintenance screen.' : 'The portal is open to everyone who signs in.'}
          actions={<Icon as={portalDown ? LuWrench : LuShieldCheck} boxSize="20px" color={portalDown ? '#000' : COLORS.brandGreen} />}
          mb="4px"
        />
        <ControlRow id={PORTAL_CONTROL} label="Portal" options={PORTAL_OPTIONS} multiline />
      </Card>

      <Card>
        <CardHeading title="Pages" description="Hidden pages leave the menu and search. Pages under maintenance stay in the menu but show the maintenance notice." mb="4px" />
        {PAGE_CONTROLS.map((page) => (
          <ControlRow key={page.id} id={page.id} label={page.label} />
        ))}
      </Card>

      <Flex
        align="center"
        gap="8px"
        h="40px"
        px="12px"
        borderRadius="8px"
        border="1px solid"
        borderColor={COLORS.border}
        bg={COLORS.surface}
      >
        <Icon as={LuSearch} boxSize="16px" color={COLORS.subtle} />
        <Input
          unstyled
          flex="1"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search Buttons"
          aria-label="Find a button"
          fontFamily={FONT}
          fontSize="13.5px"
        />
      </Flex>

      {pagesWithButtons.map((page) => {
        const pageButtons = buttons.filter((button) => button.page === page.page)
        const sections = [...new Set(pageButtons.map((button) => button.section))]
        return (
          <Card key={page.page}>
            <CardHeading title={`${page.label} | Buttons`}  mb="4px" />
            {sections.map((section) => (
              <Box key={section} mt="12px">
                <Text
                  fontFamily={FONT}
                  fontWeight="600"
                  fontSize="11px"
                  letterSpacing="0.55px"
                  textTransform="uppercase"
                  color={COLORS.muted}
                >
                  {section}
                </Text>
                {pageButtons.filter((button) => button.section === section).map((button) => (
                  <ControlRow key={button.id} id={button.id} label={button.label} />
                ))}
              </Box>
            ))}
          </Card>
        )
      })}

      {words.length && !buttons.length ? (
        <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>No button matches “{filter}”.</Text>
      ) : null}
    </Flex>
  )
}
