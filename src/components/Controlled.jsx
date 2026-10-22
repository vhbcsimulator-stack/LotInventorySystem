import { cloneElement } from 'react'
import { Box, Menu, Text } from '@chakra-ui/react'
import { Tooltip } from '@/components/ui/tooltip'
import { useControl } from '@/hooks/usePortalControls'
import { CONTROL_STATE } from '@/lib/portalControls'

const MENU_TAG = {
  [CONTROL_STATE.HIDDEN]: { label: 'Hidden', fg: '#374151', bg: '#E5E7EB' },
  [CONTROL_STATE.MAINTENANCE]: { label: 'Maintenance', fg: '#92400E', bg: '#FEF3E2' },
}

const DEV_NOTE = {
  [CONTROL_STATE.HIDDEN]: 'Hidden from everyone but developers',
  [CONTROL_STATE.MAINTENANCE]: 'Under maintenance for everyone but developers',
}

/**
 * The tooltip on anything a developer switched off: a heading, then the
 * message they left in Developer Controls. `children` must take a ref and
 * pointer events — wrap a disabled button in a span first, since a disabled
 * button fires no hover.
 */
export function ControlTooltip({ title = 'Under maintenance', message = '', placement = 'top', children }) {
  return (
    <Tooltip
      showArrow
      openDelay={150}
      positioning={{ placement }}
      contentProps={{ maxW: '280px', px: '10px', py: '8px' }}
      content={
        <Box>
          <Text fontWeight="700" fontSize="12.5px">{title}</Text>
          {message ? <Text mt="2px" fontSize="12.5px" whiteSpace="pre-line">{message}</Text> : null}
        </Box>
      }
    >
      {children}
    </Tooltip>
  )
}

/**
 * <Menu.Item> under a control: `<ControlledMenuItem control="button.clients.edit" value="edit">`.
 * Hidden: left out of the menu. Under maintenance: shown but cannot be picked,
 * with the message in a tooltip. A developer can always pick it, and sees a tag
 * (and the same tooltip) when others get something else.
 */
export function ControlledMenuItem({ control, children, disabled, ...props }) {
  const { state, message, developer, hidden, maintenance } = useControl(control)
  if (hidden) return null
  const tag = MENU_TAG[state]
  const item = (
    <Menu.Item {...props} disabled={disabled || maintenance}>
      {children}
      {tag ? (
        <Text as="span" ml="auto" pl="8px" flexShrink={0}>
          <Text as="span" px="6px" borderRadius="999px" bg={tag.bg} color={tag.fg} fontSize="10.5px" fontWeight="600" lineHeight="18px">
            {tag.label}
          </Text>
        </Text>
      ) : null}
    </Menu.Item>
  )
  if (!tag) return item
  return (
    <ControlTooltip title={developer ? DEV_NOTE[state] : 'Under maintenance'} message={message} placement="right">
      {item}
    </ControlTooltip>
  )
}

/**
 * Wrap one button whose id is listed in BUTTON_CONTROLS (lib/portalControls.js):
 *
 *   <Controlled id="button.clients.export"><ToolbarButton …/></Controlled>
 *
 * Hidden: the button is not rendered. Under maintenance: it stays in place but
 * is disabled, with the message in a tooltip. A developer always gets the
 * working button, outlined when everyone else gets something else.
 */
export default function Controlled({ id, children }) {
  const { state, message, developer, hidden, maintenance } = useControl(id)
  if (hidden) return null

  if (maintenance) {
    return (
      <ControlTooltip message={message}>
        <Box as="span" display="inline-flex" cursor="not-allowed" tabIndex={0} aria-label={message ? `Under maintenance: ${message}` : 'Under maintenance'}>
          {cloneElement(children, {
            disabled: true,
            onClick: undefined,
            'aria-disabled': true,
            _disabled: { opacity: 0.5, cursor: 'not-allowed' },
          })}
        </Box>
      </ControlTooltip>
    )
  }

  if (!developer || state === CONTROL_STATE.VISIBLE) return children
  return (
    <ControlTooltip title={DEV_NOTE[state]} message={message}>
      <Box
        as="span"
        display="inline-flex"
        borderRadius="10px"
        outline="2px dashed"
        outlineColor={state === CONTROL_STATE.HIDDEN ? '#6B7280' : '#D97706'}
        outlineOffset="2px"
      >
        {children}
      </Box>
    </ControlTooltip>
  )
}
