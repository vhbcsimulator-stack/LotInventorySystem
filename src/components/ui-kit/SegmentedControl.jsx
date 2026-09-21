import { Flex, Icon, Text } from '@chakra-ui/react'
import { COLORS } from '@/theme/colors'

/**
 * Pill group for mutually exclusive choices (time ranges, views). Controlled:
 * pass `value` and handle `onChange`. Options may carry an `icon`.
 */
export default function SegmentedControl({
  options,
  value,
  onChange,
  size = 'md',
  activeColor = COLORS.activeBg,
}) {
  const pad = size === 'sm' ? '4px 10px' : '6px 14px'
  const fontSize = size === 'sm' ? '12px' : '13px'

  return (
    <Flex
      role="group"
      align="center"
      gap="2px"
      p="3px"
      bg={COLORS.hoverBg}
      borderRadius="8px"
      flexShrink={0}
    >
      {options.map((option) => {
        const isActive = option.value === value
        const color = isActive ? activeColor : COLORS.subtle
        return (
          <Flex
            as="button"
            type="button"
            key={option.value}
            onClick={() => onChange?.(option.value)}
            aria-pressed={isActive}
            align="center"
            justify="center"
            gap="6px"
            p={pad}
            borderRadius="6px"
            cursor="pointer"
            bg={isActive ? COLORS.surface : 'transparent'}
            boxShadow={isActive ? '0px 1px 2px rgba(0, 0, 0, 0.06)' : undefined}
            transition="background-color 120ms ease"
            _hover={{ bg: isActive ? COLORS.surface : 'rgba(255,255,255,0.6)' }}
            _focusVisible={{
              outline: '2px solid',
              outlineColor: COLORS.activeBg,
              outlineOffset: '1px',
            }}
          >
            {option.icon ? <Icon as={option.icon} boxSize="14px" color={color} /> : null}
            <Text
              fontFamily="Inter, system-ui, sans-serif"
              fontWeight="600"
              fontSize={fontSize}
              lineHeight="18px"
              whiteSpace="nowrap"
              color={color}
            >
              {option.label}
            </Text>
          </Flex>
        )
      })}
    </Flex>
  )
}
