import { Flex, Icon, Text } from '@chakra-ui/react'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { COLORS } from '@/theme/colors'

/**
 * Page numbers to show: always the first and last page, a window around the
 * current one, and 'gap' markers where pages are skipped.
 * e.g. page 1 of 26 -> [1, 2, 3, 4, 'gap', 26]
 */
function pageItems(page, count) {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1)

  const start = Math.max(2, Math.min(page - 1, count - 4))
  const end = Math.min(count - 1, Math.max(page + 1, 4))

  const items = [1]
  if (start > 2) items.push('gap')
  for (let n = start; n <= end; n += 1) items.push(n)
  if (end < count - 1) items.push('gap')
  items.push(count)
  return items
}

function PageButton({ children, isActive = false, disabled = false, onClick, label }) {
  return (
    <Flex
      as="button"
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      align="center"
      justify="center"
      minW="34px"
      h="34px"
      px="8px"
      borderRadius="8px"
      cursor={disabled ? 'default' : 'pointer'}
      opacity={disabled ? 0.4 : 1}
      bg={isActive ? COLORS.brandGreen : 'transparent'}
      color={isActive ? '#FFFFFF' : COLORS.muted}
      border="1px solid"
      borderColor={isActive ? COLORS.brandGreen : 'transparent'}
      transition="background-color 120ms ease"
      _hover={disabled || isActive ? undefined : { bg: COLORS.hoverBg }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '1px' }}
    >
      {typeof children === 'number' ? (
        <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="13px">
          {children}
        </Text>
      ) : (
        children
      )}
    </Flex>
  )
}

/** Numbered pager. Renders nothing when everything fits on one page. */
export default function Pagination({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null

  return (
    <Flex as="nav" aria-label="Pagination" align="center" gap="4px" maxW="100%" minW={0} overflowX="auto">
      <PageButton label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <Icon as={LuChevronLeft} boxSize="16px" />
      </PageButton>

      {pageItems(page, pageCount).map((item, index) =>
        item === 'gap' ? (
          <Text
            key={`gap-${index}`}
            aria-hidden="true"
            px="4px"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="13px"
            color={COLORS.subtle}
          >
            …
          </Text>
        ) : (
          <PageButton
            key={item}
            label={`Page ${item}`}
            isActive={item === page}
            onClick={() => onChange(item)}
          >
            {item}
          </PageButton>
        ),
      )}

      <PageButton
        label="Next page"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        <Icon as={LuChevronRight} boxSize="16px" />
      </PageButton>
    </Flex>
  )
}
