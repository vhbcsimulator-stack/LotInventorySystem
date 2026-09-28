import { useState } from 'react'
import { Box, Flex, Icon, Input, NativeSelect, Table, Text } from '@chakra-ui/react'
import { LuSearch } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import { COLORS, CHART } from '@/theme/colors'
import { filterMovements } from '@/data/dashboardData'
import { formatNumber } from '@/utils/format'

const STATUS = {
  sold: { label: 'Sold', color: CHART.sold },
  reserved: { label: 'Reserved', color: CHART.reserved },
}

/** Status reads as dot + word, never color alone. */
function StatusTag({ status }) {
  const meta = STATUS[status] ?? { label: status, color: COLORS.subtle }
  return (
    <Flex align="center" gap="6px">
      <Box boxSize="7px" borderRadius="full" bg={meta.color} flexShrink={0} />
      <Text
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="600"
        fontSize="12px"
        lineHeight="16px"
        color={meta.color}
      >
        {meta.label}
      </Text>
    </Flex>
  )
}

function HeadCell({ children, align = 'start' }) {
  return (
    <Table.ColumnHeader
      textAlign={align}
      borderColor={COLORS.border}
      fontFamily="Inter, system-ui, sans-serif"
      fontWeight="600"
      fontSize="11px"
      lineHeight="15px"
      letterSpacing="0.3px"
      color={COLORS.subtle}
      textTransform="none"
      py="10px"
      whiteSpace="nowrap"
    >
      {children}
    </Table.ColumnHeader>
  )
}

function PageButton({ children, isActive, onClick, disabled, ...rest }) {
  return (
    <Flex
      as="button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      // A disabled step button is greyed rather than removed, so the row keeps
      // its width and the numbers do not shift under the pointer.
      opacity={disabled ? 0.45 : 1}
      {...rest}
      align="center"
      justify="center"
      minW="28px"
      h="28px"
      px="8px"
      borderRadius="6px"
      cursor={disabled ? 'default' : 'pointer'}
      bg={isActive ? COLORS.activeBg : 'transparent'}
      color={isActive ? '#FFFFFF' : COLORS.subtle}
      _hover={{ bg: isActive ? COLORS.activeBg : COLORS.hoverBg }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
    >
      <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="12px">
        {children}
      </Text>
    </Flex>
  )
}

/**
 * `filters` is the page's own — the Filters menu in the hero — so the header
 * controls, this table and the export all describe the same set of movements.
 * The project select here writes back through onProjectChange rather than
 * keeping a second copy of that choice.
 */
export default function RecentTransactionsCard({ transactions, filters = {}, onProjectChange }) {
  const [query, setQuery] = useState('')
  /*
   * The page being read. Paging happens here because every movement is already
   * loaded, so turning a page asks the database for nothing.
   */
  const [page, setPage] = useState(1)
  const { rows, total, pageSize, projects = [] } = transactions
  const project = filters.project ?? 'overall'

  const needle = query.trim().toLowerCase()
  const filtered = filterMovements(rows, filters)
  const matches = needle
    ? filtered.filter((row) => [row.property, row.status].some((field) => field?.toLowerCase().includes(needle)))
    : filtered

  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize))
  // A search shortens the list, so the page being read may no longer exist.
  const current = Math.min(page, pageCount)
  const visible = matches.slice((current - 1) * pageSize, current * pageSize)

  /*
   * The page numbers to offer: the first and last, the current page and its
   * neighbours, and an ellipsis wherever that skips a stretch. The old row
   * printed page, page + 1, page + 2 and the last — buttons that never moved,
   * because nothing was wired to them and the card held only one page of rows.
   */
  const numbers = []
  for (let n = 1; n <= pageCount; n += 1) {
    if (n === 1 || n === pageCount || Math.abs(n - current) <= 1) numbers.push(n)
    else if (numbers[numbers.length - 1] !== '…') numbers.push('…')
  }

  return (
    <Card display="flex" flexDirection="column">
      <Flex align="flex-start" justify="space-between" gap="16px" mb="14px" flexWrap="wrap">
        <Box minW={0}>
          <Text
            fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
            fontWeight="700"
            fontSize="16px"
            lineHeight="22px"
            letterSpacing="-0.2px"
            color={COLORS.heading}
          >
            Sold & Reserved Lots
          </Text>
          <Text
            mt="2px"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="13px"
            lineHeight="18px"
            color={COLORS.subtle}
          >
            {/* No "newest first": the lot tables hold no date to order them by. */}
            {project === 'overall'
              ? 'Every lot sold or reserved, across every project.'
              : `Lots sold or reserved in ${projects.find((option) => option.code === project)?.name ?? project}.`}
          </Text>
        </Box>

        <Flex align="center" gap="8px" flexWrap="wrap" justify="flex-end">
          {/* Overall, then one entry per project that actually has movements. */}
          {projects.length > 1 ? (
            <NativeSelect.Root size="sm" w="auto" minW="150px" flexShrink={0}>
              <NativeSelect.Field
                value={project}
                onChange={(event) => {
                  onProjectChange?.(event.target.value)
                  // Another project is another list, which starts at its first page.
                  setPage(1)
                }}
                aria-label="Show transactions for"
                h="34px"
                bg={COLORS.hoverBg}
                border="1px solid transparent"
                borderRadius="8px"
                fontFamily="Inter, system-ui, sans-serif"
                fontWeight="500"
                fontSize="12.5px"
                color={COLORS.heading}
                _focusVisible={{ borderColor: COLORS.activeBg, outline: 'none' }}
              >
                <option value="overall">Overall</option>
                {projects.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator color={COLORS.subtle} />
            </NativeSelect.Root>
          ) : null}

          <Flex align="center" position="relative" w="220px" maxW="100%" flexShrink={0}>
          <Icon
            as={LuSearch}
            boxSize="14px"
            color={COLORS.subtle}
            position="absolute"
            left="10px"
            pointerEvents="none"
            zIndex={1}
          />
          <Input
            name="transaction-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              // A new search starts at its own first page, not wherever the last left off.
              setPage(1)
            }}
            placeholder="Search project, phase, lot..."
            aria-label="Search transactions by project, phase, or lot"
            h="34px"
            pl="30px"
            bg={COLORS.hoverBg}
            border="1px solid transparent"
            borderRadius="8px"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="12px"
            color={COLORS.heading}
            _placeholder={{ color: COLORS.subtle }}
            _focusVisible={{ borderColor: COLORS.activeBg, bg: COLORS.surface, outline: 'none' }}
          />
          </Flex>
        </Flex>
      </Flex>

      <Box overflowX="auto">
        <Table.Root size="sm" minW="600px">
          <Table.Header>
            <Table.Row bg="transparent">
              <HeadCell>Property</HeadCell>
              <HeadCell>Status</HeadCell>
              <HeadCell align="end">Lot Area</HeadCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {visible.map((row) => (
              <Table.Row key={row.id} bg="transparent">
                <Table.Cell borderColor={COLORS.border} py="12px">
                  <Text
                    fontFamily="Inter, system-ui, sans-serif"
                    fontSize="13px"
                    lineHeight="18px"
                    color={COLORS.heading}
                  >
                    {row.property}
                  </Text>
                  <Text
                    fontFamily="Inter, system-ui, sans-serif"
                    fontSize="11px"
                    lineHeight="15px"
                    color={COLORS.subtle}
                  >
                    {formatNumber(row.areaSqm)} sqm
                  </Text>
                </Table.Cell>
                <Table.Cell borderColor={COLORS.border} py="12px">
                  <StatusTag status={row.status} />
                </Table.Cell>
                <Table.Cell borderColor={COLORS.border} py="12px" textAlign="end">
                  <Text
                    fontFamily="Inter, system-ui, sans-serif"
                    fontWeight="600"
                    fontSize="13px"
                    lineHeight="18px"
                    color={COLORS.heading}
                    whiteSpace="nowrap"
                  >
                    {formatNumber(row.areaSqm)} sqm
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>

        {visible.length === 0 ? (
          <Flex justify="center" py="28px">
            <Text fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.subtle}>
              {needle ? `No transactions match “${query}”.` : 'No transactions recorded yet.'}
            </Text>
          </Flex>
        ) : null}
      </Box>

      <Flex align="center" justify="space-between" gap="12px" mt="14px" flexWrap="wrap">
        <Text
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="12px"
          lineHeight="16px"
          color={COLORS.subtle}
        >
          {/* Which rows these are, out of how many the search left — a count of
              everything would not explain a page of three. */}
          Showing {visible.length ? `${(current - 1) * pageSize + 1}–${(current - 1) * pageSize + visible.length}` : 0} of{' '}
          {formatNumber(matches.length)}
          {/* The total in brackets is every movement on record, so a narrow
              window never looks like the whole history. */}
          {matches.length === total ? ' transactions' : ` transactions (of ${formatNumber(total)})`}
        </Text>
        {/* Only paginate when there is more than one page of results. */}
        {pageCount > 1 ? (
          <Flex align="center" gap="4px" maxW="100%" minW={0} overflowX="auto">
            {/* Stepping one page at a time is how a list like this is read; the
                numbers are for jumping. Disabled at the ends rather than hidden,
                so the row does not change width as it is used. */}
            <PageButton
              onClick={() => setPage(Math.max(1, current - 1))}
              disabled={current === 1}
              aria-label="Previous page"
            >
              &lt;
            </PageButton>
            {numbers.map((n, index) =>
              n === '…' ? (
                // Keyed by position: an ellipsis stands for a different stretch
                // on either side of the current page.
                <PageButton key={`gap-${index}`} disabled>
                  …
                </PageButton>
              ) : (
                <PageButton key={n} isActive={n === current} onClick={() => setPage(n)}>
                  {n}
                </PageButton>
              ),
            )}
            <PageButton
              onClick={() => setPage(Math.min(pageCount, current + 1))}
              disabled={current === pageCount}
              aria-label="Next page"
            >
              &gt;
            </PageButton>
          </Flex>
        ) : null}
      </Flex>
    </Card>
  )
}
