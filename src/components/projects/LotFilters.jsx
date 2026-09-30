import { Box, Flex, Icon, Input, NativeSelect, Text } from '@chakra-ui/react'
import { LuArrowDown, LuArrowUp, LuRotateCcw, LuSearch, LuX } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import RefreshButton from '@/components/ui-kit/RefreshButton'
import { DEFAULT_LOT_TERMS, SORTABLE_FIELDS } from '@/data/projectsData'
import { COLORS, LOT_STATUS } from '@/theme/colors'

function FilterSelect({ name, placeholder, value, options, onChange }) {
  return (
    <NativeSelect.Root size="sm" w="auto" minW="150px" flexShrink={0}>
      <NativeSelect.Field
        name={name}
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        h="40px"
        pl="12px"
        bg={COLORS.hoverBg}
        border="1px solid transparent"
        borderRadius="8px"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="500"
        fontSize="13px"
        color={COLORS.heading}
        _focusVisible={{ borderColor: COLORS.activeBg, outline: 'none' }}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator color={COLORS.subtle} />
    </NativeSelect.Root>
  )
}

function Chip({ label, onRemove }) {
  return (
    <Flex align="center" gap="4px" h="26px" pl="10px" pr="4px" borderRadius="full" bg={COLORS.statusBg}>
      <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="12px" color={COLORS.heading}>
        {label}
      </Text>
      <Flex
        as="button"
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        align="center"
        justify="center"
        boxSize="18px"
        borderRadius="full"
        cursor="pointer"
        _hover={{ bg: '#D3E0FB' }}
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
      >
        <Icon as={LuX} boxSize="12px" color={COLORS.subtle} />
      </Flex>
    </Flex>
  )
}

/**
 * Search, filter, and sort controls for the lots table. Phase and category
 * options come from the database via `facets`; statuses are the fixed set the
 * API understands. The phase list mirrors the distinct values displayed in the
 * Phase column; category choices remain in the separate category filter.
 */
export default function LotFilters({
  search,
  onSearchChange,
  filters,
  facets,
  onFilterChange,
  onReset,
  sort,
  onSortDirToggle,
  // Re-checks the lots (table and stats) against Supabase; omitted hides the button.
  onRefresh,
  // What the project calls its lots and their grouping; `group` null hides that filter.
  terms = DEFAULT_LOT_TERMS,
}) {
  const statusOptions = Object.entries(LOT_STATUS).map(([value, meta]) => ({ value, label: meta.label }))
  // Phase filter choices match the values displayed in the system's Phase column.
  const phaseOptions = (facets.phaseFilters ?? facets.phases).map((phase) => ({ value: phase, label: phase }))
  const categoryOptions = facets.categories.map((category) => ({ value: category, label: category }))
  /*
   * Block / Lot appear once a phase is picked, listing
   * only that phase's blocks — and the lots of the chosen block, or of the whole
   * phase when no block is chosen. Offered only where identifiers read "B12 L5".
   */
  const phaseBlocks = (filters.phase && facets.blockLotsByPhase?.[filters.phase]) || {}
  const blockOptions = Object.keys(phaseBlocks).map((block) => ({ value: block, label: block === 'C' ? 'C (Commercial)' : block }))
  const lotOptions = [
    ...new Set(filters.block ? (phaseBlocks[filters.block] ?? []) : Object.values(phaseBlocks).flat()),
  ]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((lot) => ({ value: lot, label: `L${lot}` }))
  const hasBlocks = blockOptions.length > 0
  // Condominium projects (MSCC) also filter by Floor Level, from the form's own choices.
  const floorField = terms.unitFields?.find((field) => field.key === 'floorLevel')
  const floorOptions = (floorField?.options ?? []).map((floor) => ({ value: floor, label: floor }))

  const trimmed = search.trim()
  const chips = [
    trimmed && { key: 'search', label: `“${trimmed}”`, clear: () => onSearchChange('') },
    filters.status && {
      key: 'status',
      label: LOT_STATUS[filters.status]?.label ?? filters.status,
      clear: () => onFilterChange({ status: '' }),
    },
    filters.phase && { key: 'phase', label: filters.phase, clear: () => onFilterChange({ phase: '' }) },
    filters.category && {
      key: 'category',
      label: filters.category,
      clear: () => onFilterChange({ category: '' }),
    },
    filters.block && { key: 'block', label: `Block ${filters.block}`, clear: () => onFilterChange({ block: '' }) },
    filters.lot && { key: 'lot', label: `Lot ${filters.lot}`, clear: () => onFilterChange({ lot: '' }) },
    filters.floor && { key: 'floor', label: filters.floor, clear: () => onFilterChange({ floor: '' }) },
  ].filter(Boolean)

  const hasActive = chips.length > 0
  const termLabels = { phase: terms.group ?? SORTABLE_FIELDS.phase, identifier: terms.identifier, areaSqm: terms.area }
  const sortLabel = termLabels[sort.by] ?? SORTABLE_FIELDS[sort.by] ?? sort.by
  const isAsc = sort.dir === 'asc'

  return (
    <Card p="20px">
      <Flex align="center" gap="10px" flexWrap="wrap">
        <Flex align="center" position="relative" flex="1" minW="240px">
          <Icon
            as={LuSearch}
            boxSize="15px"
            color={COLORS.subtle}
            position="absolute"
            left="13px"
            pointerEvents="none"
            zIndex={1}
          />
          <Input
            name="lot-search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={`Search ${[terms.item, terms.group].filter(Boolean).join(', ').toLowerCase()}, category${
              terms.pricing === false ? '' : ', price, TCP'
            }, or status...`}
            aria-label="Search lots by any column"
            h="40px"
            pl="38px"
            bg={COLORS.hoverBg}
            border="1px solid transparent"
            borderRadius="8px"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="13px"
            color={COLORS.heading}
            _placeholder={{ color: COLORS.subtle }}
            _focusVisible={{ borderColor: COLORS.activeBg, bg: COLORS.surface, outline: 'none' }}
          />
        </Flex>

        <FilterSelect
          name="status"
          placeholder="All Statuses"
          value={filters.status}
          options={statusOptions}
          onChange={(status) => onFilterChange({ status })}
        />
        {terms.group ? (
          <FilterSelect
            name="phase"
            placeholder={`All ${terms.group}s`}
            value={filters.phase}
            options={phaseOptions}
            onChange={(phase) => onFilterChange({ phase })}
          />
        ) : null}
        <FilterSelect
          name="category"
          placeholder="All Categories"
          value={filters.category}
          options={categoryOptions}
          onChange={(category) => onFilterChange({ category })}
        />
        {floorField ? (
          <FilterSelect
            name="floor"
            placeholder="All Floors"
            value={filters.floor ?? ''}
            options={floorOptions}
            onChange={(floor) => onFilterChange({ floor })}
          />
        ) : null}
        {hasBlocks ? (
          <>
            <FilterSelect
              name="block"
              placeholder="All Blocks"
              value={filters.block}
              options={blockOptions}
              onChange={(block) => onFilterChange({ block })}
            />
            <FilterSelect
              name="lot"
              placeholder={filters.block ? `All lots in ${filters.block}` : 'All Lots'}
              value={filters.lot}
              options={lotOptions}
              onChange={(lot) => onFilterChange({ lot })}
            />
          </>
        ) : null}

        <Box w="1px" h="24px" bg={COLORS.border} display={{ base: 'none', md: 'block' }} />

        <Flex
          as="button"
          type="button"
          onClick={onReset}
          align="center"
          gap="6px"
          h="40px"
          px="8px"
          borderRadius="8px"
          color={COLORS.muted}
          cursor="pointer"
          _hover={{ bg: COLORS.hoverBg }}
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
        >
          <Icon as={LuRotateCcw} boxSize="14px" />
          <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="500" fontSize="13px">
            Reset
          </Text>
        </Flex>

        {onRefresh ? <RefreshButton onRefresh={onRefresh} label={`Refresh ${terms.item.toLowerCase()}s`} size="40px" /> : null}
      </Flex>

      <Flex mt="14px" align="center" justify="space-between" gap="12px" flexWrap="wrap">
        <Flex align="center" gap="8px" flexWrap="wrap">
          <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="500" fontSize="12px" color={COLORS.subtle}>
            Active:
          </Text>
          {hasActive ? (
            chips.map((chip) => <Chip key={chip.key} label={chip.label} onRemove={chip.clear} />)
          ) : (
            <Text fontFamily="Inter, system-ui, sans-serif" fontSize="12px" color={COLORS.subtle}>
              No filters
            </Text>
          )}
        </Flex>

        <Flex
          as="button"
          type="button"
          onClick={onSortDirToggle}
          aria-label={`Sorted by ${sortLabel}, ${isAsc ? 'ascending' : 'descending'}. Reverse order.`}
          align="center"
          gap="6px"
          px="6px"
          h="28px"
          borderRadius="6px"
          cursor="pointer"
          _hover={{ bg: COLORS.hoverBg }}
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg }}
        >
          <Text fontFamily="Inter, system-ui, sans-serif" fontSize="12px" color={COLORS.subtle}>
            Sorted by:
          </Text>
          <Text fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="12px" color={COLORS.heading}>
            {sortLabel}
          </Text>
          <Icon as={isAsc ? LuArrowUp : LuArrowDown} boxSize="13px" color={COLORS.heading} />
        </Flex>
      </Flex>
    </Card>
  )
}
