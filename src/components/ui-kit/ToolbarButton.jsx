import { forwardRef } from 'react'
import { Flex, Icon, Text } from '@chakra-ui/react'
import { COLORS } from '@/theme/colors'

/**
 * Compact page-level action button. `variant="primary"` is the filled green style.
 *
 * Forwards its ref and passes the rest of its props through, so it can serve as
 * the trigger of a menu or popover: without the ref the popup has no element to
 * measure against, and opens in the corner of the window rather than under the
 * button it belongs to.
 */
const ToolbarButton = forwardRef(function ToolbarButton({ icon, children, variant = 'ghost', onClick, ...rest }, ref) {
  const isPrimary = variant === 'primary'
  return (
    <Flex
      ref={ref}
      as="button"
      type="button"
      onClick={onClick}
      {...rest}
      align="center"
      gap="8px"
      h="36px"
      px="14px"
      borderRadius="8px"
      cursor="pointer"
      flexShrink={0}
      bg={isPrimary ? COLORS.brandGreen : COLORS.surface}
      border="1px solid"
      borderColor={isPrimary ? COLORS.brandGreen : COLORS.border}
      color={isPrimary ? '#FFFFFF' : COLORS.muted}
      transition="background-color 120ms ease"
      _hover={{ bg: isPrimary ? '#00522A' : COLORS.hoverBg }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
    >
      {icon ? <Icon as={icon} boxSize="15px" /> : null}
      <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="13px" lineHeight="18px" whiteSpace="nowrap">
        {children}
      </Text>
    </Flex>
  )
})

export default ToolbarButton
