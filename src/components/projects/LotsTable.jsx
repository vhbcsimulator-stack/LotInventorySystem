import { Box, Checkbox, Flex, Icon, Menu, NativeSelect, Portal, Spinner, Table, Text } from '@chakra-ui/react'
import { LuArrowDown, LuArrowUp, LuCopy, LuEllipsisVertical, LuEye, LuPencil, LuTrash2 } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import Pagination from '@/components/ui-kit/Pagination'
import { COLORS, LOT_STATUS } from '@/theme/colors'
import { formatNumber, formatPeso } from '@/utils/format'
import { DEFAULT_LOT_TERMS, LOT_STATUS_OPTIONS } from '@/data/projectsData'

const PAGE_SIZES = [10, 25, 50]
const HEADER_BG = '#EEF3FC'
// Select, identifier, category, area, status, actions — the columns every project shows.
const FIXED_COLUMNS = 6

const NEUTRAL_STATUS = { fg: COLORS.muted, bg: COLORS.hoverBg, dot: COLORS.subtle }

/** Status pill that is also the picker: dot + word, never color alone. Without `onChange` it is a plain pill. */
function StatusSelect({ lot, saving, onChange }) {
  const meta = LOT_STATUS[lot.status] ?? NEUTRAL_STATUS

  if (!onChange) {
    return (
      <Flex display="inline-flex" align="center" gap="6px" h="26px" px="10px" borderRadius="full" bg={meta.bg}>
        <Box boxSize="6px" borderRadius="full" bg={meta.dot} flexShrink={0} />
        <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="12px" color={meta.fg} whiteSpace="nowrap">
          {LOT_STATUS_OPTIONS.find((option) => option.value === lot.rawStatus)?.label ?? (lot.rawStatus || '—')}
        </Text>
      </Flex>
    )
  }

  return (
    <Flex display="inline-flex" align="center" h="26px" pl="10px" borderRadius="full" bg={meta.bg}>
      {saving ? (
        <Spinner size="xs" color={meta.fg} flexShrink={0} />
      ) : (
        <Box boxSize="6px" borderRadius="full" bg={meta.dot} flexShrink={0} />
      )}
      <NativeSelect.Root size="xs" w="auto" disabled={saving || !onChange}>
        <NativeSelect.Field
          name="lot-status"
          aria-label={`Status of lot ${lot.identifier}`}
          value={lot.rawStatus}
          onChange={(event) => onChange?.(lot, event.target.value)}
          h="26px"
          pl="6px"
          pr="24px"
          bg="transparent"
          border="none"
          borderRadius="full"
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight="600"
          fontSize="12px"
          color={meta.fg}
          cursor="pointer"
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
        >
          {LOT_STATUS_OPTIONS.some((option) => option.value === lot.rawStatus) ? null : (
            <option value={lot.rawStatus}>{lot.rawStatus || '—'}</option>
          )}
          {LOT_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator color={meta.fg} />
      </NativeSelect.Root>
    </Flex>
  )
}

/**
 * The Status cell: the pill, then who sold it or who it is reserved for. The
 * import preview renders this same cell so it shows exactly what the table will.
 */
export function LotStatusCell({ lot, saving, onChange }) {
  return (
    <>
      <StatusSelect lot={lot} saving={saving} onChange={onChange} />
      {lot.rawStatus === 'sold' && lot.soldBy ? (
        <Text
          mt="4px"
          pl="4px"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="11px"
          color={COLORS.subtle}
          whiteSpace="nowrap"
          title={`Sold by ${lot.soldBy}`}
        >
          by {lot.soldBy}
        </Text>
      ) : null}
      {lot.status === 'reserved' && lot.reserveType ? (
        <Text mt="4px" pl="4px" fontFamily="Inter, system-ui, sans-serif" fontSize="11px" color={COLORS.subtle} whiteSpace="nowrap">
          {`${lot.reserveType === 'company' ? 'Company' : 'Client'} Reserve${lot.reservedFor ? ` · ${lot.reservedFor}` : ''}`}
        </Text>
      ) : null}
    </>
  )
}

function SelectBox({ checked, onChange, label }) {
  return (
    <Checkbox.Root size="sm" checked={checked} onCheckedChange={onChange} colorPalette="green">
      <Checkbox.HiddenInput name="select-lot" aria-label={label} />
      <Checkbox.Control>
        <Checkbox.Indicator />
      </Checkbox.Control>
    </Checkbox.Root>
  )
}

function HeaderCell({ children, align = 'start', sortKey, sort, onSort }) {
  const isSorted = Boolean(sortKey) && sort.by === sortKey

  return (
    <Table.ColumnHeader
      textAlign={align}
      aria-sort={isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      bg={HEADER_BG}
      borderColor={COLORS.border}
      py="14px"
      fontFamily="Inter, system-ui, sans-serif"
      fontWeight="600"
      fontSize="11px"
      lineHeight="15px"
      letterSpacing="0.6px"
      textTransform="uppercase"
      color={COLORS.muted}
      whiteSpace="nowrap"
    >
      {sortKey ? (
        <Flex
          as="button"
          type="button"
          onClick={() => onSort(sortKey)}
          align="center"
          justify={align === 'end' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'}
          gap="4px"
          w="full"
          cursor="pointer"
          textTransform="inherit"
          letterSpacing="inherit"
          color={isSorted ? COLORS.heading : 'inherit'}
          _hover={{ color: COLORS.heading }}
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
        >
          {children}
          {isSorted ? <Icon as={sort.dir === 'asc' ? LuArrowUp : LuArrowDown} boxSize="12px" /> : null}
        </Flex>
      ) : (
        children
      )}
    </Table.ColumnHeader>
  )
}

function RowActions({ lot, onDetails, onRowAction }) {
  return (
    <Flex align="center" justify="center" gap="4px">

      <Menu.Root onSelect={(details) => details.value === 'details' ? onDetails?.(lot) : onRowAction?.(details.value, lot)}>
        <Menu.Trigger
          aria-label={`More actions for lot ${lot.identifier}`}
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxSize="30px"
          borderRadius="6px"
          bg="transparent"
          color={COLORS.muted}
          cursor="pointer"
          _hover={{ bg: COLORS.hoverBg }}
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
        >
          <Icon as={LuEllipsisVertical} boxSize="16px" />
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content minW="170px">
              <Menu.Item value="details" gap="8px" fontSize="13px">
                <Icon as={LuEye} boxSize="14px" />
                View details
              </Menu.Item>
              <Menu.Item value="copy-row" gap="8px" fontSize="13px">
                <Icon as={LuCopy} boxSize="14px" />
                Copy row
              </Menu.Item>
              <Menu.Item value="update" gap="8px" fontSize="13px">
                <Icon as={LuPencil} boxSize="14px" />
                Update
              </Menu.Item>
              <Menu.Item value="delete" gap="8px" fontSize="13px" color="#DC2626" _hover={{ bg: '#FDECEC', color: '#B91C1C' }}>
                <Icon as={LuTrash2} boxSize="14px" />
                Delete
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
    </Flex>
  )
}

/**
 * One server-side page of lots. Sorting, paging, and page size are reported up
 * so the page component can re-query the database; this table never filters or
 * sorts rows itself.
 */
export default function LotsTable({
  lots,
  loading,
  hasFilters,
  selectedIds,
  onToggleRow,
  onTogglePage,
  sort,
  onSort,
  onDetails,
  onRowAction,
  onStatusChange,
  savingIds,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  projectName,
  // What the project calls its lots and their grouping; `group` null hides that column.
  terms = DEFAULT_LOT_TERMS,
}) {
  const pageIds = lots.map((lot) => lot.id)
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length
  let headerChecked = false
  if (pageIds.length > 0 && selectedOnPage === pageIds.length) headerChecked = true
  else if (selectedOnPage > 0) headerChecked = 'indeterminate'

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  // Condominium projects (MSCC) add per-unit columns and drop the pricing pair.
  const unitFields = terms.unitFields ?? []
  const showPricing = terms.pricing !== false
  const columnCount = FIXED_COLUMNS + unitFields.length + (terms.group ? 1 : 0) + (showPricing ? 2 : 0)

  const cellProps = { borderColor: COLORS.border, py: '16px', textAlign: 'center' }

  return (
    <Card p="0" overflow="hidden">
      <Box display={{ base: 'block', md: 'none' }} opacity={loading ? 0.55 : 1} transition="opacity 120ms ease">
        {lots.length > 0 ? (
          <Flex align="center" gap="10px" px="16px" py="10px" bg={HEADER_BG}>
            <SelectBox checked={headerChecked} onChange={() => onTogglePage(pageIds)} label="Select all lots on this page" />
            <Text fontFamily="Inter, system-ui, sans-serif" fontSize="12px" fontWeight="600" color={COLORS.heading}>Select page</Text>
          </Flex>
        ) : null}
        {lots.length === 0 ? (
          <Text py="40px" px="16px" textAlign="center" fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.subtle}>
            {hasFilters ? `No ${terms.item.toLowerCase()}s match these filters.` : `No ${terms.item.toLowerCase()}s recorded yet.`}
          </Text>
        ) : lots.map((lot) => (
          <Box as="article" key={lot.id} px="16px" py="14px" borderBottom="1px solid" borderColor={COLORS.border} bg={selectedIds.has(lot.id) ? '#F5F8FF' : COLORS.surface}>
            <Flex align="center" justify="space-between" gap="10px">
              <Flex align="center" gap="10px" minW={0}>
                <SelectBox checked={selectedIds.has(lot.id)} onChange={() => onToggleRow(lot.id)} label={`Select lot ${lot.identifier}`} />
                <Text fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontWeight="700" fontSize="15px" color={COLORS.heading} truncate>{lot.identifier}</Text>
              </Flex>
              <RowActions lot={lot} onDetails={onDetails} onRowAction={onRowAction} />
            </Flex>
            <Flex mt="10px" gap="6px 14px" flexWrap="wrap" fontFamily="Inter, system-ui, sans-serif" fontSize="12px" color={COLORS.muted}>
              {terms.group ? <Text>{terms.group}: {lot.phase}</Text> : null}
              <Text>Category: {lot.category}</Text>
              <Text>{terms.area}: {formatNumber(lot.areaSqm)} sqm</Text>
              {unitFields.map((field) => <Text key={field.key}>{field.label}: {lot[field.key] || '—'}</Text>)}
              {showPricing ? (
                <>
                  <Text>Price / sqm: {formatPeso(lot.pricePerSqm)}</Text>
                  <Text>TCP: {formatPeso(lot.tcp)}{lot.vatInclusive === null ? '' : lot.vatInclusive ? ' · VAT Incl.' : ' · VAT Excl.'}</Text>
                </>
              ) : null}
            </Flex>
            <Flex align="center" justify="space-between" gap="8px" mt="12px" flexWrap="wrap">
              <StatusSelect lot={lot} saving={savingIds?.has(lot.id)} onChange={onStatusChange} />
              {lot.rawStatus === 'sold' && lot.soldBy ? <Text fontFamily="Inter, system-ui, sans-serif" fontSize="11px" color={COLORS.subtle} overflowWrap="anywhere">Sold by {lot.soldBy}</Text> : null}
              {lot.status === 'reserved' && lot.reserveType ? (
                <Text fontFamily="Inter, system-ui, sans-serif" fontSize="11px" color={COLORS.subtle} overflowWrap="anywhere">
                  {`${lot.reserveType === 'company' ? 'Company' : 'Client'} Reserve${lot.reservedFor ? ` · ${lot.reservedFor}` : ''}`}
                </Text>
              ) : null}
            </Flex>
          </Box>
        ))}
      </Box>
      <Box overflowX="auto" display={{ base: 'none', md: 'block' }}>
        <Table.Root size="sm" minW="980px">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader bg={HEADER_BG} borderColor={COLORS.border} w="48px" pl="20px">
                <SelectBox
                  checked={headerChecked}
                  onChange={() => onTogglePage(pageIds)}
                  label="Select all lots on this page"
                />
              </Table.ColumnHeader>
              <HeaderCell align="center" sortKey="identifier" sort={sort} onSort={onSort}>
                {terms.identifier}
              </HeaderCell>
              {terms.group ? (
                <HeaderCell align="center" sortKey="phase" sort={sort} onSort={onSort}>
                  {terms.group}
                </HeaderCell>
              ) : null}
              <HeaderCell align="center">Category</HeaderCell>
              {unitFields.map((field) => (
                <HeaderCell key={field.key} align="center">
                  {field.label}
                </HeaderCell>
              ))}
              <HeaderCell align="center" sortKey="areaSqm" sort={sort} onSort={onSort}>
                {terms.area}
              </HeaderCell>
              {terms.pricing === false ? null : (
                <>
                  <HeaderCell align="center" sortKey="pricePerSqm" sort={sort} onSort={onSort}>
                    Price / sqm
                  </HeaderCell>
                  <HeaderCell align="center" sortKey="tcp" sort={sort} onSort={onSort}>
                    TCP
                  </HeaderCell>
                </>
              )}
              <HeaderCell align="center">Status</HeaderCell>
              <HeaderCell align="center">Actions</HeaderCell>
            </Table.Row>
          </Table.Header>

          <Table.Body opacity={loading ? 0.55 : 1} transition="opacity 120ms ease">
            {lots.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={columnCount} borderColor={COLORS.border} py="48px" textAlign="center">
                  <Text fontFamily="Inter, system-ui, sans-serif" fontSize="13px" color={COLORS.subtle}>
                    {hasFilters
                      ? `No ${terms.item.toLowerCase()}s match these filters.`
                      : `No ${terms.item.toLowerCase()}s recorded yet.`}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              lots.map((lot) => {
                const isSelected = selectedIds.has(lot.id)
                return (
                  <Table.Row
                    key={lot.id}
                    bg={isSelected ? '#F5F8FF' : 'transparent'}
                    _hover={{ bg: isSelected ? '#F5F8FF' : COLORS.canvas }}
                  >
                    <Table.Cell {...cellProps} pl="20px" textAlign="start">
                      <SelectBox
                        checked={isSelected}
                        onChange={() => onToggleRow(lot.id)}
                        label={`Select lot ${lot.identifier}`}
                      />
                    </Table.Cell>
                    <Table.Cell {...cellProps}>
                      <Text
                        fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
                        fontWeight="600"
                        fontSize="15px"
                        color={COLORS.heading}
                        whiteSpace="nowrap"
                      >
                        {lot.identifier}
                      </Text>
                    </Table.Cell>
                    {terms.group ? (
                      <Table.Cell {...cellProps}>
                        <Text
                          fontFamily="Inter, system-ui, sans-serif"
                          fontSize="13px"
                          color={COLORS.muted}
                          whiteSpace="nowrap"
                        >
                          {lot.phase}
                        </Text>
                      </Table.Cell>
                    ) : null}
                    <Table.Cell {...cellProps}>
                      <Text
                        fontFamily="Inter, system-ui, sans-serif"
                        fontWeight="600"
                        fontSize="13px"
                        color={COLORS.heading}
                      >
                        {lot.category}
                      </Text>
                    </Table.Cell>
                    {unitFields.map((field) => (
                      <Table.Cell key={field.key} {...cellProps}>
                        <Text
                          fontFamily="Inter, system-ui, sans-serif"
                          fontSize="13px"
                          color={COLORS.muted}
                          whiteSpace="nowrap"
                        >
                          {lot[field.key] || '—'}
                        </Text>
                      </Table.Cell>
                    ))}
                    <Table.Cell {...cellProps}>
                      <Text
                        fontFamily="Inter, system-ui, sans-serif"
                        fontWeight="600"
                        fontSize="14px"
                        color={COLORS.heading}
                      >
                        {formatNumber(lot.areaSqm)}
                      </Text>
                      <Text fontFamily="Inter, system-ui, sans-serif" fontSize="11px" color={COLORS.subtle}>
                        sqm
                      </Text>
                    </Table.Cell>
                    {showPricing ? (
                      <>
                        <Table.Cell {...cellProps}>
                          <Text
                            fontFamily="Inter, system-ui, sans-serif"
                            fontSize="14px"
                            color={COLORS.muted}
                            whiteSpace="nowrap"
                          >
                            {formatPeso(lot.pricePerSqm)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell {...cellProps}>
                          <Text
                            fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
                            fontWeight="700"
                            fontSize="15px"
                            color={COLORS.heading}
                            whiteSpace="nowrap"
                          >
                            {formatPeso(lot.tcp)}
                          </Text>
                          {lot.vatInclusive === null ? null : (
                            <Text fontFamily="Inter, system-ui, sans-serif" fontSize="11px" color={COLORS.subtle}>
                              {lot.vatInclusive ? 'VAT Incl.' : 'VAT Excl.'}
                            </Text>
                          )}
                        </Table.Cell>
                      </>
                    ) : null}
                    <Table.Cell {...cellProps}>
                      <LotStatusCell lot={lot} saving={savingIds?.has(lot.id)} onChange={onStatusChange} />
                    </Table.Cell>
                    <Table.Cell {...cellProps} pr="20px">
                      <RowActions lot={lot} onDetails={onDetails} onRowAction={onRowAction} />
                    </Table.Cell>
                  </Table.Row>
                )
              })
            )}
          </Table.Body>
        </Table.Root>
      </Box>

      <Flex
        align="center"
        justify="space-between"
        gap="12px"
        px="20px"
        py="14px"
        flexWrap="wrap"
        borderTop="1px solid"
        borderColor={COLORS.border}
      >
        <Flex align="center" gap="20px" flexWrap="wrap">
          <Text fontFamily="Inter, system-ui, sans-serif" fontSize="12px" color={COLORS.subtle}>
            Showing{' '}
            <Text as="span" fontWeight="600" color={COLORS.heading}>
              {from}–{to}
            </Text>{' '}
            of{' '}
            <Text as="span" fontWeight="600" color={COLORS.heading}>
              {formatNumber(total)}
            </Text>{' '}
            {terms.item.toLowerCase()}s{projectName ? ` in ${projectName}` : ''}
          </Text>

          <Flex align="center" gap="8px">
            <Text fontFamily="Inter, system-ui, sans-serif" fontSize="12px" color={COLORS.subtle}>
              Rows:
            </Text>
            <NativeSelect.Root size="xs" w="70px">
              <NativeSelect.Field
                name="rows-per-page"
                aria-label="Rows per page"
                value={pageSize}
                onChange={(event) => onPageSizeChange(Number(event.target.value))}
                bg={COLORS.statusBg}
                border="1px solid transparent"
                borderRadius="6px"
                fontFamily="Inter, system-ui, sans-serif"
                fontWeight="600"
                fontSize="12px"
                color={COLORS.heading}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator color={COLORS.subtle} />
            </NativeSelect.Root>
          </Flex>
        </Flex>

        <Pagination page={page} pageCount={pageCount} onChange={onPageChange} />
      </Flex>
    </Card>
  )
}
